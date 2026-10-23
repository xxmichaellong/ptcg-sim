import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { GraduationCapIcon } from '@phosphor-icons/react/dist/csr/GraduationCap';
import { HandPointingIcon } from '@phosphor-icons/react/dist/csr/HandPointing';
import { ListIcon } from '@phosphor-icons/react/dist/csr/List';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import type { MatchViewState } from '@ptcgsim/game-core';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

import { useHotkeyHints } from '../hotkeys/hotkey-preferences.js';
import { motionSettings } from '../motion/motion-settings.js';
import { preferences } from '../preferences/preference-store.js';
import { usePreference } from '../preferences/usePreference.js';
import { COARSE_POINTER_QUERY, useMediaQuery } from '../ui/breakpoints.js';
import { TUTORIAL_IMAGE_URLS } from './tutorial-cards.js';
import {
  lessonsFor,
  type TutorialLesson,
  type TutorialStep,
} from './tutorial-lessons.js';
import {
  dealScenario,
  tutorialSeats,
  type ScenarioSession,
} from './scenario-runner.js';
import { setTutorialActive, TUTORIAL_PREFERENCES } from './tutorial-state.js';
import {
  readScreen,
  sameScreen,
  type InputMode,
  type TutorialScreen,
  type TutorialWorld,
} from './tutorial-world.js';
import {
  TutorialSpotlight,
  useTargetRects,
  type ScreenRect,
} from './TutorialSpotlight.js';
import './tutorial.css';

const decorative = { 'aria-hidden': true, focusable: false } as const;

/** What the host needs of the practice room. */
export interface TutorialRoom {
  readonly session: ScenarioSession;
  readonly presentation: {
    readonly activityFeed: {
      readonly subscribe: (listener: () => void) => () => void;
      readonly getSnapshot: () => {
        readonly items: readonly {
          readonly id: number;
          readonly eventType: string;
          readonly playerId?: string;
        }[];
        readonly newestItemId: number | null;
      };
    };
    readonly clearActivity: () => boolean;
  };
}

/** The hand at the table: a finger, or a mouse and keys; the last one used wins. */
export const useInputMode = (): InputMode => {
  const coarse = useMediaQuery(COARSE_POINTER_QUERY);
  const [last, setLast] = useState<InputMode | null>(null);
  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      setLast(event.pointerType === 'touch' ? 'touch' : 'mouse');
    };
    window.addEventListener('pointerdown', onPointer, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener('pointerdown', onPointer, { capture: true });
  }, []);
  return last ?? (coarse ? 'touch' : 'mouse');
};

const useReducedMotion = (): boolean =>
  useSyncExternalStore(
    motionSettings().subscribe,
    () => motionSettings().getSnapshot().reduced,
    () => false
  );

/** The page's open things, read again whenever the page changes. */
const useScreen = (): TutorialScreen => {
  const [screen, setScreen] = useState<TutorialScreen>(() =>
    readScreen(document)
  );
  useEffect(() => {
    let frame = 0;
    let last = readScreen(document);
    const read = (): void => {
      frame = 0;
      const next = readScreen(document);
      if (!sameScreen(next, last)) {
        last = next;
        setScreen(next);
      }
    };
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(read);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-open',
        'data-context-card-id',
        'data-marker-controls',
        'data-zone-browser-kind',
      ],
    });
    read();
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);
  return screen;
};

/** Warms the practice cards' scans so the first lesson shows them at once. */
const warmTutorialImages = (): void => {
  for (const url of TUTORIAL_IMAGE_URLS) {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
  }
};

