import type { ViewCardId } from '@ptcgsim/game-core';
import {
  BoardDragController,
  resolveBoardDropTarget,
  type BoardDepthProjection,
  type BoardIntent,
  type BoardScene,
  type CardSceneNode,
} from '@ptcgsim/renderer-contract';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

interface Options {
  readonly scene: BoardScene | undefined;
  readonly depth?: BoardDepthProjection;
  readonly cards: readonly CardSceneNode[];
  readonly enabled: boolean;
  readonly emit: (
    intent: Extract<BoardIntent, { kind: 'CardDropRequested' }>
  ) => void;
}
interface Grip {
  card: CardSceneNode;
  target: HTMLElement;
  pointerId: number;
  u: number;
  v: number;
  x: number;
  y: number;
  ghost: HTMLElement | null;
  frame: number | null;
}

/** The board gesture contract, with a screen-space face while leaving a panel. */
export const useOverlayCardDrag = (options: Options) => {
  const latest = useRef(options);
  latest.current = options;
  // Buried pile cards have no board hit target, but are individually movable
  // inside an authorized open panel. Override only the current source.
  const gestureScene = (scene: BoardScene, id: ViewCardId): BoardScene => ({
    ...scene,
    cards: scene.cards.map((card) =>
      card.id === id ? { ...card, interactive: true } : card
    ),
  });
  const grip = useRef<Grip | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<ViewCardId | null>(null);
  const controller = useMemo(
    () =>
      new BoardDragController({
        emitIntent: (intent) => {
          if (intent.kind === 'CardDropRequested') latest.current.emit(intent);
        },
        emitPresentationUpdate: (update) => {
          if (update.kind !== 'DragChanged') return;
          setDraggingCardId(update.drag?.cardId ?? null);
          const current = grip.current;
          if (!update.drag || !current || current.ghost) return;
          const ghost = current.target.ownerDocument.createElement('div');
          ghost.className = 'ptcgsim-panel-drag-face card-material';
          ghost.setAttribute('aria-hidden', 'true');
          ghost.dataset.finish = current.card.concealed
            ? 'sheen'
            : (current.card.finish ?? 'sheen');
          if (!current.card.concealed && current.card.presentation?.foilRegion)
            ghost.dataset.foilRegion = current.card.presentation.foilRegion;
          const image = current.target.ownerDocument.createElement('img');
          image.src = current.card.imageUrl;
          image.alt = '';
          image.draggable = false;
          ghost.append(image);
          ghost.style.transform = `translate3d(${current.x - current.u * 126}px, ${current.y - current.v * 176}px, 0)`;
          current.target.ownerDocument.body.append(ghost);
          current.ghost = ghost;
        },
      }),
    []
  );

  const finish = (cancel = true) => {
    if (cancel) controller.cancel();
    const current = grip.current;
    grip.current = null;
    if (current) {
      if (current.frame !== null) cancelAnimationFrame(current.frame);
      current.ghost?.remove();
      try {
        current.target.releasePointerCapture(current.pointerId);
      } catch {
        /* Already released by the browser. */
      }
    }
    setDraggingCardId(null);
  };

  useEffect(() => {
    const input = (event: PointerEvent) => {
      const current = grip.current;
      const { scene, depth, cards, enabled } = latest.current;
      if (!current || current.pointerId !== event.pointerId || !scene)
        return null;
      if (
        !enabled ||
        !cards.some(
          (card) =>
            card.id === current.card.id &&
            card.parentId === current.card.parentId &&
            card.imageUrl === current.card.imageUrl &&
            card.concealed === current.card.concealed
        )
      ) {
        finish();
        return null;
      }
      const bounds = current.target
        .closest('[data-legacy-board-overlays]')
        ?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return null;
      const screen = {
        x:
          ((event.clientX - bounds.left) * scene.viewport.width) / bounds.width,
        y:
          ((event.clientY - bounds.top) * scene.viewport.height) /
          bounds.height,
      };
      const hit = depth?.drop(screen, current.card.id) ?? {
        point: screen,
        targetId: resolveBoardDropTarget(
          scene,
          current.card.id,
          screen.x,
          screen.y
        ),
      };
      // Picking follows the pointer, while settling follows the held face's
      // centre. An off-centre grip must not jump to a centred grip on release.
      const centre = {
        x:
          screen.x +
          ((0.5 - current.u) * 126 * scene.viewport.width) / bounds.width,
        y:
          screen.y +
          ((0.5 - current.v) * 176 * scene.viewport.height) / bounds.height,
      };
      const dropPoint = depth?.boardPoint(centre) ?? centre;
      const inside =
        screen.x >= 0 &&
        screen.y >= 0 &&
        screen.x <= scene.viewport.width &&
        screen.y <= scene.viewport.height;
      return {
        pointerId: event.pointerId,
        button: 0,
        x: hit.point.x,
        y: hit.point.y,
        screenPoint: { x: event.clientX, y: event.clientY },
        dropPoint,
        targetId: inside ? hit.targetId : null,
      };
    };
    const move = (event: PointerEvent) => {
      const value = input(event);
      if (!value || !latest.current.scene) return;
      if (
        !controller.pointerMove(
          gestureScene(latest.current.scene, grip.current!.card.id),
          value
        )
      )
        return;
      event.preventDefault();
      const current = grip.current!;
      current.x = event.clientX;
      current.y = event.clientY;
      if (current.frame !== null) return;
      current.frame = requestAnimationFrame(() => {
        current.frame = null;
        if (current.ghost)
          current.ghost.style.transform = `translate3d(${current.x - current.u * 126}px, ${current.y - current.v * 176}px, 0)`;
      });
    };
    const up = (event: PointerEvent) => {
      if (grip.current?.pointerId !== event.pointerId) return;
      const value = input(event);
      if (value && latest.current.scene)
        controller.pointerUp(
          gestureScene(latest.current.scene, grip.current!.card.id),
          value
        );
      else controller.cancel();
      finish(false);
    };
    const cancelPointer = (event: PointerEvent) => {
      if (grip.current?.pointerId === event.pointerId) finish();
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
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancelPointer, true);
      window.removeEventListener('lostpointercapture', cancelPointer, true);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', cancel);
      finish();
      controller.destroy();
    };
  }, [controller]);

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
    consumeClick: (id: ViewCardId) => controller.consumeSuppressedClick(id),
    onPointerDown: (
      event: ReactPointerEvent<HTMLElement>,
      card: CardSceneNode
    ) => {
      const { scene, enabled } = latest.current;
      if (!enabled || !scene || grip.current || event.button !== 0) return;
      // Touching artwork scrolls the pile. Its visible grip explicitly starts
      // a drag; mouse and pen can still pick up anywhere on the face.
      if (
        event.pointerType === 'touch' &&
        !(
          event.target instanceof Element &&
          event.target.closest('[data-panel-drag-handle]')
        )
      )
        return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      if (
        !controller.pointerDown(gestureScene(scene, card.id), card.id, {
          pointerId: event.pointerId,
          button: event.button,
          x: card.bounds.x + card.bounds.width / 2,
          y: card.bounds.y + card.bounds.height / 2,
          screenPoint: { x: event.clientX, y: event.clientY },
        })
      )
        return;
      grip.current = {
        card,
        target: event.currentTarget,
        pointerId: event.pointerId,
        u: (event.clientX - bounds.left) / bounds.width,
        v: (event.clientY - bounds.top) / bounds.height,
        x: event.clientX,
        y: event.clientY,
        ghost: null,
        frame: null,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* Window listeners also finish out-of-bounds gestures. */
      }
    },
  };
};
