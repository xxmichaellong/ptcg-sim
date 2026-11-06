import { t } from '@lingui/core/macro';

/**
 * The loading screen over the table (ADR-030). index.html paints it
 * (`#tableCurtain`) in the page's first frame, before any script has
 * loaded: the desk, the site's mark and name, and a progress bar at its
 * foot, as Magic Circle's boot screen has them. It stays down while the
 * table is put together underneath it: the lazy lobby, the board renderer,
 * the Solo room being made and connected, the room's board painting for the
 * first time. Then the bar fills and it fades away, once. The swaps
 * underneath -- the empty stand-in table giving way to the room's -- are
 * never seen, so the table appears exactly once rather than appearing,
 * vanishing and coming back.
 *
 * The bar is paced by an inline script in index.html from the time since
 * the page was asked for and the marks the app makes on the way
 * (`markTableLoad`); it never claims more than 97% until the table is
 * there, when `reveal` sweeps it to full and the curtain fades just after.
 *
 * Later, when the page trades one table for another (joining a room,
 * leaving one, Play online parking a Solo game), `handOff` draws it over the
 * old table first, makes the swap under it, and the new table lifts it.
 * That is travel, not a load (`data-mode="travel"`): no mark or name, and
 * the bar only sweeps, after a moment, as it can't say how far.
 *
 * It is only paint: it never takes the pointer, the keyboard or focus, so
 * nothing waits on it. Its fades follow the page's motion settings
 * (`--motion-scale`, page-motion.ts): under reduced motion or at "instant"
 * it goes at once, still, and a hand-off swaps the tables at once,
 * uncovered.
 */

export type TableCurtainState = 'covering' | 'arriving' | 'leaving' | 'gone';

export interface TableCurtain {
  readonly state: () => TableCurtainState;
  /** The table under it is ready to be seen: fade away. */
  readonly reveal: () => void;
  /** Gone at once, never faded: for pages that are not the table. */
  readonly drop: () => void;
  /**
   * Trades one table for another under the curtain: covers the old table,
   * then runs `swap`; the new table reveals. Without a curtain, or without
   * motion, `swap` runs at once.
   */
  readonly handOff: (swap: () => void) => void;
}

export const TABLE_CURTAIN_ID = 'tableCurtain';
/** Drawing over a table to trade it: quick, the player asked for it. */
export const CURTAIN_COVER_MS = 140;
/** Lifting off the table: slow enough to read as the table arriving. */
export const CURTAIN_REVEAL_MS = 320;
/**
 * At the end of a load, the bar is seen to fill before the curtain fades:
 * the fade waits this long (the bar's sweep, 360ms, eases out, so most of
 * it is done by then).
 */
export const CURTAIN_COMPLETE_MS = 180;
/** However the table fares, the page never stays behind it longer. */
export const CURTAIN_MAX_COVER_MS = 15_000;

