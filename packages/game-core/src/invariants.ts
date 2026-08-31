import type { CardInstanceId, StackId } from './ids.js';
import { findCardLocations } from './location.js';
import type { MatchState } from './model.js';

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
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    problems.push('revision must be a non-negative safe integer');
  }
  if (state.playerOrder.length !== 2 || hasDuplicates(state.playerOrder)) {
    problems.push('match must contain exactly two distinct ordered players');
  }
  for (const playerId of state.playerOrder) {
    if (!state.players[playerId]) problems.push(`missing player ${playerId}`);
    if (!state.boards[playerId]) problems.push(`missing board ${playerId}`);
    if (!state.workAreas[playerId])
      problems.push(`missing work areas ${playerId}`);
    if (!state.deckLists[playerId])
      problems.push(`missing deck list ${playerId}`);
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
        stack.damage < 0 ||
        stack.damage > 9990)
    ) {
      problems.push(`stack ${stack.id} has invalid damage`);
    }
    if (stack.specialCondition !== null && stack.specialCondition.length > 16) {
      problems.push(`stack ${stack.id} has invalid condition`);
    }
  }

  const workAreaCardIds = new Set<CardInstanceId>();
  for (const [playerId, areas] of Object.entries(state.workAreas)) {
    for (const cardId of areas.inspection?.cardIds ?? []) {
      if (workAreaCardIds.has(cardId))
        problems.push(`card ${cardId} appears in two work areas`);
      workAreaCardIds.add(cardId);
    }
    for (const cardId of areas.attachmentResolution?.cardIds ?? []) {
      if (workAreaCardIds.has(cardId))
        problems.push(`card ${cardId} appears in two work areas`);
      workAreaCardIds.add(cardId);
    }
    if (
      areas.inspection &&
      areas.inspection.viewerIds.some((viewerId) => !state.players[viewerId])
    ) {
      problems.push(`inspection for ${playerId} contains unknown viewer`);
    }
  }

  for (const cardId of state.visibility.publicCardIds) {
    if (!state.cards[cardId])
      problems.push(`public reveal references missing card ${cardId}`);
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