type Phase =
  | { readonly kind: 'lessons' }
  | {
      readonly kind: 'dealing';
      readonly lesson: TutorialLesson;
      /** Counts starts, so starting the same lesson again deals again. */
      readonly attempt: number;
    }
  | {
      readonly kind: 'failed';
      readonly lesson: TutorialLesson;
    }
  | {
      readonly kind: 'playing';
      readonly lesson: TutorialLesson;
      readonly step: number;
      /** The table and the log as the step began. */
      readonly start: MatchViewState;
      readonly feedFrom: number;
      /** The step just finished: shown done a moment before the next. */
      readonly done: boolean;
      /**
       * Reached by Back: the step counts only once the table has shown it
       * undone, or it would tick and go straight on again.
       */
      readonly rearm?: boolean;
      /**
       * The table and the log the moment this step was done: the next step
       * starts from them, so what the player does in the done moment counts
       * toward it.
       */
      readonly doneAt?: {
        readonly start: MatchViewState;
        readonly feedFrom: number;
      };
    }
  | { readonly kind: 'finished'; readonly lesson: TutorialLesson };

/** How long a finished step shows its tick before the next. */
const STEP_DONE_MS = 650;

/**
 * Tutorial mode (ADR-038): the practice table's coach. It opens on the
 * list of lessons (or straight into one asked for), deals each lesson's
 * position with the room's own commands, then walks its steps: one line to
 * do at a time, the thing to touch lit, a drag shown, each step done the
 * moment the table shows it. Nothing here blocks the table; the player can
 * do anything, and leave from the coach's X.
 */
