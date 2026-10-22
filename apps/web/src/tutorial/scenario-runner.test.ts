import type { ClientSessionState } from '@ptcgsim/client-session';
import {
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  type CommandContext,
  type GameCommand,
  type MatchState,
  type MatchViewState,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import { dealScenario, ScenarioError } from './scenario-runner.js';
import { tutorialCardKeyOf } from './tutorial-cards.js';
import { MIDGAME_SCENARIO, START_SCENARIO } from './tutorial-scenarios.js';
import {
  activeStack,
  benchStacks,
  topCard,
  zoneCards,
} from './tutorial-world.js';

const you = asPlayerId('tutorial-you');
const them = asPlayerId('tutorial-them');

/**
 * A Solo room in miniature: the real game core runs each command, and the
 * one player sees every card (Solo shows both hands), as the room would
 * answer them. Shuffles keep order, so the test can read the deal.
 */
const fakeRoom = (options: { readonly refuse?: string } = {}) => {
  let next = 0;
  const context: CommandContext = {
    nextCardId: (definitionId, copy) =>
      asCardInstanceId(`${definitionId}#${String(copy)}#${String(next++)}`),
    nextStackId: () => asStackId(`stack-${String(next++)}`),
    nextInspectionId: () => asInspectionId(`inspection-${String(next++)}`),
    nextWorkAreaId: () => asWorkAreaId(`work-area-${String(next++)}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
  let match: MatchState = createEmptyMatch(asMatchId('tutorial'), [
    { playerId: you, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: them, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const sent: WireGameCommand[] = [];
  const completed: ClientSessionState['completedCommands'][number][] = [];
  const listeners = new Set<() => void>();
  const view = (): MatchViewState => {
    const known = (id: string) => {
      const card = match.cards[id]!;
      return {
        kind: 'known' as const,
        id,
        definitionId: card.definitionId,
        ownerId: card.ownerId,
        category: card.currentCategory,
        face: card.face,
        orientationQuarterTurns: card.orientationQuarterTurns,
        abilityUsed: false,
        publiclyRevealed: false,
      };
    };
    return {
      matchId: match.matchId,
      revision: match.revision,
      lifecycle: match.lifecycle,
      viewer: { kind: 'player', playerId: you },
      playerOrder: match.playerOrder,
      players: {},
      definitions: Object.fromEntries(
        Object.entries(match.definitions).map(([id, definition]) => [
          id,
          { ...definition, id },
        ])
      ),
      zones: Object.fromEntries(
        Object.entries(match.zones).map(([id, zone]) => [
          id,
          {
            id,
            kind: zone.kind,
            ownerId: zone.ownerId,
            cards: zone.cardIds.map(known),
          },
        ])
      ),
      boards: match.boards,
      stacks: Object.fromEntries(
        Object.entries(match.stacks).map(([id, stack]) => [
          id,
          {
            ...stack,
            evolutionCards: stack.evolutionCardIds.map(known),
            attachmentCards: stack.attachmentCardIds.map(known),
          },
        ])
      ),
    } as unknown as MatchViewState;
  };
  const toGame = (command: WireGameCommand): GameCommand => {
    const { targetPlayerId, ...rest } = command as WireGameCommand & {
      readonly targetPlayerId?: string;
    };
    if (command.type === 'LoadDeck' || command.type === 'DrawCards') {
      return { ...rest, playerId: asPlayerId(targetPlayerId!) } as GameCommand;
    }
    if (command.type === 'PlaceCardOnPlayStack') {
      // The room acts for the seat whose hand the card leaves (Solo).
      const owner = command.expectedSourceId.split(':')[1]!;
      return { ...rest, playerId: asPlayerId(owner) } as GameCommand;
    }
    return rest as GameCommand;
  };
  let state: ClientSessionState = {
    phase: 'ready',
    role: 'player',
    playerId: you,
    view: view(),
    nextClientSequence: 1,
    pendingCommands: [],
    completedCommands: [],
    presentationEvents: [],
    chatMessages: [],
    presence: [],
    notices: [],
    replayLoading: false,
    reconnectAttempt: 0,
  };
  const publish = (): void => {
    state = { ...state, view: view(), completedCommands: [...completed] };
    for (const listener of [...listeners]) listener();
  };
  return {
    sent,
    match: () => match,
    session: {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      submit: (command: WireGameCommand) => {
        sent.push(command);
        const commandId = `command-${String(sent.length)}`;
        // The room answers a moment later, as over the wire.
        queueMicrotask(() => {
          const refused = options.refuse === command.type;
          const executed = refused
            ? { accepted: false as const }
            : executeCommand(match, toGame(command), context);
          if (executed.accepted) match = executed.state;

          completed.push({
            commandId,
            clientSequence: sent.length,
            accepted: executed.accepted,
            revision: match.revision,
            ...(executed.accepted
              ? {}
              : { code: 'precondition_failed' as const }),
          });
          publish();
        });
        return {
          queued: true,
          commandId,
          clientSequence: sent.length,
        } as const;
      },
    },
  };
};

const names = (view: MatchViewState, cards: ReturnType<typeof zoneCards>) =>
  cards.map((card) => tutorialCardKeyOf(view, card));

describe('dealing a lesson onto the practice table', () => {
  it('lays out the mid-game position with the room’s own commands', async () => {
    const room = fakeRoom();
    await dealScenario(
      room.session,
      MIDGAME_SCENARIO,
      new AbortController().signal
    );
    const view = room.session.getSnapshot().view!;
    // Your side: the hand, six face-down Prizes, Charmander Active with its
    // Energy, Pidgey Benched, the discard, and the deck's top card known.
    expect(names(view, zoneCards(view, you, 'hand')).sort()).toEqual(
      [
        'charmeleon',
        'fireEnergy',
        'fireEnergy',
        'pidgey',
        'research',
        'ultraBall',
      ].sort()
    );
    expect(zoneCards(view, you, 'prizes')).toHaveLength(6);
    const active = activeStack(view, you)!;
    expect(tutorialCardKeyOf(view, topCard(active))).toBe('charmander');
    expect(names(view, active.attachmentCards)).toEqual(['fireEnergy']);
    expect(
      benchStacks(view, you).map((stack) =>
        tutorialCardKeyOf(view, topCard(stack))
      )
    ).toEqual(['pidgey']);
    expect(names(view, zoneCards(view, you, 'discard'))).toEqual(['ultraBall']);
    expect(tutorialCardKeyOf(view, zoneCards(view, you, 'deck')[0])).toBe(
      'charizardEx'
    );
    expect(zoneCards(view, you, 'deck')).toHaveLength(44);
    // Theirs: Kirlia evolved from Ralts with an Energy, two Ralts Benched.
    const theirs = activeStack(view, them)!;
    expect(names(view, theirs.evolutionCards)).toEqual(['ralts', 'kirlia']);
    expect(names(view, theirs.attachmentCards)).toEqual(['psychicEnergy']);
    expect(benchStacks(view, them)).toHaveLength(2);
    expect(zoneCards(view, them, 'prizes')).toHaveLength(6);
    expect(zoneCards(view, them, 'hand')).toHaveLength(5);
    // Every move is one play makes; nothing else is sent.
    expect(new Set(room.sent.map((command) => command.type))).toEqual(
      new Set([
        'LoadDeck',
        'DrawCards',
        'MoveCard',
        'MoveCardToPlay',
        'PlaceCardOnPlayStack',
      ])
    );
  });

  it('leaves the first lesson’s deck loaded and not set up', async () => {
    const room = fakeRoom();
    await dealScenario(
      room.session,
      START_SCENARIO,
      new AbortController().signal
    );
    const view = room.session.getSnapshot().view!;
    expect(zoneCards(view, you, 'deck')).toHaveLength(60);
    expect(zoneCards(view, you, 'hand')).toHaveLength(0);
    expect(activeStack(view, them)).toBeDefined();
  });

  it('deals again over a table already played on', async () => {
    const room = fakeRoom();
    const signal = new AbortController().signal;
    await dealScenario(room.session, MIDGAME_SCENARIO, signal);
    await dealScenario(room.session, MIDGAME_SCENARIO, signal);
    const view = room.session.getSnapshot().view!;
    expect(zoneCards(view, you, 'hand')).toHaveLength(6);
    expect(Object.keys(room.match().stacks)).toHaveLength(5);
  });

  it('gives up when the room refuses a move, or the deal is stopped', async () => {
    await expect(
      dealScenario(
        fakeRoom({ refuse: 'DrawCards' }).session,
        MIDGAME_SCENARIO,
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(ScenarioError);
    const abort = new AbortController();
    const dealing = dealScenario(
      fakeRoom().session,
      MIDGAME_SCENARIO,
      abort.signal
    );
    abort.abort();
    await expect(dealing).rejects.toBeInstanceOf(ScenarioError);
  });
});
