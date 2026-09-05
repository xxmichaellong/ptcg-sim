import type { CardInstanceId, StackId } from './ids.js';
import { findCardLocations } from './location.js';
import { MATCH_STATE_SCHEMA_VERSION, type MatchState } from './model.js';

export class MatchInvariantError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Match invariant violation:\n${problems.join('\n')}`);
    this.name = 'MatchInvariantError';
    this.problems = problems;
  }
}

const hasDuplicates = <Value>(values: readonly Value[]): boolean =>
  new Set(values).size !== values.length;

export const collectInvariantProblems = (
  state: MatchState
): readonly string[] => {
  const problems: string[] = [];
  if (state.schemaVersion !== MATCH_STATE_SCHEMA_VERSION) {
    problems.push(`unsupported match schema ${state.schemaVersion}`);
  }
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    problems.push('revision must be a non-negative safe integer');
  }
  if (state.playerOrder.length !== 2 || hasDuplicates(state.playerOrder)) {
    problems.push('match must contain exactly two distinct ordered players');
  }
  if (!Number.isSafeInteger(state.turn.number) || state.turn.number < 0) {
    problems.push('turn number must be a non-negative safe integer');
  }
  if (
    state.turn.currentPlayerId !== null &&
    !state.players[state.turn.currentPlayerId]
  ) {
    problems.push('turn references an unknown current player');
  }
  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    if (!player) problems.push(`missing player ${playerId}`);
    else if (
      typeof player.oncePerGame.gxUsed !== 'boolean' ||
      typeof player.oncePerGame.vstarUsed !== 'boolean'
    ) {
      problems.push(`player ${playerId} has invalid once-per-game markers`);
    }
    if (!state.boards[playerId]) problems.push(`missing board ${playerId}`);
    if (!state.workAreas[playerId])
      problems.push(`missing work areas ${playerId}`);
    const deckList = state.deckLists[playerId];
    if (!deckList) {
      problems.push(`missing deck list ${playerId}`);
    } else {
      if (hasDuplicates(deckList)) {
        problems.push(`deck list ${playerId} contains duplicate cards`);
      }
      const ownedCardIds = Object.values(state.cards)
        .filter((card) => card.ownerId === playerId)
        .map((card) => card.id)
        .sort();
      const baselineCardIds = [...deckList].sort();
      if (
        ownedCardIds.length !== baselineCardIds.length ||
        ownedCardIds.some((cardId, index) => cardId !== baselineCardIds[index])
      ) {
        problems.push(`deck list ${playerId} does not match owned cards`);
      }
    }
  }

  for (const definition of Object.values(state.definitions)) {
    if (!definition.name || definition.name.length > 256) {
      problems.push(`definition ${definition.id} has invalid name`);
    }
    if (!definition.imageUrl || definition.imageUrl.length > 4096) {
      problems.push(`definition ${definition.id} has invalid image URL`);
    }
  }

  for (const card of Object.values(state.cards)) {
    if (!state.definitions[card.definitionId]) {
      problems.push(
        `card ${card.id} references missing definition ${card.definitionId}`
      );
    }
    if (!state.players[card.ownerId]) {
      problems.push(`card ${card.id} references missing owner ${card.ownerId}`);
    }
    if (
      !Number.isSafeInteger(card.visibilityGeneration) ||
      card.visibilityGeneration < 0
    ) {
      problems.push(`card ${card.id} has invalid visibility generation`);
    }
    const locations = findCardLocations(state, card.id);
    if (locations.length !== 1) {
      problems.push(
        `card ${card.id} has ${locations.length} locations instead of one`
      );
    }
    if (![0, 1, 2, 3].includes(card.orientationQuarterTurns)) {
      problems.push(`card ${card.id} has invalid orientation`);
    }
    if (typeof card.abilityUsed !== 'boolean') {
      problems.push(`card ${card.id} has invalid ability marker`);
    }
    const location = locations[0];
    if (card.abilityUsed && location) {
      const allowed =
        location.kind === 'stackAttachment' ||
        (location.kind === 'attachmentResolutionWorkArea' &&
          location.source === 'attachment') ||
        (location.kind === 'zone' &&
          ['discard', 'stadium'].includes(
            state.zones[location.zoneId]?.kind ?? ''
          ));
      if (!allowed) {
        problems.push(`card ${card.id} has an ability marker outside play`);
      }
    }
  }

  for (const [zoneId, zone] of Object.entries(state.zones)) {
    if (zone.id !== zoneId)
      problems.push(`zone key ${zoneId} does not match its ID`);
    if (hasDuplicates(zone.cardIds))
      problems.push(`zone ${zone.id} contains duplicate cards`);
    if (zone.kind === 'stadium' && zone.cardIds.length > 1) {
      problems.push('stadium contains more than one card');
    }
    for (const cardId of zone.cardIds) {
      if (!state.cards[cardId])
        problems.push(`zone ${zone.id} references missing card ${cardId}`);
    }
  }

  const placedStackIds = new Set<StackId>();
  for (const [playerId, board] of Object.entries(state.boards)) {
    const stackIds = [
      ...(board.activeStackId ? [board.activeStackId] : []),
      ...board.benchStackIds,
    ];
    if (hasDuplicates(stackIds))
      problems.push(`board ${playerId} duplicates a stack`);
    for (const stackId of stackIds) {
      if (placedStackIds.has(stackId))
        problems.push(`stack ${stackId} is placed twice`);
      placedStackIds.add(stackId);
      const stack = state.stacks[stackId];
      if (!stack)
        problems.push(`board ${playerId} references missing stack ${stackId}`);
      else if (stack.boardPlayerId !== playerId) {
        problems.push(`stack ${stackId} board owner does not match placement`);
      }
    }
    if (
      board.activeStackId &&
      state.stacks[board.activeStackId]?.slot !== 'active'
    ) {
      problems.push(
        `active stack ${board.activeStackId} does not have active slot`
      );
    }
    for (const stackId of board.benchStackIds) {
      if (state.stacks[stackId]?.slot !== 'bench') {
        problems.push(`bench stack ${stackId} does not have bench slot`);
      }
    }
  }
  for (const stack of Object.values(state.stacks)) {
    if (!placedStackIds.has(stack.id))
      problems.push(`stack ${stack.id} is not on a board`);
    if (stack.evolutionCardIds.length === 0)
      problems.push(`stack ${stack.id} is empty`);
    const allIds = [...stack.evolutionCardIds, ...stack.attachmentCardIds];
    if (hasDuplicates(allIds))
      problems.push(`stack ${stack.id} duplicates a card`);
    for (const cardId of allIds) {
      if (!state.cards[cardId])
        problems.push(`stack ${stack.id} references missing card ${cardId}`);
    }
    if (
      stack.damage !== null &&
      (!Number.isSafeInteger(stack.damage) ||
        stack.damage <= 0 ||
        stack.damage > 9990)
    ) {
      problems.push(`stack ${stack.id} has invalid damage`);
    }
    if (
      stack.specialCondition !== null &&
      (stack.slot !== 'active' ||
        stack.specialCondition.trim() !== stack.specialCondition ||
        stack.specialCondition === '' ||
        stack.specialCondition === '0' ||
        stack.specialCondition.length > 16)
    ) {
      problems.push(`stack ${stack.id} has invalid condition`);
    }
    if (![0, 1, 2, 3].includes(stack.rotationQuarterTurns)) {
      problems.push(`stack ${stack.id} has invalid rotation`);
    }
  }

  const workAreaCardIds = new Set<CardInstanceId>();
  const activeInspectionIds = new Set<string>();
  for (const [playerId, areas] of Object.entries(state.workAreas)) {
    if (areas.inspection) {
      if (activeInspectionIds.has(areas.inspection.inspectionId)) {
        problems.push(
          `inspection ID ${areas.inspection.inspectionId} is duplicated`
        );
      }
      activeInspectionIds.add(areas.inspection.inspectionId);
    }
    for (const cardId of areas.inspection?.cardIds ?? []) {
      if (workAreaCardIds.has(cardId))
        problems.push(`card ${cardId} appears in two work areas`);
      workAreaCardIds.add(cardId);
      if (!state.cards[cardId]) {
        problems.push(
          `inspection for ${playerId} references missing card ${cardId}`
        );
      }
    }
    const stagedIds = areas.attachmentResolution
      ? [
          ...areas.attachmentResolution.evolutionCardIds,
          ...areas.attachmentResolution.attachmentCardIds,
        ]
      : [];
    if (hasDuplicates(stagedIds)) {
      problems.push(`attachment resolution for ${playerId} duplicates a card`);
    }
    for (const cardId of stagedIds) {
      if (workAreaCardIds.has(cardId))
        problems.push(`card ${cardId} appears in two work areas`);
      workAreaCardIds.add(cardId);
      if (!state.cards[cardId]) {
        problems.push(
          `attachment resolution for ${playerId} references missing card ${cardId}`
        );
      }
    }
    if (areas.attachmentResolution && stagedIds.length === 0) {
      problems.push(`attachment resolution for ${playerId} is empty`);
    }
    if (
      areas.inspection &&
      areas.inspection.viewerIds.some((viewerId) => !state.players[viewerId])
    ) {
      problems.push(`inspection for ${playerId} contains unknown viewer`);
    }
  }

  if (Object.keys(state.visibility.inspectionGrants).length > 200) {
    problems.push('too many private inspection grants are active');
  }
  for (const [inspectionId, grant] of Object.entries(
    state.visibility.inspectionGrants
  )) {
    if (grant.inspectionId !== inspectionId) {
      problems.push(
        `inspection grant key ${inspectionId} does not match its ID`
      );
    }
    if (!state.players[grant.sourcePlayerId]) {
      problems.push(`inspection ${inspectionId} has an unknown source player`);
    }
    if (grant.scope !== 'card' && grant.scope !== 'zone') {
      problems.push(`inspection ${inspectionId} has an invalid scope`);
    } else if (grant.scope === 'card' && grant.cardIds.length !== 1) {
      problems.push(`inspection ${inspectionId} card scope is not singular`);
    }
    if (
      grant.cardIds.length === 0 ||
      grant.cardIds.length > 200 ||
      hasDuplicates(grant.cardIds)
    ) {
      problems.push(`inspection ${inspectionId} has invalid cards`);
    }
    if (
      grant.viewerIds.length === 0 ||
      grant.viewerIds.length > state.playerOrder.length ||
      hasDuplicates(grant.viewerIds)
    ) {
      problems.push(`inspection ${inspectionId} has invalid viewers`);
    }
    for (const viewerId of grant.viewerIds) {
      if (!state.players[viewerId]) {
        problems.push(
          `inspection ${inspectionId} has unknown viewer ${viewerId}`
        );
      }
    }
    for (const cardId of grant.cardIds) {
      const card = state.cards[cardId];
      const locations = card ? findCardLocations(state, cardId) : [];
      const location = locations.length === 1 ? locations[0] : undefined;
      const sourceId = location
        ? location.kind === 'zone'
          ? location.zoneId
          : location.kind === 'stackEvolution' ||
              location.kind === 'stackAttachment'
            ? location.stackId
            : location.kind === 'inspectionWorkArea'
              ? state.workAreas[location.playerId]?.inspection?.id
              : state.workAreas[location.playerId]?.attachmentResolution?.id
        : undefined;
      const sourcePlayerId =
        card && location
          ? location.kind === 'zone'
            ? (state.zones[location.zoneId]?.ownerId ?? card.ownerId)
            : location.kind === 'stackEvolution' ||
                location.kind === 'stackAttachment'
              ? state.stacks[location.stackId]?.boardPlayerId
              : location.playerId
          : undefined;
      if (
        !card ||
        sourceId !== grant.sourceId ||
        sourcePlayerId !== grant.sourcePlayerId
      ) {
        problems.push(
          `inspection ${inspectionId} references card ${cardId} outside its source`
        );
      }
    }
  }

  for (const cardId of state.visibility.publicCardIds) {
    const card = state.cards[cardId];
    if (!card) {
      problems.push(`public reveal references missing card ${cardId}`);
    } else if (card.face !== 'up') {
      problems.push(`public reveal references face-down card ${cardId}`);
    }
  }
  if (hasDuplicates(state.visibility.publicCardIds)) {
    problems.push('public reveal list contains duplicates');
  }

  return problems;
};

export const assertMatchInvariants = (state: MatchState): void => {
  const problems = collectInvariantProblems(state);
  if (problems.length > 0) throw new MatchInvariantError(problems);
};
