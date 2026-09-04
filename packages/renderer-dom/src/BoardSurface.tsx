import { BoardDragController } from '@ptcgsim/renderer-contract';
import type {
  BoardPointerInput,
  BoardPreferences,
  BoardPresentation,
  BoardRendererAdapters,
  BoardScene,
  CardSceneNode,
  MarkerSceneNode,
  Rect,
  ZoneSceneNode,
} from '@ptcgsim/renderer-contract';
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const absoluteRect = (bounds: Rect, zIndex: number): CSSProperties => ({
  position: 'absolute',
  left: bounds.x,
  top: bounds.y,
  width: bounds.width,
  height: bounds.height,
  zIndex,
  boxSizing: 'border-box',
});

/** Geometry sentinels only; visible chrome and resize input remain route-owned. */
const PlayerFrameNode = memo(function PlayerFrameNode({
  frame,
}: {
  readonly frame: BoardScene['layout']['players'][number];
}) {
  return (
    <div
      data-player-frame-id={frame.playerId}
      data-player-frame-side={frame.side}
      data-player-physical-side={frame.physicalSide}
      data-player-rotation={frame.rotationQuarterTurns}
      aria-hidden="true"
      style={{ ...absoluteRect(frame.bounds, -10), pointerEvents: 'none' }}
    />
  );
});

const ResizeHandleNode = memo(function ResizeHandleNode({
  handle,
}: {
  readonly handle: BoardScene['layout']['resizeHandles'][number];
}) {
  return (
    <div
      data-resize-handle-id={handle.id}
      data-controls-physical-side={handle.controlsPhysicalSide}
      aria-hidden="true"
      style={{ ...absoluteRect(handle.bounds, 10_000), pointerEvents: 'none' }}
    />
  );
});

const BoardControlsAnchorNode = memo(function BoardControlsAnchorNode({
  anchor,
}: {
  readonly anchor: BoardScene['layout']['shared']['boardControlsAnchor'];
}) {
  return (
    <div
      data-board-controls-anchor="true"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: anchor.x,
        top: anchor.y,
        width: 0,
        height: anchor.height,
        pointerEvents: 'none',
      }}
    />
  );
});

const ZoneNode = memo(function ZoneNode({
  zone,
  emitIntent,
}: {
  readonly zone: ZoneSceneNode;
  readonly emitIntent: BoardRendererAdapters['emitIntent'];
}) {
  return (
    <div
      className={`ptcgsim-zone ptcgsim-zone-${zone.kind}`}
      data-zone-id={zone.id}
      data-zone-kind={zone.kind}
      data-zone-surface={zone.surface}
      aria-label={`${zone.label}, ${zone.count} cards`}
      style={{
        ...absoluteRect(zone.bounds, zone.zIndex),
        borderRadius: 15,
        background: 'rgba(255, 255, 255, 0.1)',
        boxShadow: '2px 2px 5px rgba(0, 0, 0, 0.1)',
        pointerEvents: zone.interactive ? 'auto' : 'none',
      }}
      onDoubleClick={() => emitIntent({ kind: 'ZoneOpened', zoneId: zone.id })}
    >
      <div
        data-zone-content-id={zone.id}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: zone.contentBounds.x - zone.bounds.x,
          top: zone.contentBounds.y - zone.bounds.y,
          width: zone.contentBounds.width,
          height: zone.contentBounds.height,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
});

const CardNode = memo(function CardNode({
  card,
  selected,
  hovered,
  drag,
  emitIntent,
  consumeSuppressedClick,
}: {
  readonly card: CardSceneNode;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly drag: BoardPresentation['drag'];
  readonly emitIntent: BoardRendererAdapters['emitIntent'];
  readonly consumeSuppressedClick: (cardId: CardSceneNode['id']) => boolean;
}) {
  const bounds = drag
    ? {
        ...card.bounds,
        x: drag.x - card.bounds.width / 2,
        y: drag.y - card.bounds.height / 2,
      }
    : card.bounds;
  const context = (event: ReactMouseEvent) => {
    event.preventDefault();
    emitIntent({ kind: 'CardContextRequested', cardId: card.id });
  };
  return (
    <button
      type="button"
      className="ptcgsim-card"
      data-card-id={card.id}
      data-card-role={card.role}
      aria-label={card.label}
      aria-pressed={selected}
      style={{
        ...absoluteRect(bounds, drag ? 10_000 : card.zIndex),
        display: 'block',
        margin: 0,
        padding: 0,
        border: selected
          ? '4px solid rgba(143, 215, 153, 0.864)'
          : hovered
            ? '3px solid rgba(90, 110, 188, 0.864)'
            : 0,
        borderRadius: '0.375rem',
        background: '#777',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.5)',
        cursor: card.interactive ? (drag ? 'grabbing' : 'grab') : 'default',
        overflow: 'hidden',
        transform: `rotate(${card.rotationQuarterTurns * 90}deg)`,
        transformOrigin: 'center',
      }}
      disabled={!card.interactive}
      onClick={() => {
        if (!consumeSuppressedClick(card.id)) {
          emitIntent({ kind: 'CardSelected', cardId: card.id });
        }
      }}
      onDoubleClick={() =>
        emitIntent({ kind: 'CardPreviewRequested', cardId: card.id })
      }
      onContextMenu={context}
    >
      <img
        src={card.imageUrl}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </button>
  );
});

