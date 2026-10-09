import {
  SPRING_PRESETS,
  planBoardMotion,
  springSettleTime,
  springStateAt,
  type BoardScene,
  type BoardSceneMotion,
  type CardFlight,
  type CardGhost,
  type MarkerPulse,
  type PileShuffle,
  type Rect,
  type SpringConfig,
} from '@ptcgsim/renderer-contract';

/** Where a painted card was last drawn, including a drag or settle hold. */
export interface PaintedCard {
  readonly rect: Rect;
  readonly rotationQuarterTurns: number;
}

export interface BoardMotionSettings {
  readonly reduced: boolean;
  /** Duration multiplier; 0 jumps straight to the end. */
  readonly durationScale: number;
}

interface Flight {
  readonly element: HTMLElement;
  readonly animation: Animation;
  readonly spring: SpringConfig;
  /** Offset of the card centre from its target centre at the start. */
  readonly x0: number;
  readonly y0: number;
  readonly vx0: number;
  readonly vy0: number;
  readonly scale0: number;
  readonly delaySeconds: number;
  readonly targetCenterX: number;
  readonly targetCenterY: number;
  readonly startedAt: number;
  readonly durationScale: number;
  readonly finished: Promise<void>;
}

const centerOf = (rect: Rect) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

/** The shortest turn from one quarter-turn count to another, in degrees. */
const turnBetween = (from: number, to: number): number => {
  const delta = ((((to - from) % 4) + 4) % 4) * 90;
  return delta > 180 ? delta - 360 : delta;
};

const springFor = (
  cause: BoardSceneMotion['cause'],
  kind: CardFlight['kind'] | 'ghost'
): SpringConfig => {
  if (cause === 'rollback') return SPRING_PRESETS.settle;
  if (cause === 'predict') return SPRING_PRESETS.snappy;
  return kind === 'move' ? SPRING_PRESETS.snappy : SPRING_PRESETS.gentle;
};

const now = (): number =>
  typeof document !== 'undefined' &&
  typeof document.timeline?.currentTime === 'number'
    ? document.timeline.currentTime
    : performance.now();

/** Scene seconds elapsed in a flight, accounting for its delay and speed. */
const flightTime = (flight: Flight, at: number): number => {
  const elapsed = (at - flight.startedAt) / 1000;
  const scaled =
    flight.durationScale > 0 ? elapsed / flight.durationScale : Infinity;
  return Math.max(0, scaled - flight.delaySeconds);
};

const canAnimate = (element: Element): element is HTMLElement =>
  typeof (element as HTMLElement).animate === 'function';

/**
 * Runs the planner's flights on the compositor. Geometry comes from the
 * scene, never from layout reads. Each animation only says where a card
 * *was*: its keyframes end at no offset and it never fills forwards, so the
 * React-owned rect is always the true resting place.
 */
export class BoardMotionDirector {
  private readonly elements = new Map<string, HTMLElement>();
  private readonly flights = new Map<string, Flight>();
  private readonly painted = new Map<string, PaintedCard>();
  private readonly releases = new Map<
    string,
    { readonly vx: number; readonly vy: number; readonly at: number }
  >();
  private readonly ghosts = new Set<HTMLElement>();
  private readonly extras = new Set<Animation>();
  private ghostLayer: HTMLElement | null = null;
  private surface: HTMLElement | null = null;
  private settings: BoardMotionSettings = { reduced: false, durationScale: 1 };
  private wasActive = false;
  /** Told whenever the table starts or stops moving on its own. */
  onActivity: ((active: boolean) => void) | null = null;

  /**
   * Ref callback for a painted card. Detaching does not stop its flight:
   * React's development StrictMode detaches and re-attaches a newly mounted
   * card's ref straight after its first commit, and a card that really leaves
   * the page takes its animation with it (it then finishes unseen).
   */
  readonly register = (renderKey: string, element: HTMLElement | null) => {
    if (element) {
      this.elements.set(renderKey, element);
      return;
    }
    this.elements.delete(renderKey);
  };

  attach(surface: HTMLElement | null, ghostLayer: HTMLElement | null): void {
    this.surface = surface;
    this.ghostLayer = ghostLayer;
  }

  setSettings(settings: BoardMotionSettings): void {
    this.settings = settings;
    if (settings.reduced || settings.durationScale <= 0) this.cancelAll();
  }

