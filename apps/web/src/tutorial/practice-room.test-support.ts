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

export const you = asPlayerId('tutorial-you');
export const them = asPlayerId('tutorial-them');

/**
 * A Solo room in miniature: the real game core runs each command, and the
 * one player sees every card (Solo shows both hands), as the room would
 * answer them. Shuffles keep order, so the test can read the deal.
 */
export const fakePracticeRoom = (
  options: { readonly refuse?: string } = {}
) => {
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
  const feed = { items: [], newestItemId: null };
  return {
    sent,
    match: () => match,
    /** The session reconnecting, failed or ready again. */
    setPhase: (phase: ClientSessionState['phase']): void => {
      state = { ...state, phase };
      for (const listener of [...listeners]) listener();
    },
    // The practice table's log, as the host reads it: empty here.
    presentation: {
      activityFeed: {
        subscribe: () => () => undefined,
        getSnapshot: () => feed,
      },
      clearActivity: () => true,
    },
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