const MarkerNode = memo(function MarkerNode({
  marker,
}: {
  readonly marker: MarkerSceneNode;
}) {
  const legacy = marker.presentation === 'legacyActiveQ0';
  const legacyConditionPalette = (() => {
    switch (marker.value.toUpperCase()) {
      case 'P':
        return { background: 'rgb(0, 128, 0)', color: 'rgb(255, 255, 255)' };
      case 'B':
        return { background: 'rgb(255, 0, 0)', color: 'rgb(255, 255, 255)' };
      case 'A':
        return { background: 'rgb(0, 0, 255)', color: 'rgb(255, 255, 255)' };
      case 'PA':
        return { background: 'rgb(255, 255, 0)', color: 'rgb(0, 0, 0)' };
      case 'C':
        return { background: 'rgb(128, 0, 128)', color: 'rgb(255, 255, 255)' };
      default:
        return { background: 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)' };
    }
  })();
  const legacyBackground =
    marker.kind === 'damage'
      ? 'rgb(255, 98, 0)'
      : marker.kind === 'specialCondition'
        ? legacyConditionPalette.background
        : marker.side === 'local'
          ? 'rgba(59, 141, 173, 0.708)'
          : 'rgba(255, 60, 0, 0.392)';
  const legacyColor =
    marker.kind === 'damage'
      ? 'rgb(255, 255, 255)'
      : marker.kind === 'specialCondition'
        ? legacyConditionPalette.color
        : 'rgb(0, 0, 0)';
  const legacyFontSize =
    marker.kind === 'damage'
      ? marker.bounds.width / 2
      : marker.kind === 'specialCondition'
        ? marker.bounds.width * 0.75
        : undefined;
  return (
    <div
      className={`ptcgsim-marker ptcgsim-marker-${marker.kind}`}
      data-marker-id={marker.id}
      data-marker-presentation={marker.presentation}
      data-marker-side={marker.side}
      aria-hidden="true"
      style={
        legacy
          ? {
              ...absoluteRect(marker.bounds, marker.zIndex),
              display: 'block',
              borderRadius: marker.kind === 'abilityUsed' ? '10%' : '50%',
              background: legacyBackground,
              color: legacyColor,
              fontSize: legacyFontSize,
              lineHeight:
                marker.kind === 'abilityUsed'
                  ? `${marker.bounds.width / 3}px`
                  : `${marker.bounds.width}px`,
              textAlign: 'center',
              pointerEvents: 'none',
            }
          : {
              ...absoluteRect(marker.bounds, marker.zIndex),
              display: 'grid',
              placeItems: 'center',
              borderRadius: '50%',
              background: marker.kind === 'damage' ? '#e64242' : '#efefef',
              color: marker.kind === 'damage' ? '#fff' : '#111',
              fontSize: Math.max(10, marker.bounds.height * 0.42),
              fontWeight: 700,
              pointerEvents: 'none',
            }
      }
    >
      {legacy && marker.kind === 'abilityUsed' ? '' : marker.value}
    </div>
  );
});

