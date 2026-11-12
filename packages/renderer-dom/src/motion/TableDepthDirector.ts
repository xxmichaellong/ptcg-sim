import {
  BoardDepthProjection,
  TABLE_CARD_THICKNESS,
  TablePoseMotion,
  planBoardMotion,
  projectTablePoint,
  tablePoseMatrix,
  tablePoseEdges,
  tableShadowStyle,
  sameTablePose,
  unprojectTablePoint,
  type BoardPresentation,
  type BoardScene,
  type BoardSceneMotion,
  type CardSceneNode,
  type TableCamera,
  type TableCardPose,
  type TablePoint,
  type Rect,
} from '@ptcgsim/renderer-contract';
import { depthPaintKey } from './depth-paint-key.js';
import { pictureElement as pictureFor } from './card-pictures.js';
import { faceImageOf, isFaceReady, whenFaceReady } from './face-ready.js';
import {
  RIFFLE_MARGIN,
  RIFFLE_MS,
  RIFFLE_PACKETS,
  riffleFrame,
  riffleOrder,
  riffleShift,
  type RiffleHalf,
  type RiffleOrder,
} from './riffle.js';

const timestamp = () => performance.now();
/** How long a card takes to rise to its held height. */
const LIFT_DURATION_MS = 120;
/** A card let go of comes down to the table over this long. */
const LANDING_DESCENT_MS = 160;
/** How long after it is let go a card still lands rather than travels. */
const LANDING_WINDOW_MS = 2500;
/** A row opening (or closing) a gap for the card held over it. */
const MAKE_ROOM_MS = 200;
/** The pieces of one Pokémon in play, which rise and land together. */
const STACK_PIECE_ROLES: ReadonlySet<string> = new Set([
  'stackEvolution',
  'stackAttachment',
]);
/** A card under the pointer rises this share of its width, over this long. */
const HOVER_RAISE = 0.06;
const HOVER_RAISE_MS = 140;
/** A card turned over by hand, from flat to flat again. */
const TURN_MS = 420;
/** One frame, at sixty a second. */
const FRAME_MS = 16;
/**
 * At most this much is held back for a slow first frame: more is no slow
 * frame but a page out of sight (a tab in the background), where what went
 * on meanwhile is over by the time it is seen again.
 */
const POSTPONE_MAX_MS = 250;
/**
 * How long after a press where viewer cards were still counts as where a
 * card that left one set off.
 */
const ORIGIN_FRESH_MS = 1_500;
/** A stand-in turns over from this share of its trip, over this share. */
const GHOST_TURN_FROM = 0.1;
const GHOST_TURN_FOR = 0.75;
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
/**
 * A card `progress` of the way through being turned over: on its edge
 * halfway, where its faces change.
 */
const turnedOver = (base: TableCardPose, progress: number): TableCardPose => {
  const turn = easeInOut(progress);
  const angle =
    progress >= 1 ? 0 : turn < 0.5 ? turn * Math.PI : (turn - 1) * Math.PI;
  return {
    ...base,
    flip: angle,
    // Turned about its middle, a card on the table rises by half its width
    // so its edge never dips under the cloth, and a little more, as a card
    // is tossed over.
    elevation:
      base.elevation +
      base.plane *
        base.bounds.width *
        (0.5 * Math.abs(Math.sin(angle)) + 0.06 * Math.sin(Math.PI * progress)),
  };
};
interface Ghost {
  element: HTMLElement;
  /** What it shows: a canvas copy, or an `<img>` where none could be had. */
  picture: HTMLElement;
  /** The picture it shows now. */
  shows: string;
  expires: number;
  /** Edge lines a stand-in pile shows. */
  bands?: number;
  holdFor?: string;
  /**
   * Holding a pile for a card turned over right on top of it (let go over
   * it): it shows that card's own face from the moment the turn begins, so
   * the card on its edge never shows the old top under it.
   */
  revealsArrival?: boolean;
  fromImage?: string;
  toImage?: string;
  start: number;
  duration: number;
}
/**
 * A card being turned over: `image` is the face it had (the back), shown
 * over its own until it is on its edge; `start` is Infinity while its own
 * face is still loading. A zero `duration` turns nothing, only holds the old
 * face up until the new one is ready (reduced motion).
 */
interface Flip {
  image: HTMLElement | null;
  /** The old face shown over it while it turns, if any. */
  readonly fromImageUrl: string | null;
  readonly face: HTMLElement;
  start: number;
  readonly duration: number;
  stopWaiting?: () => void;
}
/** How far through its turn a card is at `at`, from 0 to 1. */
const turnProgress = (flip: Flip, at: number): number =>
  flip.duration > 0
    ? Math.max(0, Math.min(1, (at - flip.start) / flip.duration))
    : at >= flip.start
      ? 1
      : 0;
interface Shuffle {
  key: string;
  base: TableCardPose;
  start: number;
  duration: number;
  side: number;
  index: number;
  /** Where the spread gathers: the middle of all its cards. */
  centre: { readonly x: number; readonly y: number };
}

/** A spread pile shuffled where it lies (the prizes): gather, mix, deal. */
const SPREAD_SHUFFLE_MS = 1150;
/** Each card of it deals back this much after the one before. */
const SPREAD_DEAL_STAGGER_MS = 45;
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * Where a card of a shuffled spread is `t` (0..1) through it: gathered into
 * one pile at the spread's middle, split and swung out to either side and
 * back twice (the halves passing over and under each other), squared, then
 * dealt back to its place.
 */
export const spreadShufflePose = (
  shuffle: Pick<Shuffle, 'base' | 'side' | 'index' | 'centre'>,
  t: number
): TableCardPose => {
  const { base, side, index } = shuffle;
  const { width, height } = base.bounds;
  const toX = shuffle.centre.x - (base.bounds.x + width / 2);
  const toY = shuffle.centre.y - (base.bounds.y + height / 2);
  const reach = width * (0.5 + 0.12 * (index % 3));
  let gathered = 1;
  let swing = 0;
  if (t < 0.24) {
    gathered = easeInOutCubic(t / 0.24);
  } else if (t < 0.7) {
    swing = Math.sin(((t - 0.24) / 0.46) * Math.PI * 2);
  } else {
    gathered = 1 - easeInOutCubic((t - 0.7) / 0.3);
  }
  return {
    ...base,
    bounds: {
      ...base.bounds,
      x: base.bounds.x + toX * gathered + side * reach * swing,
      y: base.bounds.y + toY * gathered - 8 * Math.abs(swing),
    },
    // Lifted off the mat while it is shuffled; the halves cross by height.
    elevation: base.elevation + 14 * gathered + side * 6 * swing,
    turns: base.turns + side * 0.07 * swing,
  };
};

/**
 * A pile being riffled (see riffle.ts): stand-ins play it while the real
 * pile is hidden.
 */
interface Riffle {
  /** The stand-in for each half, the new pile and each packet. */
  readonly stands: ReadonlyMap<RiffleHalf | 'pile' | number, string>;
  readonly order: RiffleOrder;
  /** How far along the table it is drawn from the pile (riffleShift). */
  readonly shift: number;
  readonly pile: string | null;
  /**
   * Cards dealt off the pile once it is shuffled (PileShuffle.riders),
   * waiting on it: hidden while it riffles, as the stand-ins are the whole
   * pile, until each sets off.
   */
  readonly riders: readonly string[];
  readonly base: TableCardPose;
  readonly start: number;
  readonly duration: number;
}