  /** The card was let go with this velocity (scene px per second). */
  noteRelease(renderKey: string, vx: number, vy: number): void {
    this.releases.set(renderKey, { vx, vy, at: now() });
  }

  /** True while any card is travelling, turning, popping or ghosting. */
  get active(): boolean {
    return (
      this.flights.size > 0 || this.ghosts.size > 0 || this.extras.size > 0
    );
  }

  private notify(): void {
    const active = this.active;
    if (active === this.wasActive) return;
    this.wasActive = active;
    this.onActivity?.(active);
  }

  /**
   * Called once per renderer commit with the scene before and after it and
   * where every painted card ended up being drawn.
   */
  commit(
    previous: BoardScene | null,
    next: BoardScene,
    motion: BoardSceneMotion | undefined,
    painted: ReadonlyMap<string, PaintedCard>,
    held: ReadonlySet<string>
  ): void {
    const lastPainted = new Map(this.painted);
    this.painted.clear();
    for (const [key, card] of painted) this.painted.set(key, card);
    if (!motion || !previous || previous === next) return;
    const cause = motion.cause;
    if (cause === 'replace' || cause === 'layout') {
      this.cancelAll();
      return;
    }
    if (this.settings.durationScale <= 0) return;
    if (cause === 'flip') {
      this.cancelAll();
      this.turnTable();
      return;
    }
    const plan = planBoardMotion(previous, next, cause);
    const at = now();
    for (const flight of plan.flights) {
      if (held.has(flight.renderKey)) {
        this.stopFlight(flight.renderKey);
        continue;
      }
      this.startFlight(flight, cause, lastPainted, next, at);
    }
    for (const ghost of plan.ghosts) this.startGhost(ghost, cause);
    for (const pulse of plan.pulses) this.pulse(pulse);
    for (const shuffle of plan.shuffles) this.riffle(shuffle);
  }

  cancelAll(): void {
    for (const key of [...this.flights.keys()]) this.stopFlight(key);
    for (const animation of this.extras) animation.cancel();
    this.extras.clear();
    for (const ghost of this.ghosts) ghost.remove();
    this.ghosts.clear();
    this.releases.clear();
    this.notify();
  }

  /**
   * Stops everything and lets go of the DOM. Reversible: React's development
   * StrictMode tears effects down and runs them again on mount, after which
   * `attach` and `register` hand the elements back.
   */
  destroy(): void {
    this.cancelAll();
    this.painted.clear();
    this.surface = null;
    this.ghostLayer = null;
  }

  private stopFlight(renderKey: string): void {
    const flight = this.flights.get(renderKey);
    if (!flight) return;
    this.flights.delete(renderKey);
    flight.animation.cancel();
    delete flight.element.dataset.flying;
    this.notify();
  }

  /** Where a travelling card is drawn right now, relative to its target. */
  private sample(flight: Flight, at: number) {
    const t = flightTime(flight, at);
    const x = springStateAt(flight.spring, flight.x0, flight.vx0, t);
    const y = springStateAt(flight.spring, flight.y0, flight.vy0, t);
    const s = springStateAt(flight.spring, 1, 0, t).displacement;
    return {
      x: x.displacement,
      y: y.displacement,
      vx: x.velocity,
      vy: y.velocity,
      scale: 1 + (flight.scale0 - 1) * s,
    };
  }

