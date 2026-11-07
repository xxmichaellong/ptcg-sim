import type { CardInstanceId, PlayerId } from './ids.js';
import type { InspectionWorkArea } from './model.js';

type ViewerIdsByCardId = InspectionWorkArea['viewerIdsByCardId'];

const sameOrder = <Value>(
  left: readonly Value[],
  right: readonly Value[]
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export const cloneInspectionViewerIds = (
  cardIds: readonly CardInstanceId[],
  viewerIdsByCardId: ViewerIdsByCardId
): ViewerIdsByCardId =>
  Object.fromEntries(
    cardIds.map((cardId) => [cardId, [...(viewerIdsByCardId[cardId] ?? [])]])
  );

export const uniformInspectionViewerIds = (
  cardIds: readonly CardInstanceId[],
  viewerIds: readonly PlayerId[]
): ViewerIdsByCardId =>
  Object.fromEntries(cardIds.map((cardId) => [cardId, [...viewerIds]]));

export const sameInspectionViewerIds = (
  cardIds: readonly CardInstanceId[],
  left: ViewerIdsByCardId,
  right: ViewerIdsByCardId
): boolean => {
  const cardIdSet = new Set(cardIds);
  if (
    Object.keys(left).length !== cardIds.length ||
    Object.keys(right).length !== cardIds.length ||
    Object.keys(left).some(
      (cardId) => !cardIdSet.has(cardId as CardInstanceId)
    ) ||
    Object.keys(right).some(
      (cardId) => !cardIdSet.has(cardId as CardInstanceId)
    )
  ) {
    return false;
  }
  return cardIds.every((cardId) => {
    const leftViewerIds = left[cardId];
    const rightViewerIds = right[cardId];
    return (
      Boolean(leftViewerIds) &&
      Boolean(rightViewerIds) &&
      sameOrder(leftViewerIds!, rightViewerIds!)
    );
  });
};

export const activeInspectionViewerIds = (
  inspection: InspectionWorkArea
): readonly PlayerId[] | null => {
  for (const cardId of inspection.cardIds) {
    const viewerIds = inspection.viewerIdsByCardId[cardId];
    if (viewerIds && viewerIds.length > 0) return viewerIds;
  }
  return null;
};

export const extendInspectionViewerIds = (
  inspection: InspectionWorkArea,
  appendedCardIds: readonly CardInstanceId[],
  viewerIds: readonly PlayerId[]
): ViewerIdsByCardId => {
  const activeViewerIds = activeInspectionViewerIds(inspection);
  const retainExisting =
    activeViewerIds !== null && sameOrder(activeViewerIds, viewerIds);
  return {
    ...Object.fromEntries(
      inspection.cardIds.map((cardId) => [
        cardId,
        retainExisting
          ? [...inspection.viewerIdsByCardId[cardId]!]
          : ([] as PlayerId[]),
      ])
    ),
    ...uniformInspectionViewerIds(appendedCardIds, viewerIds),
  };
};

export const clearInspectionViewerIds = (
  cardIds: readonly CardInstanceId[]
): ViewerIdsByCardId =>
  Object.fromEntries(cardIds.map((cardId) => [cardId, [] as PlayerId[]]));
