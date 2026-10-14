import {
  BoardDepthProjection,
  TABLE_CARD_THICKNESS,
  TablePoseMotion,
  planBoardMotion,
  tablePoseMatrix,
  tablePoseEdges,
  tableShadowStyle,
  sameTablePose,
  type BoardPresentation,
  type BoardScene,
  type BoardSceneMotion,
  type CardSceneNode,
  type TableCardPose,
  type CardFlight,
  type Rect,
} from '@ptcgsim/renderer-contract';
import { depthPaintKey } from './depth-paint-key.js';

const timestamp = () => performance.now();
/** How long a card takes to rise to its held height. */
const LIFT_DURATION_MS = 120;
/** A card under the pointer rises this share of its width, over this long. */
const HOVER_RAISE = 0.06;
const HOVER_RAISE_MS = 140;
/** A riffle shuffle, from split to squared pile. */
const RIFFLE_MS = 900;
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
interface Ghost {
  element: HTMLElement;
  expires: number;
  /** Edge lines a stand-in pile shows. */
  bands?: number;
  holdFor?: string;
  fromImage?: string;
  toImage?: string;
  start: number;
  duration: number;
}
interface Shuffle {
  key: string;
  base: TableCardPose;
  start: number;
  duration: number;
  side: number;
  index: number;
}

/**
 * A pile being riffled: split in two halves that lift apart and tip in,
 * riffle back together while the cards pass into one pile in the middle,
 * and square up. Stand-ins play it while the real pile is hidden.
 */