interface CurtainTimers {
  readonly setTimeout: (handler: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface TableCurtainOptions {
  /** Where the page's motion settings are written (page-motion.ts). */
  readonly root?: HTMLElement;
  readonly maxCoverMs?: number;
  readonly timers?: CurtainTimers;
}

/**
 * The steps a page load reaches on the way to its table, which pace the
 * loading screen's bar (the inline script in index.html reads them):
 * `app` the app's own script running, `lobby` the table's screen mounted,
 * `room` a room connected.
 */
export type TableLoadStep = 'app' | 'lobby' | 'room';

/** Marks `step` of this page's load, the first time it is reached. */
export const markTableLoad = (step: TableLoadStep): void => {
  const name = `ptcgsim:load:${step}`;
  try {
    if (performance.getEntriesByName(name, 'mark').length > 0) return;
    performance.mark(name);
  } catch {
    // No User Timing (an old browser): the bar paces by time alone.
  }
};

const browserTimers: CurtainTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The page's duration multiplier: 0 under reduced motion and "instant". */
const motionScale = (root: HTMLElement): number => {
  if (root.dataset.motion === 'reduced') return 0;
  const raw = root.style.getPropertyValue('--motion-scale').trim();
  if (raw === '') return 1;
  const scale = Number(raw);
  return Number.isFinite(scale) && scale > 0 ? scale : 0;
};

const absentCurtain: TableCurtain = Object.freeze({
  state: () => 'gone' as const,
  reveal: () => undefined,
  drop: () => undefined,
  handOff: (swap: () => void) => swap(),
});

export const createTableCurtain = (
  element: HTMLElement | null,
  options: TableCurtainOptions = {}
): TableCurtain => {
  if (!element) return absentCurtain;
  const root = options.root ?? element.ownerDocument.documentElement;
  const timers = options.timers ?? browserTimers;
  const maxCoverMs = options.maxCoverMs ?? CURTAIN_MAX_COVER_MS;
  let state: TableCurtainState = element.hidden ? 'gone' : 'covering';
  // A page load (its bar measures how far) until the first table is seen;
  // from then on every cover is a trade of tables.
  const setMode = (mode: 'boot' | 'travel'): void => {
    element.dataset.mode = mode;
    if (mode === 'travel') {
      element.removeAttribute('data-complete');
      element.style.removeProperty('--table-curtain-progress');
      // Indeterminate: it sweeps, and claims no percent.
      element
        .querySelector('[role="progressbar"]')
        ?.removeAttribute('aria-valuenow');
    }
  };
  if (state === 'gone' || element.dataset.mode === 'travel') {
    setMode('travel');
  } else {
    setMode('boot');
  }
  let fade: unknown;
  let ceiling: unknown;
  let swaps: (() => void)[] = [];

  const enter = (
    next: TableCurtainState,
    durationMs = 0,
    delayMs = 0
  ): void => {
    // index.html can only say it in English; from here on it is said in
    // the page's language, each time it covers.
    if (next === 'covering' || next === 'arriving') {
      const label = element.querySelector('.table-curtain__label');
      if (label) label.textContent = t`Setting up the table…`;
    }
    state = next;
    element.style.setProperty('--table-curtain-fade', `${durationMs}ms`);
    element.style.setProperty('--table-curtain-delay', `${delayMs}ms`);
    element.dataset.state = next;
    element.hidden = next === 'gone';
    // Once a table has been seen, the next cover is a trade of tables.
    if (next === 'gone') setMode('travel');
  };
  /** A load's bar to full: the table is there. */
  const complete = (): void => {
    if (element.dataset.mode !== 'boot') return;
    element.style.setProperty('--table-curtain-progress', '1');
    element
      .querySelector('[role="progressbar"]')
      ?.setAttribute('aria-valuenow', '100');
    element.dataset.complete = '';
  };
  const stopFade = (): void => {
    if (fade === undefined) return;
    timers.clearTimeout(fade);
    fade = undefined;
  };
  const stopCeiling = (): void => {
    if (ceiling === undefined) return;
    timers.clearTimeout(ceiling);
    ceiling = undefined;
  };
  const runSwaps = (): void => {
    const pending = swaps;
    swaps = [];
    for (const swap of pending) swap();
  };

  const reveal = (): void => {
    // Still drawing over the old table: the one it waits for is not there.
    if (state !== 'covering') return;
    stopCeiling();
    const scale = motionScale(root);
    const durationMs = CURTAIN_REVEAL_MS * scale;
    // A load's bar fills first; a trade's sweeping bar just goes with it.
    const delayMs =
      element.dataset.mode === 'boot' ? CURTAIN_COMPLETE_MS * scale : 0;
    complete();
    if (durationMs === 0) {
      enter('gone');
      return;
    }
    enter('leaving', durationMs, delayMs);
    fade = timers.setTimeout(() => {
      fade = undefined;
      enter('gone');
    }, delayMs + durationMs);
  };

  const holdAtMost = (): void => {
    stopCeiling();
    ceiling = timers.setTimeout(() => {
      ceiling = undefined;
      if (state === 'arriving') {
        stopFade();
        enter('covering');
        runSwaps();
      }
      reveal();
    }, maxCoverMs);
  };

  const drop = (): void => {
    stopFade();
    stopCeiling();
    enter('gone');
    runSwaps();
  };

  const handOff = (swap: () => void): void => {
    if (state === 'covering') {
      // Already over the table (the page is still loading): swap under it.
      holdAtMost();
      swap();
      return;
    }
    if (state === 'arriving') {
      swaps.push(swap);
      return;
    }
    const durationMs = CURTAIN_COVER_MS * motionScale(root);
    if (
      durationMs === 0 ||
      element.ownerDocument.visibilityState === 'hidden'
    ) {
      swap();
      return;
    }
    stopFade();
    setMode('travel');
    if (state === 'gone') {
      // From transparent: shown at nothing, laid out, then faded in.
      enter('leaving');
      void element.offsetWidth;
    }
    swaps.push(swap);
    enter('arriving', durationMs);
    holdAtMost();
    fade = timers.setTimeout(() => {
      fade = undefined;
      enter('covering');
      runSwaps();
    }, durationMs);
  };

  if (state === 'covering') {
    enter('covering');
    holdAtMost();
  }
  return { state: () => state, reveal, drop, handOff };
};

const curtains = new WeakMap<HTMLElement, TableCurtain>();

/** The page's curtain, or one that does nothing where there is none. */
export const tableCurtain = (
  document: Document | undefined = globalThis.document
): TableCurtain => {
  const element = document?.getElementById(TABLE_CURTAIN_ID) ?? null;
  if (!element) return absentCurtain;
  let curtain = curtains.get(element);
  if (!curtain) {
    curtain = createTableCurtain(element);
    curtains.set(element, curtain);
  }
  return curtain;
};
