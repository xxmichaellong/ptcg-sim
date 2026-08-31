import type { MatchState } from './model.js';

export const cloneMatchState = (state: MatchState): MatchState => ({
  ...state,
  playerOrder: [...state.playerOrder],
  players: Object.fromEntries(
    Object.entries(state.players).map(([id, player]) => [
      id,
      { ...player, oncePerGame: { ...player.oncePerGame } },
    ])
  ),
  definitions: Object.fromEntries(
    Object.entries(state.definitions).map(([id, definition]) => [
      id,
      { ...definition },
    ])
  ),
  cards: Object.fromEntries(
    Object.entries(state.cards).map(([id, card]) => [id, { ...card }])
  ),
  deckLists: Object.fromEntries(
    Object.entries(state.deckLists).map(([id, cardIds]) => [id, [...cardIds]])
  ),
  zones: Object.fromEntries(
    Object.entries(state.zones).map(([id, zone]) => [
      id,
      { ...zone, cardIds: [...zone.cardIds] },
    ])
  ),
  boards: Object.fromEntries(
    Object.entries(state.boards).map(([id, board]) => [
      id,
      { ...board, benchStackIds: [...board.benchStackIds] },
    ])
  ),
  stacks: Object.fromEntries(
    Object.entries(state.stacks).map(([id, stack]) => [
      id,
      {
        ...stack,
        evolutionCardIds: [...stack.evolutionCardIds],
        attachmentCardIds: [...stack.attachmentCardIds],
      },
    ])
  ),
  workAreas: Object.fromEntries(
    Object.entries(state.workAreas).map(([id, areas]) => [
      id,
      {
        inspection: areas.inspection
          ? {
              ...areas.inspection,
              cardIds: [...areas.inspection.cardIds],
              viewerIds: [...areas.inspection.viewerIds],
            }
          : null,
        attachmentResolution: areas.attachmentResolution
          ? {
              ...areas.attachmentResolution,
              cardIds: [...areas.attachmentResolution.cardIds],
            }
          : null,
      },
    ])
  ),
  visibility: {
    publicCardIds: [...state.visibility.publicCardIds],
    inspectionGrants: Object.fromEntries(
      Object.entries(state.visibility.inspectionGrants).map(([id, grant]) => [
        id,
        {
          ...grant,
          cardIds: [...grant.cardIds],
          viewerIds: [...grant.viewerIds],
        },
      ])
    ),
  },
  turn: { ...state.turn },
});
