import type { CardInstanceId } from './ids.js';
import type { CardLocation, MatchState } from './model.js';

export const findCardLocations = (
  state: MatchState,
  cardId: CardInstanceId
): readonly CardLocation[] => {
  const locations: CardLocation[] = [];

  for (const zone of Object.values(state.zones)) {
    zone.cardIds.forEach((candidateId, index) => {
      if (candidateId === cardId) {
        locations.push({ kind: 'zone', zoneId: zone.id, index });
      }
    });
  }

  for (const stack of Object.values(state.stacks)) {
    stack.evolutionCardIds.forEach((candidateId, index) => {
      if (candidateId === cardId) {
        locations.push({ kind: 'stackEvolution', stackId: stack.id, index });
      }
    });
    stack.attachmentCardIds.forEach((candidateId, index) => {
      if (candidateId === cardId) {
        locations.push({ kind: 'stackAttachment', stackId: stack.id, index });
      }
    });
  }

  for (const [playerKey, areas] of Object.entries(state.workAreas)) {
    const playerId = state.players[playerKey]?.id;
    if (!playerId) continue;
    areas.inspection?.cardIds.forEach((candidateId, index) => {
      if (candidateId === cardId) {
        locations.push({ kind: 'inspectionWorkArea', playerId, index });
      }
    });
    areas.attachmentResolution?.evolutionCardIds.forEach(
      (candidateId, index) => {
        if (candidateId === cardId) {
          locations.push({
            kind: 'attachmentResolutionWorkArea',
            playerId,
            source: 'evolution',
            index,
          });
        }
      }
    );
    areas.attachmentResolution?.attachmentCardIds.forEach(
      (candidateId, index) => {
        if (candidateId === cardId) {
          locations.push({
            kind: 'attachmentResolutionWorkArea',
            playerId,
            source: 'attachment',
            index,
          });
        }
      }
    );
  }

  return locations;
};

export const findCardLocation = (
  state: MatchState,
  cardId: CardInstanceId
): CardLocation | null => {
  const locations = findCardLocations(state, cardId);
  return locations.length === 1 ? (locations[0] ?? null) : null;
};