/** One on-demand clock for physical poses, thickness and their shadows. */
export class TableDepthDirector {
  private readonly motion = new TablePoseMotion();
  private readonly painted = new Map<string, TableCardPose>();
  private sourcePainted = new Map<string, TableCardPose>();
  private readonly ghosts = new Map<string, Ghost>();
  private readonly shuffles = new Map<string, Shuffle>();
  private readonly riffles = new Map<string, Riffle>();
  private readonly flips = new Map<string, Flip>();
  private readonly markers = new Map<string, HTMLElement>();
  /** A card picked up rises to its held height over a moment, not at once. */
  private readonly lifts = new Map<
    string,
    { from: number; start: number; duration: number }
  >();
  private readonly held = new Set<string>();
  /**
   * Cards the player has just let go of, and when: until each is in its
   * place it comes down and slides there in one smooth motion, without the
   * arc of a card carried across the table.
   */
  private readonly released = new Map<string, number>();
  /**
   * Cards whose current travel carries them through the air -- a flight from
   * elsewhere, a landing, a set-down -- and so rise over the table while it
   * lasts. A card that only slides along its row (making room for a held
   * card, or settling into a hand's new order) stays in the row's order:
   * lifting it would put it over neighbours it must stay under.
   */
  private readonly airborne = new Set<string>();
  /**
   * Where the pointer holds the held cards: a point on one card's face, as
   * fractions of it, and the pointer over it.
   */
  private grip: {
    readonly key: string;
    readonly x: number;
    readonly y: number;
    readonly point: TablePoint;
  } | null = null;
  /** The card under the pointer rises a little, as a card does when touched. */
  private hovered: string | null = null;
  private readonly raises = new Map<
    string,
    { from: number; to: number; start: number; duration: number }
  >();
  private readonly cards = new Map<string, CardSceneNode>();
  private projection: BoardDepthProjection | null = null;
  private frame: number | null = null;
  private context = '';
  private serial = 0;
  private durationScale = 1;
  private layer: HTMLElement | null = null;
  private surface: HTMLElement | null = null;
  onActivity: (() => void) | null = null;
  /**
   * Told when cards start or stop flying out of a viewer open over the
   * table, so whoever draws the table shows them above its windows (which
   * would otherwise hide the whole flight).
   */
  onOverWindows: ((flying: boolean) => void) | null = null;
  /** Told when a card's markers were painted somewhere new. */
  onMarkersMoved: (() => void) | null = null;
  /** Cards flying out of a viewer, marked `data-over-windows`. */
  private readonly overWindows = new Set<string>();
  /**
   * Where the cards shown in viewers over the table (`data-motion-origin`,
   * by card id) were when the player last pressed a key or the pointer, in
   * the table's own coordinates. By the time the table hears that a card
   * moved it has gone from its viewer, so where it was shown is kept from
   * then: it flies from there, not from the pile under the viewer.
   */
  private origins: {
    readonly at: number;
    readonly rects: Map<string, Rect>;
  } | null = null;
  private listening: Window | null = null;
  /** When the last commit that set anything off was, until its first frame. */
  private committedAt: number | null = null;
  private readonly recordOrigins = (): void => {
    const table = this.surface;
    if (!table) return;
    const shown = table.ownerDocument.querySelectorAll<HTMLElement>(
      '[data-motion-origin]'
    );
    if (shown.length === 0) {
      this.origins = null;
      return;
    }
    const base = table.getBoundingClientRect();
    const rects = new Map<string, Rect>();
    for (const element of Array.from(shown)) {
      const id = element.dataset.motionOrigin;
      const box = element.getBoundingClientRect();
      if (!id || box.width === 0 || box.height === 0) continue;
      rects.set(id, {
        x: box.left - base.left,
        y: box.top - base.top,
        width: box.width,
        height: box.height,
      });
    }
    this.origins = { at: timestamp(), rects };
  };

  constructor(private readonly elements: ReadonlyMap<string, HTMLElement>) {}
  get active() {
    return (
      this.motion.active ||
      this.ghosts.size > 0 ||
      this.shuffles.size > 0 ||
      this.riffles.size > 0 ||
      this.flips.size > 0 ||
      this.lifts.size > 0 ||
      this.raising()
    );
  }
  /** How long until the card is in its place, in milliseconds from now. */
  landsIn(key: string): number {
    const end = this.motion.endsAt(key);
    return end === null ? 0 : Math.max(0, end - timestamp());
  }
  private raising(): boolean {
    const now = timestamp();
    for (const raise of this.raises.values())
      if (now < raise.start + raise.duration) return true;
    return false;
  }
  private raiseAt(key: string, now: number): number {
    const raise = this.raises.get(key);
    if (!raise) return 0;
    const progress =
      raise.duration > 0
        ? Math.min(1, Math.max(0, (now - raise.start) / raise.duration))
        : 1;
    return raise.from + (raise.to - raise.from) * easeOut(progress);
  }
  /**
   * The card under the pointer, by render key: it rises a little off the
   * table, and the one it left settles back. Never a held card, a flat one
   * or one in flight.
   */
  hover(key: string | null) {
    if (key === this.hovered) return;
    const now = timestamp();
    const raise = (target: string, to: number) => {
      const from = this.raiseAt(target, now);
      if (from === 0 && to === 0) {
        this.raises.delete(target);
        return;
      }
      this.raises.set(target, {
        from,
        to,
        start: now,
        duration: HOVER_RAISE_MS * this.durationScale,
      });
    };
    const previous = this.hovered;
    this.hovered = key;
    // A joined card's pieces rise and settle together, as the one card.
    const settling = previous ? this.joined(previous) : [];
    const rising = key ? this.joined(key) : [];
    for (const target of settling)
      if (!rising.includes(target)) raise(target, 0);
    const pose = key ? this.motion.poses.get(key) : undefined;
    if (
      pose &&
      pose.plane === 1 &&
      rising.every(
        (target) => !this.held.has(target) && !this.motion.has(target)
      )
    )
      for (const target of rising)
        raise(target, HOVER_RAISE * pose.bounds.width);
    for (const target of new Set([...settling, ...rising])) {
      const base = this.motion.poses.get(target);
      if (base) this.paint(target, base, now);
    }
    this.schedule();
    this.onActivity?.();
  }
  current(key: string) {
    return this.painted.get(key);
  }
  /**
   * Where the pointer holds the card it is carrying (by render key, with
   * the grip as fractions of its face). A card still rising to its held
   * height is kept with its grip under the pointer.
   */
  grab(grip: {
    readonly key: string;
    readonly x: number;
    readonly y: number;
    readonly point: TablePoint;
  }) {
    this.grip = grip;
  }
  /** The render keys of a joined card's pieces, or the card alone. */
  private joined(key: string): string[] {
    const card = this.cards.get(key);
    if (!card?.composition) return [key];
    const pieces: string[] = [];
    for (const [other, piece] of this.cards)
      if (piece.composition && piece.parentId === card.parentId)
        pieces.push(other);
    return pieces;
  }
  attach(surface: HTMLElement | null, layer: HTMLElement | null) {
    this.surface = surface;
    this.layer = layer;
    const view = surface?.ownerDocument.defaultView ?? null;
    if (view === this.listening) return;
    this.listening?.removeEventListener('keydown', this.recordOrigins, true);
    this.listening?.removeEventListener(
      'pointerdown',
      this.recordOrigins,
      true
    );
    // On the window, capturing: before anything acts on the press, while
    // the card is still in its viewer.
    view?.addEventListener('keydown', this.recordOrigins, true);
    view?.addEventListener('pointerdown', this.recordOrigins, true);
    this.listening = view;
  }

