import type { CardInstanceId } from './ids.js';
import type { CardLocation, MatchState } from './model.js';

const EMPTY_LOCATIONS: readonly CardLocation[] = Object.freeze([]);

type LocationIndex = ReadonlyMap<CardInstanceId, readonly CardLocation[]>;

/**
 * Location lookups are a hot path: invariants, grant pruning, and per-recipient
 * projection each resolve every card in the match. Scanning the whole state per
 * card makes those passes quadratic, so the index is built once per state and
 * memoized against the state object.
 *
 * This relies on the same immutability contract the authority already depends
 * on for its validation tokens: a `MatchState` is never mutated in place, so an
 * unchanged reference implies unchanged contents. Every reducer path in
 * `apply-events.ts` builds a new state object rather than mutating.
 */
const locationIndexes = new WeakMap<MatchState, LocationIndex>();

const addLocation = (
  index: Map<CardInstanceId, CardLocation[]>,
  cardId: CardInstanceId,
  location: CardLocation
): void => {
  const existing = index.get(cardId);
  if (existing) existing.push(location);
  else index.set(cardId, [location]);
};

const buildLocationIndex = (state: MatchState): LocationIndex => {
  const index = new Map<CardInstanceId, CardLocation[]>();

  for (const zone of Object.values(state.zones)) {
    zone.cardIds.forEach((cardId, index_) => {
      addLocation(index, cardId, {
        kind: 'zone',
        zoneId: zone.id,
        index: index_,
      });
    });
  }

  for (const stack of Object.values(state.stacks)) {
    stack.evolutionCardIds.forEach((cardId, index_) => {
      addLocation(index, cardId, {
        kind: 'stackEvolution',
        stackId: stack.id,
        index: index_,
      });
    });
    stack.attachmentCardIds.forEach((cardId, index_) => {
      addLocation(index, cardId, {
        kind: 'stackAttachment',
        stackId: stack.id,
        index: index_,
      });
    });
  }

  for (const [playerKey, areas] of Object.entries(state.workAreas)) {
    const playerId = state.players[playerKey]?.id;
    if (!playerId) continue;
    areas.inspection?.cardIds.forEach((cardId, index_) => {
      addLocation(index, cardId, {
        kind: 'inspectionWorkArea',
        playerId,
        index: index_,
      });
    });
    areas.attachmentResolution?.evolutionCardIds.forEach((cardId, index_) => {
      addLocation(index, cardId, {
        kind: 'attachmentResolutionWorkArea',
        playerId,
        source: 'evolution',
        index: index_,
      });
    });
    areas.attachmentResolution?.attachmentCardIds.forEach((cardId, index_) => {
      addLocation(index, cardId, {
        kind: 'attachmentResolutionWorkArea',
        playerId,
        source: 'attachment',
        index: index_,
      });
    });
  }

  for (const locations of index.values()) Object.freeze(locations);
  return index;
};

const locationIndexFor = (state: MatchState): LocationIndex => {
  const cached = locationIndexes.get(state);
  if (cached) return cached;
  const index = buildLocationIndex(state);
  locationIndexes.set(state, index);
  return index;
};

export const findCardLocations = (
  state: MatchState,
  cardId: CardInstanceId
): readonly CardLocation[] =>
  locationIndexFor(state).get(cardId) ?? EMPTY_LOCATIONS;

export const findCardLocation = (
  state: MatchState,
  cardId: CardInstanceId
): CardLocation | null => {
  const locations = findCardLocations(state, cardId);
  return locations.length === 1 ? (locations[0] ?? null) : null;
};
