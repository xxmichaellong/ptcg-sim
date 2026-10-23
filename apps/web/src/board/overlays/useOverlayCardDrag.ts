import type { ViewCardId } from '@ptcgsim/game-core';
import {
  BoardDragController,
  boardDragInput,
  type BoardDepthProjection,
  type BoardIntent,
  type BoardPresentation,
  type BoardScene,
  type CardGrip,
  type CardSceneNode,
  type SettlingCard,
} from '@ptcgsim/renderer-contract';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { TableMotionStore } from '../table-motion.js';

interface Options {
  readonly scene: BoardScene | undefined;
  readonly depth?: BoardDepthProjection;
  readonly cards: readonly CardSceneNode[];
  readonly enabled: boolean;
  readonly emit: (
    intent: Extract<BoardIntent, { kind: 'CardDropRequested' }>
  ) => void;
  /**
   * The table's drag: the card picked up here is held over the table as one
   * picked up there (lit targets, a row making room, the landing).
   */
  readonly updateDrag?: (drag: BoardPresentation['drag']) => void;
  /** The table's cards held where they were dropped (presentation.settling). */
  readonly settling?: readonly SettlingCard[];
  /** Whether the table is still moving, so a dropped card is seen to land. */
  readonly tableMotion?: TableMotionStore;
}

interface Grip {
  readonly card: CardSceneNode;
  readonly target: HTMLElement;
  readonly pointerId: number;
  /** Where on the card's face it was pressed. */
  readonly grip: CardGrip;
  /** Touch: picked up once held still; until then the finger scrolls. */
  armed: boolean;
  hold: number | null;
  readonly startX: number;
  readonly startY: number;
}

/** A finger held this long on a card picks it up; a swipe scrolls the pile. */
export const TOUCH_PICKUP_MS = 350;
/** A finger that strays this far before then is scrolling. */
const TOUCH_SLOP_PX = 8;
/** However a drop goes, the viewer is back this long after it at the latest. */
export const LANDING_MAX_MS = 4_000;

/**
 * Cards shown outside the table -- a pile's viewer, a work area, the stack
 * view, a card's preview -- are picked up and dragged through the table's own
 * drag: the same controller, the same projected aim and room-making
 * (boardDragInput), and the table paints the held card (withHeldCards), so a
 * card leaving a viewer lifts, lights its targets, opens a gap and lands as
 * any card moved on the table does. The viewer steps aside while it is held,
 * and stays aside until the card has landed: back at once, it would cover
 * the card's way to where it was put.
 */