  /**
   * Where viewers showed cards at the player's last press, if that was just
   * now. (Whether a viewer still shows a card says nothing yet: the viewers
   * may draw after the table does.)
   */
  private viewed(at: number): ReadonlyMap<string, Rect> {
    const origins = this.origins;
    return origins && at - origins.at <= ORIGIN_FRESH_MS
      ? origins.rects
      : new Map();
  }

  /** Shows a card flying out of a viewer above the table's windows, or not. */
  private liftOverWindows(key: string, over: boolean) {
    const before = this.overWindows.size > 0;
    const element = this.elements.get(key);
    if (over) {
      this.overWindows.add(key);
      if (element) element.dataset.overWindows = '';
    } else {
      this.overWindows.delete(key);
      if (element) delete element.dataset.overWindows;
    }
    const after = this.overWindows.size > 0;
    if (before !== after) this.onOverWindows?.(after);
  }

  commit(
    previous: BoardScene | null,
    projection: BoardDepthProjection,
    presentation: BoardPresentation,
    cause: BoardSceneMotion | undefined,
    reduced: boolean,
    durationScale: number
  ) {
    const context = JSON.stringify([projection.camera, projection.settings]);
    const oldProjection = this.projection;
    const oldCards = new Map(this.cards);
    this.sourcePainted = new Map(this.painted);
    const discontinuity =
      this.context !== context ||
      cause?.cause === 'replace' ||
      cause?.cause === 'layout' ||
      cause?.cause === 'flip';
    if (discontinuity || reduced || durationScale === 0)
      this.cancel(!discontinuity);
    this.context = context;
    this.projection = projection;
    this.durationScale = reduced ? 0 : durationScale;
    const at = timestamp();
    const next = projection.scene;
    const plan =
      previous && previous !== next && cause && !discontinuity
        ? planBoardMotion(previous, next, cause.cause, cause.redeals)
        : null;
    const flights = new Map(
      plan?.flights.map((flight) => [flight.renderKey, flight]) ?? []
    );
    // Cards let go over a pile and turned over right on top of it.
    const turnsOnPile = new Set<string>();
    // The cards in hand when the table was last drawn: one now shown by
    // another node (a pile's top taking it) was put down there by hand.
    const wasHeld = new Set(
      [...this.held].map((key) => String(oldCards.get(key)?.id))
    );
    this.cards.clear();
    for (const card of next.cards)
      if (card.renderKey !== null) this.cards.set(card.renderKey, card);
    // Cards out of a viewer fly from where it showed them; one re-aliased
    // on its way (the room answering) carries on above the windows.
    const viewed = plan ? this.viewed(at) : new Map<string, Rect>();
    const overWindows = new Set(this.overWindows);
    // A card re-aliased mid-move carries on the move its old node had under
    // way, on the same clock: set off again from where it was last painted,
    // it would stall there before gathering speed.
    for (const flight of plan?.flights ?? [])
      if (
        flight.fromRenderKey !== undefined &&
        !this.cards.has(flight.fromRenderKey) &&
        this.motion.has(flight.fromRenderKey)
      ) {
        if (this.airborne.has(flight.fromRenderKey))
          this.airborne.add(flight.renderKey);
        this.motion.carry(flight.fromRenderKey, flight.renderKey);
      }
    for (const key of overWindows)
      if (!this.cards.has(key)) this.liftOverWindows(key, false);
    for (const key of this.motion.poses.keys())
      if (!this.cards.has(key) && !this.ghosts.has(key)) {
        this.shuffles.delete(key);
        this.motion.delete(key);
        this.painted.delete(key);
        this.released.delete(key);
        this.airborne.delete(key);
      }
    this.markers.clear();
    for (const element of Array.from(
      this.surface?.querySelectorAll<HTMLElement>('[data-marker-id]') ?? []
    ))
      this.markers.set(element.dataset.markerId!, element);
    // The card the pointer holds goes first: the cards carried with it are
    // placed from where it is painted.
    const gripped = this.grip?.key;
    const order = [...this.cards].sort(
      ([a], [b]) => Number(b === gripped) - Number(a === gripped)
    );
    for (const [key, card] of order) {
      const target = projection.pose(card, presentation);
      const held = this.elements.get(key)?.dataset.held !== undefined;
      if (held && !this.held.has(key) && this.durationScale > 0) {
        // A joined card's pieces rise together, from the highest of them.
        const from = Math.max(
          ...this.joined(key).map(
            (piece) => this.painted.get(piece)?.elevation ?? -Infinity
          )
        );
        if (Number.isFinite(from) && from < target.elevation)
          this.lifts.set(key, {
            from,
            start: at,
            duration: LIFT_DURATION_MS * this.durationScale,
          });
      }
      if (held) {
        this.held.add(key);
        this.raises.delete(key);
        // Picked up mid-shuffle, the pile is the player's again at once.
        for (const [riffleKey, riffle] of this.riffles)
          if (riffle.pile === key) {
            this.paintRiffle({ ...riffle, start: -Infinity }, at);
            this.riffles.delete(riffleKey);
          }
      } else {
        if (this.held.has(key)) this.released.set(key, at);
        this.held.delete(key);
        this.lifts.delete(key);
        if (this.grip?.key === key) this.grip = null;
      }
      const releasedAt = this.released.get(key);
      const landing =
        !held &&
        releasedAt !== undefined &&
        at - releasedAt < LANDING_WINDOW_MS * Math.max(1, this.durationScale);
      if (releasedAt !== undefined && !landing) this.released.delete(key);
      const shuffle = this.shuffles.get(key);
      if (shuffle && (held || !sameTablePose(shuffle.base, target))) {
        // A newer move owns the card. Continue from its visible shuffle pose,
        // and never let the old shuffle restore its previous destination.
        this.motion.set(key, this.painted.get(key) ?? shuffle.base, at);
        this.shuffles.delete(key);
      }
      const flight = flights.get(key);
      const before = this.motion.target(key);
      const oldCard = oldCards.get(key);
      const oldPose = this.sourcePainted.get(key);
      // A pile whose top was carried off by hand now shows the card under
      // it, in its place at once. Only a top that was held: one still flying
      // in onto the pile is the same card, re-aliased by the room.
      const replacedHeldPile =
        card.primaryAction &&
        releasedAt !== undefined &&
        oldCard &&
        oldCard.id !== card.id &&
        oldPose &&
        (oldPose.bounds.x !== oldCard.bounds.x ||
          oldPose.bounds.y !== oldCard.bounds.y);
      // Taken out of a viewer over the table: it sets off flat, face up,
      // where the viewer showed it, not from the pile under the viewer. Only
      // a card that went somewhere else: one a viewer showed that stayed
      // where it was (a Pokémon whose Energy left, a card put back on top of
      // the pile its viewer shows) is not one.
      const inViewer = flight ? viewed.get(String(card.id)) : undefined;
      const was = inViewer
        ? oldProjection?.scene.cards.find((old) => old.id === card.id)
        : undefined;
      const shownAt =
        inViewer && was && was.parentId !== card.parentId
          ? inViewer
          : undefined;
      if (shownAt) this.origins?.rects.delete(String(card.id));
      // The viewer still identifies its face and above-window flight, but a
      // pointer that already carried it owns its painted departure pose.
      const newerViewerPress =
        shownAt !== undefined &&
        releasedAt !== undefined &&
        this.origins !== null &&
        this.origins.at > releasedAt;
      const carriedByHand =
        held ||
        (landing && !newerViewerPress) ||
        (flight?.fromRenderKey !== undefined &&
          this.held.has(flight.fromRenderKey));
      // A cover key can show a different card after its old top departed.
      const carriedSourceKey =
        flight?.fromRenderKey ?? (oldCard?.id === card.id ? key : undefined);
      const source =
        shownAt && !carriedByHand
          ? {
              bounds: shownAt,
              turns: 0,
              elevation: 0,
              thickness:
                shownAt.width *
                TABLE_CARD_THICKNESS *
                projection.settings.strength,
              plane: 0,
            }
          : flight
            ? ((carriedByHand && carriedSourceKey !== undefined
                ? this.sourcePainted.get(carriedSourceKey)
                : undefined) ??
              this.sourcePose(
                flight.from,
                flight.fromRotationQuarterTurns,
                oldProjection,
                target
              ))
            : undefined;
      // The node now shows a card that was somewhere else: a pile's cover
      // taking the card put on it. It sets off from where that card was,
      // not from the pile it already covers.
      const fromElsewhere =
        flight !== undefined &&
        source !== undefined &&
        oldCard !== undefined &&
        oldPose !== undefined &&
        (shownAt !== undefined ||
          Math.abs(flight.from.x - oldCard.bounds.x) > 0.5 ||
          Math.abs(flight.from.y - oldCard.bounds.y) > 0.5);
      // The face it sets off showing: a viewer shows every card face up.
      const fromImageUrl = shownAt ? was?.imageUrl : flight?.fromImageUrl;
      const turnsOver =
        fromImageUrl !== undefined &&
        fromImageUrl !== (card.tableImageUrl ?? card.imageUrl);
      const onlyHeight =
        !fromElsewhere &&
        before &&
        before.bounds.x === target.bounds.x &&
        before.bounds.y === target.bounds.y &&
        before.bounds.width === target.bounds.width &&
        before.turns === target.turns;
      // Let go of over the pile it now covers: it settles onto it, as any
      // card put down does, rather than being carried there.
      const letGo =
        fromElsewhere &&
        flight?.fromRenderKey !== undefined &&
        this.held.has(flight.fromRenderKey);
      // A card carried across the table takes longer the further it goes,
      // and arcs above its path as a hand would carry it.
      const distance = source
        ? Math.hypot(
            source.bounds.x +
              source.bounds.width / 2 -
              (target.bounds.x + target.bounds.width / 2),
            source.bounds.y +
              source.bounds.height / 2 -
              (target.bounds.y + target.bounds.height / 2)
          )
        : 0;
      const still =
        replacedHeldPile ||
        held ||
        discontinuity ||
        (!cause && previous !== next);
      const settles = landing || letGo;
      const duration = still
        ? 0
        : this.durationScale *
          (onlyHeight
            ? projection.settings.animate
              ? LANDING_DESCENT_MS
              : 0
            : settles
              ? // Put down by hand: it slides the last of the way into its
                // place, quickly, as a card pushed square on the table does.
                Math.min(300, Math.max(180, 160 + 0.15 * distance))
              : source
                ? Math.min(560, Math.max(320, 300 + 0.22 * distance))
                : previous === next
                  ? // Only the held card moved: a row making room for it.
                    MAKE_ROOM_MS
                  : 420);
      const arc =
        source && duration > 0 && target.plane === 1 && !settles
          ? Math.min(
              target.bounds.width,
              Math.max(0.25 * target.bounds.width, 0.2 * distance)
            ) * projection.settings.strength
          : 0;
      // A card flown onto a pile travels as the one card it is, onto the
      // pile as it was (its old top holds it, see planBoardMotion), and is
      // the whole pile once it lands.
      const single =
        target.bounds.width *
        TABLE_CARD_THICKNESS *
        projection.settings.strength;
      const ontoPile =
        fromElsewhere && duration > 0 && target.thickness > single;
      // In its place now: the next move of it is an ordinary one.
      if (landing && !onlyHeight && duration > 0) this.released.delete(key);
      const from = source
        ? {
            ...source,
            thickness: Math.min(
              source.thickness,
              source.bounds.width *
                TABLE_CARD_THICKNESS *
                projection.settings.strength
            ),
          }
        : undefined;
      const delay = settles
        ? 0
        : (flight?.delay ?? 0) * 1000 * this.durationScale;
      this.motion.set(
        key,
        ontoPile ? { ...target, thickness: single } : target,
        at,
        duration,
        from,
        delay,
        arc,
        settles,
        {
          restart: fromElsewhere || shownAt !== undefined,
          ...(ontoPile ? { becomes: target } : {}),
        }
      );
      // A travel that carries on to the same place keeps its kind. A card
      // that stays in its zone only slides along the row (a hand taking a
      // new order, a row spreading out); a Pokémon's pieces are carried.
      const continues =
        duration > 0 && before !== undefined && sameTablePose(before, target);
      const slides =
        card.role === 'zone' && oldCard?.parentId === card.parentId;
      if (!continues) {
        if (
          duration > 0 &&
          (settles || onlyHeight || (source !== undefined && !slides))
        )
          this.airborne.add(key);
        else this.airborne.delete(key);
      }
      // Out of a viewer, it flies above the windows over the table; carried
      // on under a new alias, it stays above them.
      if (
        duration > 0 &&
        (shownAt !== undefined ||
          (flight?.fromRenderKey !== undefined &&
            overWindows.has(flight.fromRenderKey)))
      )
        this.liftOverWindows(key, true);
      else if (this.overWindows.has(key) && !this.motion.has(key))
        this.liftOverWindows(key, false);
      if (
        ontoPile &&
        turnsOver &&
        (settles || (!held && wasHeld.has(String(card.id))))
      )
        turnsOnPile.add(key);
      if (
        fromImageUrl !== undefined &&
        turnsOver &&
        (duration > 0 || this.durationScale === 0)
      )
        // Turned over by hand during the move: it sets off showing its old
        // face and turns over a little way into the trip. Onto a pile it is
        // over before it lands, as it is the whole pile from then on.
        this.flipFace(
          key,
          fromImageUrl,
          at + delay + duration * (ontoPile ? 0.1 : 0.2),
          ontoPile
            ? Math.min(TURN_MS * this.durationScale, duration * 0.8)
            : TURN_MS * this.durationScale
        );
      else if (flight?.fromRenderKey) this.carryFlip(flight.fromRenderKey, key);
      if (held) {
        this.shuffles.delete(key);
        this.clearFlip(key);
      }
      const pose = this.motion.poses.get(key) ?? target;
      // Still cards keep their existing transforms and edge paths. Repaint a
      // changed descriptor, or a card given a new place, as React has drawn
      // it there already: left as React drew it, it would flash in its new
      // place for a frame before setting off (a row making room for a held
      // card).
      if (
        discontinuity ||
        !oldCard ||
        !oldPose ||
        !before ||
        !sameTablePose(before, target) ||
        depthPaintKey(oldCard) !== depthPaintKey(card) ||
        oldProjection?.pileCounts.get(oldCard.id) !==
          projection.pileCounts.get(card.id) ||
        !sameTablePose(oldPose, pose) ||
        (this.elements.get(key)?.dataset.flying !== undefined) !==
          this.lifted(key)
      )
        this.paint(key, this.turning(key, pose, at), at);
    }
    // A card that was held and is gone from the table (put into a pile,
    // its cover taking over) is held no more.
    for (const key of this.held)
      if (!this.cards.has(key)) this.held.delete(key);
    // Who is lifted is settled once every travel of this commit is known: a
    // card looked at before its stack-mate's flight was set would otherwise
    // sit at the wrong height in the order for a frame or two.
    for (const [key, element] of this.elements) {
      const lifted = this.lifted(key);
      if (lifted === (element.dataset.flying !== undefined)) continue;
      if (lifted) element.dataset.flying = '';
      else delete element.dataset.flying;
    }
    if (plan && this.durationScale > 0) {
      for (const ghost of plan.ghosts) {
        const target = this.sourcePose(
          ghost.to ?? ghost.from,
          ghost.to
            ? ghost.toRotationQuarterTurns
            : ghost.fromRotationQuarterTurns,
          ghost.to ? projection : oldProjection
        );
        const from = this.sourcePose(
          ghost.from,
          ghost.fromRotationQuarterTurns,
          oldProjection,
          target
        );
        // The old top holding a pile stands in for the whole pile as it
        // was, its edges and all, under the card flying onto it.
        const holder = ghost.holdFor ? oldCards.get(ghost.holdFor) : undefined;
        const bands = holder
          ? (oldProjection?.pileCounts.get(holder.id) ?? 1)
          : undefined;
        this.addGhost(
          ghost.imageUrl,
          from,
          target,
          at,
          ghost.delay * 1000 * this.durationScale,
          ghost.holdFor,
          ghost.toImageUrl,
          bands === undefined
            ? { duration: ghost.duration }
            : // It lasts until that card has landed, however late it set off.
              {
                bands,
                lasts: this.landsIn(ghost.holdFor!) + TURN_MS,
                revealsArrival: turnsOnPile.has(ghost.holdFor!),
              }
        );
      }
      for (const shuffle of plan.shuffles) {
        if (shuffle.spread) {
          const parts = shuffle.spread
            .map((part, index) => ({
              part,
              index,
              base: this.motion.target(part.renderKey),
            }))
            .filter(
              (entry): entry is typeof entry & { base: TableCardPose } =>
                entry.base !== undefined &&
                this.elements.get(entry.part.renderKey)?.dataset.held ===
                  undefined
            );
          const centre = parts.reduce(
            (point, { base }) => ({
              x:
                point.x +
                (base.bounds.x + base.bounds.width / 2) / parts.length,
              y:
                point.y +
                (base.bounds.y + base.bounds.height / 2) / parts.length,
            }),
            { x: 0, y: 0 }
          );
          for (const { part, index, base } of parts)
            this.shuffles.set(part.renderKey, {
              key: part.renderKey,
              base,
              start: at + index * SPREAD_DEAL_STAGGER_MS * this.durationScale,
              duration: SPREAD_SHUFFLE_MS * this.durationScale,
              side: index % 2 ? 1 : -1,
              index,
              centre,
            });
        } else {
          this.riffle(
            shuffle.rect,
            shuffle.rotationQuarterTurns,
            shuffle.imageUrl,
            at + shuffle.delay * 1000 * this.durationScale,
            projection,
            shuffle.riders?.map((rider) => rider.renderKey) ?? []
          );
        }
      }
    }
    // Whatever this set off starts with the first frame that shows it.
    if (this.active && this.durationScale > 0) this.committedAt = at;
    this.schedule();
    this.onActivity?.();
  }

