import {
  BoardDragController,
  isLegacyMarkerPresentation,
  legacyMarkerAppearance,
  legacyMarkerCssColor,
} from '@ptcgsim/renderer-contract';
import type {
  BoardPointerInput,
  BoardPreferences,
  BoardPresentation,
  BoardRendererAdapters,
  BoardScene,
  CardSceneNode,
  MarkerSceneNode,
  SettlingCard,
  ZoneCountSceneNode,
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
  showOutline,
  emitIntent,
}: {
  readonly zone: ZoneSceneNode;
  readonly showOutline: boolean;
  readonly emitIntent: BoardRendererAdapters['emitIntent'];
}) {
  return (
    <div
      className={`ptcgsim-zone ptcgsim-zone-${zone.kind}`}
      data-zone-id={zone.id}
      data-zone-kind={zone.kind}
      data-zone-surface={zone.surface}
      aria-label={`${zone.label}, ${zone.count} cards`}
      aria-haspopup={zone.interactive ? 'dialog' : undefined}
      role={zone.interactive ? 'button' : undefined}
      tabIndex={zone.interactive ? 0 : undefined}
      style={{
        ...absoluteRect(zone.bounds, zone.zIndex),
        borderRadius: 15,
        background: showOutline ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
        boxShadow: showOutline ? '2px 2px 5px rgba(0, 0, 0, 0.1)' : 'none',
        pointerEvents: zone.interactive ? 'auto' : 'none',
      }}
      onDoubleClick={() => {
        if (zone.interactive) {
          emitIntent({ kind: 'ZoneOpened', zoneId: zone.id });
        }
      }}
      onKeyDown={(event) => {
        if (
          zone.interactive &&
          event.target === event.currentTarget &&
          (event.key === 'Enter' || event.key === ' ')
        ) {
          event.preventDefault();
          emitIntent({ kind: 'ZoneOpened', zoneId: zone.id });
        }
      }}
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
  targetable,
  drag,
  settle,
  emitIntent,
  consumeSuppressedClick,
}: {
  readonly card: CardSceneNode;
  readonly selected: boolean;
  readonly targetable: boolean;
  readonly drag: BoardPresentation['drag'];
  readonly settle: SettlingCard | null;
  readonly emitIntent: BoardRendererAdapters['emitIntent'];
  readonly consumeSuppressedClick: (cardId: CardSceneNode['id']) => boolean;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  // A card that was just dropped stays centred on its drop point until the
  // authoritative move lands, exactly as it was painted while dragging.
  const held = drag ?? settle;
  const bounds = held
    ? {
        ...card.bounds,
        x: held.x - card.bounds.width / 2,
        y: held.y - card.bounds.height / 2,
      }
    : card.bounds;
  const legacyBorderRadius =
    card.side === 'local'
      ? '0.275rem'
      : card.side === 'opponent'
        ? '0.3rem'
        : '0.375rem';
  const legacyShadow =
    card.side === 'shared'
      ? '0 2px 4px rgba(0, 0, 0, 0.5)'
      : '0 2px 4px rgba(0, 0, 0, 0.3)';
  const context = (event: ReactMouseEvent) => {
    event.preventDefault();
    emitIntent({ kind: 'CardContextRequested', cardId: card.id });
  };
  const activate = () => {
    if (card.primaryAction?.kind === 'openZone') {
      emitIntent({ kind: 'ZoneOpened', zoneId: card.primaryAction.zoneId });
      return;
    }
    emitIntent({ kind: 'CardSelected', cardId: card.id });
  };
  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    if (image.complete) {
      const ready = image.naturalWidth > 0;
      image.dataset.cardImageState = ready ? 'ready' : 'failed';
      image.style.visibility = ready ? 'visible' : 'hidden';
      return;
    }
    image.dataset.cardImageState = 'loading';
    image.style.visibility = 'hidden';
  }, [card.tableImageUrl, card.imageUrl]);
  return (
    <button
      type="button"
      className="ptcgsim-card"
      data-card-id={card.id}
      data-card-role={card.role}
      data-card-primary-action={card.primaryAction?.kind}
      aria-label={card.label}
      aria-haspopup={
        card.primaryAction?.kind === 'openZone' ? 'dialog' : undefined
      }
      aria-pressed={card.primaryAction ? undefined : selected}
      style={{
        ...absoluteRect(bounds, drag ? 10_000 : settle ? 9_000 : card.zIndex),
        display: 'block',
        margin: 0,
        padding: 0,
        // Selection and hover are rings drawn with box-shadow, never with a
        // border. The card is a fixed-size box, so a border would be taken
        // out of its content area and shrink the image inside -- which is
        // exactly what v1 avoids by highlighting with box-shadow.
        border: 0,
        borderRadius: legacyBorderRadius,
        background: '#777',
        // v1 colours: a selected card wears the blue `.highlight` ring, an
        // attach/evolve target the green `.selectHighlight` ring, and a
        // merely hovered card nothing at all.
        boxShadow: targetable
          ? 'rgba(143, 215, 153, 0.864) 0 0 0 4px'
          : selected
            ? `rgba(90, 110, 188, 0.864) 0 0 0 4px, ${legacyShadow}`
            : legacyShadow,
        cursor: card.interactive ? (drag ? 'grabbing' : 'grab') : 'default',
        overflow: 'hidden',
        transform: `rotate(${card.rotationQuarterTurns * 90}deg)`,
        transformOrigin: 'center',
      }}
      disabled={!card.interactive}
      onClick={() => {
        if (!consumeSuppressedClick(card.id)) {
          activate();
        }
      }}
      onDoubleClick={() => {
        if (!card.primaryAction) {
          emitIntent({ kind: 'CardPreviewRequested', cardId: card.id });
        }
      }}
      onContextMenu={context}
    >
      <img
        ref={imageRef}
        src={card.tableImageUrl ?? card.imageUrl}
        alt=""
        draggable={false}
        onLoad={(event) => {
          event.currentTarget.dataset.cardImageState = 'ready';
          event.currentTarget.style.visibility = 'visible';
        }}
        onError={(event) => {
          event.currentTarget.dataset.cardImageState = 'failed';
          event.currentTarget.style.visibility = 'hidden';
        }}
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

const ZoneCountNode = memo(function ZoneCountNode({
  node,
  darkMode,
}: {
  readonly node: ZoneCountSceneNode;
  readonly darkMode: boolean;
}) {
  // The anchor is one corner of the text box; the other three follow from
  // the text's own size, which is why this is positioned by the anchored
  // edges rather than by a measured rectangle.
  const horizontal =
    node.horizontalAlign === 'left'
      ? { left: node.anchor.x }
      : { right: `calc(100% - ${node.anchor.x}px)` };
  const vertical =
    node.verticalAlign === 'top'
      ? { top: node.anchor.y }
      : { bottom: `calc(100% - ${node.anchor.y}px)` };
  return (
    <div
      className={`ptcgsim-zone-count ptcgsim-zone-count-${node.kind}`}
      data-zone-count-for={node.zoneId}
      data-zone-count={node.count}
      aria-hidden="true"
      style={{
        position: 'absolute',
        ...horizontal,
        ...vertical,
        zIndex: node.zIndex,
        fontSize: node.fontSizePx,
        lineHeight: 'normal',
        // v1 toggles `.dark-mode-3` on every count text: the pile counts turn
        // grey, while the hand count keeps its side colour.
        color:
          darkMode && node.kind !== 'hand' ? 'rgb(149, 149, 149)' : node.color,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      ({node.count})
    </div>
  );
});

const MarkerNode = memo(function MarkerNode({
  marker,
}: {
  readonly marker: MarkerSceneNode;
}) {
  const legacy = isLegacyMarkerPresentation(marker.presentation);
  const appearance = legacy ? legacyMarkerAppearance(marker) : null;
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
              borderRadius: appearance?.shape === 'tab' ? '10%' : '50%',
              background: legacyMarkerCssColor(appearance!.fill),
              color: legacyMarkerCssColor(appearance!.text),
              fontSize: appearance!.fontSizePx,
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
      {appearance ? appearance.label : marker.value}
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
      data-show-zone-outlines={preferences.showZoneOutlines ? 'true' : 'false'}
      data-dragging={presentation.drag ? 'true' : 'false'}
      onPointerDown={(event) => {
        const target = pointerCard(event);
        if (!target) {
          adapters.emitIntent({ kind: 'BoardBackgroundPressed' });
          return;
        }
        const input = pointerInput(event);
        if (!input) return;
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
        background: 'transparent',
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
        <ZoneNode
          key={zone.id}
          zone={zone}
          showOutline={preferences.showZoneOutlines}
          emitIntent={adapters.emitIntent}
        />
      ))}
      {scene.cards
        .filter((card) => card.renderKey !== null)
        .map((card) => (
          <CardNode
            key={card.renderKey}
            card={card}
            selected={presentation.selectedCardId === card.id}
            targetable={presentation.targetableCardIds.includes(card.id)}
            drag={
              presentation.drag?.cardId === card.id ? presentation.drag : null
            }
            settle={
              presentation.settling.find((entry) => entry.cardId === card.id) ??
              null
            }
            emitIntent={adapters.emitIntent}
            consumeSuppressedClick={consumeSuppressedClick}
          />
        ))}
      {scene.markers.map((marker) => (
        <MarkerNode key={marker.id} marker={marker} />
      ))}
      {scene.counts.map((node) => (
        <ZoneCountNode
          key={node.id}
          node={node}
          darkMode={preferences.darkMode}
        />
      ))}
    </div>
  );
};
