import type { ViewCardId } from '@ptcgsim/game-core';

import { containsPoint } from './geometry.js';
import type {
  BoardRendererAdapters,
  BoardScene,
  CardSceneNode,
} from './model.js';

export interface BoardPointerInput {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly button: number;
}

interface ActiveGesture {
  readonly pointerId: number;
  readonly cardId: ViewCardId;
  readonly startX: number;
  readonly startY: number;
  readonly centerOffsetX: number;
  readonly centerOffsetY: number;
  dragging: boolean;
}

const cardAt = (
  scene: BoardScene,
  cardId: ViewCardId
): CardSceneNode | undefined =>
  scene.cards.find((candidate) => candidate.id === cardId);

export const resolveBoardDropTarget = (
  scene: BoardScene,
  sourceCardId: ViewCardId,
  x: number,
  y: number
): string | null => {
  const card = [...scene.cards]
    .sort((left, right) => right.zIndex - left.zIndex)
    .find(
      (candidate) =>
        candidate.id !== sourceCardId &&
        candidate.interactive &&
        containsPoint(candidate.bounds, x, y)
    );
  if (card) return card.parentId;
  const zone = [...scene.zones]
    .sort((left, right) => right.zIndex - left.zIndex)
    .find(
      (candidate) =>
        candidate.interactive && containsPoint(candidate.bounds, x, y)
    );
  return zone?.id ?? null;
};

/** Shared pointer gesture state so DOM and Pixi produce identical drag intent. */
export class BoardDragController {
  private active: ActiveGesture | null = null;
  private suppressedClickCardId: ViewCardId | null = null;

  constructor(
    private readonly adapters: Pick<
      BoardRendererAdapters,
      'emitIntent' | 'emitPresentationUpdate'
    >,
    private readonly thresholdPixels = 5
  ) {
    if (!Number.isFinite(thresholdPixels) || thresholdPixels < 0) {
      throw new Error('Drag threshold must be a non-negative finite number');
    }
  }

  pointerDown(
    scene: BoardScene,
    cardId: ViewCardId,
    input: BoardPointerInput
  ): boolean {
    if (this.active || input.button !== 0 || !this.validPoint(input)) {
      return false;
    }
    const card = cardAt(scene, cardId);
    if (!card?.interactive) return false;
    this.suppressedClickCardId = null;
    this.active = {
      pointerId: input.pointerId,
      cardId,
      startX: input.x,
      startY: input.y,
      centerOffsetX: card.bounds.x + card.bounds.width / 2 - input.x,
      centerOffsetY: card.bounds.y + card.bounds.height / 2 - input.y,
      dragging: false,
    };
    return true;
  }

  pointerMove(scene: BoardScene, input: BoardPointerInput): boolean {
    const gesture = this.active;
    if (
      !gesture ||
      gesture.pointerId !== input.pointerId ||
      !this.validPoint(input)
    ) {
      return false;
    }
    const card = cardAt(scene, gesture.cardId);
    if (!card?.interactive) {
      this.cancel(input.pointerId);
      return false;
    }
    if (!gesture.dragging) {
      const xDistance = input.x - gesture.startX;
      const yDistance = input.y - gesture.startY;
      if (
        xDistance * xDistance + yDistance * yDistance <
        this.thresholdPixels * this.thresholdPixels
      ) {
        return false;
      }
      gesture.dragging = true;
    }
    this.adapters.emitPresentationUpdate({
      kind: 'DragChanged',
      drag: {
        cardId: gesture.cardId,
        x: input.x + gesture.centerOffsetX,
        y: input.y + gesture.centerOffsetY,
        targetId: resolveBoardDropTarget(
          scene,
          gesture.cardId,
          input.x,
          input.y
        ),
      },
    });
    return true;
  }

  pointerUp(scene: BoardScene, input: BoardPointerInput): boolean {
    const gesture = this.active;
    if (!gesture || gesture.pointerId !== input.pointerId) {
      return false;
    }
    if (!this.validPoint(input)) return this.cancel(input.pointerId);
    this.pointerMove(scene, input);
    if (this.active !== gesture) return false;
    this.active = null;
    if (!gesture.dragging) return false;
    const targetId = resolveBoardDropTarget(
      scene,
      gesture.cardId,
      input.x,
      input.y
    );
    this.suppressedClickCardId = gesture.cardId;
    this.adapters.emitPresentationUpdate({ kind: 'DragChanged', drag: null });
    if (targetId) {
      this.adapters.emitIntent({
        kind: 'CardDropRequested',
        cardId: gesture.cardId,
        targetId,
      });
    }
    return true;
  }

  cancel(pointerId?: number): boolean {
    const gesture = this.active;
    if (
      !gesture ||
      (pointerId !== undefined && pointerId !== gesture.pointerId)
    ) {
      return false;
    }
    this.active = null;
    if (gesture.dragging) {
      this.suppressedClickCardId = gesture.cardId;
      this.adapters.emitPresentationUpdate({ kind: 'DragChanged', drag: null });
    }
    return gesture.dragging;
  }

  reconcile(scene: BoardScene): void {
    const gesture = this.active;
    if (gesture && !cardAt(scene, gesture.cardId)?.interactive) this.cancel();
  }

  consumeSuppressedClick(cardId: ViewCardId): boolean {
    if (this.suppressedClickCardId !== cardId) return false;
    this.suppressedClickCardId = null;
    return true;
  }

  destroy(): void {
    this.active = null;
    this.suppressedClickCardId = null;
  }

  private validPoint(input: BoardPointerInput): boolean {
    return (
      Number.isSafeInteger(input.pointerId) &&
      Number.isFinite(input.x) &&
      Number.isFinite(input.y)
    );
  }
}