export const useOverlayCardDrag = (options: Options) => {
  const latest = useRef(options);
  latest.current = options;
  // Buried pile cards have no table hit target, but are individually movable
  // inside an authorized open panel. Override only the current source.
  const gestureScene = (scene: BoardScene, id: ViewCardId): BoardScene => ({
    ...scene,
    cards: scene.cards.map((card) =>
      card.id === id ? { ...card, interactive: true } : card
    ),
  });
  const grip = useRef<Grip | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<ViewCardId | null>(null);
  const [armedCardId, setArmedCardId] = useState<ViewCardId | null>(null);
  /** Let go of here and still on its way to where it was put. */
  const [landingCardId, setLandingCardId] = useState<ViewCardId | null>(null);
  const controller = useMemo(
    () =>
      new BoardDragController({
        emitIntent: (intent) => {
          if (intent.kind !== 'CardDropRequested') return;
          setLandingCardId(intent.cardId);
          latest.current.emit(intent);
        },
        emitPresentationUpdate: (update) => {
          if (update.kind !== 'DragChanged') return;
          setDraggingCardId(update.drag?.cardId ?? null);
          latest.current.updateDrag?.(update.drag);
        },
      }),
    []
  );

  const finish = (cancel = true) => {
    if (cancel) controller.cancel();
    const current = grip.current;
    grip.current = null;
    if (current) {
      if (current.hold !== null) clearTimeout(current.hold);
      try {
        current.target.releasePointerCapture(current.pointerId);
      } catch {
        /* Already released by the browser. */
      }
    }
    setDraggingCardId(null);
    setArmedCardId(null);
  };

  /** The pointer in the board's own coordinates. */
  const boardPoint = (
    target: HTMLElement,
    scene: BoardScene,
    clientX: number,
    clientY: number
  ): { readonly x: number; readonly y: number } | null => {
    const bounds = target
      .closest('[data-legacy-board-overlays]')
      ?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return null;
    return {
      x: ((clientX - bounds.left) * scene.viewport.width) / bounds.width,
      y: ((clientY - bounds.top) * scene.viewport.height) / bounds.height,
    };
  };

  /** Picks the card up: from here on the gesture is the table's drag. */
  const pickUp = (current: Grip, clientX: number, clientY: number): boolean => {
    const { scene, depth } = latest.current;
    if (!scene) return false;
    const point = boardPoint(current.target, scene, clientX, clientY);
    if (!point) return false;
    return controller.pointerDown(
      gestureScene(scene, current.card.id),
      current.card.id,
      boardDragInput(
        scene,
        depth,
        current.card,
        current.pointerId,
        point,
        current.grip,
        true
      )
    );
  };

  useEffect(() => {
    const present = (current: Grip): boolean => {
      const { cards, enabled } = latest.current;
      return (
        enabled &&
        cards.some(
          (card) =>
            card.id === current.card.id &&
            card.parentId === current.card.parentId &&
            card.imageUrl === current.card.imageUrl &&
            card.concealed === current.card.concealed
        )
      );
    };
    const input = (event: PointerEvent) => {
      const current = grip.current;
      const { scene, depth } = latest.current;
      if (!current || current.pointerId !== event.pointerId || !scene)
        return null;
      if (!present(current)) {
        finish();
        return null;
      }
      const point = boardPoint(
        current.target,
        scene,
        event.clientX,
        event.clientY
      );
      if (!point) return null;
      const value = boardDragInput(
        scene,
        depth,
        current.card,
        event.pointerId,
        point,
        current.grip
      );
      // Off the table there is nothing to drop on.
      const inside =
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= scene.viewport.width &&
        point.y <= scene.viewport.height;
      return inside ? value : { ...value, targetId: null };
    };
    const move = (event: PointerEvent) => {
      const current = grip.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.armed) {
        // A finger that moves before the card is picked up scrolls the pile.
        if (
          Math.hypot(
            event.clientX - current.startX,
            event.clientY - current.startY
          ) > TOUCH_SLOP_PX
        )
          finish();
        return;
      }
      const value = input(event);
      if (!value || !latest.current.scene) return;
      if (
        controller.pointerMove(
          gestureScene(latest.current.scene, current.card.id),
          value
        )
      )
        event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      const current = grip.current;
      if (current?.pointerId !== event.pointerId) return;
      const value = current.armed ? input(event) : null;
      if (value && latest.current.scene)
        controller.pointerUp(
          gestureScene(latest.current.scene, current.card.id),
          value
        );
      else controller.cancel();
      finish(false);
    };
    const cancelPointer = (event: PointerEvent) => {
      if (grip.current?.pointerId === event.pointerId) finish();
    };
    // Once a finger has picked a card up, it drags; it no longer scrolls.
    const holdTouch = (event: TouchEvent) => {
      if (grip.current?.armed && event.cancelable) event.preventDefault();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !grip.current) return;
      event.preventDefault();
      event.stopPropagation();
      finish();
    };
    const cancel = () => finish();
    window.addEventListener('pointermove', move, {
      capture: true,
      passive: false,
    });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancelPointer, true);
    window.addEventListener('lostpointercapture', cancelPointer, true);
    window.addEventListener('touchmove', holdTouch, {
      capture: true,
      passive: false,
    });
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancelPointer, true);
      window.removeEventListener('lostpointercapture', cancelPointer, true);
      window.removeEventListener('touchmove', holdTouch, true);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', cancel);
      finish();
      controller.destroy();
    };
  }, [controller]);

  // It has landed once the table has let go of it (the room has answered)
  // and stopped moving; or, whatever happened to it, a little later.
  const settlingLanding =
    landingCardId !== null &&
    (options.settling ?? []).some((entry) => entry.cardId === landingCardId);
  useEffect(() => {
    if (landingCardId === null) return;
    const cap = window.setTimeout(() => setLandingCardId(null), LANDING_MAX_MS);
    return () => clearTimeout(cap);
  }, [landingCardId]);
  useEffect(() => {
    if (landingCardId === null || settlingLanding) return;
    const motion = latest.current.tableMotion;
    let unsubscribe = () => {};
    // The table sets the card off on its next paint: ask once it has.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!motion?.isMoving()) {
          setLandingCardId(null);
          return;
        }
        unsubscribe = motion.subscribe(() => {
          if (!motion.isMoving()) setLandingCardId(null);
        });
      });
    });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [landingCardId, settlingLanding]);

  const context = JSON.stringify([
    options.scene?.viewport,
    options.depth?.camera,
    options.depth?.settings,
    options.enabled,
  ]);
  useEffect(() => {
    finish();
  }, [context]);
  useEffect(() => {
    const current = grip.current;
    if (
      current &&
      !options.cards.some(
        (card) =>
          card.id === current.card.id &&
          card.parentId === current.card.parentId &&
          card.imageUrl === current.card.imageUrl &&
          card.concealed === current.card.concealed
      )
    )
      finish();
  }, [options.cards]);

  return {
    draggingCardId,
    /** The card the viewer steps aside for: held, or let go and landing. */
    asideCardId: draggingCardId ?? landingCardId,
    /** Touch: the card a held finger has just picked up. */
    armedCardId,
    consumeClick: (id: ViewCardId) => controller.consumeSuppressedClick(id),
    /**
     * A card pressed here is the table's to carry. WebKit can start a native
     * drag of its picture even with draggable={false}, and that drag takes
     * the rest of the gesture: the pointer never comes up for the table.
     */
    onDragStart: (event: ReactDragEvent<HTMLElement>) => event.preventDefault(),
    onPointerDown: (
      event: ReactPointerEvent<HTMLElement>,
      card: CardSceneNode
    ) => {
      const { scene, enabled } = latest.current;
      if (!enabled || !scene || grip.current || event.button !== 0) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const current: Grip = {
        card,
        target: event.currentTarget,
        pointerId: event.pointerId,
        grip: {
          x: (event.clientX - bounds.left) / bounds.width,
          y: (event.clientY - bounds.top) / bounds.height,
        },
        armed: event.pointerType !== 'touch',
        hold: null,
        startX: event.clientX,
        startY: event.clientY,
      };
      if (current.armed && !pickUp(current, event.clientX, event.clientY))
        return;
      grip.current = current;
      if (!current.armed) {
        // Touching a card scrolls the pile; holding it still picks it up.
        const { clientX, clientY } = event;
        current.hold = window.setTimeout(() => {
          current.hold = null;
          if (grip.current !== current) return;
          if (!pickUp(current, clientX, clientY)) {
            finish();
            return;
          }
          current.armed = true;
          setArmedCardId(card.id);
          navigator.vibrate?.(8);
        }, TOUCH_PICKUP_MS);
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* Window listeners also finish out-of-bounds gestures. */
      }
    },
  };
};