export const BoardSurface = ({
  scene,
  presentation,
  preferences,
  adapters,
  onCommit,
  setInteractionCancellation,
}: {
  readonly scene: BoardScene;
  readonly presentation: BoardPresentation;
  readonly preferences: BoardPreferences;
  readonly adapters: BoardRendererAdapters;
  readonly onCommit?: () => void;
  readonly setInteractionCancellation?: (cancel: (() => void) | null) => void;
}) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const capturedPointerRef = useRef<{
    readonly element: HTMLElement;
    readonly pointerId: number;
  } | null>(null);
  const dragController = useMemo(
    () => new BoardDragController(adapters),
    [adapters]
  );
  const consumeSuppressedClick = useCallback(
    (cardId: CardSceneNode['id']) =>
      dragController.consumeSuppressedClick(cardId),
    [dragController]
  );
  useLayoutEffect(() => {
    onCommit?.();
  }, [onCommit]);
  useLayoutEffect(() => {
    dragController.reconcile(scene);
  }, [dragController, scene]);
  useLayoutEffect(
    () => () => {
      dragController.destroy();
    },
    [dragController]
  );
  useLayoutEffect(() => {
    const cancel = () => {
      const pointerId = dragController.cancelInteraction();
      const captured = capturedPointerRef.current;
      capturedPointerRef.current = null;
      if (
        captured &&
        (pointerId === null || pointerId === captured.pointerId)
      ) {
        try {
          if (captured.element.hasPointerCapture?.(captured.pointerId)) {
            captured.element.releasePointerCapture(captured.pointerId);
          }
        } catch {
          // Capture can already be released by the browser.
        }
      }
    };
    setInteractionCancellation?.(cancel);
    return () => {
      setInteractionCancellation?.(null);
      cancel();
    };
  }, [dragController, setInteractionCancellation]);

  const pointerInput = (
    event: ReactPointerEvent<HTMLDivElement>
  ): BoardPointerInput | null => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      pointerId: event.pointerId,
      x: ((event.clientX - bounds.left) * scene.viewport.width) / bounds.width,
      y: ((event.clientY - bounds.top) * scene.viewport.height) / bounds.height,
      button: event.button,
    };
  };
  const pointerCard = (
    event: ReactPointerEvent<HTMLDivElement>
  ): { readonly element: HTMLElement; readonly card: CardSceneNode } | null => {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const element = target.closest<HTMLElement>('[data-card-id]');
    const id = element?.dataset.cardId;
    const card = id
      ? scene.cards.find((candidate) => String(candidate.id) === id)
      : undefined;
    return element && card ? { element, card } : null;
  };
  const releaseCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const captured = capturedPointerRef.current;
    if (!captured || captured.pointerId !== event.pointerId) return;
    capturedPointerRef.current = null;
    try {
      if (captured.element.hasPointerCapture?.(captured.pointerId)) {
        captured.element.releasePointerCapture(captured.pointerId);
      }
    } catch {
      // Capture can already be released by the browser on cancellation.
    }
  };
  return (
    <div
      ref={surfaceRef}
      className="ptcgsim-board-surface"
      data-match-id={scene.matchId}
      data-revision={scene.revision}
      data-shell-mode={scene.layout.shellMode}
      data-reduced-motion={preferences.reducedMotion ? 'true' : 'false'}
      data-high-contrast={preferences.highContrast ? 'true' : 'false'}
      data-dark-mode={preferences.darkMode ? 'true' : 'false'}
      data-dragging={presentation.drag ? 'true' : 'false'}
      onPointerDown={(event) => {
        const input = pointerInput(event);
        const target = pointerCard(event);
        if (!input || !target) return;
        if (dragController.pointerDown(scene, target.card.id, input)) {
          try {
            target.element.setPointerCapture?.(event.pointerId);
            capturedPointerRef.current = {
              element: target.element,
              pointerId: event.pointerId,
            };
          } catch {
            // Pointer capture is best effort on older embedded browsers.
          }
        }
      }}
      onPointerMove={(event) => {
        const input = pointerInput(event);
        if (input && dragController.pointerMove(scene, input)) {
          event.preventDefault();
        }
      }}
      onPointerUp={(event) => {
        const input = pointerInput(event);
        if (input && dragController.pointerUp(scene, input)) {
          event.preventDefault();
        }
        releaseCapture(event);
      }}
      onPointerCancel={(event) => {
        dragController.cancel(event.pointerId);
        releaseCapture(event);
      }}
      onLostPointerCapture={(event) => {
        dragController.cancel(event.pointerId);
        if (capturedPointerRef.current?.pointerId === event.pointerId) {
          capturedPointerRef.current = null;
        }
      }}
      style={{
        position: 'relative',
        width: scene.viewport.width,
        height: scene.viewport.height,
        overflow: 'hidden',
        background: preferences.darkMode ? '#081212' : 'transparent',
        touchAction: 'none',
        userSelect: 'none',
        contain: 'strict',
      }}
    >
      {scene.layout.players.map((frame) => (
        <PlayerFrameNode key={frame.playerId} frame={frame} />
      ))}
      {scene.layout.resizeHandles.map((handle) => (
        <ResizeHandleNode key={handle.id} handle={handle} />
      ))}
      <BoardControlsAnchorNode
        anchor={scene.layout.shared.boardControlsAnchor}
      />
      {scene.zones.map((zone) => (
        <ZoneNode key={zone.id} zone={zone} emitIntent={adapters.emitIntent} />
      ))}
      {scene.cards.map((card) => (
        <CardNode
          key={card.id}
          card={card}
          selected={presentation.selectedCardId === card.id}
          hovered={presentation.hoveredCardId === card.id}
          drag={
            presentation.drag?.cardId === card.id ? presentation.drag : null
          }
          emitIntent={adapters.emitIntent}
          consumeSuppressedClick={consumeSuppressedClick}
        />
      ))}
      {scene.markers.map((marker) => (
        <MarkerNode key={marker.id} marker={marker} />
      ))}
    </div>
  );
};