interface Riffle {
  readonly left: string;
  readonly right: string;
  readonly middle: string;
  readonly pile: string | null;
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
  private readonly flips = new Map<
    string,
    { image: HTMLElement; face: HTMLElement; start: number; duration: number }
  >();
  private readonly markers = new Map<string, HTMLElement>();
  /** A card picked up rises to its held height over a moment, not at once. */
  private readonly lifts = new Map<
    string,
    { from: number; start: number; duration: number }
  >();
  private readonly held = new Set<string>();
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
    if (previous) raise(previous, 0);
    const pose = key ? this.motion.poses.get(key) : undefined;
    if (
      key &&
      pose &&
      pose.plane === 1 &&
      !this.held.has(key) &&
      !this.motion.has(key)
    )
      raise(key, HOVER_RAISE * pose.bounds.width);
    for (const target of [previous, key]) {
      const base = target ? this.motion.poses.get(target) : undefined;
      if (target && base) this.paint(target, base);
    }
    this.schedule();
    this.onActivity?.();
  }
  current(key: string) {
    return this.painted.get(key);
  }
  attach(surface: HTMLElement | null, layer: HTMLElement | null) {
    this.surface = surface;
    this.layer = layer;
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
    if (discontinuity || reduced || durationScale === 0) this.cancel();
    this.context = context;
    this.projection = projection;
    this.durationScale = reduced ? 0 : durationScale;
    const at = timestamp();
    const next = projection.scene;
    const plan =
      previous && previous !== next && cause && !discontinuity
        ? planBoardMotion(previous, next, cause.cause)
        : null;
    const flights = new Map(
      plan?.flights.map((flight) => [flight.renderKey, flight]) ?? []
    );
    this.cards.clear();
    for (const card of next.cards)
      if (card.renderKey !== null) this.cards.set(card.renderKey, card);
    for (const key of this.motion.poses.keys())
      if (!this.cards.has(key) && !this.ghosts.has(key)) {
        this.shuffles.delete(key);
        this.motion.delete(key);
        this.painted.delete(key);
      }
    this.markers.clear();
    for (const element of Array.from(
      this.surface?.querySelectorAll<HTMLElement>('[data-marker-id]') ?? []
    ))
      this.markers.set(element.dataset.markerId!, element);
    for (const [key, card] of this.cards) {
      const target = projection.pose(card, presentation);
      const held = this.elements.get(key)?.dataset.held !== undefined;
      if (held && !this.held.has(key) && this.durationScale > 0) {
        const from = this.painted.get(key)?.elevation;
        if (from !== undefined && from < target.elevation)
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
        this.held.delete(key);
        this.lifts.delete(key);
      }
      const shuffle = this.shuffles.get(key);
      if (shuffle && (held || !sameTablePose(shuffle.base, target))) {
        // A newer move owns the card. Continue from its visible shuffle pose,
        // and never let the old shuffle restore its previous destination.
        this.motion.set(key, this.painted.get(key) ?? shuffle.base, at);
        this.shuffles.delete(key);
      }
      const flight = flights.get(key);
      const before = this.motion.target(key);
      const onlyHeight =
        before &&
        before.bounds.x === target.bounds.x &&
        before.bounds.y === target.bounds.y &&
        before.bounds.width === target.bounds.width &&
        before.turns === target.turns;
      const oldCard = oldCards.get(key);
      const oldPose = this.sourcePainted.get(key);
      const replacedHeldPile =
        card.primaryAction &&
        oldCard &&
        oldCard.id !== card.id &&
        oldPose &&
        (oldPose.bounds.x !== oldCard.bounds.x ||
          oldPose.bounds.y !== oldCard.bounds.y);
      const source = flight
        ? this.sourcePose(
            flight.from,
            flight.fromRotationQuarterTurns,
            oldProjection,
            target
          )
        : undefined;
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
      const duration = still
        ? 0
        : this.durationScale *
          (onlyHeight
            ? projection.settings.animate
              ? 180
              : 0
            : source
              ? Math.min(560, Math.max(320, 300 + 0.22 * distance))
              : 420);
      const arc =
        source && duration > 0 && target.plane === 1
          ? Math.min(
              target.bounds.width,
              Math.max(0.25 * target.bounds.width, 0.2 * distance)
            ) * projection.settings.strength
          : 0;
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
      this.motion.set(
        key,
        target,
        at,
        duration,
        from,
        (flight?.delay ?? 0) * 1000 * this.durationScale,
        arc
      );
      if (flight?.fromImageUrl && duration > 0)
        this.flipFace(key, flight, at, duration);
      if (held) {
        this.shuffles.delete(key);
        this.clearFlip(key);
      }
      const pose = this.motion.poses.get(key) ?? target;
      // Still cards keep their existing transforms and edge paths. Repaint a
      // changed descriptor as React may have restored its target transform.
      if (
        discontinuity ||
        !oldCard ||
        !oldPose ||
        depthPaintKey(oldCard) !== depthPaintKey(card) ||
        oldProjection?.pileCounts.get(oldCard.id) !==
          projection.pileCounts.get(card.id) ||
        !sameTablePose(oldPose, pose) ||
        (this.elements.get(key)?.dataset.flying !== undefined) !==
          this.lifted(key)
      )
        this.paint(key, pose);
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
        this.addGhost(
          ghost.imageUrl,
          from,
          target,
          at,
          ghost.delay * 1000 * this.durationScale,
          ghost.holdFor,
          ghost.toImageUrl
        );
      }
      for (const shuffle of plan.shuffles) {
        if (shuffle.spread) {
          for (const [index, part] of shuffle.spread.entries()) {
            const base = this.motion.target(part.renderKey);
            if (
              base &&
              this.elements.get(part.renderKey)?.dataset.held === undefined
            )
              this.shuffles.set(part.renderKey, {
                key: part.renderKey,
                base,
                start: at,
                duration: 600 * this.durationScale,
                side: index % 2 ? 1 : -1,
                index,
              });
          }
        } else {
          this.riffle(
            shuffle.rect,
            shuffle.rotationQuarterTurns,
            shuffle.imageUrl,
            at + shuffle.delay * 1000 * this.durationScale,
            projection
          );
        }
      }
    }
    this.schedule();
    this.onActivity?.();
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

  /** A pile shuffled where it lies: see Riffle. */
  private riffle(
    rect: Rect,
    turns: number,
    image: string,
    start: number,
    projection: BoardDepthProjection
  ) {
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
    const duration = RIFFLE_MS * this.durationScale;
    const lasts = start - timestamp() + duration;
    const half = {
      ...base,
      thickness: base.thickness / 2,
      elevation: base.thickness / 2,
    };
    const left = this.addGhost(
      image,
      half,
      half,
      start,
      0,
      undefined,
      undefined,
      { bands: 4, lasts }
    );
    const right = this.addGhost(
      image,
      half,
      half,
      start,
      0,
      undefined,
      undefined,
      { bands: 4, lasts }
    );
    const middle = this.addGhost(
      image,
      base,
      base,
      start,
      0,
      undefined,
      undefined,
      { bands: 8, lasts }
    );
    if (!left || !right || !middle) return;
    for (const key of [left, right, middle])
      this.ghosts.get(key)!.element.style.opacity = '0';
    this.riffles.set(left, {
      left,
      right,
      middle,
      pile: cover?.renderKey ?? null,
      base,
      start,
      duration,
    });
  }

  private paintRiffle(riffle: Riffle, at: number): boolean {
    const t = (at - riffle.start) / riffle.duration;
    if (t < 0) return false;
    const pile = riffle.pile ? this.elements.get(riffle.pile) : undefined;
    const ghost = (key: string) => this.ghosts.get(key)?.element;
    if (t >= 1) {
      if (pile) pile.style.removeProperty('opacity');
      for (const key of [riffle.left, riffle.right, riffle.middle])
        this.removeGhost(key);
      return true;
    }
    if (pile) pile.style.opacity = '0';
    const { base } = riffle;
    const width = base.bounds.width;
    const full = base.thickness;
    const half = full / 2;
    // Split (0-0.3), riffle (0.3-0.82), square up (0.82-1).
    const split = easeInOut(Math.min(1, t / 0.3));
    const pass = Math.max(0, Math.min(1, (t - 0.3) / 0.52));
    const square = Math.max(0, (t - 0.82) / 0.18);
    const apart = 0.55 * width * split * (1 - 0.8 * easeInOut(pass));
    const raise = 0.12 * width * split * (1 - pass);
    const tip = 0.14 * split * (1 - pass);
    const flutter =
      pass > 0 && pass < 1 ? Math.sin(pass * Math.PI * 14) * 0.012 * width : 0;
    const halfThickness = half * (1 - pass);
    const halfPose = (side: number): TableCardPose => ({
      ...base,
      bounds: { ...base.bounds, x: base.bounds.x + side * apart },
      thickness: halfThickness,
      elevation: halfThickness + raise + (side > 0 ? flutter : -flutter * 0.5),
      flip: -side * tip,
    });
    const middleThickness = full * pass;
    const settle =
      square > 0
        ? Math.sin(square * Math.PI * 2) * 0.02 * width * (1 - square)
        : 0;
    for (const [key, side] of [
      [riffle.left, -1],
      [riffle.right, 1],
    ] as const) {
      const element = ghost(key);
      if (!element) continue;
      element.style.opacity = halfThickness > 0.3 ? '1' : '0';
      this.paint(key, halfPose(side));
    }
    const middle = ghost(riffle.middle);
    if (middle) {
      middle.style.opacity = middleThickness > 0.3 ? '1' : '0';
      this.paint(riffle.middle, {
        ...base,
        bounds: { ...base.bounds, x: base.bounds.x + settle },
        thickness: middleThickness,
        elevation: middleThickness,
      });
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
    options?: { readonly bands?: number; readonly lasts?: number }
  ): string | null {
    if (!this.layer) return null;
    const key = `depth-ghost-${this.serial++}`;
    const element = document.createElement('div');
    element.className = 'ptcgsim-card-ghost';
    element.dataset.depthCard = 'true';
    if (options?.bands !== undefined) {
      // A stand-in pile shows its edges and shadows like the real one.
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
    const img = document.createElement('img');
    img.src = image;
    img.alt = '';
    img.draggable = false;
    face.append(img);
    element.append(face);
    this.layer.append(element);
    Object.assign(element.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      transformOrigin: '0 0',
      pointerEvents: 'none',
    });
    const duration = 420 * this.durationScale;
    this.ghosts.set(key, {
      element,
      expires:
        at +
        delay +
        Math.max(duration, 720 * this.durationScale, options?.lasts ?? 0),
      start: at + delay,
      duration,
      ...(options?.bands !== undefined ? { bands: options.bands } : {}),
      ...(holdFor ? { holdFor } : {}),
      ...(toImage ? { fromImage: image, toImage } : {}),
    });
    this.motion.set(key, holdFor ? from : to, at, duration, from, delay);
    this.paint(key, from);
    return key;
  }

  private flipFace(
    key: string,
    flight: CardFlight,
    at: number,
    duration: number
  ) {
    this.clearFlip(key);
    const face = this.elements
      .get(key)
      ?.querySelector<HTMLElement>('.ptcgsim-card__face');
    if (!face || !flight.fromImageUrl) return;
    const image = document.createElement('img');
    image.className = 'ptcgsim-card__turn';
    image.src = flight.fromImageUrl;
    image.alt = '';
    image.draggable = false;
    face.append(image);
    // Turned over by hand during the middle of the move: the old face
    // turns on edge, the faces change hidden, the new one turns flat.
    const start =
      at + flight.delay * 1000 * this.durationScale + duration * 0.2;
    this.flips.set(key, {
      image,
      face,
      start,
      duration: duration * 0.6,
    });
  }
  private clearFlip(key: string) {
    const flip = this.flips.get(key);
    if (flip) {
      flip.image.remove();
      flip.face.style.removeProperty('transform');
    }
    this.flips.delete(key);
  }

  private paint(key: string, target: TableCardPose) {
    const projection = this.projection;
    const element = this.elements.get(key) ?? this.ghosts.get(key)?.element;
    if (!projection || !element) return;
    let pose = target;
    const now = timestamp();
    const raised = this.raiseAt(key, now);
    if (raised > 0) pose = { ...pose, elevation: pose.elevation + raised };
    else if (this.raises.get(key)?.to === 0) this.raises.delete(key);
    const lift = this.lifts.get(key);
    if (lift) {
      const progress = Math.min(1, (now - lift.start) / lift.duration);
      if (progress >= 1) this.lifts.delete(key);
      else
        pose = {
          ...pose,
          elevation:
            lift.from + (pose.elevation - lift.from) * easeOut(progress),
        };
    }
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
        shadow.style.filter =
          look.castBlur > 0 ? `blur(${look.castBlur.toFixed(2)}px)` : 'none';
      }
      const contact = geometry.querySelector<SVGPathElement>(
        '[data-depth-contact]'
      );
      if (contact) {
        contact.setAttribute('d', edges.contact);
        contact.style.opacity = look.contactOpacity.toFixed(3);
      }
    }
    if (card)
      for (const marker of projection.scene.markers) {
        if (marker.parentCardId !== card.id) continue;
        const node = this.markers.get(marker.id);
        if (!node) continue;
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
  /**
   * Lifted while it, or any card landing with it on the same parent, still
   * travels: a Pokémon that arrives first never drops below its Energy that
   * is still in the air.
   */
  private lifted(key: string): boolean {
    if (this.motion.has(key)) return true;
    const group = this.cards.get(key)?.parentId;
    if (group === undefined) return false;
    for (const [other, card] of this.cards) {
      if (card.parentId === group && this.motion.has(other)) return true;
    }
    return false;
  }

  private readonly tick = (at: number) => {
    this.frame = null;
    const sampled = this.motion.sampleAll(at);
    for (const [key, pose] of sampled) this.paint(key, pose);
    for (const key of new Set([...this.lifts.keys(), ...this.raises.keys()])) {
      if (sampled.has(key)) continue;
      const pose = this.motion.poses.get(key);
      if (pose) this.paint(key, pose);
    }
    // Cards that landed earlier keep their lift until their group has landed.
    for (const [key, element] of this.elements) {
      if (element.dataset.flying !== undefined && !this.lifted(key)) {
        delete element.dataset.flying;
      }
    }
    for (const [key, flip] of this.flips) {
      const progress = Math.max(
        0,
        Math.min(1, (at - flip.start) / flip.duration)
      );
      if (progress >= 0.5) flip.image.remove();
      const base = this.motion.poses.get(key) ?? this.painted.get(key);
      if (base) {
        const turn = easeInOut(progress);
        this.paint(key, {
          ...base,
          flip:
            progress >= 1
              ? 0
              : turn < 0.5
                ? turn * Math.PI
                : (turn - 1) * Math.PI,
        });
      }
      if (progress === 1) this.clearFlip(key);
    }
    for (const [key, shuffle] of this.shuffles) {
      const t = Math.max(
        0,
        Math.min(1, (at - shuffle.start) / shuffle.duration)
      );
      if (t === 1) {
        this.shuffles.delete(key);
        this.paint(key, shuffle.base);
        continue;
      }
      const fan = Math.sin(t * Math.PI) ** 2;
      this.paint(key, {
        ...shuffle.base,
        bounds: {
          ...shuffle.base.bounds,
          x:
            shuffle.base.bounds.x +
            shuffle.side * shuffle.base.bounds.width * 0.48 * fan,
          y: shuffle.base.bounds.y - 3 * fan,
        },
        elevation: shuffle.base.elevation + 9 * fan,
        turns: shuffle.base.turns + shuffle.side * 0.055 * fan,
      });
    }
    for (const [key, riffle] of this.riffles)
      if (this.paintRiffle(riffle, at)) this.riffles.delete(key);
    for (const [key, ghost] of this.ghosts) {
      if (ghost.toImage && at >= ghost.start + ghost.duration * 0.5) {
        const img = ghost.element.querySelector('img');
        if (img && img.src !== ghost.toImage) img.src = ghost.toImage;
      }
      if (
        at >= ghost.expires ||
        (ghost.holdFor && !this.motion.has(ghost.holdFor) && at > ghost.start)
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
  private removeGhost(key: string) {
    this.ghosts.get(key)?.element.remove();
    this.ghosts.delete(key);
    this.shuffles.delete(key);
    this.motion.delete(key);
    this.painted.delete(key);
  }
  cancel() {
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
    for (const key of this.flips.keys()) this.clearFlip(key);
    for (const riffle of this.riffles.values())
      if (riffle.pile)
        this.elements.get(riffle.pile)?.style.removeProperty('opacity');
    this.riffles.clear();
    for (const key of this.ghosts.keys()) this.removeGhost(key);
    this.shuffles.clear();
    this.lifts.clear();
    this.raises.clear();
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
  }
}
