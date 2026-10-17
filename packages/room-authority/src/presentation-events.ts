import {
  isCardKnownToViewer,
  type EventBatch,
  type MatchState,
} from '@ptcgsim/game-core';
import {
  MAX_PRESENTATION_EVENTS,
  type PresentationEvent,
} from '@ptcgsim/protocol';

import { narrationEventsForBatch } from './narration-events.js';

type PresentationCardSource = Extract<
  PresentationEvent,
  { readonly type: 'PublicCardsRevealed' }
>['source'];

const presentationCardSource = (
  state: MatchState,
  sourceId: string
): PresentationCardSource => {
  const zone = state.zones[sourceId];
  if (zone) return zone.kind;
  const stack = state.stacks[sourceId];
  if (stack) return stack.slot;
  for (const areas of Object.values(state.workAreas)) {
    if (areas.inspection?.id === sourceId) {
      return state.zones[areas.inspection.sourceZoneId]?.kind ?? 'inspection';
    }
    if (areas.attachmentResolution?.id === sourceId) {
      return 'attachmentResolution';
    }
  }
  throw new Error('Presentation event references a missing card source');
};

const publiclyKnownCardName = (
  state: MatchState,
  cardId: string
): string | undefined => {
  const card = state.cards[cardId];
  if (!card || !isCardKnownToViewer(state, { kind: 'spectator' }, card)) {
    return undefined;
  }
  return state.definitions[card.definitionId]?.name;
};

/**
 * @param state the state after the batch was applied
 * @param previousState the state the batch was applied to; card names are
 *   disclosed when public on either side of the batch
 */
export const presentationEventsForBatch = (
  batch: EventBatch,
  state: MatchState,
  previousState: MatchState
): readonly PresentationEvent[] => {
  if (state.revision !== batch.revision) {
    throw new Error('Presentation state revision does not match event batch');
  }
  const narration = narrationEventsForBatch(batch, state, previousState);
  return withinOneFrame(narration, declarationEventsForBatch(batch, state));
};

type CardMoved = Extract<PresentationEvent, { readonly type: 'CardMoved' }>;
type CardsResolved = Extract<
  PresentationEvent,
  { readonly type: 'CardsResolved' }
>;

const RESOLVED_DESTINATIONS: ReadonlySet<string> = new Set<
  CardsResolved['destination']
>(['hand', 'discard', 'lostZone', 'deck', 'deckBottom', 'play']);

/** The run a card-by-card move belongs to, if it can be told in bulk. */
const runOf = (line: PresentationEvent): string | undefined =>
  line.type === 'CardMoved' &&
  line.verb === 'moved' &&
  line.destination !== undefined &&
  RESOLVED_DESTINATIONS.has(line.destination)
    ? JSON.stringify([line.playerId, line.source, line.destination])
    : line.type === 'CardsResolved' && line.verb === 'moved'
      ? JSON.stringify([line.playerId, line.source, line.destination])
      : undefined;

/**
 * A publication carries at most MAX_PRESENTATION_EVENTS, and a client
 * refuses one with more. A batch that would say more (a window of 101
 * cards resolved card by card) says it in fewer lines: a run of one move
 * becomes "moved N card(s)", and past that the narration is cut short, so
 * the table's declarations always go.
 */
const withinOneFrame = (
  narration: readonly PresentationEvent[],
  declarations: readonly PresentationEvent[]
): readonly PresentationEvent[] => {
  if (narration.length + declarations.length <= MAX_PRESENTATION_EVENTS) {
    return [...narration, ...declarations];
  }
  const folded: PresentationEvent[] = [];
  for (const line of narration) {
    const last = folded.at(-1);
    const run = runOf(line);
    if (run === undefined || last === undefined || runOf(last) !== run) {
      folded.push(line);
      continue;
    }
    const counted = (event: PresentationEvent): number =>
      event.type === 'CardsResolved' ? event.cardCount : 1;
    const moved = line as CardMoved;
    folded[folded.length - 1] = {
      type: 'CardsResolved',
      revision: moved.revision,
      playerId: moved.playerId,
      verb: 'moved',
      cardCount: counted(last) + counted(line),
      source: moved.source,
      destination: moved.destination as CardsResolved['destination'],
    };
  }
  return [
    ...folded.slice(0, MAX_PRESENTATION_EVENTS - declarations.length),
    ...declarations,
  ];
};