  private startFlight(
    planned: CardFlight,
    cause: BoardSceneMotion['cause'],
    lastPainted: ReadonlyMap<string, PaintedCard>,
    next: BoardScene,
    at: number
  ): void {
    const element = this.elements.get(planned.renderKey);
    const target = next.cards.find(
      (card) => card.renderKey === planned.renderKey
    );
    if (!element || !target || !canAnimate(element)) return;
    const reduced = this.settings.reduced;
    if (reduced) {
      this.stopFlight(planned.renderKey);
      if (planned.kind !== 'move') {
        this.track(
          element.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 150,
            easing: 'ease-out',
          })
        );
      }
      return;
    }
    const to = centerOf(target.bounds);
    const running = this.flights.get(planned.renderKey);
    // Where the card is drawn now: mid-flight, held where it was dropped, or
    // where the planner says it was.
    let fromX: number;
    let fromY: number;
    let vx = 0;
    let vy = 0;
    let scale0 =
      planned.kind === 'appear'
        ? 0.6
        : planned.from.width / Math.max(1, target.bounds.width);
    if (running) {
      const live = this.sample(running, at);
      fromX = running.targetCenterX + live.x;
      fromY = running.targetCenterY + live.y;
      vx = live.vx;
      vy = live.vy;
      scale0 = live.scale;
    } else {
      const visual =
        planned.kind === 'move' ? lastPainted.get(planned.renderKey) : null;
      const from = centerOf(visual?.rect ?? planned.from);
      fromX = from.x;
      fromY = from.y;
    }
    const release = this.releases.get(planned.renderKey);
    if (release && at - release.at < 250) {
      vx = release.vx;
      vy = release.vy;
    }
    this.releases.delete(planned.renderKey);
    const x0 = fromX - to.x;
    const y0 = fromY - to.y;
    this.stopFlight(planned.renderKey);
    if (
      Math.abs(x0) < 0.5 &&
      Math.abs(y0) < 0.5 &&
      Math.abs(scale0 - 1) < 0.01 &&
      planned.fromRotationQuarterTurns === target.rotationQuarterTurns &&
      !planned.fromImageUrl &&
      planned.kind !== 'appear'
    ) {
      return;
    }
    const spring = springFor(cause, planned.kind);
    const settle = Math.max(
      springSettleTime(spring, x0, vx, 0.5),
      springSettleTime(spring, y0, vy, 0.5),
      springSettleTime(spring, 1, 0, 0.004),
      0.12
    );
    const steps = Math.max(2, Math.ceil(settle * 60));
    const turn = turnBetween(
      planned.fromRotationQuarterTurns,
      target.rotationQuarterTurns
    );
    const baseTurn = target.rotationQuarterTurns * 90;
    const frames: Keyframe[] = [];
    for (let index = 0; index <= steps; index += 1) {
      const t = (settle * index) / steps;
      const last = index === steps;
      const x = last ? 0 : springStateAt(spring, x0, vx, t).displacement;
      const y = last ? 0 : springStateAt(spring, y0, vy, t).displacement;
      const progress = last ? 0 : springStateAt(spring, 1, 0, t).displacement;
      const frame: Keyframe = {
        translate: `${x.toFixed(2)}px ${y.toFixed(2)}px`,
        scale: String(1 + (scale0 - 1) * progress),
      };
      if (turn !== 0) {
        frame.transform = `rotate(${(baseTurn - turn * progress).toFixed(2)}deg)`;
      }
      frames.push(frame);
    }
    const durationScale = this.settings.durationScale;
    const delaySeconds = planned.delay;
    const animation = element.animate(frames, {
      duration: settle * 1000 * durationScale,
      delay: delaySeconds * 1000 * durationScale,
      easing: 'linear',
      fill: 'backwards',
    });
    element.dataset.flying = '';
    const flight: Flight = {
      element,
      animation,
      spring,
      x0,
      y0,
      vx0: vx,
      vy0: vy,
      scale0,
      delaySeconds,
      targetCenterX: to.x,
      targetCenterY: to.y,
      startedAt: at,
      durationScale,
      finished: animation.finished.then(
        () => undefined,
        () => undefined
      ),
    };
    this.flights.set(planned.renderKey, flight);
    this.notify();
    void flight.finished.then(() => {
      if (this.flights.get(planned.renderKey) !== flight) return;
      this.flights.delete(planned.renderKey);
      delete element.dataset.flying;
      this.notify();
    });
    if (planned.fromImageUrl) {
      this.turnOver(
        element,
        planned.fromImageUrl,
        settle * durationScale,
        delaySeconds * durationScale
      );
    }
  }

  /**
   * A squash-flip on the card face: it shows `fromImageUrl` until the card is
   * edge-on, then its real face.
   */
  private turnOver(
    element: HTMLElement,
    fromImageUrl: string,
    flightSeconds: number,
    delaySeconds: number
  ): void {
    const face = element.querySelector<HTMLElement>('.ptcgsim-card__face');
    if (!face || !canAnimate(face)) return;
    const overlay = document.createElement('img');
    overlay.className = 'ptcgsim-card__turn';
    overlay.alt = '';
    overlay.draggable = false;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.src = fromImageUrl;
    face.append(overlay);
    const duration = Math.min(0.42, Math.max(0.2, flightSeconds * 0.7)) * 1000;
    const delay = (delaySeconds + flightSeconds * 0.12) * 1000;
    const squash = face.animate(
      [
        { transform: 'scaleX(1)' },
        { transform: 'scaleX(0.04)', offset: 0.5 },
        { transform: 'scaleX(1)' },
      ],
      { duration, delay, easing: 'ease-in-out', fill: 'backwards' }
    );
    const swap = overlay.animate(
      [
        { opacity: 1 },
        { opacity: 1, offset: 0.5 },
        { opacity: 0, offset: 0.501 },
        { opacity: 0 },
      ],
      { duration, delay, fill: 'both' }
    );
    this.track(squash);
    this.track(swap);
    void swap.finished.then(
      () => overlay.remove(),
      () => overlay.remove()
    );
  }

  private startGhost(planned: CardGhost, cause: BoardSceneMotion['cause']) {
    const layer = this.ghostLayer;
    if (!layer || this.settings.reduced) return;
    const restRect = planned.to ?? planned.from;
    const ghost = document.createElement('div');
    ghost.className = 'ptcgsim-card-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, {
      position: 'absolute',
      left: `${restRect.x}px`,
      top: `${restRect.y}px`,
      width: `${restRect.width}px`,
      height: `${restRect.height}px`,
      transform: `rotate(${(planned.to ? planned.toRotationQuarterTurns : planned.fromRotationQuarterTurns) * 90}deg)`,
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    const face = document.createElement('div');
    face.className = 'ptcgsim-card__face';
    const image = document.createElement('img');
    image.alt = '';
    image.draggable = false;
    image.src = planned.imageUrl;
    face.append(image);
    ghost.append(face);
    layer.append(ghost);
    this.ghosts.add(ghost);
    this.notify();
    const remove = () => {
      ghost.remove();
      this.ghosts.delete(ghost);
      this.notify();
    };
    if (!canAnimate(ghost)) {
      remove();
      return;
    }
    const scale = this.settings.durationScale;
    if (planned.holdFor) {
      // Stay put until the incoming card lands on the pile.
      const flight = this.flights.get(planned.holdFor);
      if (!flight) {
        remove();
        return;
      }
      void flight.finished.then(remove);
      return;
    }
    if (!planned.to) {
      const fade = ghost.animate(
        [
          { opacity: 1, scale: '1' },
          { opacity: 0, scale: '0.92' },
        ],
        { duration: 180 * scale, easing: 'ease-in' }
      );
      void fade.finished.then(remove, remove);
      return;
    }
    const spring = springFor(cause, 'ghost');
    const from = centerOf(planned.from);
    const to = centerOf(planned.to);
    const x0 = from.x - to.x;
    const y0 = from.y - to.y;
    const scale0 = planned.from.width / Math.max(1, planned.to.width);
    const turn = turnBetween(
      planned.fromRotationQuarterTurns,
      planned.toRotationQuarterTurns
    );
    const settle = Math.max(
      springSettleTime(spring, x0, 0, 0.5),
      springSettleTime(spring, y0, 0, 0.5),
      0.12
    );
    const steps = Math.max(2, Math.ceil(settle * 60));
    const frames: Keyframe[] = [];
    for (let index = 0; index <= steps; index += 1) {
      const t = (settle * index) / steps;
      const last = index === steps;
      const progress = last ? 0 : springStateAt(spring, 1, 0, t).displacement;
      const x = last ? 0 : springStateAt(spring, x0, 0, t).displacement;
      const y = last ? 0 : springStateAt(spring, y0, 0, t).displacement;
      frames.push({
        translate: `${x.toFixed(2)}px ${y.toFixed(2)}px`,
        scale: String(1 + (scale0 - 1) * progress),
        transform: `rotate(${(planned.toRotationQuarterTurns * 90 - turn * progress).toFixed(2)}deg)`,
        // It sinks into the pile in the last part of the trip.
        opacity: index >= steps - 1 ? 0 : 1,
      });
    }
    const animation = ghost.animate(frames, {
      duration: settle * 1000 * scale,
      delay: planned.delay * 1000 * scale,
      easing: 'linear',
      fill: 'both',
    });
    if (planned.toImageUrl) {
      this.turnOver(
        ghost,
        planned.imageUrl,
        settle * scale,
        planned.delay * scale
      );
      image.src = planned.toImageUrl;
    }
    void animation.finished.then(remove, remove);
  }

  private pulse(pulse: MarkerPulse): void {
    const marker = this.surface?.querySelector<HTMLElement>(
      `[data-marker-id="${CSS.escape(pulse.markerId)}"]`
    );
    if (!marker || !canAnimate(marker)) return;
    if (this.settings.reduced) {
      this.track(
        marker.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 200 })
      );
      return;
    }
    const spring = SPRING_PRESETS.bouncy;
    const settle = Math.max(springSettleTime(spring, 1, 0, 0.004), 0.2);
    const steps = Math.ceil(settle * 60);
    const frames: Keyframe[] = [];
    for (let index = 0; index <= steps; index += 1) {
      const t = (settle * index) / steps;
      const offset =
        index === steps ? 0 : springStateAt(spring, 1, 0, t).displacement;
      frames.push({ scale: String(1 + 0.32 * offset) });
    }
    this.track(
      marker.animate(frames, {
        duration: settle * 1000 * this.settings.durationScale,
        easing: 'linear',
      })
    );
  }

  /**
   * A riffle over a shuffled pile: two half-decks swing apart and interleave
   * back, drawn as short-lived copies of the pile's cover over the pile.
   */
  private riffle(shuffle: PileShuffle): void {
    const layer = this.ghostLayer;
    if (!layer || this.settings.reduced) return;
    const scale = this.settings.durationScale;
    const { rect } = shuffle;
    const spread = rect.width * 0.62;
    const lift = rect.height * 0.05;
    const halves = [
      { side: -1, cards: 2 },
      { side: 1, cards: 2 },
    ];
    halves.forEach(({ side, cards }, halfIndex) => {
      for (let index = 0; index < cards; index += 1) {
        const ghost = document.createElement('div');
        ghost.className = 'ptcgsim-card-ghost ptcgsim-card-ghost--riffle';
        ghost.setAttribute('aria-hidden', 'true');
        Object.assign(ghost.style, {
          position: 'absolute',
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          transform: `rotate(${shuffle.rotationQuarterTurns * 90}deg)`,
          pointerEvents: 'none',
        } satisfies Partial<CSSStyleDeclaration>);
        const face = document.createElement('div');
        face.className = 'ptcgsim-card__face';
        const image = document.createElement('img');
        image.alt = '';
        image.draggable = false;
        image.src = shuffle.imageUrl;
        face.append(image);
        ghost.append(face);
        layer.append(ghost);
        this.ghosts.add(ghost);
        this.notify();
        const remove = () => {
          ghost.remove();
          this.ghosts.delete(ghost);
          this.notify();
        };
        if (!canAnimate(ghost)) {
          remove();
          continue;
        }
        const out = side * spread * (0.7 + index * 0.3);
        const tilt = side * (5 + index * 2);
        // The halves interleave: cards from each side land alternately.
        const landing = 0.62 + (index * 2 + halfIndex) * 0.07;
        const animation = ghost.animate(
          [
            { translate: '0px 0px', rotate: '0deg', offset: 0 },
            {
              translate: `${out.toFixed(1)}px ${(-lift).toFixed(1)}px`,
              rotate: `${tilt}deg`,
              offset: 0.32,
            },
            {
              translate: `${(out * 0.35).toFixed(1)}px ${(-lift * 0.6).toFixed(1)}px`,
              rotate: `${tilt * 0.4}deg`,
              offset: Math.min(0.9, landing - 0.12),
            },
            {
              translate: '0px 0px',
              rotate: '0deg',
              offset: Math.min(0.97, landing),
            },
            { translate: '0px 0px', rotate: '0deg', offset: 1 },
          ],
          {
            duration: 680 * scale,
            delay: index * 30 * scale,
            easing: 'cubic-bezier(0.45, 0, 0.25, 1)',
            fill: 'backwards',
          }
        );
        void animation.finished.then(remove, remove);
      }
    });
  }

  /** The whole table turns around when the viewer flips the board. */
  private turnTable(): void {
    const surface = this.surface;
    if (!surface || !canAnimate(surface) || this.settings.reduced) return;
    this.track(
      surface.animate(
        [
          { rotate: '-180deg', scale: '1' },
          { rotate: '-90deg', scale: '0.62', offset: 0.5 },
          { rotate: '0deg', scale: '1' },
        ],
        {
          duration: 620 * this.settings.durationScale,
          easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
        }
      )
    );
  }

  private track(animation: Animation): void {
    this.extras.add(animation);
    this.notify();
    const done = () => {
      this.extras.delete(animation);
      this.notify();
    };
    void animation.finished.then(done, done);
  }
}
