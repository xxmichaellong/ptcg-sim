/**
 * How much the table moves. Two settings, kept apart because they answer
 * different needs: "reduce motion" is an accessibility choice that defaults to
 * the operating system's, and "animation speed" is taste. Dragging is never
 * slowed or sped up by either; only what the table does on its own is.
 */
export type ReduceMotionChoice = 'system' | 'reduce' | 'full';
export type AnimationSpeed = 'relaxed' | 'normal' | 'fast' | 'instant';

export interface MotionSettings {
  readonly reduceMotion: ReduceMotionChoice;
  readonly animationSpeed: AnimationSpeed;
}

export interface MotionSnapshot extends MotionSettings {
  /** The operating system's `prefers-reduced-motion`. */
  readonly systemPrefersReduced: boolean;
  /** What the table should actually do. */
  readonly reduced: boolean;
  /** Duration multiplier: larger is slower; 0 means jump to the end. */
  readonly durationScale: number;
}

export const DEFAULT_MOTION_SETTINGS: MotionSettings = {
  reduceMotion: 'system',
  animationSpeed: 'normal',
};

const DURATION_SCALE: Readonly<Record<AnimationSpeed, number>> = {
  relaxed: 1.35,
  normal: 1,
  fast: 0.6,
  instant: 0,
};

const STORAGE_KEY = 'ptcgsim.motion.v1';

const isChoice = (value: unknown): value is ReduceMotionChoice =>
  value === 'system' || value === 'reduce' || value === 'full';
const isSpeed = (value: unknown): value is AnimationSpeed =>
  value === 'relaxed' ||
  value === 'normal' ||
  value === 'fast' ||
  value === 'instant';

export const parseMotionSettings = (value: unknown): MotionSettings => {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_MOTION_SETTINGS;
  }
  const reduceMotion = Reflect.get(value, 'reduceMotion');
  const animationSpeed = Reflect.get(value, 'animationSpeed');
  return {
    reduceMotion: isChoice(reduceMotion)
      ? reduceMotion
      : DEFAULT_MOTION_SETTINGS.reduceMotion,
    animationSpeed: isSpeed(animationSpeed)
      ? animationSpeed
      : DEFAULT_MOTION_SETTINGS.animationSpeed,
  };
};

export const resolveMotion = (
  settings: MotionSettings,
  systemPrefersReduced: boolean
): MotionSnapshot => {
  const reduced =
    settings.reduceMotion === 'reduce' ||
    (settings.reduceMotion === 'system' && systemPrefersReduced);
  return {
    ...settings,
    systemPrefersReduced,
    reduced,
    durationScale: DURATION_SCALE[settings.animationSpeed],
  };
};

export interface MotionSettingsEnvironment {
  readonly matchMedia?: (query: string) => {
    readonly matches: boolean;
    addEventListener?(type: 'change', listener: () => void): void;
    removeEventListener?(type: 'change', listener: () => void): void;
  };
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

const browserEnvironment = (): MotionSettingsEnvironment => {
  let storage: MotionSettingsEnvironment['storage'];
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    // Reading localStorage throws where site data is blocked.
    storage = null;
  }
  return {
    ...(typeof globalThis.matchMedia === 'function'
      ? { matchMedia: (query: string) => globalThis.matchMedia(query) }
      : {}),
    storage,
  };
};

/**
 * One store per page. It follows the operating system setting live and keeps
 * the player's own choices in local storage (best effort: a private window
 * simply forgets them).
 */
export class MotionSettingsStore {
  private settings: MotionSettings;
  private systemPrefersReduced: boolean;
  private snapshot: MotionSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly detach: () => void;

  constructor(private readonly environment = browserEnvironment()) {
    this.settings = this.load();
    const query = environment.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.systemPrefersReduced = query?.matches ?? false;
    this.snapshot = resolveMotion(this.settings, this.systemPrefersReduced);
    const onChange = () => {
      const next = query?.matches ?? false;
      if (next === this.systemPrefersReduced) return;
      this.systemPrefersReduced = next;
      this.publish();
    };
    query?.addEventListener?.('change', onChange);
    this.detach = () => query?.removeEventListener?.('change', onChange);
  }

  getSnapshot = (): MotionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A boolean view for consumers that only need "animate or not". */
  readonly reducedMotion = {
    getSnapshot: (): boolean => this.snapshot.reduced,
    subscribe: (listener: () => void): (() => void) => this.subscribe(listener),
  };

  update(patch: Partial<MotionSettings>): void {
    const next = parseMotionSettings({ ...this.settings, ...patch });
    if (
      next.reduceMotion === this.settings.reduceMotion &&
      next.animationSpeed === this.settings.animationSpeed
    ) {
      return;
    }
    this.settings = next;
    try {
      this.environment.storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be full or blocked; the choice still applies this visit.
    }
    this.publish();
  }

  dispose(): void {
    this.detach();
    this.listeners.clear();
  }

  private load(): MotionSettings {
    try {
      const raw = this.environment.storage?.getItem(STORAGE_KEY);
      return raw
        ? parseMotionSettings(JSON.parse(raw))
        : DEFAULT_MOTION_SETTINGS;
    } catch {
      return DEFAULT_MOTION_SETTINGS;
    }
  }

  private publish(): void {
    this.snapshot = resolveMotion(this.settings, this.systemPrefersReduced);
    for (const listener of this.listeners) listener();
  }
}

let pageStore: MotionSettingsStore | undefined;

/** The page's shared motion settings. */
export const motionSettings = (): MotionSettingsStore => {
  pageStore ??= new MotionSettingsStore();
  return pageStore;
};
