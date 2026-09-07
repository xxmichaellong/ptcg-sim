import type {
  ConcealedViewCard,
  MatchViewState,
  ViewCard,
  ViewCardId,
} from '@ptcgsim/game-core';
import type { ReadyReplayPlaybackState } from '@ptcgsim/client-session';

import type { LegacyBoardContextActionId } from './resolveLegacyBoardOverlayAction.js';

type ReplayLocalDisclosureState = NonNullable<
  ReadyReplayPlaybackState['localDisclosure']
>;

export type ReplayLocalDisclosureMode = 'shown' | 'hidden';

export interface ReplayLocalDisplayState {
  readonly disclosure: ReplayLocalDisclosureState;
  readonly zoneModes: Readonly<
    Partial<Record<string, ReplayLocalDisclosureMode>>
  >;
  readonly cardModes: Readonly<
    Partial<Record<string, ReplayLocalDisclosureMode>>
  >;
}

export const isReplayLocalDisclosureAction = (
  action: LegacyBoardContextActionId
): action is
  'revealPrizes' | 'togglePrizes' | 'toggleOpponentHand' | 'revealCard' =>
  action === 'revealPrizes' ||
  action === 'togglePrizes' ||
  action === 'toggleOpponentHand' ||
  action === 'revealCard';

const unique = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  unique(left) &&
  unique(right) &&
  left.every((value) => right.includes(value));

const eligibleZones = (view: MatchViewState) => {
  if (view.viewer.kind !== 'player') return [];
  const viewerId = view.viewer.playerId;
  return Object.values(view.zones).filter(
    (zone) =>
      zone.ownerId !== null &&
      (zone.kind === 'prizes' ||
        (zone.kind === 'hand' && zone.ownerId !== viewerId))
  );
};

/** Defense in depth for controller tests and future non-network replay sources. */
export const isValidReplayLocalDisclosure = (
  view: MatchViewState,
  disclosure: ReplayLocalDisclosureState
): boolean => {
  if (view.viewer.kind !== 'player') return false;
  const zones = eligibleZones(view);
  if (
    !sameSet(
      disclosure.zoneIds,
      zones.map((zone) => zone.id)
    )
  )
    return false;

  const definitionIds = disclosure.definitions.map(
    (definition) => definition.id
  );
  if (!unique(definitionIds)) return false;
  const definitions = new Set(definitionIds);
  if (definitionIds.some((id) => Boolean(view.definitions[id]))) return false;

  const concealed = new Map(
    zones.flatMap((zone) =>
      zone.cards
        .filter((card) => card.kind === 'concealed')
        .map((card) => [card.id, card] as const)
    )
  );
  if (
    !sameSet(
      disclosure.cards.map((card) => card.id),
      [...concealed.keys()]
    )
  )
    return false;
  return disclosure.cards.every((card) => {
    const projected = concealed.get(card.id);
    return (
      projected?.ownerId === card.ownerId &&
      card.face === 'up' &&
      !card.publiclyRevealed &&
      definitions.has(card.definitionId)
    );
  });
};

export const reconcileReplayLocalDisplayState = (
  view: MatchViewState,
  disclosure: ReplayLocalDisclosureState,
  previous?: ReplayLocalDisplayState
): ReplayLocalDisplayState | null => {
  if (!isValidReplayLocalDisclosure(view, disclosure)) return null;
  const zoneModes: Partial<Record<string, ReplayLocalDisclosureMode>> = {};
  if (previous) {
    for (const zoneId of disclosure.zoneIds) {
      const mode = previous.zoneModes[zoneId];
      if (mode) zoneModes[zoneId] = mode;
    }
  }
  const cardModes: Partial<Record<string, ReplayLocalDisclosureMode>> = {};
  if (previous) {
    const disclosedCardIds = new Set(disclosure.cards.map((card) => card.id));
    for (const [cardId, mode] of Object.entries(previous.cardModes)) {
      if (mode && disclosedCardIds.has(cardId as ViewCardId)) {
        cardModes[cardId] = mode;
      }
    }
  }
  return { disclosure, zoneModes, cardModes };
};