export const TutorialHost = ({
  room,
  lesson: askedLesson,
  serial,
  flipped,
  flipBoard,
  onExit,
}: {
  readonly room: TutorialRoom;
  /** A lesson asked for; absent, the list. */
  readonly lesson?: string;
  /** Counts each request, so asking again for the same lesson restarts it. */
  readonly serial?: number;
  readonly flipped: boolean;
  readonly flipBoard: () => void;
  readonly onExit: () => void;
}) => {
  const { t, i18n } = useLingui();
  const mode = useInputMode();
  const keys = useHotkeyHints();
  const reducedMotion = useReducedMotion();
  const screen = useScreen();
  const progress = usePreference(TUTORIAL_PREFERENCES);
  const lessons = useMemo(() => lessonsFor(mode), [mode]);
  const [phase, setPhase] = useState<Phase>({ kind: 'lessons' });
  const session = room.session;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const feed = useSyncExternalStore(
    room.presentation.activityFeed.subscribe,
    room.presentation.activityFeed.getSnapshot
  );
  const [demo, setDemo] = useState(0);
  const flippedRef = useRef(flipped);
  flippedRef.current = flipped;
  // The route passes a fresh function each render; the deal must not restart.
  const flipBoardRef = useRef(flipBoard);
  flipBoardRef.current = flipBoard;

  useEffect(() => {
    setTutorialActive(true);
    warmTutorialImages();
    return () => {
      setTutorialActive(false);
    };
  }, []);

  const isDone = useCallback(
    (lesson: TutorialLesson): boolean =>
      (progress.completed[lesson.id] ?? 0) >= lesson.version,
    [progress]
  );

  // Each start (or try again) of a lesson deals its position afresh.
  const attempts = useRef(0);
  const begin = useCallback((lesson: TutorialLesson): void => {
    attempts.current += 1;
    setPhase({ kind: 'dealing', lesson, attempt: attempts.current });
  }, []);

  // The deal belongs to the dealing phase: a remount (or StrictMode's
  // rehearsal of one) aborts it and deals again, so it never stalls.
  const dealingPhase = phase.kind === 'dealing' ? phase : null;
  useEffect(() => {
    if (!dealingPhase) return;
    const { lesson } = dealingPhase;
    const abort = new AbortController();
    // Every lesson is played from its own seat, at the bottom.
    if (flippedRef.current) flipBoardRef.current();
    const settled = new Promise<void>((resolve) => setTimeout(resolve, 600));
    void dealScenario(session, lesson.scenario, abort.signal)
      .then(() => settled)
      .then(
        () => {
          if (abort.signal.aborted) return;
          // The deal's own moves are not the lesson's: the log starts clean.
          room.presentation.clearActivity();
          const view = session.getSnapshot().view;
          if (!view) {
            setPhase({ kind: 'failed', lesson });
            return;
          }
          setPhase({
            kind: 'playing',
            lesson,
            step: 0,
            start: view,
            feedFrom:
              room.presentation.activityFeed.getSnapshot().newestItemId ?? -1,
            done: false,
          });
        },
        () => {
          if (!abort.signal.aborted) setPhase({ kind: 'failed', lesson });
        }
      );
    return () => abort.abort();
  }, [dealingPhase, room.presentation, session]);

  // A lesson asked for by name (the palette, a link) starts at once.
  const askedRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (askedLesson === undefined || state.phase !== 'ready' || !state.view)
      return;
    if (askedRef.current === serial) return;
    askedRef.current = serial;
    const lesson = lessons.find((candidate) => candidate.id === askedLesson);
    if (lesson) begin(lesson);
  }, [askedLesson, serial, lessons, begin, state.phase, state.view]);

  const playing = phase.kind === 'playing' ? phase : null;
  const step: TutorialStep | null = playing
    ? (playing.lesson.steps[playing.step] ?? null)
    : null;
  const world = useMemo((): TutorialWorld | null => {
    if (!playing || !state.view) return null;
    let seats;
    try {
      seats = tutorialSeats(state.view);
    } catch {
      return null;
    }
    return {
      view: state.view,
      start: playing.start,
      you: seats.you,
      them: seats.them,
      mode,
      events: feed.items
        .filter((item) => item.id > playing.feedFrom)
        .map((item) => ({
          type: item.eventType,
          ...(item.playerId ? { playerId: item.playerId } : {}),
        })),
      flipped,
      screen,
      keys,
    };
  }, [playing, state.view, mode, feed, flipped, screen, keys]);

  // A lesson finished is kept as done on this device. Written once the
  // phase has changed, never from inside its update: the write tells every
  // reader of the progress at once, and React must not hear it mid-render.
  const finishedLesson = phase.kind === 'finished' ? phase.lesson : null;
  useEffect(() => {
    if (!finishedLesson) return;
    preferences().patch(TUTORIAL_PREFERENCES, {
      completed: {
        ...preferences().get(TUTORIAL_PREFERENCES).completed,
        [finishedLesson.id]: finishedLesson.version,
      },
    });
  }, [finishedLesson]);

  const advance = useCallback((): void => {
    setPhase((current) => {
      if (current.kind !== 'playing') return current;
      const next = current.step + 1;
      if (next >= current.lesson.steps.length) {
        return { kind: 'finished', lesson: current.lesson };
      }
      // From where the step was done, or (Next, Skip) from now.
      const from = (current.done ? current.doneAt : undefined) ?? {
        start: session.getSnapshot().view ?? current.start,
        feedFrom:
          room.presentation.activityFeed.getSnapshot().newestItemId ?? -1,
      };
      return {
        kind: 'playing',
        lesson: current.lesson,
        step: next,
        start: from.start,
        feedFrom: from.feedFrom,
        done: false,
      };
    });
    setDemo(0);
  }, [room.presentation, session]);

  const back = (): void => {
    setPhase((current) =>
      current.kind === 'playing' && current.step > 0
        ? {
            kind: 'playing',
            lesson: current.lesson,
            step: current.step - 1,
            start: session.getSnapshot().view ?? current.start,
            feedFrom:
              room.presentation.activityFeed.getSnapshot().newestItemId ?? -1,
            done: false,
            rearm: true,
          }
        : current
    );
  };

  // A step is done the moment the table shows it.
  const stepDone = Boolean(step?.done && world && step.done(world));
  useEffect(() => {
    if (!playing || playing.done) return;
    if (playing.rearm) {
      if (!stepDone) setPhase({ ...playing, rearm: false });
      return;
    }
    if (stepDone) {
      setPhase({
        ...playing,
        done: true,
        doneAt: {
          start: session.getSnapshot().view ?? playing.start,
          feedFrom:
            room.presentation.activityFeed.getSnapshot().newestItemId ?? -1,
        },
      });
    }
  }, [playing, stepDone, room.presentation, session]);
  useEffect(() => {
    if (!playing?.done) return;
    const timer = setTimeout(advance, STEP_DONE_MS);
    return () => clearTimeout(timer);
  }, [playing?.done, playing?.step, advance]);

  const stuck = step?.stuck && world && !stepDone ? step.stuck(world) : null;
  const targets = useMemo(
    () => (step?.targets && world ? step.targets(world) : []),
    [step, world]
  );
  const drag = useMemo(
    () => (step?.drag && world ? step.drag(world) : null),
    [step, world]
  );
  // Out of the way of the deck screen and sheets, and the coach while the
  // practice table reconnects (the lesson waits, as it was). The coach is
  // read over the command palette; the list and the other cards are not.
  const covered = screen.deckScreen || screen.sheet;
  const hidden = covered || state.phase !== 'ready';
  // The lesson list and the deal's card also step aside while the practice
  // table reconnects or has failed: its own banner (Reconnect) shows then.
  const overlaysHidden = covered || screen.palette || state.phase !== 'ready';
  const announcement = playing?.done
    ? t`Done`
    : playing && step && world && !hidden
      ? step.text(world)
      : null;
  const paletteAnnouncer = screen.palette
    ? document.querySelector<HTMLElement>('[data-palette-announcer]')
    : null;
  // The region it is read from changes as the palette opens or closes: the
  // other starts silent on what the first was reading, so the step it
  // already read (or the one the palette opening has just finished) isn't
  // read again, and speaks from the next change on -- a step coming back
  // later (Back, the lesson again) is read as any.
  const spokenKey = playing
    ? `${playing.lesson.id}:${String(playing.step)}:${playing.done ? 'done' : ''}:${hidden ? 'hidden' : ''}`
    : '';
  const region = paletteAnnouncer ? 'palette' : 'table';
  const regionWas = useRef(region);
  const silentFor = useRef<string | null>(null);
  const heard = useRef<string | null>(null);
  if (regionWas.current !== region) {
    regionWas.current = region;
    silentFor.current = heard.current === spokenKey ? spokenKey : null;
  } else if (silentFor.current !== spokenKey) {
    silentFor.current = null;
  }
  heard.current = announcement !== null ? spokenKey : null;
  const spoken = silentFor.current === spokenKey ? null : announcement;
  // Measured through a step's done moment too, so the coach stays put.
  const measuring = Boolean(playing && !hidden);
  const rects = useTargetRects(targets, measuring);
  const dragRects = useTargetRects(
    drag ? [drag.from, drag.to] : [],
    measuring && drag !== null
  );
  const dragShown =
    drag && dragRects.length === 2
      ? { from: dragRects[0] ?? null, to: dragRects[1] ?? null }
      : null;

  // The hand shows a drag again whenever its step starts.
  const dragKey =
    drag && playing ? `${playing.lesson.id}:${String(playing.step)}` : '';
  useEffect(() => {
    if (dragKey !== '') setDemo((count) => count + 1);
  }, [dragKey]);

  const nextLesson = (after: TutorialLesson): TutorialLesson | undefined => {
    const index = lessons.indexOf(after);
    return (
      lessons.slice(index + 1).find((lesson) => !isDone(lesson)) ??
      lessons[index + 1]
    );
  };

  const firstUnfinished = lessons.find((lesson) => !isDone(lesson));
  const finishedCount = lessons.filter(isDone).length;

  return (
    <>
      {phase.kind === 'lessons' && !overlaysHidden ? (
        <LessonList
          lessons={lessons}
          isDone={isDone}
          finishedCount={finishedCount}
          suggested={firstUnfinished}
          onStart={begin}
          onExit={onExit}
        />
      ) : null}
      {(phase.kind === 'dealing' || phase.kind === 'failed') &&
      !overlaysHidden ? (
        <div className="tutorial-scrim" data-tutorial-dealing="true">
          <div className="tutorial-dealing" role="status">
            <span className="tutorial-dealing__title">
              {i18n._(phase.lesson.title)}
            </span>
            {phase.kind === 'dealing' ? (
              <>
                <span
                  className="tutorial-dealing__spinner"
                  aria-hidden="true"
                />
                <div className="tutorial-dealing__actions">
                  <button
                    type="button"
                    className="ds-button ds-button--ghost"
                    onClick={onExit}
                  >
                    <Trans>Leave tutorial</Trans>
                  </button>
                </div>
              </>
            ) : (
              <>
                <span>
                  <Trans>The practice table didn't answer.</Trans>
                </span>
                <div className="tutorial-dealing__actions">
                  <button
                    type="button"
                    className="ds-button ds-button--primary"
                    onClick={() => begin(phase.lesson)}
                  >
                    <ArrowClockwiseIcon {...decorative} weight="bold" />
                    <Trans>Try again</Trans>
                  </button>
                  <button
                    type="button"
                    className="ds-button ds-button--secondary"
                    onClick={onExit}
                  >
                    <Trans>Leave tutorial</Trans>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {playing && step && world && !hidden ? (
        <>
          <TutorialSpotlight
            rects={playing.done ? [] : rects}
            drag={playing.done ? null : dragShown}
            demo={demo}
            reducedMotion={reducedMotion}
          />
          <Coach
            lesson={playing.lesson}
            stepIndex={playing.step}
            step={step}
            world={world}
            done={playing.done}
            settled={playing.done || (stepDone && !playing.rearm)}
            stuck={stuck}
            paletteOpen={screen.palette}
            avoid={[
              ...rects,
              ...(dragShown ? [dragShown.from, dragShown.to] : []),
            ]}
            onBack={playing.step > 0 ? back : undefined}
            onNext={advance}
            onShowMe={drag ? () => setDemo((count) => count + 1) : undefined}
            onRestart={() => begin(playing.lesson)}
            onLessons={() => setPhase({ kind: 'lessons' })}
            onExit={onExit}
          />
        </>
      ) : null}
      {phase.kind === 'finished' && !overlaysHidden ? (
        <LessonDone
          lesson={phase.lesson}
          next={nextLesson(phase.lesson)}
          allDone={lessons.every(isDone)}
          onNext={begin}
          onLessons={() => setPhase({ kind: 'lessons' })}
          onExit={onExit}
        />
      ) : null}
      {/* Read out each step as it comes, and each done: one region that
          is always there, so the first step is read too. The palette is a
          modal window, past which a screen reader hears nothing: while it
          is open, its own region (there, empty, from its first frame) reads
          them out. */}
      <div className="ds-visually-hidden" role="status" aria-live="polite">
        {paletteAnnouncer ? null : spoken}
      </div>
      {paletteAnnouncer ? createPortal(spoken, paletteAnnouncer) : null}
    </>
  );
};

// ---- The coach ----------------------------------------------------------------

const COACH_GAP_PX = 12;

type Corner = 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right';

const overlaps = (a: ScreenRect, b: ScreenRect): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const overlapArea = (a: ScreenRect, b: ScreenRect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const screenRectOf = (selector: string): ScreenRect | undefined => {
  const rect = document.querySelector(selector)?.getBoundingClientRect();
  return rect
    ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    : undefined;
};

/**
 * Where the coach sits: the first corner that covers nothing the step
 * points at (nor the app bar, nor the open command palette); failing that,
 * the corner that covers least. On a phone it spans the width at the top
 * or the bottom, the bottom above the on-screen keyboard.
 */
export const placeCoach = (
  size: { readonly width: number; readonly height: number },
  avoid: readonly (ScreenRect | null)[],
  compact: boolean
): { readonly left: number; readonly top: number; readonly corner: Corner } => {
  const width = window.innerWidth;
  const viewport = window.visualViewport;
  const height = viewport
    ? Math.min(window.innerHeight, viewport.offsetTop + viewport.height)
    : window.innerHeight;
  const bar = screenRectOf('.ptcgsim-app-bar');
  const palette = screenRectOf('[data-command-palette]');
  const blockers = [
    ...avoid.filter((rect): rect is ScreenRect => rect !== null),
    ...(bar ? [bar] : []),
    ...(palette ? [palette] : []),
  ];
  const at = (corner: Corner) => {
    const left = corner.endsWith('left')
      ? COACH_GAP_PX
      : width - size.width - COACH_GAP_PX;
    const top = corner.startsWith('top')
      ? COACH_GAP_PX + (compact && bar ? bar.y + bar.height : 0)
      : height - size.height - COACH_GAP_PX;
    return { left, top, corner };
  };
  const corners: readonly Corner[] = compact
    ? ['top-left', 'bottom-left']
    : ['top-left', 'bottom-left', 'top-right', 'bottom-right'];
  let best = at(corners[0]!);
  let leastCovered = Number.POSITIVE_INFINITY;
  for (const corner of corners) {
    const place = at(corner);
    const box = { x: place.left, y: place.top, ...size };
    if (!blockers.some((rect) => overlaps(rect, box))) return place;
    const covered = blockers.reduce(
      (sum, rect) => sum + overlapArea(rect, box),
      0
    );
    if (covered < leastCovered) {
      leastCovered = covered;
      best = place;
    }
  }
  return best;
};

const Coach = ({
  lesson,
  stepIndex,
  step,
  world,
  done,
  settled,
  stuck,
  paletteOpen,
  avoid,
  onBack,
  onNext,
  onShowMe,
  onRestart,
  onLessons,
  onExit,
}: {
  readonly lesson: TutorialLesson;
  readonly stepIndex: number;
  readonly step: TutorialStep;
  readonly world: TutorialWorld;
  readonly done: boolean;
  /**
   * The table already shows the step (it is done, or about to be marked
   * so): the coach stays where it is, though what the step pointed at may
   * have just gone (a dragged card).
   */
  readonly settled: boolean;
  readonly stuck: ReactNode | null;
  /** The command palette is open: the coach keeps clear of it. */
  readonly paletteOpen: boolean;
  readonly avoid: readonly (ScreenRect | null)[];
  readonly onBack: (() => void) | undefined;
  readonly onNext: () => void;
  readonly onShowMe: (() => void) | undefined;
  readonly onRestart: () => void;
  readonly onLessons: () => void;
  readonly onExit: () => void;
}) => {
  const { t, i18n } = useLingui();
  const ref = useRef<HTMLDivElement>(null);
  const compact = useMediaQuery('(max-width: 599px)');
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    corner: Corner;
  }>({ left: COACH_GAP_PX, top: COACH_GAP_PX, corner: 'top-left' });
  const avoidRef = useRef(avoid);
  avoidRef.current = avoid;
  const avoidKey = JSON.stringify(avoid);
  // Through a step's done moment the coach stays put against what the step
  // pointed at, which may just have gone; it still takes its first place,
  // and moves off a palette that opens or a window that changes size.
  const placed = useRef(false);
  const paletteWas = useRef(paletteOpen);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const paletteMoved = paletteWas.current !== paletteOpen;
    paletteWas.current = paletteOpen;
    const hold = settled && placed.current && !paletteMoved;
    const measure = (): void => {
      placed.current = true;
      const next = placeCoach(
        { width: element.offsetWidth, height: element.offsetHeight },
        avoidRef.current,
        compact
      );
      setPlace((current) =>
        current.left === next.left &&
        current.top === next.top &&
        current.corner === next.corner
          ? current
          : next
      );
    };
    // The palette lays itself out a frame after it opens.
    const frame = hold ? 0 : requestAnimationFrame(measure);
    if (!hold) measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [avoidKey, compact, stepIndex, settled, paletteOpen]);
  // A lesson started from the list, or a step whose button went away under
  // the focus (Back to the first step, Skip while done): the coach has it
  // now. Focus elsewhere (the table, a card) stays.
  useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) {
      ref.current?.focus({ preventScroll: true });
    }
  }, [stepIndex, done]);
  const count = lesson.steps.length;
  const action = step.done === undefined;
  const titleId = `tutorialCoachTitle-${lesson.id}`;
  return (
    <div
      ref={ref}
      className="tutorial-coach"
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-tutorial-step={`${lesson.id}:${step.id}`}
      data-done={done ? 'true' : undefined}
      data-corner={place.corner}
      style={{ left: place.left, top: place.top }}
    >
      <div className="tutorial-coach__head">
        <GraduationCapIcon {...decorative} weight="fill" />
        <span id={titleId} className="tutorial-coach__lesson">
          {i18n._(lesson.title)}
        </span>
        <span className="tutorial-coach__count">
          {t({
            message: `${String(stepIndex + 1)} of ${String(count)}`,
            comment: 'The step of a tutorial lesson, like "2 of 4".',
          })}
        </span>
        <button
          type="button"
          className="ds-icon-button tutorial-coach__icon"
          aria-label={t`All lessons`}
          title={t`All lessons`}
          onClick={onLessons}
        >
          <ListIcon {...decorative} weight="bold" />
        </button>
        <button
          id="tutorialExitButton"
          type="button"
          className="ds-icon-button tutorial-coach__icon"
          aria-label={t`Leave tutorial`}
          title={t`Leave tutorial`}
          onClick={onExit}
        >
          <XIcon {...decorative} weight="bold" />
        </button>
      </div>
      <div className="tutorial-coach__progress" aria-hidden="true">
        <span
          style={{
            width: `${String(((stepIndex + (done ? 1 : 0)) / count) * 100)}%`,
          }}
        />
      </div>
      <p className="tutorial-coach__text">
        {done ? (
          <CheckCircleIcon
            {...decorative}
            weight="fill"
            className="tutorial-coach__tick"
          />
        ) : null}
        <span>{step.text(world)}</span>
      </p>
      {stuck ? (
        <p className="tutorial-coach__stuck">
          <span>{stuck}</span>
          <button type="button" className="ds-link" onClick={onRestart}>
            <Trans>Start the lesson over</Trans>
          </button>
        </p>
      ) : null}
      <div className="tutorial-coach__actions">
        {onBack ? (
          <button
            type="button"
            className="ds-button ds-button--ghost"
            onClick={onBack}
          >
            <Trans>Back</Trans>
          </button>
        ) : null}
        <span className="tutorial-coach__spacer" />
        {onShowMe && !done ? (
          <button
            type="button"
            className="ds-button ds-button--ghost"
            onClick={onShowMe}
          >
            <HandPointingIcon {...decorative} weight="bold" />
            <Trans>Show me</Trans>
          </button>
        ) : null}
        {action ? (
          <button
            type="button"
            className="ds-button ds-button--primary tutorial-coach__next"
            onClick={onNext}
          >
            {stepIndex + 1 === count ? (
              <Trans>Done</Trans>
            ) : (
              <Trans>Next</Trans>
            )}
          </button>
        ) : (
          <button
            type="button"
            className="ds-button ds-button--ghost tutorial-coach__skip"
            disabled={done}
            onClick={onNext}
          >
            {step.optional ? <Trans>Next</Trans> : <Trans>Skip</Trans>}
          </button>
        )}
      </div>
    </div>
  );
};

