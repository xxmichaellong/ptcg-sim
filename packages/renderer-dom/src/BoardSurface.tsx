import {
  arrangementHold,
  arrangementIndexAt,
  arrangementOffsets,
  BoardDragController,
  canDetachFromStack,
  compositionHold,
  presentHeldMarker,
  VelocityTracker,
  BoardDepthProjection,
  tableCardMatrix,
  tablePoseMatrix,
  tablePoseLocalPoint,
  tablePoseEdges,
  tablePileHeight,
  tableShadowStyle,
  sameTablePose,
  type TableCardPose,
  type TableCamera,
} from '@ptcgsim/renderer-contract';
import type {
  BoardPointerInput,
  BoardPreferences,
  BoardPresentation,
  BoardRendererAdapters,
  BoardScene,
  BoardSceneMotion,
  CardSceneNode,
  SettlingCard,
  ZoneCountSceneNode,
  Rect,
  ZoneSceneNode,
} from '@ptcgsim/renderer-contract';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { BOARD_SURFACE_CSS } from './board-surface-css.js';
import {
  scheduleCardImageRetry,
  settleCardImage,
  watchCardImageRetries,
} from './card-image-retry.js';
import { BOARD_MARKER_CSS } from './markers/marker-css.js';
import { MarkerNode } from './markers/MarkerNode.js';
import {
  BoardMotionDirector,
  type PaintedCard,
} from './motion/BoardMotionDirector.js';
import { DragSwing } from './motion/DragSwing.js';
import { depthPaintKey } from './motion/depth-paint-key.js';
import {
  HoverTilt,
  localPointer,
  type QuarterTurn,
} from './motion/HoverTilt.js';

const FACE_DOWN_LABEL = 'Face-down card';

/**
 * Bases for lifted cards, each added to the card's own scene z-index so the
 * table's order survives the lift. Scene z-indexes stay below ~1,100 (work
 * areas), so a flying or settling card (9,000 + z) passes over the table and
 * its badges, and the card in the hand (20,000 + z) over everything moving.
 */
const LIFTED_Z_INDEX = 9_000;
const DRAG_Z_INDEX = 20_000;
/** How far the pointer moves after a drop before hover answers it again. */
const HOVER_REST_SLOP_PX = 4;
/**
 * Held this long without moving, a Pokémon's card lifts off the rest of its
 * stack and moves alone (to devolve it, say). A mouse or pen only: a long
 * touch is the browser's.
 */
const DETACH_PRESS_MS = 450;
const NO_ASIDES: ReadonlyMap<
  CardSceneNode['id'],
  { readonly x: number; readonly y: number }
> = new Map();

/**
 * The table shows this card's back: it is concealed, or (the deck cover) it
 * paints a back over a face its owner may read elsewhere.
 */
const paintsBack = (card: CardSceneNode): boolean =>
  card.concealed ||
  (card.tableImageUrl !== undefined && card.tableImageUrl !== card.imageUrl);

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
/** The clear space the centre line keeps on either side of the Stadium. */
const SEAM_GAP_PX = 10;

