import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg, plural, t } from '@lingui/core/macro';
import {
  arrangementHold,
  arrangementIndexAt,
  arrangementOffsets,
  BoardDragController,
  canDetachFromStack,
  carriedGroup,
  compositionHold,
  containsPoint,
  groupCardsOf,
  paintedCardBounds,
  presentHeldMarker,
  selectionItemOf,
  VelocityTracker,
  BoardDepthProjection,
  tableCardMatrix,
  tablePoseMatrix,
  tablePoseLocalPoint,
  tablePoseEdges,
  tablePileHeight,
  tableShadowStyle,
  sameTablePose,
  withHeldCards,
  type TableCardPose,
  type TableCamera,
} from '@ptcgsim/renderer-contract';
import type {
  BoardPointerInput,
  BoardPreferences,
  BoardPresentation,
  BoardPress,
  BoardRendererAdapters,
  BoardScene,
  BoardSceneMotion,
  BoardSide,
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
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';

import {
  BoardHintIndex,
  BoardHintTimer,
  BoardHintTooltip,
  boardHintAt,
  type BoardHintShowing,
  type BoardHintTarget,
} from './board-hints.js';
import { BOARD_SURFACE_CSS } from './board-surface-css.js';
import {
  fallBackCardImage,
  scheduleCardImageRetry,
  settleCardImage,
  watchCardImageRetries,
} from './card-image-retry.js';
import { BOARD_MARKER_CSS } from './markers/marker-css.js';
import { tableMatBounds } from './mat-bounds.js';
import { MarkerNode } from './markers/MarkerNode.js';
import { tableCountNode } from './table-count-node.js';
import {
  BoardMotionDirector,
  type PaintedCard,
} from './motion/BoardMotionDirector.js';
import { peekShift } from './hand-peek.js';
import {
  addsToSelection,
  SWEEP_THRESHOLD_PX,
  sweepCandidates,
  sweepRect,
  sweptItems,
  type Sweep,
  type SweepCandidate,
} from './selection-input.js';
import { DragSwing } from './motion/DragSwing.js';
import { liftHeldCards } from './motion/held-card-lift.js';
import { depthPaintKey } from './motion/depth-paint-key.js';
import {
  HoverTilt,
  localPointer,
  type QuarterTurn,
} from './motion/HoverTilt.js';

/** A card painted face down, whatever it is: worded at render. */
const faceDownLabel = (): string => t`Face-down card`;

/**
 * The page's language, so memoized nodes whose own props did not change
 * (a known card painted face down) are worded again when it changes.
 */
const subscribeLocale = (listener: () => void) => i18n.on('change', listener);
const readLocale = () => i18n.locale;

/**
 * Bases for lifted cards, each added to the card's own scene z-index so the
 * table's order survives the lift. Scene z-indexes stay below ~1,100 (work
 * areas), so a flying or settling card (9,000 + z) passes over the table and
 * its badges, and the card in the hand (20,000 + z) over everything moving.
 */
const LIFTED_Z_INDEX = 9_000;
const DRAG_Z_INDEX = 20_000;
/**
 * Each item of a group fanned out behind the card in the hand lies this
 * much lower, so the one gripped is on top (above anything settling).
 */
const FAN_Z_STEP = 1_200;
/** How far the pointer moves after a drop before hover answers it again. */
const HOVER_REST_SLOP_PX = 4;
/**
 * Held this long without moving, a Pokémon's card lifts off the rest of its
 * stack and moves alone (to devolve it, say). A mouse or pen only: a long
 * touch is the browser's.
 */
const DETACH_PRESS_MS = 450;
/**
 * A finger on a crowded hand peeks at its cards, as a mouse's hover raises
 * them (ADR-030 §9): the card it presses rises into view at once, sliding
 * along the hand raises each card under it in turn, moving toward the table
 * picks the raised card up, and letting go taps it. How far the finger
 * moves before its press slides or picks the card up:
 */
const PEEK_SLOP_PX = 8;
/** How far toward the table a sliding finger moves to pick the card up. */
const PEEK_PICK_PX = 24;
/**
 * Which way a sliding finger heads is read over its last moments: a thumb
 * sweeping the hand in an arc still heads along it, and a finger that
 * stops on a card and then lifts toward the table heads that way at once.
 */
const PEEK_HEADING_MS = 100;
/** How long the browser's own click after a slide may take to arrive. */
const PEEK_CLICK_MS = 700;
/** The same, after a rectangle drawn on the felt is let go of. */
const SWEEP_CLICK_MS = 400;
/** How wide a raised card is drawn at least, and how much it may grow. */
const PEEK_READ_WIDTH_PX = 120;
const PEEK_SCALE = { least: 1.12, most: 1.6 } as const;

/** A finger's press on a crowded hand (`PEEK_SLOP_PX`). */
interface HandPeek {
  readonly pointerId: number;
  readonly zoneId: string;
  /** The card pressed: the browser's own click, if any, lands on it. */
  readonly pressed: CardSceneNode;
  /** Where the press began, on screen. */
  readonly startX: number;
  readonly startY: number;
  /** Which way the table lies from the hand on screen: 1 down, -1 up. */
  readonly toward: 1 | -1;
  /**
   * A press yet to move; a slide along the hand; the raised card picked
   * up; or a long press's menu opened, which the release leaves alone.
   */
  mode: 'press' | 'slide' | 'picked' | 'menu';
  /** The card raised now. */
  peeked: CardSceneNode['id'];
  /** The finger's recent points, on screen, the oldest past the window. */
  trail: { readonly x: number; readonly y: number; readonly t: number }[];
  /** Where the finger began heading toward the table, while it does. */
  lift: { readonly x: number; readonly y: number } | null;
}

/** Lowers whatever card a finger has raised out of its hand. */
const lowerPeekedCards = (surface: HTMLElement | null): void => {
  if (!surface?.hasAttribute('data-peeking')) return;
  surface.removeAttribute('data-peeking');
  surface.removeAttribute('data-peek-slide');
  surface
    .querySelectorAll('[data-peek]')
    .forEach((card) => card.removeAttribute('data-peek'));
};

/**
 * Cards of a hand (`zoneId`) that overlap so much that less than half of
 * each shows, topmost first, each with where it is painted; null for a hand
 * that shows more.
 */
const crowdedHandCards = (
  scene: BoardScene,
  zoneId: string,
  paintedAt: (card: CardSceneNode) => Rect
): readonly { readonly card: CardSceneNode; readonly rect: Rect }[] | null => {
  const cards = scene.cards
    .map((card, order) => ({ card, order }))
    .filter(
      ({ card }) =>
        card.parentId === zoneId &&
        card.role === 'zone' &&
        card.renderKey !== null
    );
  if (cards.length < 2) return null;
  const placed = cards.map(({ card, order }) => ({
    card,
    order,
    rect: paintedAt(card),
  }));
  const lefts = placed.map(({ rect }) => rect.x);
  const step = (Math.max(...lefts) - Math.min(...lefts)) / (placed.length - 1);
  const width = Math.min(...placed.map(({ rect }) => rect.width));
  if (!(step < width / 2)) return null;
  return placed
    .sort((a, b) => b.card.zIndex - a.card.zIndex || b.order - a.order)
    .map(({ card, rect }) => ({ card, rect }));
};

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

/**
 * How long the table's size holds before the mat is painted afresh at it.
 * While the size keeps changing -- a log sliding in beside the table, a
 * window being dragged -- the mat keeps the size it was painted at and is
 * scaled onto the new one, so its weave, lamp light and shadows are not
 * rasterised again on every frame: that work outran the frames and let the
 * desk flash through the table.
 */
const MAT_SETTLE_MS = 180;

/** How far a press on a marker or badge may wander and still be a tap. */
const HINT_TAP_SLOP_PX = 8;

/** A second press on the same marker this soon is a double press. */
const MARKER_DOUBLE_PRESS_MS = 400;

/** The size the mat is painted at: the table's, once it has held still. */
const useSettledSize = (
  width: number,
  height: number
): { readonly width: number; readonly height: number } => {
  const [settled, setSettled] = useState({ width, height });
  useEffect(() => {
    if (settled.width === width && settled.height === height) return;
    const timer = setTimeout(
      () => setSettled({ width, height }),
      MAT_SETTLE_MS
    );
    return () => clearTimeout(timer);
  }, [width, height, settled.width, settled.height]);
  return settled.width > 0 && settled.height > 0 ? settled : { width, height };
};

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
        data-player-frame-tone={frame.tone}
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
/** What an empty zone shows when the pointer rests on it. */
const TABLE_ZONE_LABELS: Partial<
  Record<ZoneSceneNode['kind'], MessageDescriptor>
> = {
  board: msg({ message: 'Board', context: 'zone on the table' }),
  active: msg({
    message: 'Active',
    context: 'zone on the table',
    comment: 'The Active Spot.',
  }),
  bench: msg({ message: 'Bench', context: 'zone on the table' }),
  prizes: msg({
    message: 'Prizes',
    context: 'zone on the table',
    comment: 'The Prize cards.',
  }),
  deck: msg({ message: 'Deck', context: 'zone on the table' }),
  discard: msg({
    message: 'Discard',
    context: 'zone on the table',
    comment: 'The discard pile.',
  }),
  lostZone: msg({ message: 'Lost Zone', context: 'zone on the table' }),
  stadium: msg({ message: 'Stadium', context: 'zone on the table' }),
};

const tableZoneLabel = (kind: ZoneSceneNode['kind']): string | undefined => {
  const label = TABLE_ZONE_LABELS[kind];
  return label ? i18n._(label) : undefined;
};

/** A zone's name and count for assistive tech: "Red discard, 3 cards". */
const zoneName = (label: string, count: number): string =>
  t({
    message: plural(count, {
      one: `${label}, # card`,
      other: `${label}, # cards`,
    }),
    comment: 'label is the zone\'s name, e.g. "Red discard".',
  });

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
      data-zone-label={table ? tableZoneLabel(zone.kind) : undefined}
      data-zone-empty={table && zone.count === 0 ? 'true' : undefined}
      data-zone-kind={zone.kind}
      data-zone-surface={zone.surface}
      data-drop-target={dropTarget ? 'true' : undefined}
      data-zone-scroll-axis={zone.scroll?.axis}
      data-zone-scroll-length={zone.scroll?.contentLength}
      aria-label={zoneName(zone.label, zone.count)}
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
    order,
    describedBy,
    selectionMode = false,
    carryMore = 0,
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
    /** The page's language; only compared, so a change repaints the words. */
    readonly locale?: string;
    readonly card: CardSceneNode;
    readonly selected: boolean;
    /**
     * Its place in a selection of several (1, 2, 3…), shown on its face:
     * the card a selected item is selected by.
     */
    readonly order?: number;
    /**
     * The element saying how many are selected, which a numbered card's
     * accessible name is followed by. One for the table, so a card's own
     * name changes only with its own number: a toggle repaints only the
     * cards it renumbers.
     */
    readonly describedBy?: string;
    /** Touch's selection mode: a tap picks it up or puts it back. */
    readonly selectionMode?: boolean;
    /** The card in the hand of a group: how many more come than it carries. */
    readonly carryMore?: number;
    readonly targetable: boolean;
    /** The stack card under a dragged card: v1 rings it like a selection. */
    readonly dropTarget: boolean;
    /** Held, it would swap places with the Pokémon under it: it shows ⇄. */
    readonly dropAction?: 'swap';
    /** Held, and how far behind the card in the hand it is fanned (`layer`). */
    readonly drag:
      | (NonNullable<BoardPresentation['drag']> & {
          readonly layer?: number;
        })
      | null;
    readonly settle: SettlingCard | null;
    readonly emitIntent: BoardRendererAdapters['emitIntent'];
    readonly consumeSuppressedClick: (
      cardId: CardSceneNode['id'],
      renderKey: CardSceneNode['renderKey']
    ) => boolean;
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
    const activate = (clicks: number, adds: boolean) => {
      if (card.primaryAction?.kind === 'openZone') {
        emitIntent({ kind: 'ZoneOpened', zoneId: card.primaryAction.zoneId });
        return;
      }
      // Shift or ⌘/Ctrl, or a tap in selection mode: the card joins the
      // selection, or leaves it, the rest staying. Every such click counts,
      // however quickly it follows the last (ADR-042 §2).
      if (adds || selectionMode) {
        emitIntent({ kind: 'CardSelected', cardId: card.id, mode: 'add' });
        return;
      }
      // The second click of a double click opens the preview; it leaves the
      // selection the first one made. Clicks past that keep the card
      // selected, as v1's rapid clicks did.
      if (clicks === 2) return;
      emitIntent({
        kind: 'CardSelected',
        cardId: card.id,
        ...(clicks > 2 ? {} : { mode: 'toggle' as const }),
      });
    };
    const name = paintsBack(card) ? faceDownLabel() : card.label;
    useLayoutEffect(() => {
      const image = imageRef.current;
      if (!image) return;
      if (image.complete) {
        const ready = image.naturalWidth > 0;
        if (
          !ready &&
          fallBackCardImage(
            image,
            paintsBack(card) ? card.backFallbackUrl : card.imageFallbackUrl
          )
        ) {
          image.style.visibility = 'hidden';
          return;
        }
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
        data-card-side={card.side}
        data-card-composition={card.composition?.kind}
        data-card-primary-action={card.primaryAction?.kind}
        data-ring={ring}
        data-select-order={order}
        data-held={drag ? 'drag' : settle ? 'settle' : undefined}
        data-in-hand={
          card.role === 'zone' && card.parentId.endsWith(':hand')
            ? 'true'
            : undefined
        }
        aria-label={
          order === undefined
            ? name
            : t({
                message: `${name}, selected, number ${order}`,
                comment:
                  "A card's name for screen readers while several are selected: name is the card's, order its place in the selection (1 for the first picked). Followed by how many are selected.",
              })
        }
        aria-describedby={order === undefined ? undefined : describedBy}
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
                ? DRAG_Z_INDEX - (drag.layer ?? 0) * FAN_Z_STEP + card.zIndex
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
          if (
            !consumeSuppressedClick(card.id, card.renderKey) ||
            event.detail === 0
          ) {
            activate(event.detail, addsToSelection(event));
          }
        }}
        onDoubleClick={(event) => {
          // Picking cards one by one never opens the preview.
          if (addsToSelection(event) || selectionMode) return;
          // A double press on a marker lying on the card is the marker's.
          const surface = event.currentTarget.closest(
            '.ptcgsim-board-surface, .ptcgsim-board-lift'
          );
          if (
            surface &&
            boardHintAt(surface, event.clientX, event.clientY)?.markerId
          )
            return;
          if (!card.primaryAction) {
            emitIntent({ kind: 'CardPreviewRequested', cardId: card.id });
          }
        }}
        onContextMenu={context}
      >
        <span className="ptcgsim-card__body" data-card-body="">
          {/* The edges and shadows sit in the body, so a held card's swing
              turns them with the face in the same frame. */}
          {camera && pose ? (
            <CardDepthGeometry camera={camera} pose={pose} bands={bands} />
          ) : null}
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
              // A back never tells a host where it is shown (ADR-041).
              {...(paintsBack(card)
                ? { referrerPolicy: 'no-referrer' as const }
                : {})}
              onLoad={(event) => {
                event.currentTarget.dataset.cardImageState = 'ready';
                event.currentTarget.style.visibility = 'visible';
                settleCardImage(event.currentTarget);
              }}
              onError={(event) => {
                event.currentTarget.style.visibility = 'hidden';
                // A face asked for in the player's language that has no
                // such printing shows the deck's own scan instead; a back
                // that won't load, the standard back.
                if (
                  fallBackCardImage(
                    event.currentTarget,
                    paintsBack(card)
                      ? card.backFallbackUrl
                      : card.imageFallbackUrl
                  )
                )
                  return;
                event.currentTarget.dataset.cardImageState = 'failed';
                scheduleCardImageRetry(event.currentTarget);
              }}
            />
          </span>
          {order === undefined ? null : (
            <span
              className="ptcgsim-card__order"
              data-turn={card.rotationQuarterTurns}
              aria-hidden="true"
            >
              {order}
            </span>
          )}
          {carryMore > 0 ? (
            <span
              className="ptcgsim-card__carry-more"
              data-turn={card.rotationQuarterTurns}
              aria-hidden="true"
            >
              +{carryMore}
            </span>
          ) : null}
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
      before.locale === after.locale &&
      before.pose !== undefined &&
      after.pose !== undefined &&
      sameTablePose(before.pose, after.pose) &&
      before.selected === after.selected &&
      before.order === after.order &&
      before.describedBy === after.describedBy &&
      before.selectionMode === after.selectionMode &&
      before.carryMore === after.carryMore &&
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

/**
 * A card's edges and shadow on the tilted table, drawn again only when its
 * pose changes: a card repainted for its ring or number keeps its edges.
 */
const CardDepthGeometry = memo(
  function CardDepthGeometry({
    camera,
    pose,
    bands,
  }: {
    camera: TableCamera;
    pose: TableCardPose;
    bands: number;
  }) {
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
  },
  (before, after) =>
    before.bands === after.bands &&
    sameTablePose(before.pose, after.pose) &&
    depthPaintKey(before.camera) === depthPaintKey(after.camera)
);

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
      data-board-hint={node.hint}
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
  scene: installedScene,
  presentation,
  preferences,
  adapters,
  motion,
  onCommit,
  setInteractionCancellation,
  setHeldCarrier,
}: {
  readonly scene: BoardScene;
  readonly presentation: BoardPresentation;
  readonly preferences: BoardPreferences;
  readonly adapters: BoardRendererAdapters;
  /** Why this scene arrived; absent means it simply appears. */
  readonly motion?: BoardSceneMotion;
  readonly onCommit?: () => void;
  readonly setInteractionCancellation?: (cancel: (() => void) | null) => void;
  /** Takes how this table carries a held card on without rendering again. */
  readonly setHeldCarrier?: (
    carry: ((presentation: BoardPresentation) => void) | null
  ) => void;
}) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const locale = useSyncExternalStore(subscribeLocale, readLocale, readLocale);
  // A card in the hand that the table does not draw (picked out of a pile's
  // viewer) is painted while it is held and settling, so it moves like any
  // other (held-cards.ts). Keyed by which cards those are, so the scene stays
  // the same object frame to frame.
  const heldKey = [
    presentation.openedZoneId ?? '',
    presentation.drag?.cardId ?? '',
    // The items a group drag carries (the same array the whole drag).
    presentation.drag?.groupCardIds?.join(',') ?? '',
    ...presentation.settling.map(
      (entry) => `${entry.cardId}@${String(entry.x)},${String(entry.y)}`
    ),
  ].join('\u0000');
  const scene = useMemo(
    () => withHeldCards(installedScene, presentation),
    [installedScene, heldKey]
  );
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
  // A card let go of from anywhere -- the table, or a viewer, whose pointer
  // the table never sees -- rests hover where it was dropped.
  const dragRef = useRef(presentation.drag);
  dragRef.current = presentation.drag;
  useEffect(() => {
    const release = (event: PointerEvent) => {
      if (!dragRef.current || event.pointerType === 'touch') return;
      hoverRestRef.current = { x: event.clientX, y: event.clientY };
      surfaceRef.current?.setAttribute('data-hover-rest', '');
    };
    window.addEventListener('pointerup', release, true);
    return () => window.removeEventListener('pointerup', release, true);
  }, []);
  // Tooltips for the counts and markers on the table (board-hints.tsx).
  const [hintShowing, setHintShowing] = useState<BoardHintShowing | null>(null);
  const hintShowingRef = useRef(hintShowing);
  hintShowingRef.current = hintShowing;
  const hints = useMemo(() => new BoardHintTimer(setHintShowing), []);
  useEffect(() => () => hints.dispose(), [hints]);
  // The last marker pressed and when, so a double press counts once.
  const lastMarkerPressRef = useRef<{
    readonly id: string;
    readonly at: number;
  } | null>(null);
  // The marker or badge a press began on, answered when it lets go in place.
  const pressedHintRef = useRef<{
    readonly pointerId: number;
    readonly target: BoardHintTarget;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  // The marker under a resting mouse rises a little and takes the pointer's
  // hand cursor: it can be pressed.
  const hoveredHintRef = useRef<HTMLElement | null>(null);
  const hoverHint = (element: HTMLElement | null) => {
    hints.hover(element);
    const marker = element?.dataset.markerHintId ? element : null;
    if (hoveredHintRef.current === marker) return;
    hoveredHintRef.current?.removeAttribute('data-hint-hover');
    hoveredHintRef.current = marker;
    marker?.setAttribute('data-hint-hover', '');
    if (marker) surfaceRef.current?.setAttribute('data-hint-hover', '');
    else surfaceRef.current?.removeAttribute('data-hint-hover');
  };
  // Where a resting mouse is, looked up once a frame, against the hints as
  // last measured (BoardHintIndex): each commit, the table's motion starting
  // or stopping, a card carrying markers painted, or the window changing
  // has them measured again.
  const hintIndex = useMemo(() => new BoardHintIndex(), []);
  useLayoutEffect(() => {
    hintIndex.invalidate();
  });
  useEffect(() => {
    window.addEventListener('resize', hintIndex.invalidate);
    window.addEventListener('scroll', hintIndex.invalidate, true);
    return () => {
      window.removeEventListener('resize', hintIndex.invalidate);
      window.removeEventListener('scroll', hintIndex.invalidate, true);
    };
  }, [hintIndex]);
  const hintPointerRef = useRef<{
    readonly x: number;
    readonly y: number;
    readonly top: Element | null;
  } | null>(null);
  const hintFrameRef = useRef<number | null>(null);
  const scheduleHintHover = (x: number, y: number, top: Element | null) => {
    hintPointerRef.current = { x, y, top };
    if (hintFrameRef.current !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      const surface = surfaceRef.current;
      hoverHint(
        surface ? (hintIndex.at(surface, x, y, top)?.element ?? null) : null
      );
      return;
    }
    hintFrameRef.current = requestAnimationFrame(() => {
      hintFrameRef.current = null;
      const point = hintPointerRef.current;
      const surface = surfaceRef.current;
      if (!point || !surface) return;
      hoverHint(
        hintIndex.at(surface, point.x, point.y, point.top)?.element ?? null
      );
    });
  };
  useEffect(
    () => () => {
      if (hintFrameRef.current !== null)
        cancelAnimationFrame(hintFrameRef.current);
    },
    []
  );
  // A tooltip a tap opened goes with the next press anywhere.
  useEffect(() => {
    if (!hintShowing?.tapped) return;
    const press = (event: Event) => {
      if (
        event.type === 'pointerdown' &&
        event.target instanceof Node &&
        surfaceRef.current?.contains(event.target)
      )
        return;
      hints.hide();
    };
    document.addEventListener('pointerdown', press, true);
    window.addEventListener('resize', press);
    return () => {
      document.removeEventListener('pointerdown', press, true);
      window.removeEventListener('resize', press);
    };
  }, [hintShowing, hints]);
  useEffect(() => {
    if (presentation.drag) hints.hide();
  }, [presentation.drag, hints]);
  const velocity = useMemo(() => new VelocityTracker(100), []);
  const previousSceneRef = useRef<BoardScene | null>(null);
  // The scene a timer started at pointer-down should act on: the latest.
  const latestSceneRef = useRef(scene);
  latestSceneRef.current = scene;
  const detachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detachFrameRef = useRef<number | null>(null);
  const cancelDetachTimer = () => {
    if (detachTimerRef.current !== null) clearTimeout(detachTimerRef.current);
    if (detachFrameRef.current !== null)
      cancelAnimationFrame(detachFrameRef.current);
    detachTimerRef.current = null;
    detachFrameRef.current = null;
  };
  useEffect(
    () => () => {
      if (detachTimerRef.current !== null) clearTimeout(detachTimerRef.current);
      if (detachFrameRef.current !== null)
        cancelAnimationFrame(detachFrameRef.current);
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
    // `data-board-motion` says whether the table is still moving on its own,
    // for anything that must wait for it to settle (tests, screenshots). Not
    // `data-motion`: the page's own motion setting (on the root) keys rules
    // for every card face on that name, and the browser restyles every card
    // whenever an attribute of that name changes anywhere above them.
    director.onActivity = (active) => {
      if (surfaceRef.current) {
        surfaceRef.current.dataset.boardMotion = active ? 'active' : 'idle';
      }
      hintIndex.invalidate();
      adapters.reportMotion?.(active);
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
  // A card carried over a window open on the table (the "Looking at cards"
  // or attached-cards window, a pile's viewer) is shown above it, on the
  // lift layer (held-card-lift.ts) beside the surface: the windows sit over
  // the surface.
  const liftRef = useRef<HTMLDivElement>(null);
  const [liftHost, setLiftHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setLiftHost(surfaceRef.current?.parentElement ?? null);
  }, []);
  // A card flying out of a viewer is lifted over the windows too.
  const [overWindows, setOverWindows] = useState(false);
  useLayoutEffect(() => {
    director.depth.onOverWindows = setOverWindows;
    director.depth.onMarkersMoved = hintIndex.invalidate;
    return () => {
      director.depth.onOverWindows = null;
      director.depth.onMarkersMoved = null;
    };
  }, [director, hintIndex]);
  // A card carried over a piece the page draws above the board (a coin,
  // marked `data-over-board`) is lifted over it the same way, or it would
  // pass under the piece.
  const [overPiece, setOverPiece] = useState(false);
  const dragging = presentation.drag !== null;
  // Measured once the frame that shows the held card where it now is has
  // been laid out and painted, when measuring costs nothing. Measured as
  // the move was committed, it had the browser lay the table out again
  // there and then, on every move of the pointer. A frame late, the card
  // is lifted over the piece as it reaches it.
  const pieceCheckRef = useRef<{
    frame: number | null;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ frame: null, timer: null });
  const checkOverPiece = useCallback(() => {
    const pending = pieceCheckRef.current;
    if (pending.frame !== null || pending.timer !== null) return;
    const measure = () => {
      pending.timer = null;
      const surface = surfaceRef.current;
      const held = dragRef.current
        ? surface?.querySelector('.ptcgsim-card[data-held="drag"]')
        : null;
      const pieces = held
        ? Array.from(held.ownerDocument.querySelectorAll('[data-over-board]'))
        : [];
      const box = pieces.length > 0 ? held?.getBoundingClientRect() : undefined;
      setOverPiece(
        box !== undefined &&
          pieces.some((piece) => {
            const at = piece.getBoundingClientRect();
            return (
              at.width > 0 &&
              box.left < at.right &&
              at.left < box.right &&
              box.top < at.bottom &&
              at.top < box.bottom
            );
          })
      );
    };
    if (typeof requestAnimationFrame !== 'function') {
      measure();
      return;
    }
    pending.frame = requestAnimationFrame(() => {
      pending.frame = null;
      pending.timer = setTimeout(measure, 0);
    });
  }, []);
  useLayoutEffect(() => {
    if (dragging) checkOverPiece();
    else setOverPiece(false);
  }, [dragging, presentation.drag, checkOverPiece]);
  useEffect(
    () => () => {
      const pending = pieceCheckRef.current;
      if (pending.frame !== null) cancelAnimationFrame(pending.frame);
      if (pending.timer !== null) clearTimeout(pending.timer);
      pending.frame = null;
      pending.timer = null;
    },
    []
  );
  const lifting =
    (presentation.drag !== null || overWindows) &&
    (overPiece ||
      presentation.openedZoneId !== null ||
      installedScene.zones.some(
        (zone) =>
          (zone.kind === 'inspection' ||
            zone.kind === 'attachmentResolution') &&
          zone.count > 0
      ));
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const layer = liftRef.current;
    if (!lifting || !surface || !layer) return;
    return liftHeldCards(surface, layer);
  }, [lifting, liftHost]);
  // Cards and markers the carrier moved by hand go where a new scene or
  // presentation draws them (see BoardMotionDirector.uncarry): React leaves
  // alone a place it drew last time, though the carrier has moved the node
  // since. Only then: the surface drawing itself again (lifting a card over
  // the coin) brings no new place, and the carried one is the latest.
  const carriedMarkersRef = useRef(new Set<string>());
  useLayoutEffect(() => {
    let cards: Map<string, CardSceneNode> | undefined;
    director.uncarry((renderKey) => {
      cards ??= new Map(
        scene.cards.flatMap((card) =>
          card.renderKey === null ? [] : [[card.renderKey, card] as const]
        )
      );
      const card = cards.get(renderKey);
      if (!card) return null;
      // A tilted table places a card by its transform, from the origin.
      if (depth) return { x: 0, y: 0 };
      const held =
        compositionHold(scene, card, presentation.drag) ??
        presentation.settling
          .map((entry) => compositionHold(scene, card, entry))
          .find(Boolean);
      // As CardNode places it.
      return held
        ? {
            x: held.x - card.bounds.width / 2,
            y: held.y - card.bounds.height / 2,
          }
        : card.bounds;
    });
    const markers = carriedMarkersRef.current;
    if (markers.size === 0) return;
    for (const marker of scene.markers) {
      if (!markers.has(marker.id)) continue;
      const node = surfaceRef.current?.querySelector<HTMLElement>(
        `[data-marker-id="${CSS.escape(marker.id)}"]`
      );
      if (!node) continue;
      // As MarkerNode places it: by its matrix from the origin when tilted.
      const parent = depth
        ? scene.cards.find((card) => card.id === marker.parentCardId)
        : undefined;
      const { bounds } = !depth
        ? presentHeldMarker(scene, marker, presentation)
        : depth.markerMatrix(
              marker,
              parent ? depth.pose(parent, presentation) : undefined
            )
          ? { bounds: { x: 0, y: 0 } }
          : marker;
      node.style.left = `${String(bounds.x)}px`;
      node.style.top = `${String(bounds.y)}px`;
    }
    markers.clear();
  }, [depth, director, presentation, scene]);
  // The installed scene the last motion was planned for: a held card coming
  // into or out of the painted scene is no new scene, and replays nothing.
  const plannedSceneRef = useRef<BoardScene | null>(null);
  useLayoutEffect(() => {
    const { painted, held } = paintedCards(scene, presentation, asides);
    const fresh = plannedSceneRef.current !== installedScene;
    plannedSceneRef.current = installedScene;
    director.commit(
      previousSceneRef.current,
      scene,
      fresh ? motion : undefined,
      painted,
      held,
      {
        projection,
        presentation,
      }
    );
    previousSceneRef.current = scene;
  }, [
    director,
    scene,
    installedScene,
    presentation,
    motion,
    projection,
    asides,
  ]);
  // A held card carried on (onlyHeldCardMoved) is painted where it now is at
  // once, the table not rendered again: nothing else on it changes, and a
  // render of the whole table on every move of the pointer made a drag slow
  // on a slow phone. Set anew with each commit, to work from the table as
  // last drawn.
  useLayoutEffect(() => {
    if (!setHeldCarrier) return;
    setHeldCarrier((next) => {
      dragRef.current = next.drag;
      // A tilted table poses the held cards, and their markers, itself.
      const painted = new Map<string, PaintedCard>();
      const carried = new Set<CardSceneNode['id']>();
      if (!depth)
        for (const card of scene.cards) {
          if (card.renderKey === null) continue;
          const hold = compositionHold(scene, card, next.drag);
          if (!hold) continue;
          carried.add(card.id);
          painted.set(card.renderKey, {
            rect: {
              ...card.bounds,
              x: hold.x - card.bounds.width / 2,
              y: hold.y - card.bounds.height / 2,
            },
            rotationQuarterTurns: card.rotationQuarterTurns,
          });
        }
      director.carry(painted, next);
      // A flat table's markers ride on their cards, as their nodes draw them.
      for (const marker of scene.markers) {
        if (!carried.has(marker.parentCardId)) continue;
        const node = surfaceRef.current?.querySelector<HTMLElement>(
          `[data-marker-id="${CSS.escape(marker.id)}"]`
        );
        if (!node) continue;
        const { bounds } = presentHeldMarker(scene, marker, next);
        node.style.left = `${String(bounds.x)}px`;
        node.style.top = `${String(bounds.y)}px`;
        carriedMarkersRef.current.add(marker.id);
      }
      checkOverPiece();
    });
    return () => setHeldCarrier(null);
  });
  const capturedPointerRef = useRef<{
    readonly element: HTMLElement;
    readonly pointerId: number;
  } | null>(null);
  const dragController = useMemo(
    () => new BoardDragController(adapters),
    [adapters]
  );
  // A finger's press on a crowded hand, peeking at its cards.
  const peekRef = useRef<HandPeek | null>(null);
  // The card a finger last pressed, until a long press opens its menu.
  const touchPressRef = useRef<CardSceneNode | null>(null);
  // The cards whose click the browser may still send after a finger slid
  // along the hand: the release has already tapped the card it raised.
  const peekClickRef = useRef<{
    readonly cardIds: ReadonlySet<CardSceneNode['id']>;
    readonly until: number;
  } | null>(null);
  const consumeSuppressedClick = useCallback(
    (cardId: CardSceneNode['id'], renderKey: CardSceneNode['renderKey']) => {
      const suppressed = dragController.consumeSuppressedClick(
        cardId,
        renderKey
      );
      const peeked = peekClickRef.current;
      if (!peeked?.cardIds.has(cardId) || performance.now() > peeked.until)
        return suppressed;
      peekClickRef.current = null;
      return true;
    },
    [dragController]
  );
  const registerElement = director.register;
  const draggedCardId = presentation.drag?.cardId ?? null;
  const draggedCard =
    draggedCardId === null
      ? undefined
      : scene.cards.find((card) => card.id === draggedCardId);
  // The selection as the table shows it (ADR-042 §1): each item ringed --
  // a card printed in pieces on every piece, as its targets are lit -- and,
  // with several, numbered in the order they were picked.
  const selectionOrder = useMemo(
    () =>
      new Map(
        presentation.selection.map((cardId, index) => [cardId, index + 1])
      ),
    [presentation.selection]
  );
  const selectionRings = useMemo(() => {
    const ringed = new Set<CardSceneNode['id']>(presentation.selection);
    for (const cardId of presentation.selection) {
      const card = scene.cards.find((candidate) => candidate.id === cardId);
      if (
        card?.role !== 'stackEvolution' ||
        card.composition?.kind !== 'joined'
      )
        continue;
      for (const piece of scene.cards)
        if (piece.parentId === card.parentId && piece.role === 'stackEvolution')
          ringed.add(piece.id);
    }
    return ringed;
  }, [presentation.selection, scene]);
  const numbered = presentation.selection.length > 1;
  const selectionCountId = useId();
  // A group drag carries a few items in the hand; the rest are counted on
  // the card gripped.
  const carryMore =
    presentation.drag?.groupCardIds && draggedCard
      ? Math.max(
          0,
          presentation.drag.groupCardIds.length -
            carriedGroup(scene, presentation.drag).length
        )
      : 0;
  /**
   * What a press on a card holds beyond the card (ADR-042 §2): a selected
   * item among others drags them all; one pressed with Shift or ⌘/Ctrl
   * joins them once it moves, then drags them all; any other goes alone.
   */
  const pressOf = (
    card: CardSceneNode,
    adds: boolean
  ): BoardPress | undefined => {
    const selection = presentation.selection;
    const item = selectionItemOf(scene, card.id);
    if (selection.includes(item) || selection.includes(card.id))
      return selection.length > 1 ? { group: selection } : undefined;
    if (!adds) return undefined;
    return selection.length > 0
      ? { adds: true, group: [...selection, item] }
      : { adds: true };
  };
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
      peekRef.current = null;
      lowerPeekedCards(surfaceRef.current);
      // A rectangle being drawn goes too, its lit cards and its capture:
      // let go of afterwards, it selects nothing.
      clearSweep();
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
    starting?: CardSceneNode,
    /** The starting card's element, when the event's target is another. */
    startingElement?: Element | null
  ): BoardPointerInput | null => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    const point = {
      x: ((event.clientX - bounds.left) * scene.viewport.width) / bounds.width,
      y: ((event.clientY - bounds.top) * scene.viewport.height) / bounds.height,
    };
    const source =
      starting ??
      (grabbed.current &&
        (scene.cards.find((card) => card.id === grabbed.current?.id) ??
          grabbed.current));
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
          startingElement ??
          (event.target instanceof Element
            ? event.target.closest('[data-card-id]')
            : null)
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
      // A group's own cards travel with it: never where it lands.
      const group = dragRef.current?.detached
        ? undefined
        : (dragRef.current?.groupCardIds ?? pressedGroupRef.current);
      const hit = depth.drop(
        point,
        source.id,
        (card) =>
          card.renderKey ? director.depth.current(card.renderKey) : undefined,
        dragRef.current?.detached === true,
        centre,
        group ? groupCardsOf(scene, group) : undefined
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
          hit.point.y,
          depth.boardPoint(point),
          group
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
  /**
   * A rectangle drawn on the felt (ADR-042 §2): it starts on empty felt in
   * one half and stays in it, lights the cards it would take as it is drawn
   * -- on the table only, by an attribute no `:root` rule names -- and
   * selects them once, when let go of.
   */
  const sweepRef = useRef<{
    readonly pointerId: number;
    readonly touch: boolean;
    readonly adds: boolean;
    readonly start: { readonly x: number; readonly y: number };
    readonly side: BoardSide;
    readonly limits: { readonly top: number; readonly bottom: number };
    candidates: {
      readonly scene: BoardScene;
      readonly cards: readonly SweepCandidate[];
    } | null;
    swept: Sweep | null;
    element: HTMLDivElement | null;
    readonly marked: Set<HTMLElement>;
  } | null>(null);
  // The click a drawn rectangle ends with is not a press on what it ends on.
  const sweepClickRef = useRef(0);
  // The group a press holds, for the drop it aims before its first move.
  const pressedGroupRef = useRef<readonly CardSceneNode['id'][] | undefined>(
    undefined
  );
  const startSweep = (
    event: ReactPointerEvent<HTMLDivElement>,
    adds: boolean
  ) => {
    sweepRef.current = null;
    if (event.button !== 0) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('button, a, input, select, textarea, [data-no-sweep]')
    )
      return;
    const point = scenePoint(event.clientX, event.clientY);
    if (!point) return;
    const board = depth ? depth.boardPoint(point) : point;
    const frames = scene.layout.players.filter((frame) => !frame.hidden);
    const side =
      frames.find((frame) => containsPoint(frame.bounds, board.x, board.y))
        ?.side ??
      scene.zones.find(
        (zone) =>
          zone.kind === 'hand' &&
          zone.interactive &&
          containsPoint(zone.bounds, board.x, board.y)
      )?.side;
    if (side !== 'local' && side !== 'opponent') return;
    // The halves meet at the lower frame's top edge, where it is painted.
    const lower = frames.find((frame) => frame.physicalSide === 'lower');
    const upper = frames.find((frame) => frame.physicalSide === 'upper');
    const seam =
      lower && upper
        ? depth
          ? depth.point({
              x: lower.bounds.x + lower.bounds.width / 2,
              y: lower.bounds.y,
            }).y
          : lower.bounds.y
        : undefined;
    const height = scene.viewport.height;
    sweepRef.current = {
      pointerId: event.pointerId,
      touch: event.pointerType === 'touch',
      adds,
      start: point,
      side,
      limits:
        seam === undefined
          ? { top: 0, bottom: height }
          : side === 'local'
            ? { top: seam, bottom: height }
            : { top: 0, bottom: seam },
      candidates: null,
      swept: null,
      element: null,
      marked: new Set(),
    };
  };
  /** Draws the rectangle as the pointer moves; true while there is one. */
  const moveSweep = (event: ReactPointerEvent<HTMLDivElement>): boolean => {
    const sweep = sweepRef.current;
    const surface = surfaceRef.current;
    if (!sweep || sweep.pointerId !== event.pointerId || !surface) return false;
    const point = scenePoint(event.clientX, event.clientY);
    if (!point) return true;
    if (!sweep.element) {
      if (
        Math.hypot(point.x - sweep.start.x, point.y - sweep.start.y) <
        SWEEP_THRESHOLD_PX
      )
        return true;
      const element = document.createElement('div');
      element.className = 'ptcgsim-board-sweep';
      element.setAttribute('aria-hidden', 'true');
      surface.append(element);
      sweep.element = element;
      try {
        surface.setPointerCapture?.(event.pointerId);
      } catch {
        // Capture is best effort; the rectangle still follows on the table.
      }
      clearHover();
      hints.hide();
    }
    event.preventDefault();
    if (sweep.candidates?.scene !== scene)
      sweep.candidates = {
        scene,
        cards: sweepCandidates(scene, sweep.side, (card) =>
          depth
            ? depth.bounds(card)
            : paintedCardBounds(card.bounds, card.rotationQuarterTurns)
        ),
      };
    const rect = sweepRect(sweep.start, point, sweep.limits);
    const style = sweep.element.style;
    style.left = `${String(rect.x)}px`;
    style.top = `${String(rect.y)}px`;
    style.width = `${String(rect.width)}px`;
    style.height = `${String(rect.height)}px`;
    const swept = sweptItems(scene, sweep.candidates.cards, rect);
    sweep.swept = swept;
    const lit = new Set<HTMLElement>();
    for (const card of swept.cards) {
      const element = cardElement(card.id);
      if (element) lit.add(element);
    }
    for (const element of sweep.marked)
      if (!lit.has(element)) element.removeAttribute('data-sweep');
    for (const element of lit)
      if (!sweep.marked.has(element)) element.setAttribute('data-sweep', '');
    sweep.marked.clear();
    for (const element of lit) sweep.marked.add(element);
    return true;
  };
  /** Takes the rectangle away; whether one was drawn. */
  const clearSweep = (pointerId?: number): boolean => {
    const sweep = sweepRef.current;
    if (!sweep || (pointerId !== undefined && sweep.pointerId !== pointerId))
      return false;
    sweepRef.current = null;
    for (const element of sweep.marked) element.removeAttribute('data-sweep');
    sweep.marked.clear();
    if (!sweep.element) return false;
    sweep.element.remove();
    const surface = surfaceRef.current;
    try {
      if (surface?.hasPointerCapture?.(sweep.pointerId))
        surface.releasePointerCapture(sweep.pointerId);
    } catch {
      // Capture can already be released by the browser.
    }
    return true;
  };
  /** Let go of: the rectangle selects what it took, once. */
  const finishSweep = (event: ReactPointerEvent<HTMLDivElement>): boolean => {
    const sweep = sweepRef.current;
    if (!sweep || sweep.pointerId !== event.pointerId) return false;
    if (sweep.element) moveSweep(event);
    const swept = sweep.swept;
    if (!clearSweep(event.pointerId)) return false;
    sweepClickRef.current = performance.now() + SWEEP_CLICK_MS;
    if (!swept || swept.items.length === 0) return true;
    // A finger's rectangle starts selection mode: further taps pick cards.
    if (sweep.touch)
      adapters.emitIntent({ kind: 'SelectionModeChanged', on: true });
    adapters.emitIntent({
      kind: 'CardsSelected',
      cardIds: swept.items,
      mode: sweep.adds ? 'add' : 'replace',
    });
    return true;
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
  // Where a hand card is painted: the tilted table draws the hands larger
  // than they lie in the scene (BoardDepthProjection's hand fit).
  const handCardRect = (card: CardSceneNode): Rect =>
    depth ? depth.pose(card).bounds : card.bounds;
  const scenePoint = (clientX: number, clientY: number) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    return bounds && bounds.width > 0 && bounds.height > 0
      ? {
          x: ((clientX - bounds.left) * scene.viewport.width) / bounds.width,
          y: ((clientY - bounds.top) * scene.viewport.height) / bounds.height,
        }
      : null;
  };
  const cardElement = (cardId: CardSceneNode['id']) =>
    surfaceRef.current?.querySelector<HTMLElement>(
      `[data-card-id="${CSS.escape(String(cardId))}"]`
    ) ?? null;
  const raisePeek = (cardId: CardSceneNode['id']) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface
      .querySelectorAll('[data-peek]')
      .forEach((card) => card.removeAttribute('data-peek'));
    const element = cardElement(cardId);
    const card = scene.cards.find((candidate) => candidate.id === cardId);
    if (element && card) {
      // A small hand card grows to be read; the screen draws it larger.
      const painted = handCardRect(card);
      const width =
        (painted.width * surface.getBoundingClientRect().width) /
        scene.viewport.width;
      const scale = Math.min(
        PEEK_SCALE.most,
        Math.max(
          PEEK_SCALE.least,
          width > 0 ? PEEK_READ_WIDTH_PX / width : PEEK_SCALE.least
        )
      );
      element.style.setProperty('--ptcgsim-peek-scale', String(scale));
      element.style.setProperty(
        '--ptcgsim-peek-shift',
        `${String(peekShift(card, painted, scale, scene.viewport.width))}px`
      );
      element.setAttribute('data-peek', '');
    }
    surface.setAttribute('data-peeking', '');
  };
  /** A touch press on a crowded hand's card begins to peek at it. */
  const startPeek = (
    event: ReactPointerEvent<HTMLDivElement>,
    card: CardSceneNode
  ) => {
    peekRef.current = null;
    lowerPeekedCards(surfaceRef.current);
    if (event.pointerType !== 'touch' || !table || card.role !== 'zone') return;
    const zone = scene.zones.find(
      (candidate) => candidate.id === card.parentId && candidate.kind === 'hand'
    );
    if (!zone || !crowdedHandCards(scene, zone.id, handCardRect)) return;
    peekRef.current = {
      pointerId: event.pointerId,
      zoneId: zone.id,
      pressed: card,
      startX: event.clientX,
      startY: event.clientY,
      toward:
        zone.bounds.y + zone.bounds.height / 2 > scene.viewport.height / 2
          ? -1
          : 1,
      mode: 'press',
      peeked: card.id,
      trail: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }],
      lift: null,
    };
    raisePeek(card.id);
  };
  /** The finger slid along the hand: the card under it rises instead. */
  const slidePeek = (
    peek: HandPeek,
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const point = scenePoint(event.clientX, event.clientY);
    const cards = point
      ? crowdedHandCards(scene, peek.zoneId, handCardRect)
      : null;
    if (!point || !cards) return;
    const reachable = cards.filter(({ card }) => card.interactive);
    // The topmost card under the finger, or past either end the nearest.
    const under =
      reachable.find(
        ({ rect }) => point.x >= rect.x && point.x < rect.x + rect.width
      ) ??
      reachable
        .map((entry) => ({
          entry,
          distance: Math.abs(entry.rect.x + entry.rect.width / 2 - point.x),
        }))
        .sort((a, b) => a.distance - b.distance)[0]?.entry;
    if (!under || under.card.id === peek.peeked) return;
    peek.peeked = under.card.id;
    raisePeek(under.card.id);
  };
  /** Picks up the raised card, held where it is drawn; false if it can't be. */
  const liftPeeked = (
    peek: HandPeek,
    event: ReactPointerEvent<HTMLDivElement>
  ): boolean => {
    const card = scene.cards.find((candidate) => candidate.id === peek.peeked);
    const element = card ? cardElement(card.id) : null;
    if (!card || !element) return false;
    const input = pointerInput(event, card, element);
    if (!input) return false;
    const box = element
      .querySelector<HTMLElement>('.ptcgsim-card__body')
      ?.getBoundingClientRect();
    let centre: { x: number; y: number } | undefined;
    if (!depth && box && box.width > 0 && box.height > 0) {
      centre =
        scenePoint(box.left + box.width / 2, box.top + box.height / 2) ??
        undefined;
      const grip = localPointer(
        box,
        event.clientX,
        event.clientY,
        card.rotationQuarterTurns as QuarterTurn
      );
      gripRef.current = {
        x: Math.min(1, Math.max(0, grip.x + 0.5)),
        y: Math.min(1, Math.max(0, grip.y + 0.5)),
      };
    }
    if (
      !dragController.pick(scene, card.id, input, centre, pressOf(card, false))
    )
      return false;
    grabbed.current = card;
    clearHover();
    velocity.add(input.x, input.y, event.timeStamp);
    return true;
  };
  /**
   * The finger moved toward the table: the raised card is picked up, held
   * where it is painted, raised out of the hand. A card that cannot be (it
   * left the hand meanwhile) leaves nothing held, not the card pressed.
   */
  const pickPeeked = (
    peek: HandPeek,
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    peek.mode = 'picked';
    if (!liftPeeked(peek, event)) {
      dragController.cancel(event.pointerId);
      lowerPeekedCards(surfaceRef.current);
    }
  };
  /**
   * The finger let go of the hand without picking a card up: after a slide
   * that taps the card it raised. A press that never moved is the
   * browser's tap, as anywhere else.
   */
  const releasePeek = (
    peek: HandPeek,
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    cancelDetachTimer();
    dragController.cancel(event.pointerId);
    // Held still, it opened a menu: the click a browser may still send
    // after the long press would tap the card under it, putting a group's
    // card down and the group's menu away.
    if (peek.mode === 'menu')
      peekClickRef.current = {
        cardIds: new Set([peek.pressed.id, peek.peeked]),
        until: performance.now() + PEEK_CLICK_MS,
      };
    if (peek.mode === 'slide') {
      peekClickRef.current = {
        cardIds: new Set([peek.pressed.id, peek.peeked]),
        until: performance.now() + PEEK_CLICK_MS,
      };
      const card = scene.cards.find(
        (candidate) => candidate.id === peek.peeked
      );
      // In selection mode it is picked up into the group, or put back.
      if (card?.interactive)
        adapters.emitIntent(
          card.primaryAction?.kind === 'openZone'
            ? { kind: 'ZoneOpened', zoneId: card.primaryAction.zoneId }
            : {
                kind: 'CardSelected',
                cardId: card.id,
                mode: presentation.selectionMode ? 'add' : 'toggle',
              }
        );
    }
    velocity.reset();
    releaseCapture(event);
    grabbed.current = null;
  };
  // A drag's target is the id of the stack or zone under the pointer; v1
  // rings the stack's visible top card and tints a zone container. A card
  // printed in pieces is one card, so every piece of it is lit.
  const dragTargetId = presentation.drag?.targetId ?? null;
  const targetPokemon =
    dragTargetId === null
      ? []
      : scene.cards
          .filter(
            (card) =>
              card.parentId === dragTargetId && card.role === 'stackEvolution'
          )
          .sort((left, right) => right.zIndex - left.zIndex);
  const dropTargetCardIds = new Set(
    (targetPokemon[0]?.composition?.kind === 'joined'
      ? targetPokemon
      : targetPokemon.slice(0, 1)
    ).map((card) => card.id)
  );
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
  // The mat as last painted, scaled onto its current size; what is printed
  // on it is drawn at the current size on a layer of its own (see
  // MAT_SETTLE_MS). It covers the spots, not the hands held over the desk.
  const mat = useMemo(() => tableMatBounds(scene), [scene]);
  const matSize = useSettledSize(mat.width, mat.height);
  const matScaleX = mat.width / matSize.width;
  const matScaleY = mat.height / matSize.height;
  const matScaled = matScaleX !== 1 || matScaleY !== 1;
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
      data-far-upright={scene.layout.farCardsUpright ? 'true' : undefined}
      data-geometry={scene.layout.geometryVersion}
      data-table-view={projection.settings.mode}
      data-board-motion="idle"
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
        // The browser's click after a slide comes before any new press, if
        // at all (Chromium sends none): a new press is its own gesture,
        // and a tap on the card just raised must reach it.
        peekClickRef.current = null;
        const hint = surfaceRef.current
          ? boardHintAt(surfaceRef.current, event.clientX, event.clientY)
          : null;
        pressedHintRef.current =
          hint && event.button === 0
            ? {
                pointerId: event.pointerId,
                target: hint,
                x: event.clientX,
                y: event.clientY,
              }
            : null;
        // A tap on the badge whose tooltip a tap opened closes it (below).
        if (
          !hint ||
          hint.element !== hintShowingRef.current?.element ||
          !hintShowingRef.current.tapped
        )
          hints.hide();
        const target = pointerCard(event);
        touchPressRef.current =
          event.pointerType === 'touch' ? (target?.card ?? null) : null;
        // Shift or ⌘/Ctrl held: the press adds, and the felt keeps the
        // selection (ADR-042 §2). A finger has no keys to hold.
        const adds = event.pointerType !== 'touch' && addsToSelection(event);
        if (!target) {
          if (!adds) adapters.emitIntent({ kind: 'BoardBackgroundPressed' });
          if (!hint) startSweep(event, adds);
          return;
        }
        const input = pointerInput(event, target.card);
        if (!input) return;
        const press = pressOf(target.card, adds);
        pressedGroupRef.current = press?.group;
        if (dragController.pointerDown(scene, target.card.id, input, press)) {
          grabbed.current = target.card;
          cancelDetachTimer();
          if (
            event.pointerType !== 'touch' &&
            canDetachFromStack(scene, target.card.id)
          ) {
            const pointerId = event.pointerId;
            const lift = () => {
              if (dragController.detach(latestSceneRef.current, pointerId))
                clearHover();
            };
            detachTimerRef.current = setTimeout(() => {
              detachTimerRef.current = null;
              // A busy page can still hold the move that began the drag:
              // the next frame delivers it first, and a card already being
              // dragged never comes off its stack.
              if (typeof requestAnimationFrame !== 'function') {
                lift();
                return;
              }
              detachFrameRef.current = requestAnimationFrame(() => {
                detachFrameRef.current = null;
                lift();
              });
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
          startPeek(event, target.card);
        }
      }}
      onPointerMove={(event) => {
        if (moveSweep(event)) return;
        // A finger on a crowded hand: a slide along it raises the card under
        // the finger; a move toward the table picks the raised card up.
        const peek = peekRef.current;
        if (
          peek?.pointerId === event.pointerId &&
          (peek.mode === 'press' || peek.mode === 'slide')
        ) {
          event.preventDefault();
          if (peek.mode === 'press') {
            const dx = event.clientX - peek.startX;
            const dy = event.clientY - peek.startY;
            if (Math.hypot(dx, dy) < PEEK_SLOP_PX) return;
            const pull = dy * peek.toward;
            if (pull > 0 && pull * 2 >= Math.abs(dx)) {
              pickPeeked(peek, event);
              return;
            }
            peek.mode = 'slide';
            // Until it lets go: the release chooses the card raised, and is
            // no second tap on the card first pressed (the web app's
            // tap-again-to-read listens before this surface does).
            surfaceRef.current?.setAttribute('data-peek-slide', '');
          }
          const { trail } = peek;
          trail.push({
            x: event.clientX,
            y: event.clientY,
            t: event.timeStamp,
          });
          while (
            trail.length > 2 &&
            trail[1]!.t <= event.timeStamp - PEEK_HEADING_MS
          )
            trail.shift();
          const from = trail[0]!;
          const pull = (event.clientY - from.y) * peek.toward;
          // Heading along the hand, the card under the finger rises; heading
          // for the table, the raised card stays, and is picked up once the
          // finger has come far enough.
          if (!(pull > 0 && pull >= Math.abs(event.clientX - from.x))) {
            peek.lift = null;
            slidePeek(peek, event);
            return;
          }
          peek.lift ??= from;
          if ((event.clientY - peek.lift.y) * peek.toward >= PEEK_PICK_PX)
            pickPeeked(peek, event);
          return;
        }
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
          if (event.pointerType !== 'touch') {
            if (presentation.drag) hoverHint(null);
            else
              scheduleHintHover(
                event.clientX,
                event.clientY,
                event.target instanceof Element ? event.target : null
              );
          }
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
        hintPointerRef.current = null;
        hoverHint(null);
      }}
      onPointerUp={(event) => {
        if (finishSweep(event)) return;
        const peek = peekRef.current;
        if (peek?.pointerId === event.pointerId) {
          peekRef.current = null;
          lowerPeekedCards(surfaceRef.current);
          if (peek.mode !== 'picked') {
            releasePeek(peek, event);
            return;
          }
          // The browser's own click, if it comes, lands on the card the
          // finger first pressed, not the one it picked up.
          if (peek.pressed.id !== peek.peeked)
            peekClickRef.current = {
              cardIds: new Set([peek.pressed.id]),
              until: performance.now() + PEEK_CLICK_MS,
            };
        }
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
        const pressed = grabbed.current;
        const dropped = Boolean(
          input && dragController.pointerUp(scene, input)
        );
        if (dropped) event.preventDefault();
        // A press let go where it began, on a marker or a badge: a marker
        // opens its controls; a finger's tap on a badge shows its tooltip.
        // Either way the card under it does not take the click as well.
        const hint = pressedHintRef.current;
        pressedHintRef.current = null;
        if (
          hint &&
          !dropped &&
          hint.pointerId === event.pointerId &&
          Math.hypot(event.clientX - hint.x, event.clientY - hint.y) <=
            HINT_TAP_SLOP_PX &&
          (hint.target.markerId || event.pointerType === 'touch')
        ) {
          if (pressed)
            dragController.suppressClick(pressed.id, pressed.renderKey);
          if (hint.target.markerId) {
            hints.hide();
            // A double press is one press: the controls open, and stay.
            const last = lastMarkerPressRef.current;
            const now = event.timeStamp;
            lastMarkerPressRef.current = { id: hint.target.markerId, at: now };
            if (
              last?.id !== hint.target.markerId ||
              now - last.at > MARKER_DOUBLE_PRESS_MS
            )
              adapters.emitIntent({
                kind: 'MarkerPressed',
                markerId: hint.target.markerId,
              });
          } else {
            hints.tap(hint.target.element);
          }
        }
        releaseCapture(event);
        if (ownsGrab) grabbed.current = null;
      }}
      onContextMenuCapture={(event) => {
        // A finger held still on a crowded hand opens the menu of the card
        // it raised, which the letting go then leaves alone.
        const peek = peekRef.current;
        if (peek?.mode !== 'press' && peek?.mode !== 'slide') {
          // Held still on any other card, it opens that card's menu (a
          // group's, on a selected one): the click a browser may still send
          // after the long press must not tap the card too.
          const pressed = touchPressRef.current;
          touchPressRef.current = null;
          if (pressed)
            dragController.suppressClick(pressed.id, pressed.renderKey);
          return;
        }
        dragController.cancel(peek.pointerId);
        lowerPeekedCards(surfaceRef.current);
        const raised = peek.peeked;
        peek.mode = 'menu';
        if (raised === peek.pressed.id) return;
        event.preventDefault();
        event.stopPropagation();
        adapters.emitIntent({ kind: 'CardContextRequested', cardId: raised });
      }}
      onClickCapture={(event) => {
        if (performance.now() > sweepClickRef.current) return;
        sweepClickRef.current = 0;
        event.stopPropagation();
        event.preventDefault();
      }}
      onPointerCancel={(event) => {
        clearSweep(event.pointerId);
        if (peekRef.current?.pointerId === event.pointerId) {
          peekRef.current = null;
          lowerPeekedCards(surfaceRef.current);
        }
        pressedHintRef.current = null;
        cancelDetachTimer();
        dragController.cancel(event.pointerId);
        if (capturedPointerRef.current?.pointerId === event.pointerId)
          grabbed.current = null;
        velocity.reset();
        swing.release();
        releaseCapture(event);
      }}
      onLostPointerCapture={(event) => {
        if (event.target === event.currentTarget) clearSweep(event.pointerId);
        if (peekRef.current?.pointerId === event.pointerId) {
          peekRef.current = null;
          lowerPeekedCards(surfaceRef.current);
        }
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
        // A child must never make focus scroll the surface: a projected one
        // on the tilted table, or a hand card bleeding past the flat table's
        // edge, which scrolled the whole table up under the rail and pieces.
        overflow: 'clip',
        background: 'transparent',
        touchAction: 'none',
        userSelect: 'none',
        contain: 'strict',
      }}
    >
      <style>{BOARD_SURFACE_CSS}</style>
      <style>{BOARD_MARKER_CSS}</style>
      <BoardHintTooltip showing={hintShowing} layoutKey={scene} />
      {numbered ? (
        <span id={selectionCountId} hidden>
          {plural(presentation.selection.length, {
            one: '# selected',
            other: '# selected',
          })}
        </span>
      ) : null}
      <div
        ref={tableRef}
        className="ptcgsim-board-table"
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* The play mat (geometry v2), tilted with the table or flat on
            it, as far as the benches; the hands are held over the desk. */}
        {depth || table ? (
          <div
            className="ptcgsim-depth-mat"
            aria-hidden="true"
            style={{
              width: matSize.width,
              height: matSize.height,
              transform: `${depth ? `matrix3d(${tableCardMatrix(depth.camera, mat, 0).join(',')})` : `translate(${String(mat.x)}px, ${String(mat.y)}px)`}${matScaled ? ` scale(${String(matScaleX)}, ${String(matScaleY)})` : ''}`,
            }}
          >
            {/* The halves' tints and the seam are printed on the mat, so
                they lie on it however it is tilted. The print keeps the
                table's coordinates; the mat shows the part it covers. */}
            <div
              className="ptcgsim-depth-mat__print"
              style={{
                width: scene.viewport.width,
                height: scene.viewport.height,
                transform: `${matScaled ? `scale(${String(1 / matScaleX)}, ${String(1 / matScaleY)}) ` : ''}translate(${String(-mat.x)}px, ${String(-mat.y)}px)`,
              }}
            >
              {frames}
            </div>
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
              locale={locale}
              card={card}
              selected={selectionRings.has(card.id)}
              {...(numbered && selectionOrder.has(card.id)
                ? {
                    order: selectionOrder.get(card.id)!,
                    describedBy: selectionCountId,
                  }
                : {})}
              {...(presentation.selectionMode ? { selectionMode: true } : {})}
              {...(carryMore > 0 && card.id === draggedCardId
                ? { carryMore }
                : {})}
              targetable={presentation.targetableCardIds.includes(card.id)}
              dropTarget={dropTargetCardIds.has(card.id)}
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
                        referrerPolicy="no-referrer"
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
            node={tableCountNode(
              node,
              depth,
              table,
              scene.layout,
              // A pile paints only its top card.
              scene.cards.find(
                (card) =>
                  card.parentId === node.zoneId && card.renderKey !== null
              )
            )}
            darkMode={preferences.darkMode}
            table={table}
          />
        ))}
      </div>
      {lifting && liftHost
        ? createPortal(
            <div
              ref={liftRef}
              className="ptcgsim-board-lift"
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                zIndex: 'var(--table-layer-drag, 8)',
                pointerEvents: 'none',
                overflow: 'clip',
              }}
            >
              <div style={{ position: 'absolute', inset: 0 }} />
            </div>,
            liftHost
          )
        : null}
    </div>
  );
};