  /**
   * The held cards carried on to where `presentation` holds them, nothing
   * else on the table changing (`onlyHeldCardMoved`): each is painted there
   * at once, as a commit would paint it, without going over every card.
   */
  carry(presentation: BoardPresentation) {
    const projection = this.projection;
    if (!projection) return;
    const at = timestamp();
    // The card the pointer holds goes first: the cards carried with it are
    // placed from where it is painted.
    const gripped = this.grip?.key;
    const held = [...this.held].sort(
      (a, b) => Number(b === gripped) - Number(a === gripped)
    );
    for (const key of held) {
      const card = this.cards.get(key);
      if (!card) continue;
      const target = projection.pose(card, presentation);
      const before = this.motion.target(key);
      this.motion.set(key, target, at);
      if (!before || !sameTablePose(before, target))
        this.paint(
          key,
          this.turning(key, this.motion.poses.get(key) ?? target, at),
          at
        );
    }
  }

  private sourcePose(
    bounds: Rect,
    turns: number,
    projection: BoardDepthProjection | null,
    fallback?: TableCardPose
  ): TableCardPose {
    const exact = projection?.scene.cards.find(
      (card) =>
        card.renderKey !== null &&
        Math.abs(card.bounds.x - bounds.x) < 0.1 &&
        Math.abs(card.bounds.y - bounds.y) < 0.1
    );
    if (exact && projection) {
      // A new recipient alias may still represent the face just released.
      // Snapshot before painting the new pile cover, which reuses its key.
      const painted =
        projection !== this.projection && exact.renderKey
          ? this.sourcePainted.get(exact.renderKey)
          : undefined;
      return painted ?? { ...projection.pose(exact), bounds, turns };
    }
    return {
      bounds,
      turns,
      elevation: fallback?.elevation ?? 1,
      thickness: fallback?.thickness ?? 0.5,
      plane: fallback?.plane ?? 1,
    };
  }