const PlayerFrameNode = memo(function PlayerFrameNode({
  frame,
  darkMode,
  table,
  stadiumSpan,
}: {
  readonly frame: BoardScene['layout']['players'][number];
  readonly darkMode: boolean;
  /** Geometry v2: the play mat paints itself through the stylesheet. */
  readonly table: boolean;
  /** Where the Stadium crosses the centre line, which the line stops for. */
  readonly stadiumSpan?: { readonly left: number; readonly right: number };
}) {
  if (table) {
    const gap =
      stadiumSpan && frame.physicalSide === 'lower'
        ? {
            '--ptcgsim-seam-gap-start': `${String(stadiumSpan.left - SEAM_GAP_PX - frame.bounds.x)}px`,
            '--ptcgsim-seam-gap-end': `${String(stadiumSpan.right + SEAM_GAP_PX - frame.bounds.x)}px`,
          }
        : {};
    return (
      <div
        className="ptcgsim-player-frame"
        data-player-frame-id={frame.playerId}
        data-player-frame-side={frame.side}
        data-player-physical-side={frame.physicalSide}
        data-player-rotation={frame.rotationQuarterTurns}
        aria-hidden="true"
        style={
          {
            ...absoluteRect(frame.bounds, -10),
            pointerEvents: 'none',
            ...gap,
          } as CSSProperties
        }
      />
    );
  }
  // v1's `#boardCenterDesign`: each player frame paints half of the table's
  // centre circles on its authored top edge (16vw and 4vw of the frame's
  // own viewport), so the two halves meet at the divider. The frame clips
  // them and the cards paint over them.
  const outer = frame.bounds.width * 0.16;
  const inner = frame.bounds.width * 0.04;
  const centreY = frame.rotationQuarterTurns === 2 ? frame.bounds.height : 0;
  const circle = (size: number, background: string) => ({
    position: 'absolute' as const,
    left: frame.bounds.width / 2 - size / 2,
    top: centreY - size / 2,
    width: size,
    height: size,
    borderRadius: '50%',
    background,
  });
  return (
    <div
      data-player-frame-id={frame.playerId}
      data-player-frame-side={frame.side}
      data-player-physical-side={frame.physicalSide}
      data-player-rotation={frame.rotationQuarterTurns}
      aria-hidden="true"
      style={{
        ...absoluteRect(frame.bounds, -10),
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <div
        data-board-circle="outer"
        style={circle(outer, 'rgba(164, 164, 216, 0.112)')}
      />
      <div
        data-board-circle="inner"
        style={circle(
          inner,
          darkMode ? 'rgb(8, 18, 18)' : 'rgba(255, 255, 255, 0.6)'
        )}
      />
    </div>
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

/**
 * The containers v1's Show Zones setting outlines (`settings.js`
 * `showOutlines`): the hand and the loose board never get one.
 */
const OUTLINED_ZONE_KINDS: ReadonlySet<ZoneSceneNode['kind']> = new Set([
  // The loose board, where a card is shown before it is resolved (a
  // Supporter being played). Any empty felt in the half drops here too.
  'board',
  'active',
  'bench',
  'prizes',
  'deck',
  'lostZone',
  'discard',
  'stadium',
]);

/**
 * v1's `#hand { border-top: 3px solid ... }` in each player's container: blue
 * for the viewer, red for the opponent, on the edge facing the board -- the
 * opponent's container is turned around, so theirs sits on the hand's lower
 * edge.
 */
interface HandDivider {
  readonly edge: 'top' | 'bottom';
  readonly color: string;
}

const handDividerFor = (
  zone: ZoneSceneNode,
  players: BoardScene['layout']['players']
): HandDivider | undefined => {
  if (zone.kind !== 'hand') return undefined;
  const frame = players.find(
    (candidate) => candidate.playerId === zone.playerId
  );
  if (!frame) return undefined;
  return {
    edge: frame.physicalSide === 'lower' ? 'top' : 'bottom',
    color:
      frame.side === 'local'
        ? 'rgba(90, 110, 188, 0.864)'
        : 'rgba(188, 90, 113, 0.864)',
  };
};

/** What the play mat prints in each zone (geometry v2). */
const TABLE_ZONE_LABELS: Partial<Record<ZoneSceneNode['kind'], string>> = {
  board: 'Board',
  active: 'Active',
  bench: 'Bench',
  prizes: 'Prizes',
  deck: 'Deck',
  discard: 'Discard',
  lostZone: 'Lost Zone',
  stadium: 'Stadium',
};

const ZoneNode = memo(function ZoneNode({
  zone,
  showOutline,
  handDividerEdge,
  handDividerColor,
  dropTarget,
  emitIntent,
  scrollZone,
  table,
  depth,
}: {
  readonly zone: ZoneSceneNode;
  readonly showOutline: boolean;
  /** Primitives, so the memoized node is not repainted every render. */
  readonly handDividerEdge: HandDivider['edge'] | undefined;
  readonly handDividerColor: string | undefined;
  /** The zone under a dragged card: v1 tints it with `.highlightBox`. */
  readonly dropTarget: boolean;
  readonly emitIntent: BoardRendererAdapters['emitIntent'];
  readonly scrollZone: BoardRendererAdapters['scrollZone'];
  readonly table: boolean;
  readonly depth?: BoardDepthProjection;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const grownRef = useRef<number | null>(null);
  // v1 `#hand { overflow-x: auto }` and `#board { overflow-y: auto }`: an
  // overflowing zone is a real scroll container. Its scrollbar and wheel move
  // the offset, which the scene then applies to the card boxes, so the element
  // follows the scene's offset. `board-observer.js` additionally scrolls the
  // loose board to the bottom whenever cards arrive, which is reproduced by
  // jumping to the end when the content grows.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const scroll = zone.scroll;
    if (!element || !scroll) {
      grownRef.current = null;
      return;
    }
    const appended =
      zone.kind === 'board' &&
      grownRef.current !== null &&
      scroll.contentLength > grownRef.current;
    grownRef.current = scroll.contentLength;
    if (scroll.axis === 'y') {
      const target = appended
        ? Math.max(0, scroll.contentLength - zone.bounds.height)
        : scroll.offsetPx;
      if (Math.abs(element.scrollTop - target) >= 1) element.scrollTop = target;
      return;
    }
    if (Math.abs(element.scrollLeft - scroll.offsetPx) >= 1) {
      element.scrollLeft = scroll.offsetPx;
    }
  }, [zone.scroll, zone.kind, zone.bounds.height]);
  return (
    <div
      ref={scrollRef}
      className={`ptcgsim-zone ptcgsim-zone-${zone.kind}`}
      data-zone-id={zone.id}
      data-zone-side={zone.side}
      data-zone-outline={table && showOutline ? 'true' : undefined}
      data-zone-label={table ? TABLE_ZONE_LABELS[zone.kind] : undefined}
      data-zone-kind={zone.kind}
      data-zone-surface={zone.surface}
      data-drop-target={dropTarget ? 'true' : undefined}
      data-zone-scroll-axis={zone.scroll?.axis}
      data-zone-scroll-length={zone.scroll?.contentLength}
      aria-label={`${zone.label}, ${zone.count} cards`}
      aria-haspopup={zone.interactive ? 'dialog' : undefined}
      role={zone.interactive ? 'button' : undefined}
      tabIndex={zone.interactive ? 0 : undefined}
      style={{
        ...absoluteRect(zone.bounds, zone.zIndex),
        ...(depth &&
        zone.kind !== 'hand' &&
        zone.kind !== 'inspection' &&
        zone.kind !== 'attachmentResolution'
          ? {
              left: 0,
              top: 0,
              transformOrigin: '0 0',
              transform: `matrix3d(${tableCardMatrix(depth.camera, zone.bounds, 0).join(',')})`,
            }
          : {}),
        // The table's zones are painted by the stylesheet from tokens.
        ...(table
          ? {}
          : {
              borderRadius: 15,
              background: dropTarget
                ? 'rgba(90, 110, 188, 0.3)'
                : showOutline
                  ? 'rgba(255, 255, 255, 0.1)'
                  : 'transparent',
              boxShadow: showOutline
                ? '2px 2px 5px rgba(0, 0, 0, 0.1)'
                : 'none',
              ...(handDividerEdge && handDividerColor
                ? {
                    borderRadius: 0,
                    // An inset shadow paints v1's 3px border without moving
                    // the zone's children, whose content box starts below it.
                    boxShadow: `inset 0 ${handDividerEdge === 'top' ? 3 : -3}px 0 ${handDividerColor}`,
                  }
                : {}),
            }),
        pointerEvents: zone.interactive ? 'auto' : 'none',
        ...(zone.scroll
          ? zone.scroll.axis === 'y'
            ? { overflowY: 'auto' as const, overflowX: 'hidden' as const }
            : { overflowX: 'auto' as const, overflowY: 'hidden' as const }
          : {}),
      }}
      onScroll={(event) => {
        if (!zone.scroll) return;
        scrollZone?.(
          zone.id,
          zone.scroll.axis === 'y'
            ? event.currentTarget.scrollTop
            : event.currentTarget.scrollLeft
        );
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
      {zone.scroll ? (
        <div
          data-zone-scroll-spacer={zone.id}
          aria-hidden="true"
          style={
            zone.scroll.axis === 'y'
              ? { width: 1, height: zone.scroll.contentLength }
              : { width: zone.scroll.contentLength, height: 1 }
          }
        />
      ) : null}
    </div>
  );
});

/**
 * A shadow is cast down-screen whatever way the card is turned. These are the
 * offsets, in the card's own (rotated) frame, that point physically down.
 */
const SHADOW_DIRECTION: Readonly<
  Record<CardSceneNode['rotationQuarterTurns'], readonly [number, number]>
> = {
  0: [0, 1],
  1: [1, 0],
  2: [0, -1],
  3: [-1, 0],
};

const CardNode = memo(
  function CardNode({
    card,
    selected,
    targetable,
    dropTarget,
    dropAction,
    drag,
    settle,
    emitIntent,
    consumeSuppressedClick,
    registerElement,
    camera,
    bands = 1,
    pose,
    asideX = 0,
    asideY = 0,
  }: {
    readonly card: CardSceneNode;
    readonly selected: boolean;
    readonly targetable: boolean;
    /** The stack card under a dragged card: v1 rings it like a selection. */
    readonly dropTarget: boolean;
    /** Held, it would swap places with the Pokémon under it: it shows ⇄. */
    readonly dropAction?: 'swap';
    readonly drag: BoardPresentation['drag'];
    readonly settle: SettlingCard | null;
    readonly emitIntent: BoardRendererAdapters['emitIntent'];
    readonly consumeSuppressedClick: (cardId: CardSceneNode['id']) => boolean;
    readonly registerElement: (
      renderKey: string,
      element: HTMLElement | null
    ) => void;
    readonly camera?: TableCamera;
    readonly bands?: number;
    readonly pose?: TableCardPose;
    /** Moved aside on the flat table, making room for a card held near it. */
    readonly asideX?: number;
    readonly asideY?: number;
  }) {
    const imageRef = useRef<HTMLImageElement>(null);
    const renderKey = card.renderKey ?? '';
    const ref = useCallback(
      (element: HTMLButtonElement | null) =>
        registerElement(renderKey, element),
      [registerElement, renderKey]
    );
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
    // v1's scrolling zones clip what has scrolled out of them. `clip-path` is
    // applied before the element's own transform, so the physical insets are
    // rotated into the card's local frame: its local top edge points physically
    // right after one quarter turn, down after two, and so on. Cards in a
    // scrolling row only ever carry the opponent frame's half turn.
    const clip = ((): string | undefined => {
      const region = card.clipBounds;
      if (!region || held) return undefined;
      const physical = [
        region.y - bounds.y,
        bounds.x + bounds.width - (region.x + region.width),
        bounds.y + bounds.height - (region.y + region.height),
        region.x - bounds.x,
      ].map((inset) => Math.max(0, inset));
      if (physical.every((inset) => inset === 0)) return undefined;
      const local = physical.map(
        (_, index) => physical[(index + card.rotationQuarterTurns) % 4] ?? 0
      );
      return `inset(${local.map((inset) => `${String(inset)}px`).join(' ')})`;
    })();
    // Selection, targets and drop targets are rings drawn with box-shadow on
    // the face, never with a border, so the art keeps its full size.
    const ring = targetable
      ? 'target'
      : selected
        ? 'selected'
        : dropTarget
          ? 'drop'
          : undefined;
    const [shadowX, shadowY] = SHADOW_DIRECTION[card.rotationQuarterTurns];
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
        ref={ref}
        type="button"
        className="ptcgsim-card"
        data-card-id={card.id}
        data-depth-card={camera ? 'true' : undefined}
        data-elevation={pose?.elevation.toFixed(3)}
        data-card-role={card.role}
        data-card-composition={card.composition?.kind}
        data-card-primary-action={card.primaryAction?.kind}
        data-ring={ring}
        data-held={drag ? 'drag' : settle ? 'settle' : undefined}
        data-in-hand={
          card.role === 'zone' && card.parentId.endsWith(':hand')
            ? 'true'
            : undefined
        }
        aria-label={paintsBack(card) ? FACE_DOWN_LABEL : card.label}
        aria-haspopup={
          card.primaryAction?.kind === 'openZone' ? 'dialog' : undefined
        }
        aria-pressed={card.primaryAction ? undefined : selected}
        style={
          {
            // Lifted cards keep the table's order among themselves: an
            // attached Energy stays behind its Pokémon while the stack is
            // held, settling or (see [data-flying]) in flight.
            ...absoluteRect(
              bounds,
              drag
                ? DRAG_Z_INDEX + card.zIndex
                : settle
                  ? LIFTED_Z_INDEX + card.zIndex
                  : card.zIndex
            ),
            '--ptcgsim-z': card.zIndex,
            display: 'block',
            margin: 0,
            padding: 0,
            border: 0,
            background: 'transparent',
            cursor: card.interactive ? (drag ? 'grabbing' : 'grab') : 'default',
            ...(clip ? { clipPath: clip } : {}),
            transform: `rotate(${card.rotationQuarterTurns * 90}deg)`,
            transformOrigin: 'center',
            ...(!camera && !held && (asideX !== 0 || asideY !== 0)
              ? { translate: `${String(asideX)}px ${String(asideY)}px` }
              : {}),
            ...(camera && pose
              ? {
                  left: 0,
                  top: 0,
                  transformOrigin: '0 0',
                  transform: `matrix3d(${tablePoseMatrix(camera, pose).join(',')})`,
                }
              : {}),
            '--ptcgsim-shadow-x': String(shadowX),
            '--ptcgsim-shadow-y': String(shadowY),
          } as CSSProperties
        }
        disabled={!card.interactive}
        onClick={(event) => {
          if (!consumeSuppressedClick(card.id) || event.detail === 0) {
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
        {camera && pose ? (
          <CardDepthGeometry camera={camera} pose={pose} bands={bands} />
        ) : null}
        <span className="ptcgsim-card__body" data-card-body="">
          <span
            className="ptcgsim-card__face card-material"
            data-finish={paintsBack(card) ? 'sheen' : (card.finish ?? 'sheen')}
            data-foil-region={
              paintsBack(card) ? undefined : card.presentation?.foilRegion
            }
          >
            <img
              ref={imageRef}
              src={card.tableImageUrl ?? card.imageUrl}
              alt=""
              draggable={false}
              onLoad={(event) => {
                event.currentTarget.dataset.cardImageState = 'ready';
                event.currentTarget.style.visibility = 'visible';
                settleCardImage(event.currentTarget);
              }}
              onError={(event) => {
                event.currentTarget.dataset.cardImageState = 'failed';
                event.currentTarget.style.visibility = 'hidden';
                scheduleCardImageRetry(event.currentTarget);
              }}
            />
          </span>
          {dropAction === 'swap' ? (
            <span
              className="ptcgsim-card__drop-action"
              data-drop-action="swap"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 8h15M15 4l4 4-4 4" />
                <path d="M20 16H5M9 12l-4 4 4 4" />
              </svg>
            </span>
          ) : null}
        </span>
      </button>
    );
  },
  (before, after) => {
    // The flat renderer retains React's ordinary shallow comparison. Depth
    // scenes recreate projections on each acknowledgement, even for still cards.
    if (!before.camera || !after.camera)
      return (
        Object.keys(before).length === Object.keys(after).length &&
        (Object.keys(before) as (keyof typeof before)[]).every((key) =>
          Object.is(before[key], after[key])
        )
      );
    return (
      depthPaintKey(before.card) === depthPaintKey(after.card) &&
      depthPaintKey(before.camera) === depthPaintKey(after.camera) &&
      before.bands === after.bands &&
      before.pose !== undefined &&
      after.pose !== undefined &&
      sameTablePose(before.pose, after.pose) &&
      before.selected === after.selected &&
      before.targetable === after.targetable &&
      before.dropTarget === after.dropTarget &&
      before.dropAction === after.dropAction &&
      before.drag === after.drag &&
      before.settle === after.settle &&
      before.emitIntent === after.emitIntent &&
      before.consumeSuppressedClick === after.consumeSuppressedClick &&
      before.registerElement === after.registerElement
    );
  }
);

const CardDepthGeometry = ({
  camera,
  pose,
  bands,
}: {
  camera: TableCamera;
  pose: TableCardPose;
  bands: number;
}) => {
  const paths = tablePoseEdges(camera, pose, bands);
  const shadow = tableShadowStyle(paths.above, pose.bounds.width);
  return (
    <svg
      className="ptcgsim-card__depth"
      viewBox={`0 0 ${pose.bounds.width} ${pose.bounds.height}`}
      aria-hidden="true"
    >
      <path
        data-depth-contact=""
        d={paths.contact}
        style={{ opacity: shadow.contactOpacity }}
      />
      <path
        data-depth-shadow=""
        d={paths.shadow}
        style={{
          opacity: shadow.castOpacity,
          filter:
            shadow.castBlur > 0
              ? `blur(${shadow.castBlur.toFixed(2)}px)`
              : 'none',
        }}
      />
      <path data-depth-side="" d={paths.sides} />
      <path data-depth-lines="" d={paths.lines} />
    </svg>
  );
};

const ZoneCountNode = memo(function ZoneCountNode({
  node,
  darkMode,
  table,
}: {
  readonly node: ZoneCountSceneNode;
  readonly darkMode: boolean;
  /** Geometry v2 shows counts as badges styled by the stylesheet. */
  readonly table: boolean;
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
      className={`ptcgsim-zone-count ptcgsim-zone-count-${node.kind}${
        table ? ' ptcgsim-zone-count--badge' : ''
      }`}
      data-zone-count-for={node.zoneId}
      data-zone-count={node.count}
      data-zone-count-side={node.side}
      aria-hidden="true"
      style={
        table
          ? ({
              position: 'absolute',
              ...horizontal,
              ...vertical,
              zIndex: 9_200,
              pointerEvents: 'none',
              userSelect: 'none',
              // The hand's badge carries its owner's colour, as v1's text did.
              ...(node.kind === 'hand'
                ? { '--ptcgsim-count-tint': node.color }
                : {}),
            } as CSSProperties)
          : {
              position: 'absolute',
              ...horizontal,
              ...vertical,
              zIndex: node.zIndex,
              fontSize: node.fontSizePx,
              lineHeight: 'normal',
              // v1 toggles `.dark-mode-3` on every count text: the pile counts turn
              // grey, while the hand count keeps its side colour.
              color:
                darkMode && node.kind !== 'hand'
                  ? 'rgb(149, 149, 149)'
                  : node.color,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              userSelect: 'none',
            }
      }
    >
      {table ? node.count : `(${node.count})`}
    </div>
  );
});

/** Where each painted card is drawn this commit, including held cards. */
const paintedCards = (
  scene: BoardScene,
  presentation: BoardPresentation,
  asides: ReadonlyMap<
    CardSceneNode['id'],
    { readonly x: number; readonly y: number }
  >
): {
  readonly painted: Map<string, PaintedCard>;
  readonly held: Set<string>;
} => {
  const painted = new Map<string, PaintedCard>();
  const held = new Set<string>();
  for (const card of scene.cards) {
    if (card.renderKey === null) continue;
    const hold =
      compositionHold(scene, card, presentation.drag) ??
      presentation.settling
        .map((entry) => compositionHold(scene, card, entry))
        .find(Boolean);
    if (hold) held.add(card.renderKey);
    const aside = asides.get(card.id);
    painted.set(card.renderKey, {
      rect: hold
        ? {
            ...card.bounds,
            x: hold.x - card.bounds.width / 2,
            y: hold.y - card.bounds.height / 2,
          }
        : aside
          ? {
              ...card.bounds,
              x: card.bounds.x + aside.x,
              y: card.bounds.y + aside.y,
            }
          : card.bounds,
      rotationQuarterTurns: card.rotationQuarterTurns,
    });
  }
  return { painted, held };
};

export const BoardSurface = ({
  scene,
  presentation,
  preferences,
  adapters,
  motion,
  onCommit,
  setInteractionCancellation,
}: {
  readonly scene: BoardScene;
  readonly presentation: BoardPresentation;
  readonly preferences: BoardPreferences;
  readonly adapters: BoardRendererAdapters;
  /** Why this scene arrived; absent means it simply appears. */
  readonly motion?: BoardSceneMotion;
  readonly onCommit?: () => void;
  readonly setInteractionCancellation?: (cancel: (() => void) | null) => void;
}) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  // Card art that failed to load tries again by itself (card-image-retry).
  useEffect(() => {
    const surface = surfaceRef.current;
    return surface ? watchCardImageRetries(surface) : undefined;
  }, []);
  // Everything painted sits on this table. Motion that moves the whole table
  // (the board flip) animates it, never the surface: the surface is what
  // pointer input and the resize handles measure.
  const tableRef = useRef<HTMLDivElement>(null);
  const ghostLayerRef = useRef<HTMLDivElement>(null);
  const director = useMemo(() => new BoardMotionDirector(), []);
  const projection = useMemo(
    () => new BoardDepthProjection(scene, preferences),
    [
      scene,
      preferences.depth,
      preferences.viewpoint,
      preferences.reducedMotion,
      preferences.animationSpeed,
    ]
  );
  const depth = projection.enabled ? projection : undefined;
  const grabbed = useRef<CardSceneNode | null>(null);
  const swing = useMemo(() => new DragSwing(), []);
  const gripRef = useRef({ x: 0.5, y: 0.55 });
  const tilt = useMemo(() => new HoverTilt(), []);
  const hoveredRef = useRef<{
    readonly cardId: CardSceneNode['id'];
    x: number;
    y: number;
  } | null>(null);
  const hoverFrameRef = useRef<number | null>(null);
  // Where the pointer let go of a dragged card. The card is still settling
  // into its place there, so hover leaves it alone -- no lift, no lean --
  // until the pointer moves on; otherwise it would sink and pop back up.
  const hoverRestRef = useRef<{
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const restHover = (at: { readonly x: number; readonly y: number } | null) => {
    hoverRestRef.current = at;
    if (at) surfaceRef.current?.setAttribute('data-hover-rest', '');
    else surfaceRef.current?.removeAttribute('data-hover-rest');
  };
  const velocity = useMemo(() => new VelocityTracker(100), []);
  const previousSceneRef = useRef<BoardScene | null>(null);
  // The scene a timer started at pointer-down should act on: the latest.
  const latestSceneRef = useRef(scene);
  latestSceneRef.current = scene;
  const detachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelDetachTimer = () => {
    if (detachTimerRef.current === null) return;
    clearTimeout(detachTimerRef.current);
    detachTimerRef.current = null;
  };
  useEffect(
    () => () => {
      if (detachTimerRef.current !== null) clearTimeout(detachTimerRef.current);
    },
    []
  );
  useLayoutEffect(
    () => () => {
      director.destroy();
      swing.stop();
      tilt.leave(true);
      if (hoverFrameRef.current !== null) {
        cancelAnimationFrame(hoverFrameRef.current);
        hoverFrameRef.current = null;
      }
    },
    [director, swing, tilt]
  );
  useLayoutEffect(() => {
    director.attach(tableRef.current, ghostLayerRef.current);
    // `data-motion` says whether the table is still moving on its own, for
    // anything that must wait for it to settle (tests, screenshots).
    director.onActivity = (active) => {
      if (surfaceRef.current) {
        surfaceRef.current.dataset.motion = active ? 'active' : 'idle';
      }
    };
  });
  const animationSpeed = preferences.animationSpeed ?? 1;
  const table = scene.layout.geometryVersion === 2;
  useLayoutEffect(() => {
    director.setSettings({
      reduced: preferences.reducedMotion,
      durationScale: animationSpeed,
    });
    swing.setEnabled(!preferences.reducedMotion && animationSpeed > 0);
    tilt.setEnabled(!preferences.reducedMotion && animationSpeed > 0);
  }, [director, swing, tilt, preferences.reducedMotion, animationSpeed]);
  // Every commit tells the director where cards are now drawn; a new scene
  // also gets a motion plan from the last one.
  // A row making room on the flat table (the tilted one poses it itself).
  const asides = useMemo(
    () =>
      depth
        ? NO_ASIDES
        : arrangementOffsets(scene, arrangementHold(scene, presentation)),
    [depth, scene, presentation]
  );
  useLayoutEffect(() => {
    const { painted, held } = paintedCards(scene, presentation, asides);
    director.commit(previousSceneRef.current, scene, motion, painted, held, {
      projection,
      presentation,
    });
    previousSceneRef.current = scene;
  }, [director, scene, presentation, motion, projection, asides]);
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
  const registerElement = director.register;
  const draggedCardId = presentation.drag?.cardId ?? null;
  const draggedCard =
    draggedCardId === null
      ? undefined
      : scene.cards.find((card) => card.id === draggedCardId);
  const paintedById = useMemo(
    () =>
      new Map(
        scene.cards
          .filter((card) => card.renderKey !== null)
          .map((card) => [String(card.id), card])
      ),
    [scene]
  );
  const reportCardHover = adapters.reportCardHover;
  const scheduleHoverReport = () => {
    if (!reportCardHover || hoverFrameRef.current !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      reportCardHover(hoveredRef.current ? { ...hoveredRef.current } : null);
      return;
    }
    hoverFrameRef.current = requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      reportCardHover(hoveredRef.current ? { ...hoveredRef.current } : null);
    });
  };
  const clearHover = () => {
    tilt.leave();
    director.depth.hover(null);
    if (hoveredRef.current) {
      hoveredRef.current = null;
      scheduleHoverReport();
    }
  };
  // The hovered card leans toward the pointer and is reported for the
  // inspector. Touch has no hover; a drag ends it.
  const trackHover = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (presentation.drag || event.pointerType === 'touch') {
      clearHover();
      return;
    }
    const element =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-card-id]')
        : null;
    const card = element?.dataset.cardId
      ? paintedById.get(element.dataset.cardId)
      : undefined;
    if (!element || !card) {
      clearHover();
      return;
    }
    const turn = card.rotationQuarterTurns as QuarterTurn;
    const surface = surfaceRef.current?.getBoundingClientRect();
    const paintedPose =
      depth && card.renderKey
        ? (director.depth.current(card.renderKey) ?? depth.pose(card))
        : null;
    const projectedLocal =
      depth && surface && paintedPose
        ? tablePoseLocalPoint(depth.camera, paintedPose, {
            x:
              ((event.clientX - surface.left) * scene.viewport.width) /
              surface.width,
            y:
              ((event.clientY - surface.top) * scene.viewport.height) /
              surface.height,
          })
        : null;
    const normalized =
      projectedLocal && paintedPose
        ? {
            x: projectedLocal.x / paintedPose.bounds.width - 0.5,
            y: projectedLocal.y / paintedPose.bounds.height - 0.5,
          }
        : undefined;
    if (card.interactive) {
      tilt.track(element, event.clientX, event.clientY, turn, normalized);
    } else {
      tilt.leave();
    }
    if (depth)
      director.depth.hover(
        card.interactive && card.renderKey ? card.renderKey : null
      );
    // Only a card the table paints face up may be read large: the deck
    // cover is a back even when its owner can read the deck in the viewer.
    if (paintsBack(card)) {
      if (hoveredRef.current) {
        hoveredRef.current = null;
        scheduleHoverReport();
      }
      return;
    }
    const point =
      normalized ??
      localPointer(
        element.getBoundingClientRect(),
        event.clientX,
        event.clientY,
        turn
      );
    hoveredRef.current = { cardId: card.id, x: point.x, y: point.y };
    scheduleHoverReport();
  };
  useLayoutEffect(() => {
    if (!draggedCard?.renderKey) {
      swing.release();
      return;
    }
    const body = surfaceRef.current?.querySelector<HTMLElement>(
      `[data-card-id="${CSS.escape(String(draggedCard.id))}"] > .ptcgsim-card__body`
    );
    swing.attach(
      draggedCard.composition ? null : (body ?? null),
      gripRef.current
    );
  }, [
    swing,
    draggedCard?.id,
    draggedCard?.renderKey,
    draggedCard?.composition,
  ]);
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
      grabbed.current = null;
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
    const suspend = () => {
      dragController.cancel();
      cancel();
      director.cancelAll();
      swing.stop();
      tilt.leave(true);
    };
    const visibility = () => suspend();
    window.addEventListener('blur', suspend);
    document.addEventListener('visibilitychange', visibility);
    setInteractionCancellation?.(cancel);
    return () => {
      window.removeEventListener('blur', suspend);
      document.removeEventListener('visibilitychange', visibility);
      setInteractionCancellation?.(null);
      cancel();
    };
  }, [dragController, director, swing, tilt, setInteractionCancellation]);

  const pointerInput = (
    event: ReactPointerEvent<HTMLDivElement>,
    starting?: CardSceneNode
  ): BoardPointerInput | null => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    const point = {
      x: ((event.clientX - bounds.left) * scene.viewport.width) / bounds.width,
      y: ((event.clientY - bounds.top) * scene.viewport.height) / bounds.height,
    };
    const source = starting ?? grabbed.current;
    if (depth && source) {
      const base = depth.pose(source);
      let grabPoint;
      if (starting) {
        const painted = source.renderKey
          ? (director.depth.current(source.renderKey) ?? base)
          : base;
        const local = tablePoseLocalPoint(depth.camera, painted, point);
        if (!local) return null;
        let u = local.x / painted.bounds.width - 0.5;
        let v = local.y / painted.bounds.height - 0.5;
        // The flat hand may already be raised by its reading hover treatment.
        const body = (
          event.target instanceof Element
            ? event.target.closest('[data-card-id]')
            : null
        )?.querySelector<HTMLElement>('.ptcgsim-card__body');
        if (base.plane === 0 && body) {
          const grip = localPointer(
            body.getBoundingClientRect(),
            event.clientX,
            event.clientY,
            source.rotationQuarterTurns
          );
          u = grip.x;
          v = grip.y;
        }
        gripRef.current = { x: u + 0.5, y: v + 0.5 };
        const angle = (source.rotationQuarterTurns * Math.PI) / 2;
        grabPoint = {
          x:
            source.bounds.x +
            source.bounds.width / 2 +
            u * source.bounds.width * Math.cos(angle) -
            v * source.bounds.height * Math.sin(angle),
          y:
            source.bounds.y +
            source.bounds.height / 2 +
            u * source.bounds.width * Math.sin(angle) +
            v * source.bounds.height * Math.cos(angle),
        };
      } else {
        // Solve at the height the card is painted at, so it stays under the
        // pointer while it rises.
        const painted = source.renderKey
          ? director.depth.current(source.renderKey)
          : undefined;
        grabPoint = depth.cardPoint(source, point, {
          ...base,
          plane: 1,
          elevation:
            painted && painted.plane === 1
              ? painted.elevation
              : base.elevation + depth.liftFor(base.bounds.width),
        });
      }
      if (source.renderKey)
        director.depth.grab({
          key: source.renderKey,
          ...gripRef.current,
          point,
        });
      // The pointer aims; the card comes down straight below where it is
      // held, centred there, so it never jumps by the grip on release.
      const u = gripRef.current.x - 0.5;
      const v = gripRef.current.y - 0.5;
      const turn = (source.rotationQuarterTurns * Math.PI) / 2;
      const centre = {
        x:
          grabPoint.x -
          (u * source.bounds.width * Math.cos(turn) -
            v * source.bounds.height * Math.sin(turn)),
        y:
          grabPoint.y -
          (u * source.bounds.width * Math.sin(turn) +
            v * source.bounds.height * Math.cos(turn)),
      };
      const hit = depth.drop(point, source.id, (card) =>
        card.renderKey ? director.depth.current(card.renderKey) : undefined
      );
      return {
        pointerId: event.pointerId,
        button: event.button,
        x: grabPoint.x,
        y: grabPoint.y,
        screenPoint: point,
        dropPoint: centre,
        targetId: hit.targetId,
        arrangementIndex: arrangementIndexAt(
          scene,
          source.id,
          hit.targetId,
          hit.point.x,
          hit.point.y
        ),
      };
    }
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
  // A drag's target is the id of the stack or zone under the pointer; v1
  // rings the stack's visible top card and tints a zone container.
  const dragTargetId = presentation.drag?.targetId ?? null;
  const dropTargetCardId =
    dragTargetId === null
      ? null
      : (scene.cards
          .filter(
            (card) =>
              card.parentId === dragTargetId && card.role === 'stackEvolution'
          )
          .sort((left, right) => right.zIndex - left.zIndex)[0]?.id ?? null);
  // A drop that would swap two Pokémon says so on the card being held, where
  // it is always in view (the Pokémon it would trade with is under it).
  const swapCardId =
    presentation.drag?.action?.kind === 'swap'
      ? presentation.drag.cardId
      : null;

  const stadium = scene.zones.find((zone) => zone.kind === 'stadium')?.bounds;
  const lower = scene.layout.players.find(
    (frame) => frame.physicalSide === 'lower'
  );
  // The Stadium straddles the centre line; the line stops either side of it.
  const stadiumSpan =
    stadium &&
    lower &&
    stadium.y < lower.bounds.y &&
    stadium.y + stadium.height > lower.bounds.y
      ? { left: stadium.x, right: stadium.x + stadium.width }
      : undefined;
  const frames = scene.layout.players
    .filter((frame) => !frame.hidden)
    .map((frame) => (
      <PlayerFrameNode
        key={frame.playerId}
        frame={frame}
        darkMode={preferences.darkMode}
        table={table}
        {...(stadiumSpan ? { stadiumSpan } : {})}
      />
    ));

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
      data-geometry={scene.layout.geometryVersion}
      data-table-view={projection.settings.mode}
      data-motion="idle"
      onWheel={(event) => {
        // The cards paint above the scroll container, so a wheel over them
        // scrolls the region the way it would over v1's `#hand` or `#board`.
        const bounds = surfaceRef.current?.getBoundingClientRect();
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
        const screenX =
          ((event.clientX - bounds.left) * scene.viewport.width) / bounds.width;
        const screenY =
          ((event.clientY - bounds.top) * scene.viewport.height) /
          bounds.height;
        const { x, y } = projection.boardPoint({ x: screenX, y: screenY });
        const zone = scene.zones.find(
          (candidate) =>
            candidate.scroll !== undefined &&
            x >= candidate.bounds.x &&
            x <= candidate.bounds.x + candidate.bounds.width &&
            y >= candidate.bounds.y &&
            y <= candidate.bounds.y + candidate.bounds.height
        );
        if (!zone?.scroll) return;
        const delta =
          Math.abs(event.deltaX) > Math.abs(event.deltaY)
            ? event.deltaX
            : event.deltaY;
        if (delta === 0) return;
        const extent =
          zone.scroll.axis === 'y' ? zone.bounds.height : zone.bounds.width;
        adapters.scrollZone?.(
          zone.id,
          Math.max(
            0,
            Math.min(
              zone.scroll.contentLength - extent,
              zone.scroll.offsetPx + delta
            )
          )
        );
      }}
      onPointerDown={(event) => {
        director.interruptTableTurn();
        const target = pointerCard(event);
        if (!target) {
          adapters.emitIntent({ kind: 'BoardBackgroundPressed' });
          return;
        }
        const input = pointerInput(event, target.card);
        if (!input) return;
        if (dragController.pointerDown(scene, target.card.id, input)) {
          grabbed.current = target.card;
          cancelDetachTimer();
          if (
            event.pointerType !== 'touch' &&
            canDetachFromStack(scene, target.card.id)
          ) {
            const pointerId = event.pointerId;
            detachTimerRef.current = setTimeout(() => {
              detachTimerRef.current = null;
              if (dragController.detach(latestSceneRef.current, pointerId))
                clearHover();
            }, DETACH_PRESS_MS);
          }
          const body = target.element.querySelector<HTMLElement>(
            '.ptcgsim-card__body'
          );
          const grip = localPointer(
            (body ?? target.element).getBoundingClientRect(),
            event.clientX,
            event.clientY,
            target.card.rotationQuarterTurns as QuarterTurn
          );
          if (!depth) gripRef.current = { x: grip.x + 0.5, y: grip.y + 0.5 };
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
          cancelDetachTimer();
          clearHover();
          event.preventDefault();
          velocity.add(input.x, input.y, event.timeStamp);
          if (draggedCard) {
            const speed = velocity.velocity();
            const turn = (draggedCard.rotationQuarterTurns * Math.PI) / 2;
            swing.lean(
              Math.cos(turn) * speed.x + Math.sin(turn) * speed.y,
              draggedCard.bounds.width,
              -Math.sin(turn) * speed.x + Math.cos(turn) * speed.y,
              draggedCard.bounds.height
            );
          }
        } else {
          const rest = hoverRestRef.current;
          if (
            rest &&
            Math.hypot(event.clientX - rest.x, event.clientY - rest.y) <
              HOVER_REST_SLOP_PX
          ) {
            clearHover();
            return;
          }
          if (rest) restHover(null);
          trackHover(event);
        }
      }}
      onPointerLeave={() => {
        restHover(null);
        clearHover();
      }}
      onPointerUp={(event) => {
        cancelDetachTimer();
        const ownsGrab =
          capturedPointerRef.current?.pointerId === event.pointerId;
        const input = pointerInput(event);
        const released = draggedCard;
        if (input && released?.renderKey) {
          velocity.add(input.x, input.y, event.timeStamp);
          const { x, y } = velocity.velocity(event.timeStamp);
          director.noteRelease(released.renderKey, x, y);
        }
        velocity.reset();
        swing.release();
        if (released && event.pointerType !== 'touch') {
          restHover({ x: event.clientX, y: event.clientY });
          clearHover();
        }
        if (input && dragController.pointerUp(scene, input)) {
          event.preventDefault();
        }
        releaseCapture(event);
        if (ownsGrab) grabbed.current = null;
      }}
      onPointerCancel={(event) => {
        cancelDetachTimer();
        dragController.cancel(event.pointerId);
        if (capturedPointerRef.current?.pointerId === event.pointerId)
          grabbed.current = null;
        velocity.reset();
        swing.release();
        releaseCapture(event);
      }}
      onLostPointerCapture={(event) => {
        dragController.cancel(event.pointerId);
        if (capturedPointerRef.current?.pointerId === event.pointerId)
          grabbed.current = null;
        if (capturedPointerRef.current?.pointerId === event.pointerId) {
          capturedPointerRef.current = null;
        }
      }}
      style={{
        position: 'relative',
        width: scene.viewport.width,
        height: scene.viewport.height,
        // A projected child must never make focus scroll the camera surface.
        overflow: depth ? 'clip' : 'hidden',
        background: 'transparent',
        touchAction: 'none',
        userSelect: 'none',
        contain: 'strict',
      }}
    >
      <style>{BOARD_SURFACE_CSS}</style>
      <style>{BOARD_MARKER_CSS}</style>
      <div
        ref={tableRef}
        className="ptcgsim-board-table"
        style={{ position: 'absolute', inset: 0 }}
      >
        {depth ? (
          <div
            className="ptcgsim-depth-mat"
            aria-hidden="true"
            style={{
              width: scene.viewport.width,
              height: scene.viewport.height,
              transform: `matrix3d(${tableCardMatrix(depth.camera, { x: 0, y: 0, width: scene.viewport.width, height: scene.viewport.height }, 0).join(',')})`,
            }}
          >
            {/* The halves' tints and the seam are printed on the mat, so
                they lie on it however it is tilted. */}
            {frames}
          </div>
        ) : (
          frames
        )}
        {/* The table's split is set from the board view, not dragged. */}
        {table
          ? null
          : scene.layout.resizeHandles.map((handle) => (
              <ResizeHandleNode key={handle.id} handle={handle} />
            ))}
        <BoardControlsAnchorNode
          anchor={scene.layout.shared.boardControlsAnchor}
        />
        {scene.zones.map((zone) => {
          const divider = handDividerFor(zone, scene.layout.players);
          return (
            <ZoneNode
              key={zone.id}
              zone={zone}
              showOutline={
                preferences.showZoneOutlines &&
                OUTLINED_ZONE_KINDS.has(zone.kind)
              }
              handDividerEdge={divider?.edge}
              handDividerColor={divider?.color}
              dropTarget={dragTargetId === zone.id}
              emitIntent={adapters.emitIntent}
              scrollZone={adapters.scrollZone}
              table={table}
              {...(depth ? { depth } : {})}
            />
          );
        })}
        {scene.cards
          .filter((card) => card.renderKey !== null)
          .map((card) => (
            <CardNode
              key={card.renderKey}
              card={card}
              selected={presentation.selectedCardId === card.id}
              targetable={presentation.targetableCardIds.includes(card.id)}
              dropTarget={dropTargetCardId === card.id}
              {...(swapCardId === card.id
                ? { dropAction: 'swap' as const }
                : {})}
              drag={compositionHold(scene, card, presentation.drag)}
              settle={
                presentation.settling
                  .map((entry) => compositionHold(scene, card, entry))
                  .find(Boolean) ?? null
              }
              {...(asides.has(card.id)
                ? {
                    asideX: asides.get(card.id)!.x,
                    asideY: asides.get(card.id)!.y,
                  }
                : {})}
              emitIntent={adapters.emitIntent}
              consumeSuppressedClick={consumeSuppressedClick}
              registerElement={registerElement}
              {...(depth
                ? {
                    camera: depth.camera,
                    bands: depth.pileCounts.get(card.id) ?? 1,
                    pose: depth.pose(card, presentation),
                  }
                : {})}
            />
          ))}
        {depth && draggedCard && (depth.pileCounts.get(draggedCard.id) ?? 0) > 1
          ? (() => {
              const base = depth.pose(draggedCard);
              const height = tablePileHeight(
                (depth.pileCounts.get(draggedCard.id) ?? 1) - 1,
                base.bounds.width,
                depth.settings.strength
              );
              const pose = { ...base, elevation: height, thickness: height };
              return (
                <div
                  data-pile-underlay=""
                  className="ptcgsim-card"
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: pose.bounds.width,
                    height: pose.bounds.height,
                    transformOrigin: '0 0',
                    transform: `matrix3d(${tablePoseMatrix(depth.camera, pose).join(',')})`,
                    zIndex: draggedCard.zIndex,
                    pointerEvents: 'none',
                  }}
                >
                  <CardDepthGeometry
                    camera={depth.camera}
                    pose={pose}
                    bands={depth.pileCounts.get(draggedCard.id) ?? 1}
                  />
                  <span className="ptcgsim-card__face">
                    {paintsBack(draggedCard) ? (
                      <img
                        src={draggedCard.tableImageUrl ?? draggedCard.imageUrl}
                        alt=""
                        draggable={false}
                      />
                    ) : null}
                  </span>
                </div>
              );
            })()
          : null}
        <div
          ref={ghostLayerRef}
          className="ptcgsim-ghost-layer"
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            // Above resting cards, below a card in flight: a pile's old top
            // keeps the pile covered until the incoming card lands on it.
            zIndex: 8_900,
          }}
        />
        {scene.markers.map((marker) => {
          if (!depth)
            return (
              <MarkerNode
                key={marker.id}
                marker={presentHeldMarker(scene, marker, presentation)}
              />
            );
          const parent = scene.cards.find(
            (card) => card.id === marker.parentCardId
          );
          const pose = parent ? depth.pose(parent, presentation) : undefined;
          const projected = depth.markerMatrix(marker, pose);
          return (
            <MarkerNode
              key={marker.id}
              marker={projected ? marker : depth.marker(marker, pose)}
              projected={projected}
            />
          );
        })}
        {scene.counts.map((node) => (
          <ZoneCountNode
            key={node.id}
            node={
              depth
                ? {
                    ...node,
                    anchor: depth.point(node.anchor, 0, node.kind === 'hand'),
                  }
                : node
            }
            darkMode={preferences.darkMode}
            table={table}
          />
        ))}
      </div>
    </div>
  );
};