const declarationEventsForBatch = (
  batch: EventBatch,
  state: MatchState
): readonly PresentationEvent[] => {
  return batch.events.flatMap((event): PresentationEvent[] => {
    if (event.type === 'CoinFlipped') {
      return [
        {
          type: 'CoinFlipped',
          revision: batch.revision,
          playerId: event.playerId,
          result: event.result,
        },
      ];
    }
    if (event.type === 'PlayerReset') {
      return [
        {
          type: 'PlayerReset',
          revision: batch.revision,
          playerId: event.playerId,
        },
      ];
    }
    if (event.type === 'DeckLoaded') {
      return [
        {
          type: 'DeckLoaded',
          revision: batch.revision,
          playerId: event.playerId,
          cardCount: event.deckOrder.length,
        },
      ];
    }
    if (event.type === 'PlayerSetup') {
      return [
        {
          type: 'PlayerSetup',
          revision: batch.revision,
          playerId: event.playerId,
          handCount: event.handOrder.length,
          prizeCount: event.prizeOrder.length,
        },
      ];
    }
    if (event.type === 'RandomHandCardPlayedFaceDown') {
      return [
        {
          type: 'RandomCardPlayedFaceDown',
          revision: batch.revision,
          actorPlayerId: event.actorPlayerId,
          targetPlayerId: event.targetPlayerId,
        },
      ];
    }
    if (event.type === 'PublicRevealSet') {
      const source = presentationCardSource(state, event.expectedSourceId);
      const cardName =
        event.revealed && event.scope === 'card'
          ? publiclyKnownCardName(state, event.cardIds[0]!)
          : undefined;
      if (event.revealed && event.scope === 'card' && !cardName) {
        throw new Error(
          'Public single-card reveal is not known to the spectator projection'
        );
      }
      return [
        {
          type: event.revealed ? 'PublicCardsRevealed' : 'PublicCardsHidden',
          revision: batch.revision,
          actorPlayerId: event.actorPlayerId,
          playerId: event.playerId,
          scope: event.scope,
          source,
          cardCount: event.cardIds.length,
          ...(cardName ? { cardName } : {}),
        },
      ];
    }
    if (event.type === 'InspectionGrantOpened') {
      const source = presentationCardSource(state, event.sourceId);
      return event.viewerIds.map((viewerPlayerId) => ({
        type: 'PrivateInspectionStarted',
        revision: batch.revision,
        sourcePlayerId: event.sourcePlayerId,
        viewerPlayerId,
        scope: event.scope,
        source,
        cardCount: event.cardIds.length,
      }));
    }
    if (event.type === 'InspectionGrantClosed') {
      const source = presentationCardSource(state, event.sourceId);
      return [
        {
          type: 'PrivateInspectionEnded',
          revision: batch.revision,
          sourcePlayerId: event.sourcePlayerId,
          viewerPlayerId: event.viewerId,
          scope: event.scope,
          source,
          cardCount: event.expectedCardIds.length,
        },
      ];
    }
    if (event.type === 'CoachingConsentSet') {
      // One line per viewer, source and scope, however many looks ended: a
      // coach can hold 200 looks at single cards, and a batch's events are
      // capped at 100 on the wire.
      const ended = new Map<
        string,
        Extract<PresentationEvent, { readonly type: 'PrivateInspectionEnded' }>
      >();
      for (const revocation of event.revokedInspections) {
        const source = presentationCardSource(state, revocation.sourceId);
        const key = JSON.stringify([
          revocation.sourcePlayerId,
          revocation.viewerPlayerId,
          revocation.scope,
          source,
        ]);
        const known = ended.get(key);
        ended.set(key, {
          type: 'PrivateInspectionEnded',
          revision: batch.revision,
          sourcePlayerId: revocation.sourcePlayerId,
          viewerPlayerId: revocation.viewerPlayerId,
          scope: revocation.scope,
          source,
          cardCount: (known?.cardCount ?? 0) + revocation.cardCount,
        });
      }
      return [...ended.values()];
    }
    if (event.type === 'UndoApplied') {
      return [
        {
          type: 'UndoApplied',
          revision: batch.revision,
          actorPlayerId: event.actorPlayerId,
          targetPlayerId: event.targetPlayerId,
          revertedRevision: event.revertedRevision,
        },
      ];
    }
    if (event.type === 'OncePerGameMarkerSet') {
      return [
        {
          type: 'OncePerGameMarkerSet',
          revision: batch.revision,
          playerId: event.playerId,
          marker: event.marker,
          used: event.used,
        },
      ];
    }
    if (event.type !== 'TableActionDeclared') return [];
    const common = {
      revision: batch.revision,
      playerId: event.playerId,
      turnNumber: event.turnNumber,
    };
    if (event.action === 'attack') {
      return [{ type: 'AttackDeclared', ...common }];
    }
    if (event.action === 'pass') {
      return [{ type: 'PassDeclared', ...common }];
    }
    return [
      {
        type:
          event.outcome === 'drawn' ? 'TurnStarted' : 'TurnStartFailedNoDeck',
        ...common,
      },
    ];
  });
};