  /** A pile shuffled where it lies: see riffle.ts. */
  private riffle(
    rect: Rect,
    turns: number,
    image: string,
    requestedStart: number,
    projection: BoardDepthProjection,
    riders: readonly string[] = []
  ) {
    let start = requestedStart;
    const cover = projection.scene.cards.find(
      (card) =>
        card.renderKey !== null &&
        card.primaryAction !== undefined &&
        Math.abs(card.bounds.x - rect.x) < 0.1 &&
        Math.abs(card.bounds.y - rect.y) < 0.1
    );
    const base = cover
      ? projection.pose(cover)
      : this.sourcePose(rect, turns, projection);
    if (base.thickness <= 0) return;
    // Cards still flying into the pile (sent off before the room answered
    // with the shuffle) land on it before it is riffled.
    for (const key of [...this.ghosts.keys(), cover?.renderKey]) {
      if (!key || this.ghosts.get(key)?.holdFor) continue;
      const end = this.motion.endsAt(key);
      const to = this.motion.target(key);
      if (
        end !== null &&
        to &&
        Math.abs(to.bounds.x - rect.x) < 1 &&
        Math.abs(to.bounds.y - rect.y) < 1
      )
        start = Math.max(start, end);
    }
    // Started late for them, it keeps the cards to be dealt off it waiting
    // as long, so they leave a squared pile, not one still being riffled.
    const late = start - requestedStart;
    if (late > 0)
      for (const key of riders) {
        const departs = this.motion.departsAt(key);
        if (departs === null || departs < requestedStart) continue;
        this.motion.postponeOne(key, late);
        const flip = this.flips.get(key);
        if (flip && Number.isFinite(flip.start) && flip.start >= requestedStart)
          flip.start += late;
      }
    const duration = RIFFLE_MS * this.durationScale;
    const lasts = start - timestamp() + duration;
    const order = riffleOrder(
      (cover && projection.pileCounts.get(cover.id)) ?? RIFFLE_PACKETS
    );
    const shift = riffleShift(...this.roomBeside(base, projection.camera));
    const stand = (bands: number) =>
      this.addGhost(image, base, base, start, 0, undefined, undefined, {
        bands,
        lasts,
      });
    // Drawn in this order, later over earlier: the bottom half under the top
    // half cut off it, the new pile over the halves' inner edges, and the
    // packets over all, each over the one that landed before it.
    const lower = stand(order.cards);
    const upper = stand(order.cards);
    const gathered = stand(order.cards);
    const packets = order.halves.map(() => stand(order.cardsPerPacket));
    const keys = [lower, upper, gathered, ...packets];
    if (!lower || !upper || !gathered || keys.some((key) => key === null)) {
      for (const key of keys) if (key) this.removeGhost(key);
      return;
    }
    keys.forEach((key, index) => {
      const { element } = this.ghosts.get(key!)!;
      element.style.opacity = '0';
      element.style.zIndex = String(index + 1);
      // Named as the flat table's riffle copies are, so either is found.
      element.classList.add('ptcgsim-card-ghost--riffle');
    });
    this.riffles.set(gathered, {
      stands: new Map<RiffleHalf | 'pile' | number, string>([
        ['upper', upper],
        ['lower', lower],
        ['pile', gathered],
        ...packets.map((key, index) => [index, key!] as const),
      ]),
      order,
      shift,
      pile: cover?.renderKey ?? null,
      riders,
      base,
      start,
      duration,
    });
  }

