import {
  BoardDepthProjection,
  TablePoseMotion,
  planBoardMotion,
  tablePoseMatrix,
  tablePoseEdges,
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
interface Ghost {
  element: HTMLElement;
  expires: number;
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

/** One on-demand clock for physical poses, thickness and their shadows. */
export class TableDepthDirector {
  private readonly motion = new TablePoseMotion();
  private readonly painted = new Map<string, TableCardPose>();
  private sourcePainted = new Map<string, TableCardPose>();
  private readonly ghosts = new Map<string, Ghost>();
  private readonly shuffles = new Map<string, Shuffle>();
  private readonly flips = new Map<
    string,
    { image: HTMLElement; face: HTMLElement; start: number; duration: number }
  >();
  private readonly markers = new Map<string, HTMLElement>();
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
      this.flips.size > 0
    );
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
      const duration =
        replacedHeldPile ||
        held ||
        discontinuity ||
        (!cause && previous !== next)
          ? 0
          : this.durationScale *
            (onlyHeight ? (projection.settings.animate ? 180 : 0) : 420);
      const source = flight
        ? this.sourcePose(
            flight.from,
            flight.fromRotationQuarterTurns,
            oldProjection,
            target
          )
        : undefined;
      const from = source
        ? {
            ...source,
            thickness: Math.min(
              source.thickness,
              source.bounds.width * 0.0055 * projection.settings.strength
            ),
          }
        : undefined;
      this.motion.set(
        key,
        target,
        at,
        duration,
        from,
        (flight?.delay ?? 0) * 1000 * this.durationScale
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
          const base = this.sourcePose(
            shuffle.rect,
            shuffle.rotationQuarterTurns,
            projection
          );
          for (let index = 0; index < 4; index++) {
            const start =
              at + (shuffle.delay * 1000 + index * 22) * this.durationScale;
            const key = this.addGhost(shuffle.imageUrl, base, base, start, 0);
            if (key)
              this.shuffles.set(key, {
                key,
                base,
                start,
                duration: 660 * this.durationScale,
                side: index % 2 ? 1 : -1,
                index,
              });
          }
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

  private addGhost(
    image: string,
    from: TableCardPose,
    to: TableCardPose,
    at: number,
    delay: number,
    holdFor?: string,
    toImage?: string
  ): string | null {
    if (!this.layer) return null;
    const key = `depth-ghost-${this.serial++}`;
    const element = document.createElement('div');
    element.className = 'ptcgsim-card-ghost';
    element.dataset.depthCard = 'true';
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
      expires: at + delay + Math.max(duration, 720 * this.durationScale),
      start: at + delay,
      duration,
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
    const start = at + flight.delay * 1000 * this.durationScale;
    this.flips.set(key, {
      image,
      face,
      start,
      duration: Math.min(duration, 320 * this.durationScale),
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

  private paint(key: string, pose: TableCardPose) {
    const projection = this.projection;
    const element = this.elements.get(key) ?? this.ghosts.get(key)?.element;
    if (!projection || !element) return;
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
        card ? (projection.pileCounts.get(card.id) ?? 1) : 1
      );
      geometry
        .querySelector('[data-depth-side]')
        ?.setAttribute('d', edges.sides);
      geometry
        .querySelector('[data-depth-lines]')
        ?.setAttribute('d', edges.lines);
      const shadow = geometry.querySelector<SVGPathElement>(
        '[data-depth-shadow]'
      );
      shadow?.setAttribute('d', edges.shadow);
      if (shadow)
        shadow.style.filter =
          pose.elevation - pose.thickness > 2
            ? `blur(${Math.min(5, 1.2 + Math.max(0, pose.elevation - pose.thickness) * 0.075)}px)`
            : 'none';
    }
    if (card)
      for (const marker of projection.scene.markers) {
        if (marker.parentCardId !== card.id) continue;
        const painted = projection.marker(marker, pose);
        const node = this.markers.get(marker.id);
        if (node) {
          node.style.left = `${painted.bounds.x}px`;
          node.style.top = `${painted.bounds.y}px`;
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
    for (const [key, pose] of this.motion.sampleAll(at)) this.paint(key, pose);
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
      flip.face.style.transform = `scaleX(${0.04 + 0.96 * Math.abs(Math.cos(progress * Math.PI))})`;
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
      else if (!ghost.holdFor && !this.shuffles.has(key))
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
    for (const key of this.ghosts.keys()) this.removeGhost(key);
    this.shuffles.clear();
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