// ---- The list of lessons, and a lesson done ---------------------------------

const LessonList = ({
  lessons,
  isDone,
  finishedCount,
  suggested,
  onStart,
  onExit,
}: {
  readonly lessons: readonly TutorialLesson[];
  readonly isDone: (lesson: TutorialLesson) => boolean;
  readonly finishedCount: number;
  readonly suggested: TutorialLesson | undefined;
  readonly onStart: (lesson: TutorialLesson) => void;
  readonly onExit: () => void;
}) => {
  const { t, i18n } = useLingui();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="tutorial-scrim">
      <section
        className="tutorial-lessons"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tutorialLessonsTitle"
        data-tutorial-lessons="true"
      >
        <header className="tutorial-lessons__head">
          <GraduationCapIcon {...decorative} weight="fill" />
          <h2 id="tutorialLessonsTitle">
            <Trans>Tutorial</Trans>
          </h2>
          <span className="tutorial-lessons__count">
            {t({
              message: `${String(finishedCount)} of ${String(lessons.length)} done`,
              comment:
                'How many tutorial lessons are finished, like "3 of 10 done".',
            })}
          </span>
          <button
            type="button"
            className="ds-icon-button"
            aria-label={t`Leave tutorial`}
            title={t`Leave tutorial`}
            onClick={onExit}
          >
            <XIcon {...decorative} weight="bold" />
          </button>
        </header>
        <ol className="tutorial-lessons__list">
          {lessons.map((lesson, index) => {
            const done = isDone(lesson);
            return (
              <li key={lesson.id}>
                <button
                  ref={lesson === (suggested ?? lessons[0]) ? first : undefined}
                  type="button"
                  className="tutorial-lesson"
                  data-lesson={lesson.id}
                  data-done={done ? 'true' : undefined}
                  data-suggested={lesson === suggested ? 'true' : undefined}
                  onClick={() => onStart(lesson)}
                >
                  <span className="tutorial-lesson__mark" aria-hidden="true">
                    {done ? <CheckIcon weight="bold" /> : String(index + 1)}
                  </span>
                  <span className="tutorial-lesson__text">
                    <span className="tutorial-lesson__title">
                      {i18n._(lesson.title)}
                    </span>
                    <span className="tutorial-lesson__summary">
                      {i18n._(lesson.summary)}
                    </span>
                  </span>
                  {done ? (
                    <span className="ds-visually-hidden">
                      <Trans>Done</Trans>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
};

const LessonDone = ({
  lesson,
  next,
  allDone,
  onNext,
  onLessons,
  onExit,
}: {
  readonly lesson: TutorialLesson;
  readonly next: TutorialLesson | undefined;
  readonly allDone: boolean;
  readonly onNext: (lesson: TutorialLesson) => void;
  readonly onLessons: () => void;
  readonly onExit: () => void;
}) => {
  const { t, i18n } = useLingui();
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
  }, []);
  // Centred at the top, under the app bar where the two would meet (a
  // phone).
  const section = useRef<HTMLElement>(null);
  const [top, setTop] = useState<number>();
  useLayoutEffect(() => {
    const measure = (): void => {
      const element = section.current;
      const bar = screenRectOf('.ptcgsim-app-bar');
      if (!element || !bar) {
        setTop(undefined);
        return;
      }
      const width = element.offsetWidth;
      const left = (window.innerWidth - width) / 2;
      const box = { x: left, y: COACH_GAP_PX, width, height: 1 };
      setTop(
        overlaps(bar, { ...box, height: bar.y + bar.height })
          ? bar.y + bar.height + COACH_GAP_PX
          : undefined
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const title = i18n._(lesson.title);
  return (
    <section
      ref={section}
      className="tutorial-coach tutorial-coach--done"
      role="dialog"
      aria-modal="false"
      aria-labelledby="tutorialDoneTitle"
      data-tutorial-done={lesson.id}
      style={top === undefined ? undefined : { top }}
    >
      <div className="tutorial-done__head">
        <p className="tutorial-done__title" id="tutorialDoneTitle">
          <CheckCircleIcon {...decorative} weight="fill" />
          {allDone ? (
            <Trans>Tutorial complete. You're ready to play.</Trans>
          ) : (
            <Trans>{title}: done</Trans>
          )}
        </p>
        <button
          type="button"
          className="ds-icon-button tutorial-coach__icon"
          aria-label={t`Leave tutorial`}
          title={t`Leave tutorial`}
          onClick={onExit}
        >
          <XIcon {...decorative} weight="bold" />
        </button>
      </div>
      <div className="tutorial-coach__actions">
        <button
          type="button"
          className="ds-button ds-button--ghost"
          onClick={onLessons}
        >
          <Trans>All lessons</Trans>
        </button>
        <span className="tutorial-coach__spacer" />
        {next && !allDone ? (
          <button
            ref={primary}
            type="button"
            className="ds-button ds-button--primary"
            onClick={() => onNext(next)}
          >
            {i18n._(next.title)}
          </button>
        ) : (
          <button
            ref={primary}
            type="button"
            className="ds-button ds-button--primary"
            onClick={onExit}
          >
            <Trans>Back to my table</Trans>
          </button>
        )}
      </div>
    </section>
  );
};