  /**
   * The cards waiting on a riffled pile to be dealt: hidden from its first
   * frame until each sets off (or, picked up, at once); all shown again
   * once it is over.
   */
  private hideRiders(riffle: Riffle, at: number, over: boolean) {
    for (const key of riffle.riders) {
      const element = this.elements.get(key);
      if (!element) continue;
      const departs = this.motion.departsAt(key);
      const waiting =
        !over &&
        element.dataset.held === undefined &&
        departs !== null &&
        departs > at;
      if (waiting) element.style.opacity = '0';
      else element.style.removeProperty('opacity');
    }
  }

  /**
   * The room beside a pile along the table, either side, as far as the
   * window shows the table at the pile's row; and the pile's own width
   * along it.
   */
  private roomBeside(
    base: TableCardPose,
    camera: TableCamera
  ): [{ left: number; right: number }, number] {
    const across =
      Math.round(base.turns) % 2 === 0 ? base.bounds.width : base.bounds.height;
    const x = base.bounds.x + base.bounds.width / 2;
    const y = base.bounds.y + base.bounds.height / 2;
    const anywhere = { left: Infinity, right: Infinity };
    try {
      const row = projectTablePoint(camera, { x, y, z: base.elevation }).y;
      const edge = (screenX: number) =>
        unprojectTablePoint(camera, { x: screenX, y: row }, base.elevation)?.x;
      const left = edge(RIFFLE_MARGIN);
      const right = edge(camera.width - RIFFLE_MARGIN);
      if (left === undefined || right === undefined) return [anywhere, across];
      return [
        { left: x - across / 2 - left, right: right - (x + across / 2) },
        across,
      ];
    } catch {
      return [anywhere, across];
    }
  }

  private paintRiffle(riffle: Riffle, at: number): boolean {
    const t = (at - riffle.start) / riffle.duration;
    if (t < 0) return false;
    const pile = riffle.pile ? this.elements.get(riffle.pile) : undefined;
    if (t >= 1) {
      if (pile) pile.style.removeProperty('opacity');
      this.hideRiders(riffle, at, true);
      for (const key of riffle.stands.values()) this.removeGhost(key);
      return true;
    }
    if (pile) pile.style.opacity = '0';
    this.hideRiders(riffle, at, false);
    for (const [part, piece] of riffleFrame(
      riffle.base,
      riffle.order,
      t,
      riffle.shift
    )) {
      const key = riffle.stands.get(part);
      const ghost = key === undefined ? undefined : this.ghosts.get(key);
      if (!key || !ghost) continue;
      ghost.element.style.opacity = piece ? '1' : '0';
      if (!piece) continue;
      ghost.bands = piece.bands;
      this.paint(key, piece.pose, at);
    }
    return false;
  }

