import type { ViewCardId } from '@ptcgsim/game-core';

import type { BoardSessionControllerState } from './BoardSessionController.js';

/**
 * What Ctrl/⌘+A selects (ADR-042 §2): every card where a card lies -- its
 * hand, its seat's Pokémon in play (the Active and the Bench), the staging
 * area, its Prizes, a window of cards, the pile open in the viewer. The
 * card is the focused one; failing that, the last one selected; failing
 * that, the open pile stands for itself. Null when there is none of these:
 * the browser's own Select All goes on. The controller leaves out what is
 * no item (a pile's top, the other player's hidden cards).
 */
export const selectAllCardIds = (
  state: Pick<BoardSessionControllerState, 'view' | 'scene' | 'presentation'>,
  focusedCardId: ViewCardId | null
): readonly ViewCardId[] | null => {
  const { view, scene, presentation } = state;
  if (!view || !scene) return null;
  const opened = presentation.openedZoneId;
  const pileCards = (zoneId: string): readonly ViewCardId[] =>
    view.zones[zoneId]?.cards.map((card) => card.id) ?? [];
  const anchor = focusedCardId ?? presentation.selection.at(-1) ?? null;
  const card =
    anchor === null
      ? undefined
      : scene.cards.find((candidate) => candidate.id === anchor);
  if (!card) return opened ? pileCards(opened) : null;
  if (opened !== null && card.parentId === opened) return pileCards(opened);
  const stack = view.stacks[card.parentId];
  if (stack) {
    const board = view.boards[stack.boardPlayerId];
    if (!board) return null;
    return [board.activeStackId, ...board.benchStackIds].flatMap((stackId) => {
      const top = stackId
        ? view.stacks[stackId]?.evolutionCards.at(-1)?.id
        : undefined;
      return top ? [top] : [];
    });
  }
  return scene.cards
    .filter(
      (candidate) =>
        candidate.parentId === card.parentId && candidate.interactive
    )
    .map((candidate) => candidate.id);
};
