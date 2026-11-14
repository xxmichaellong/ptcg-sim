import type {
  ClientSessionState,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { MatchViewState, ViewCard } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import {
  orderedDeckEntries,
  tutorialCardKeyOf,
  type TutorialCardKey,
} from './tutorial-cards.js';
import {
  isLoadedSeat,
  seatDeckOrder,
  seatDrawCount,
  type TutorialPokemon,
  type TutorialScenario,
  type TutorialSeat,
} from './tutorial-scenarios.js';

/** What the runner needs of the room's session: its state and a way in. */
export interface ScenarioSession {
  readonly getSnapshot: () => ClientSessionState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly submit: (command: WireGameCommand) => SubmitCommandResult;
}

export class ScenarioError extends Error {
  override readonly name = 'ScenarioError';
}

/** How long one batch of commands may take before the deal is given up. */
const BATCH_TIMEOUT_MS = 15_000;

/**
 * Submits the commands and waits until the room has answered every one.
 * Any refusal, a session that is no longer ready, or a slow room gives up.
 */
const run = (
  session: ScenarioSession,
  commands: readonly WireGameCommand[],
  signal: AbortSignal
): Promise<void> => {
  if (commands.length === 0) return Promise.resolve();
  const ids = new Set<string>();
  for (const command of commands) {
    const result = session.submit(command);
    if (!result.queued) {
      return Promise.reject(
        new ScenarioError(`${command.type} was not sent: ${result.reason}`)
      );
    }
    ids.add(result.commandId);
  }
  return new Promise<void>((resolve, reject) => {
    let unsubscribe = (): void => undefined;
    const timer = setTimeout(() => {
      finish(new ScenarioError('The room took too long to deal the lesson'));
    }, BATCH_TIMEOUT_MS);
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = (): void => finish(new ScenarioError('Dealing stopped'));
    const check = (): void => {
      const state = session.getSnapshot();
      if (state.phase === 'closed' || state.phase === 'failed') {
        finish(new ScenarioError('The practice table closed'));
        return;
      }
      for (const completed of state.completedCommands) {
        if (!ids.has(completed.commandId)) continue;
        if (!completed.accepted) {
          finish(
            new ScenarioError(
              `The room refused a deal step (${completed.code ?? 'refused'})`
            )
          );
          return;
        }
      }
      const answered = state.completedCommands.filter((completed) =>
        ids.has(completed.commandId)
      ).length;
      if (answered === ids.size && state.pendingCommands.length === 0) {
        finish();
      }
    };
    signal.addEventListener('abort', onAbort);
    unsubscribe = session.subscribe(check);
    check();
  });
};

const viewOf = (session: ScenarioSession): MatchViewState => {
  const view = session.getSnapshot().view;
  if (!view) throw new ScenarioError('The practice table has no view');
  return view;
};

const zoneId = (playerId: string, kind: string): string =>
  `zone:${playerId}:${kind}`;

/**
 * Picks cards out of a seat's hand by name, each copy once: the hand is
 * what the deal drew, and every card the position needs is in it.
 */
const handPicker = (view: MatchViewState, playerId: string) => {
  const hand = view.zones[zoneId(playerId, 'hand')]?.cards ?? [];
  const used = new Set<string>();
  return (key: TutorialCardKey): ViewCard => {
    const card = hand.find(
      (candidate) =>
        !used.has(candidate.id) && tutorialCardKeyOf(view, candidate) === key
    );
    if (!card) throw new ScenarioError(`The deal drew no ${key}`);
    used.add(card.id);
    return card;
  };
};

/** The seat's Pokémon in play, Active first, then the Bench in order. */
const stacksOf = (view: MatchViewState, playerId: string) => {
  const board = view.boards[playerId];
  const ids = [
    ...(board?.activeStackId ? [board.activeStackId] : []),
    ...(board?.benchStackIds ?? []),
  ];
  return ids.map((id) => view.stacks[id]!);
};

/**
 * Lays out one seat that has drawn its position: the Prize cards, the
 * Pokémon (Basics, then their stages, then what is attached), the discard
 * pile and the damage, each through the same commands play uses.
 */
const layOut = async (
  session: ScenarioSession,
  playerId: string,
  seat: TutorialSeat,
  signal: AbortSignal
): Promise<void> => {
  const pokemon: TutorialPokemon[] = [
    ...(seat.active ? [seat.active] : []),
    ...(seat.bench ?? []),
  ];
  let view = viewOf(session);
  let pick = handPicker(view, playerId);
  const handZone = zoneId(playerId, 'hand');
  const first: WireGameCommand[] = [
    ...seat.prizes.map((key): WireGameCommand => ({
      type: 'MoveCard',
      cardId: pick(key).id,
      expectedSourceZoneId: handZone,
      destinationZoneId: zoneId(playerId, 'prizes'),
    })),
    ...pokemon.map((entry, index): WireGameCommand => ({
      type: 'MoveCardToPlay',
      cardId: pick(entry.card).id,
      expectedSourceZoneId: handZone,
      boardPlayerId: playerId,
      slot: index === 0 && seat.active ? 'active' : 'bench',
    })),
    ...(seat.discard ?? []).map((key): WireGameCommand => ({
      type: 'MoveCard',
      cardId: pick(key).id,
      expectedSourceZoneId: handZone,
      destinationZoneId: zoneId(playerId, 'discard'),
    })),
  ];
  await run(session, first, signal);

  // Stages, one round at a time: each lands on the card on top.
  const rounds = Math.max(
    0,
    ...pokemon.map((entry) => entry.evolutions?.length ?? 0)
  );
  for (let round = 0; round < rounds; round += 1) {
    view = viewOf(session);
    pick = handPicker(view, playerId);
    const stacks = stacksOf(view, playerId);
    const commands = pokemon.flatMap((entry, index): WireGameCommand[] => {
      const stage = entry.evolutions?.[round];
      const stack = stacks[index];
      const top = stack?.evolutionCards.at(-1);
      if (!stage || !stack || !top) return [];
      return [
        {
          type: 'PlaceCardOnPlayStack',
          cardId: pick(stage).id,
          expectedSourceId: handZone,
          targetStackId: stack.id,
          expectedTargetTopCardId: top.id,
          mode: 'evolution',
        },
      ];
    });
    await run(session, commands, signal);
  }

  // What is attached, one card per stack at a time, and the damage.
  const attachRounds = Math.max(
    0,
    ...pokemon.map((entry) => entry.attached?.length ?? 0)
  );
  for (let round = 0; round < attachRounds; round += 1) {
    view = viewOf(session);
    pick = handPicker(view, playerId);
    const stacks = stacksOf(view, playerId);
    const commands = pokemon.flatMap((entry, index): WireGameCommand[] => {
      const key = entry.attached?.[round];
      const stack = stacks[index];
      const top = stack?.evolutionCards.at(-1);
      if (!key || !stack || !top) return [];
      return [
        {
          type: 'PlaceCardOnPlayStack',
          cardId: pick(key).id,
          expectedSourceId: handZone,
          targetStackId: stack.id,
          expectedTargetTopCardId: top.id,
          mode: 'attachment',
        },
      ];
    });
    await run(session, commands, signal);
  }
  view = viewOf(session);
  const stacks = stacksOf(view, playerId);
  await run(
    session,
    pokemon.flatMap((entry, index): WireGameCommand[] => {
      const stack = stacks[index];
      return entry.damage && stack
        ? [{ type: 'SetDamage', stackId: stack.id, damage: entry.damage }]
        : [];
    }),
    signal
  );
};

/** The practice table's two seats: the viewer's, then the other. */
export const tutorialSeats = (
  view: MatchViewState
): { readonly you: string; readonly them: string } => {
  if (view.viewer.kind !== 'player') {
    throw new ScenarioError('The practice table has no player');
  }
  const you = view.viewer.playerId;
  const them = view.playerOrder.find((playerId) => playerId !== you);
  if (!them) throw new ScenarioError('The practice table has one seat');
  return { you, them };
};

/**
 * Deals a lesson's position onto the practice table: both decks loaded in
 * order (which also clears whatever was on the table), each laid-out seat
 * drawn and laid out. Resolves once the room has taken every move.
 */
export const dealScenario = async (
  session: ScenarioSession,
  scenario: TutorialScenario,
  signal: AbortSignal
): Promise<void> => {
  const { you, them } = tutorialSeats(viewOf(session));
  const seats = [
    [you, scenario.you],
    [them, scenario.them],
  ] as const;
  await run(
    session,
    seats.map(([playerId, seat]): WireGameCommand => ({
      type: 'LoadDeck',
      targetPlayerId: playerId,
      entries: orderedDeckEntries(seatDeckOrder(seat)),
    })),
    signal
  );
  await run(
    session,
    seats.flatMap(([playerId, seat]): WireGameCommand[] =>
      isLoadedSeat(seat)
        ? []
        : [
            {
              type: 'DrawCards',
              targetPlayerId: playerId,
              count: seatDrawCount(seat),
            },
          ]
    ),
    signal
  );
  for (const [playerId, seat] of seats) {
    if (!isLoadedSeat(seat)) await layOut(session, playerId, seat, signal);
  }
};