  private addGhost(
    image: string,
    from: TableCardPose,
    to: TableCardPose,
    at: number,
    delay: number,
    holdFor?: string,
    toImage?: string,
    options?: {
      readonly duration?: number | undefined;
      readonly bands?: number;
      readonly lasts?: number;
      readonly revealsArrival?: boolean;
    }
  ): string | null {
    if (!this.layer) return null;
    const key = `depth-ghost-${this.serial++}`;
    const element = document.createElement('div');
    element.className = 'ptcgsim-card-ghost';
    element.dataset.depthCard = 'true';
    if (options?.bands !== undefined) {
      // A stand-in pile shows its edges and shadows like the real one.
      element.dataset.ghost = 'pile';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ptcgsim-card__depth');
      svg.setAttribute('aria-hidden', 'true');
      for (const part of ['contact', 'shadow', 'side', 'lines']) {
        const path = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'path'
        );
        path.setAttribute(`data-depth-${part}`, '');
        svg.append(path);
      }
      element.append(svg);
    }
    const face = document.createElement('div');
    face.className = 'ptcgsim-card__face';
    const picture = pictureFor(image);
    face.append(picture);
    element.append(face);
    this.layer.append(element);
    Object.assign(element.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      transformOrigin: '0 0',
      pointerEvents: 'none',
    });
    const duration =
      (options?.duration === undefined ? 600 : options.duration * 1000) *
      this.durationScale;
    this.ghosts.set(key, {
      element,
      expires: at + delay + Math.max(duration, options?.lasts ?? 0),
      start: at + delay,
      duration,
      picture,
      shows: image,
      ...(options?.bands !== undefined ? { bands: options.bands } : {}),
      ...(holdFor ? { holdFor } : {}),
      ...(options?.revealsArrival ? { revealsArrival: true } : {}),
      ...(toImage ? { fromImage: image, toImage } : {}),
    });
    this.motion.set(key, holdFor ? from : to, at, duration, from, delay);
    this.airborne.add(key);
    this.paint(key, from, at);
    return key;
  }

  /**
   * Turns the card over by hand: the old face (`fromImageUrl`, a card back
   * mostly) turns on its edge, the faces change hidden, and its own face
   * turns flat. It waits for that face to be ready -- holding the old one
   * up -- so it never turns up an empty card. Null shows no old face: the
   * card is past its edge already.
   */
  private flipFace(
    key: string,
    fromImageUrl: string | null,
    start: number,
    duration: number
  ) {
    this.clearFlip(key);
    const element = this.elements.get(key);
    const face = element?.querySelector<HTMLElement>('.ptcgsim-card__face');
    if (!element || !face) return;
    element.dataset.turning = '';
    let image: HTMLElement | null = null;
    if (fromImageUrl !== null) {
      // A copy of the face it had, which paints at once: a new image would
      // leave the card blank for a frame or two.
      const turn = pictureFor(fromImageUrl);
      turn.classList.add('ptcgsim-card__turn');
      face.append(turn);
      image = turn;
    }
    const flip: Flip = { image, fromImageUrl, face, start, duration };
    this.flips.set(key, flip);
    const own = faceImageOf(face);
    // Infinity: carried over from a node still waiting for its face, so it
    // starts once this one's is ready -- at once if it is already.
    const pending = start === Infinity;
    // Not yet begun and its face not ready: it waits, back up, and turns
    // once it is (or at once if that is already later than planned).
    if (image && (pending || !(start < timestamp())) && !isFaceReady(own)) {
      flip.start = Infinity;
      flip.stopWaiting = whenFaceReady(own, () => {
        if (this.flips.get(key) !== flip) return;
        delete flip.stopWaiting;
        flip.start = pending ? timestamp() : Math.max(timestamp(), start);
        this.schedule();
      });
      return;
    }
    if (pending) flip.start = timestamp();
  }
  /**
   * The card was re-aliased mid-turn (the room answering a predicted move):
   * the new node carries on the turn the old one had under way.
   */
  private carryFlip(from: string, to: string) {
    const flip = this.flips.get(from);
    if (!flip || from === to) return;
    const fromImageUrl = flip.image ? flip.fromImageUrl : null;
    this.clearFlip(from);
    this.flipFace(to, fromImageUrl, flip.start, flip.duration);
  }
  private clearFlip(key: string) {
    const flip = this.flips.get(key);
    if (!flip) return;
    flip.stopWaiting?.();
    flip.image?.remove();
    flip.face.style.removeProperty('transform');
    this.flips.delete(key);
    const element = this.elements.get(key);
    if (!element) return;
    delete element.dataset.turning;
    if (!this.lifted(key)) delete element.dataset.flying;
  }

  /** Holds back by `by` everything set off at or after `since`. */
  private postpone(since: number, by: number) {
    if (by <= 0) return;
    this.motion.postpone(since, by);
    for (const flip of this.flips.values())
      if (flip.start >= since && Number.isFinite(flip.start)) flip.start += by;
    for (const ghost of this.ghosts.values())
      if (ghost.start >= since) {
        ghost.start += by;
        ghost.expires += by;
      }
    for (const [key, riffle] of this.riffles)
      if (riffle.start >= since)
        this.riffles.set(key, { ...riffle, start: riffle.start + by });
  }

  /**
   * A card's pose as far through its turn over as it is at `at`: a card
   * repainted mid-turn (the room answering) stays turned, not flat for a
   * frame.
   */
  private turning(key: string, pose: TableCardPose, at: number): TableCardPose {
    const flip = this.flips.get(key);
    return flip && flip.duration > 0
      ? turnedOver(pose, turnProgress(flip, at))
      : pose;
  }

  /** A card's height with its hover raise and the lift it is rising through. */
  private height(key: string, target: TableCardPose, now: number): number {
    const elevation = target.elevation + Math.max(0, this.raiseAt(key, now));
    const lift = this.lifts.get(key);
    return lift && now - lift.start < lift.duration
      ? lift.from +
          (elevation - lift.from) *
            easeOut(Math.max(0, (now - lift.start) / lift.duration))
      : elevation;
  }
  /**
   * A card's pose at the height it is painted at. A joined card's held
   * pieces share the highest of their heights: crossing a spot that takes
   * only one piece lets the others go, and when they are carried again
   * they are at the card's height at once, not a rise behind it.
   */
  private elevated(
    key: string,
    target: TableCardPose,
    now: number
  ): TableCardPose {
    let elevation = this.height(key, target, now);
    if (this.held.has(key) && this.cards.get(key)?.composition)
      for (const piece of this.joined(key)) {
        const pose = piece === key ? undefined : this.motion.poses.get(piece);
        if (pose && this.held.has(piece))
          elevation = Math.max(elevation, this.height(piece, pose, now));
      }
    return elevation === target.elevation ? target : { ...target, elevation };
  }
  /**
   * How far the held cards move on the table so the grip stays under the
   * pointer at the height they are painted at. The pointer was solved at
   * the height painted when it moved; a card still rising since would
   * otherwise slide out from under it.
   */
  private gripShift(now: number): TablePoint | null {
    const grip = this.grip;
    const camera = this.projection?.camera;
    const target = grip && this.motion.poses.get(grip.key);
    if (
      !grip ||
      !camera ||
      !target ||
      target.plane !== 1 ||
      !this.held.has(grip.key)
    )
      return null;
    const pose = this.elevated(grip.key, target, now);
    const m = tablePoseMatrix(camera, pose);
    const x = grip.x * pose.bounds.width;
    const y = grip.y * pose.bounds.height;
    const w = m[3]! * x + m[7]! * y + m[15]!;
    const held = unprojectTablePoint(
      camera,
      {
        x: (m[0]! * x + m[4]! * y + m[12]!) / w,
        y: (m[1]! * x + m[5]! * y + m[13]!) / w,
      },
      pose.elevation
    );
    const under = unprojectTablePoint(camera, grip.point, pose.elevation);
    return held && under ? { x: under.x - held.x, y: under.y - held.y } : null;
  }

  /**
   * Paints one card at `now`. Every card painted in one pass is given the
   * same time, so cards moving together (a joined card's pieces, a held
   * stack) are painted at the same point of their move.
   */
  private paint(key: string, target: TableCardPose, now = timestamp()) {
    const projection = this.projection;
    const element = this.elements.get(key) ?? this.ghosts.get(key)?.element;
    if (!projection || !element) return;
    let pose = this.elevated(key, target, now);
    if (this.raiseAt(key, now) <= 0 && this.raises.get(key)?.to === 0)
      this.raises.delete(key);
    const lift = this.lifts.get(key);
    if (lift && now - lift.start >= lift.duration) this.lifts.delete(key);
    const shift = this.held.has(key) ? this.gripShift(now) : null;
    if (shift)
      pose = {
        ...pose,
        bounds: {
          ...pose.bounds,
          x: pose.bounds.x + shift.x,
          y: pose.bounds.y + shift.y,
        },
      };
    this.painted.set(key, pose);
    element.style.width = `${pose.bounds.width}px`;
    element.style.height = `${pose.bounds.height}px`;
    element.style.transform = `matrix3d(${tablePoseMatrix(projection.camera, pose).join(',')})`;
    element.dataset.elevation = pose.elevation.toFixed(3);
    if (this.lifted(key)) element.dataset.flying = '';
    else delete element.dataset.flying;
    const geometry = element.querySelector<SVGSVGElement>(
      '.ptcgsim-card__depth'
    );
    const card = this.cards.get(key);
    if (geometry) {
      geometry.style.opacity = String(pose.plane);
      geometry.setAttribute(
        'viewBox',
        `0 0 ${pose.bounds.width} ${pose.bounds.height}`
      );
      const edges = tablePoseEdges(
        projection.camera,
        pose,
        card
          ? (projection.pileCounts.get(card.id) ?? 1)
          : (this.ghosts.get(key)?.bands ?? 1)
      );
      geometry
        .querySelector('[data-depth-side]')
        ?.setAttribute('d', edges.sides);
      geometry
        .querySelector('[data-depth-lines]')
        ?.setAttribute('d', edges.lines);
      const look = tableShadowStyle(edges.above, pose.bounds.width);
      const shadow = geometry.querySelector<SVGPathElement>(
        '[data-depth-shadow]'
      );
      if (shadow) {
        shadow.setAttribute('d', edges.shadow);
        shadow.style.opacity = look.castOpacity.toFixed(3);
        // The blur in quarter pixels, rewritten only when it changes: a new
        // filter re-rasterizes the shadow, and a card sliding at one height
        // keeps the same one.
        const blur =
          look.castBlur > 0
            ? `blur(${(Math.round(look.castBlur * 4) / 4).toFixed(2)}px)`
            : 'none';
        if (shadow.style.filter !== blur) shadow.style.filter = blur;
      }
      const contact = geometry.querySelector<SVGPathElement>(
        '[data-depth-contact]'
      );
      if (contact) {
        contact.setAttribute('d', edges.contact);
        contact.style.opacity = look.contactOpacity.toFixed(3);
      }
    }
    let markersMoved = false;
    if (card)
      for (const marker of projection.scene.markers) {
        if (marker.parentCardId !== card.id) continue;
        const node = this.markers.get(marker.id);
        if (!node) continue;
        markersMoved = true;
        const projected = projection.markerMatrix(marker, pose);
        if (projected) {
          node.style.left = '0px';
          node.style.top = '0px';
          node.style.transformOrigin = '0 0';
          node.style.transform = `matrix3d(${projected.join(',')})`;
        } else {
          const painted = projection.marker(marker, pose);
          node.style.left = `${painted.bounds.x}px`;
          node.style.top = `${painted.bounds.y}px`;
          node.style.removeProperty('transform');
        }
      }
    if (markersMoved) this.onMarkersMoved?.();
  }

  private schedule() {
    if (
      this.frame !== null ||
      !this.active ||
      typeof requestAnimationFrame !== 'function'
    )
      return;
    this.frame = requestAnimationFrame(this.tick);
  }
  /** Carried through the air right now, not just sliding along its row. */
  private inFlight(key: string): boolean {
    return this.motion.has(key) && this.airborne.has(key);
  }
  /**
   * Lifted while it, or a piece of the same Pokémon landing with it, is in
   * the air: a Pokémon that arrives first never drops below its Energy that
   * is still in the air. A hand or another row is not one piece: a card
   * landing in it leaves the rest of the row in its order beneath.
   */
  private lifted(key: string): boolean {
    // Turning over, it stays over the table (and over the old top of a pile
    // it landed on) until it lies flat.
    if (this.inFlight(key) || this.flips.has(key)) return true;
    const card = this.cards.get(key);
    if (!card || !STACK_PIECE_ROLES.has(card.role)) return false;
    for (const [other, mate] of this.cards) {
      if (mate.parentId === card.parentId && this.inFlight(other)) return true;
    }
    return false;
  }

  private readonly tick = (at: number) => {
    this.frame = null;
    // The first frame after a commit: what it set off begins now, a frame
    // along, not as far along as the commit and a slow frame (a new face
    // decoded, a row laid out) took -- it would jump there.
    const since = this.committedAt;
    this.committedAt = null;
    if (since !== null) {
      const late = at - since - FRAME_MS;
      if (late <= POSTPONE_MAX_MS) this.postpone(since, late);
    }
    const sampled = this.motion.sampleAll(at);
    for (const [key, pose] of sampled) this.paint(key, pose, at);
    for (const key of new Set([...this.lifts.keys(), ...this.raises.keys()])) {
      if (sampled.has(key)) continue;
      const pose = this.motion.poses.get(key);
      if (pose) this.paint(key, pose, at);
    }
    // Landed out of a viewer, a card is back among the table's own.
    for (const key of [...this.overWindows])
      if (!this.motion.has(key) && !this.flips.has(key))
        this.liftOverWindows(key, false);
    // Cards that landed earlier keep their lift until their group has landed.
    for (const [key, element] of this.elements) {
      if (element.dataset.flying !== undefined && !this.lifted(key)) {
        delete element.dataset.flying;
      }
    }
    // Under a card turned over right on top of it, the pile shows that
    // card's face from when the turn begins, while the card still covers
    // it: on its edge the card shows itself under it, never the old top.
    // Before the turns are drawn, so a late frame that both begins and ends
    // one still does.
    for (const ghost of this.ghosts.values()) {
      if (!ghost.revealsArrival || !ghost.holdFor) continue;
      const flip = this.flips.get(ghost.holdFor);
      const url = flip ? faceImageOf(flip.face)?.getAttribute('src') : null;
      if (flip && url && Number.isFinite(flip.start) && at >= flip.start)
        this.showOnGhost(ghost, url);
    }
    for (const [key, flip] of this.flips) {
      const progress = turnProgress(flip, at);
      if (progress >= 0.5) {
        flip.image?.remove();
        flip.image = null;
      }
      const base = this.motion.poses.get(key) ?? this.painted.get(key);
      if (base && flip.duration > 0)
        this.paint(key, turnedOver(base, progress), at);
      if (progress === 1) this.clearFlip(key);
    }
    for (const [key, shuffle] of this.shuffles) {
      const t = Math.max(
        0,
        Math.min(1, (at - shuffle.start) / shuffle.duration)
      );
      if (t === 1) {
        this.shuffles.delete(key);
        this.paint(key, shuffle.base, at);
        continue;
      }
      this.paint(key, spreadShufflePose(shuffle, t), at);
    }
    for (const [key, riffle] of this.riffles)
      if (this.paintRiffle(riffle, at)) this.riffles.delete(key);
    for (const [key, ghost] of this.ghosts) {
      if (ghost.toImage) {
        // Turned over on the way, as the card it stands in for would be:
        // its faces change on its edge, halfway through the turn.
        const progress =
          ghost.duration > 0
            ? Math.max(
                0,
                Math.min(
                  1,
                  (at - ghost.start - GHOST_TURN_FROM * ghost.duration) /
                    (GHOST_TURN_FOR * ghost.duration)
                )
              )
            : 1;
        // Its faces change on its edge, to a copy that paints at once.
        if (progress >= 0.5) this.showOnGhost(ghost, ghost.toImage);
        const base = this.motion.poses.get(key);
        if (base && progress > 0 && progress < 1)
          this.paint(key, turnedOver(base, progress), at);
      }
      if (
        at >= ghost.expires ||
        // The old top keeps the pile covered until the new one has landed
        // and turned over on it.
        (ghost.holdFor &&
          !this.motion.has(ghost.holdFor) &&
          !this.flips.has(ghost.holdFor) &&
          at > ghost.start)
      )
        this.removeGhost(key);
      else if (
        !ghost.holdFor &&
        !this.shuffles.has(key) &&
        ghost.bands === undefined
      )
        ghost.element.style.opacity = String(
          Math.max(0, Math.min(1, (ghost.expires - at) / 120))
        );
    }
    this.onActivity?.();
    this.schedule();
  };
  /** A stand-in shows `url` from now on (set once; a copy paints at once). */
  private showOnGhost(ghost: Ghost, url: string) {
    if (ghost.shows === url) return;
    const next = pictureFor(url);
    ghost.picture.replaceWith(next);
    ghost.picture = next;
    ghost.shows = url;
  }
  private removeGhost(key: string) {
    this.ghosts.get(key)?.element.remove();
    this.ghosts.delete(key);
    this.shuffles.delete(key);
    this.motion.delete(key);
    this.painted.delete(key);
    this.airborne.delete(key);
  }
  /**
   * Stops every motion. `keepHolds` keeps a card that only holds its old
   * face up while its new one loads (reduced motion): it turns nothing.
   */
  cancel(keepHolds = false) {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.motion.finish();
    for (const [key, pose] of this.motion.poses) {
      const painted = this.painted.get(key);
      if (
        !painted ||
        !sameTablePose(painted, pose) ||
        this.elements.get(key)?.dataset.flying !== undefined
      )
        this.paint(key, pose);
    }
    for (const [key, flip] of this.flips)
      if (!keepHolds || flip.duration > 0) this.clearFlip(key);
    for (const riffle of this.riffles.values()) {
      if (riffle.pile)
        this.elements.get(riffle.pile)?.style.removeProperty('opacity');
      this.hideRiders(riffle, Infinity, true);
    }
    this.riffles.clear();
    for (const key of this.ghosts.keys()) this.removeGhost(key);
    this.shuffles.clear();
    this.lifts.clear();
    this.released.clear();
    this.airborne.clear();
    this.raises.clear();
    for (const key of [...this.overWindows]) this.liftOverWindows(key, false);
    this.hovered = null;
    this.onActivity?.();
  }
  destroy() {
    this.cancel();
    this.motion.clear();
    this.painted.clear();
    this.sourcePainted.clear();
    this.cards.clear();
    this.markers.clear();
    this.projection = null;
    this.context = '';
    this.origins = null;
    this.listening?.removeEventListener('keydown', this.recordOrigins, true);
    this.listening?.removeEventListener(
      'pointerdown',
      this.recordOrigins,
      true
    );
    this.listening = null;
  }
}