const concealedCard = (
  view: MatchViewState,
  card: ViewCard
): ConcealedViewCard => ({
  kind: 'concealed',
  id: card.id,
  ownerId: card.ownerId,
  cardBackUrl:
    view.players[card.ownerId]?.cardBackUrl ??
    (card.kind === 'concealed' ? card.cardBackUrl : ''),
  publiclyRevealed: false,
});

/** Creates a transient display projection without mutating the replay view. */
export const applyReplayLocalDisclosure = (
  view: MatchViewState,
  state: ReplayLocalDisplayState | undefined
): MatchViewState => {
  if (!state) return view;
  const localCards = new Map(
    state.disclosure.cards.map((card) => [card.id, card] as const)
  );
  const referencedDefinitionIds = new Set<string>();
  let changed = false;
  const zones = Object.fromEntries(
    Object.entries(view.zones).map(([zoneId, zone]) => {
      const zoneMode = state.zoneModes[zoneId];
      const hasCardMode = zone.cards.some((card) => state.cardModes[card.id]);
      if (!zoneMode && !hasCardMode) return [zoneId, zone];
      changed = true;
      const cards = zone.cards.map((card): ViewCard => {
        const mode = state.cardModes[card.id] ?? zoneMode;
        if (!mode) return card;
        if (mode === 'hidden') return concealedCard(view, card);
        if (card.kind === 'known') {
          return card.face === 'up' ? card : { ...card, face: 'up' };
        }
        const disclosed = localCards.get(card.id);
        if (!disclosed) return card;
        referencedDefinitionIds.add(disclosed.definitionId);
        return disclosed;
      });
      return [zoneId, { ...zone, cards }];
    })
  );
  if (!changed) return view;
  const localDefinitions = Object.fromEntries(
    state.disclosure.definitions
      .filter((definition) => referencedDefinitionIds.has(definition.id))
      .map((definition) => [definition.id, definition])
  );
  return {
    ...view,
    definitions: { ...view.definitions, ...localDefinitions },
    zones,
  };
};

export const toggleReplayLocalDisclosure = (
  view: MatchViewState,
  state: ReplayLocalDisplayState,
  action: LegacyBoardContextActionId,
  cardId: ViewCardId
): ReplayLocalDisplayState | null => {
  if (!isReplayLocalDisclosureAction(action)) return null;
  const zone = Object.values(view.zones).find((candidate) =>
    candidate.cards.some((card) => card.id === cardId)
  );
  if (!zone || !state.disclosure.zoneIds.includes(zone.id)) return null;
  const validTarget =
    action === 'toggleOpponentHand'
      ? zone.kind === 'hand' &&
        zone.ownerId !== null &&
        view.viewer.kind === 'player' &&
        zone.ownerId !== view.viewer.playerId
      : action === 'revealCard'
        ? state.disclosure.cards.some((card) => card.id === cardId)
        : zone.kind === 'prizes';
  if (!validTarget) return null;

  const displayed = applyReplayLocalDisclosure(view, state).zones[
    zone.id
  ]?.cards.find((card) => card.id === cardId);
  if (!displayed) return null;
  const mode: ReplayLocalDisclosureMode =
    displayed.kind === 'known' && displayed.face === 'up' ? 'hidden' : 'shown';
  if (action === 'revealCard') {
    return {
      ...state,
      cardModes: { ...state.cardModes, [cardId]: mode },
    };
  }
  const zoneCardIds = new Set(zone.cards.map((card) => card.id));
  return {
    ...state,
    zoneModes: { ...state.zoneModes, [zone.id]: mode },
    cardModes: Object.fromEntries(
      Object.entries(state.cardModes).filter(
        ([candidate]) => !zoneCardIds.has(candidate as ViewCardId)
      )
    ),
  };
};
