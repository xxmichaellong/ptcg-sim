import type { BoardLayoutSnapshot } from '@ptcgsim/renderer-contract';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';

import type {
  CoinFlipShowing,
  CoinFlipSnapshot,
} from '../presentation/CoinFlipController.js';
import type { PresentationStateSource } from '../presentation/PresentationRuntime.js';
import './CoinFlipOverlay.css';

/** A coin that was waiting for the room stays up this long after it answers. */
export const COIN_PENDING_GRACE_MS = 300;

const EMPTY: CoinFlipSnapshot = { flip: null };
const NO_SOURCE: PresentationStateSource<CoinFlipSnapshot> = {
  getSnapshot: () => EMPTY,
  subscribe: () => () => undefined,
};

export interface CoinAnchor {
  /** The coin's centre, in board pixels. */
  readonly x: number;
  readonly y: number;
  /** The coin's diameter. */
  readonly size: number;
}

/**
 * Where a player's coin lands: beside their Active Pokémon, on their own
 * right as they sit at the table (the opponent's half is turned around), and
 * sized with their half of the board.
 */
export const coinAnchor = (
  layout: BoardLayoutSnapshot,
  playerId: string | undefined
): CoinAnchor => {
  const frame =
    layout.players.find((candidate) => candidate.playerId === playerId) ??
    layout.players.find((candidate) => candidate.physicalSide === 'lower') ??
    layout.players[0];
  const size = Math.min(96, Math.max(44, frame.frameBounds.height * 0.2));
  const active = frame.regions.find((region) => region.kind === 'active');
  if (!active) {
    return {
      x: frame.frameBounds.x + frame.frameBounds.width / 2,
      y: frame.frameBounds.y + frame.frameBounds.height / 2,
      size,
    };
  }
  const bounds = active.physicalDeclaredBounds;
  const offset = size * 0.35 + size / 2;
  return {
    x:
      frame.rotationQuarterTurns === 0
        ? bounds.x + bounds.width + offset
        : bounds.x - offset,
    y: bounds.y + bounds.height / 2,
    size,
  };
};

/** Where the coin is pointed: heads up at 0 turns, tails at a half turn. */
const faceAngle = (result: 'heads' | 'tails'): number =>
  result === 'tails' ? 180 : 0;

/**
 * The landing angle: at least three full turns past where the coin is now,
 * stopping on the rolled face.
 */
export const coinLandingAngle = (
  fromDegrees: number,
  result: 'heads' | 'tails'
): number =>
  Math.ceil((fromDegrees + 3 * 360 + 180) / 360) * 360 + faceAngle(result);

const TOSS_SPIN_PERIOD_MS = 380;

const rotate = (degrees: number): string => `rotateX(${degrees}deg)`;

const canAnimate = (element: Element | null): element is HTMLElement =>
  element !== null && typeof (element as HTMLElement).animate === 'function';

/** The coin's current angle while it spins in the air waiting for the room. */
const tossAngleOf = (animation: Animation | null): number => {
  const time = animation?.currentTime;
  if (typeof time !== 'number') return 0;
  return ((time % TOSS_SPIN_PERIOD_MS) / TOSS_SPIN_PERIOD_MS) * 360;
};

const CoinFace = ({ side }: { readonly side: 'heads' | 'tails' }) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const face = `coin-face-${id}`;
  const rim = `coin-rim-${id}`;
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={face} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#ebd392" />
          <stop offset="0.55" stopColor="#ccac5f" />
          <stop offset="1" stopColor="#9e8040" />
        </radialGradient>
        <linearGradient id={rim} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3dfa4" />
          <stop offset="0.5" stopColor="#8d7544" />
          <stop offset="1" stopColor="#d9be78" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="49" fill={`url(#${rim})`} />
      <circle cx="50" cy="50" r="43" fill={`url(#${face})`} />
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke="#2c241b"
        strokeOpacity="0.55"
        strokeWidth="1.2"
      />
      {side === 'heads' ? (
        <>
          <g
            fill="none"
            stroke="#2c241b"
            strokeWidth="3.2"
            strokeLinecap="round"
          >
            <circle cx="50" cy="50" r="26" />
            <path d="M24 50H40M60 50H76" />
            <circle cx="50" cy="50" r="9" />
          </g>
          <circle cx="50" cy="50" r="4" fill="#2c241b" />
        </>
      ) : (
        <>
          <g fill="none" stroke="#2c241b" strokeWidth="2" strokeOpacity="0.7">
            <circle cx="50" cy="50" r="30" />
            <circle cx="50" cy="50" r="22" />
          </g>
          <path
            d="M50 33 54.5 45 67 45.5 57 53 60.5 65.5 50 58 39.5 65.5 43 53 33 45.5 45.5 45Z"
            fill="#2c241b"
            fillOpacity="0.8"
          />
        </>
      )}
      <path
        d="M28 40A24 24 0 0 1 50 26"
        fill="none"
        stroke="#f6e6b4"
        strokeOpacity="0.6"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
};

type CoinDisplay =
  | { readonly kind: 'none' }
  | { readonly kind: 'tossing'; readonly playerId: string | undefined }
  | { readonly kind: 'flip'; readonly flip: CoinFlipShowing };

/**
 * The coin over the table. A local flip starts tossing as soon as Coin is
 * pressed (`pending`) and lands on the room's result when it arrives; an
 * opponent's flip is tossed from the start. The result chip lingers, then
 * everything fades. It never takes input, and with reduced motion only the
 * result chip is shown. The activity log and the announcement stay the
 * record of the result; this layer is hidden from assistive technology.
 */
export const CoinFlipOverlay = ({
  source = NO_SOURCE,
  layout,
  pending,
  pendingPlayerId,
  reducedMotion,
}: {
  readonly source?: PresentationStateSource<CoinFlipSnapshot>;
  readonly layout: BoardLayoutSnapshot;
  /** The viewer pressed Coin and the room has not answered yet. */
  readonly pending: boolean;
  /** The seat the viewer flips for. */
  readonly pendingPlayerId: string | undefined;
  readonly reducedMotion: boolean;
}) => {
  const { flip } = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot
  );
  // The flip already on the table when Coin was pressed: until a newer one
  // arrives, the coin is in the air waiting for the room.
  const [awaitingAfter, setAwaitingAfter] = useState<number | null | undefined>(
    undefined
  );
  const flipId = flip?.id ?? null;
  const flipIdRef = useRef(flipId);
  flipIdRef.current = flipId;

  useEffect(() => {
    if (pending && !reducedMotion) {
      setAwaitingAfter((current) =>
        current === undefined ? flipIdRef.current : current
      );
      return;
    }
    // A short grace: the answer's publication and its presentation event
    // can arrive in either order.
    const timeout = setTimeout(
      () => setAwaitingAfter(undefined),
      COIN_PENDING_GRACE_MS
    );
    return () => clearTimeout(timeout);
  }, [pending, reducedMotion]);

  const awaiting =
    awaitingAfter !== undefined &&
    (flipId === null || flipId === awaitingAfter);
  useEffect(() => {
    // The answer arrived: the waiting coin becomes that flip.
    if (
      awaitingAfter !== undefined &&
      flipId !== null &&
      flipId !== awaitingAfter
    ) {
      setAwaitingAfter(undefined);
    }
  }, [awaitingAfter, flipId]);

  const display: CoinDisplay = awaiting
    ? { kind: 'tossing', playerId: pendingPlayerId }
    : flip
      ? { kind: 'flip', flip }
      : { kind: 'none' };

  const coinRef = useRef<HTMLSpanElement>(null);
  const tossRef = useRef<HTMLSpanElement>(null);
  const shadowRef = useRef<HTMLSpanElement>(null);
  const tossSpin = useRef<Animation | null>(null);
  const landedFlipId = useRef<number | null>(null);

  const showCoin =
    display.kind === 'tossing' ||
    (display.kind === 'flip' && display.flip.motion === 'spin');
  const spinningFlip =
    display.kind === 'flip' &&
    display.flip.motion === 'spin' &&
    display.flip.phase === 'spinning'
      ? display.flip
      : null;

  useLayoutEffect(() => {
    const coin = coinRef.current;
    const toss = tossRef.current;
    const shadow = shadowRef.current;
    if (display.kind === 'tossing') {
      if (!canAnimate(coin) || tossSpin.current) return;
      tossSpin.current = coin.animate(
        [{ transform: rotate(0) }, { transform: rotate(360) }],
        { duration: TOSS_SPIN_PERIOD_MS, iterations: Infinity }
      );
      if (canAnimate(toss)) {
        toss.animate(
          [
            { transform: 'translateY(0) scale(1)' },
            { transform: 'translateY(-55%) scale(1.15)' },
          ],
          {
            duration: 260,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            fill: 'forwards',
          }
        );
      }
      if (canAnimate(shadow)) {
        shadow.animate(
          [
            { transform: 'scale(1)', opacity: 0.5 },
            { transform: 'scale(0.65)', opacity: 0.22 },
          ],
          { duration: 260, easing: 'ease-out', fill: 'forwards' }
        );
      }
      return;
    }
    if (!spinningFlip || landedFlipId.current === spinningFlip.id) return;
    landedFlipId.current = spinningFlip.id;
    const from = tossAngleOf(tossSpin.current);
    const airborne = tossSpin.current !== null;
    tossSpin.current?.cancel();
    tossSpin.current = null;
    if (!coin) return;
    const to = coinLandingAngle(from, spinningFlip.result);
    // The resting face; the animation only supplies how it got there.
    coin.style.transform = rotate(to);
    if (!canAnimate(coin)) return;
    const duration = spinningFlip.spinMs;
    coin.animate(
      [
        {
          transform: rotate(from),
          easing: 'cubic-bezier(0.16, 0.62, 0.3, 1)',
        },
        { transform: rotate(to + 16), offset: 0.84, easing: 'ease-in-out' },
        { transform: rotate(to - 6), offset: 0.93, easing: 'ease-in-out' },
        { transform: rotate(to), offset: 1 },
      ],
      { duration }
    );
    if (canAnimate(toss)) {
      for (const animation of toss.getAnimations()) animation.cancel();
      toss.animate(
        [
          {
            transform: airborne
              ? 'translateY(-55%) scale(1.15)'
              : 'translateY(0) scale(1)',
            easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)',
          },
          {
            transform: 'translateY(-95%) scale(1.24)',
            offset: 0.4,
            easing: 'cubic-bezier(0.55, 0, 0.85, 0.4)',
          },
          { transform: 'translateY(0) scale(1)', offset: 0.84 },
          { transform: 'translateY(-7%) scale(1.01)', offset: 0.92 },
          { transform: 'translateY(0) scale(1)', offset: 1 },
        ],
        { duration }
      );
    }
    if (canAnimate(shadow)) {
      for (const animation of shadow.getAnimations()) animation.cancel();
      shadow.animate(
        [
          { transform: airborne ? 'scale(0.65)' : 'scale(1)', opacity: 0.5 },
          { transform: 'scale(0.5)', opacity: 0.16, offset: 0.4 },
          { transform: 'scale(1)', opacity: 0.5, offset: 0.84 },
          { transform: 'scale(0.94)', opacity: 0.44, offset: 0.92 },
          { transform: 'scale(1)', opacity: 0.5, offset: 1 },
        ],
        { duration }
      );
    }
  });

  useEffect(() => {
    if (showCoin) return;
    // The coin left the table: forget any spin that was keeping it up.
    tossSpin.current?.cancel();
    tossSpin.current = null;
  }, [showCoin]);

  if (display.kind === 'none') {
    return <div className="coin-flip-layer" aria-hidden="true" />;
  }
  const playerId =
    display.kind === 'flip' ? display.flip.playerId : display.playerId;
  const anchor = coinAnchor(layout, playerId);
  const phase =
    display.kind === 'flip' ? display.flip.phase : ('tossing' as const);
  const result = display.kind === 'flip' ? display.flip.result : undefined;
  const settledFace =
    display.kind === 'flip' && display.flip.phase !== 'spinning'
      ? rotate(faceAngle(display.flip.result))
      : undefined;
  return (
    <div className="coin-flip-layer" aria-hidden="true">
      <div
        className="coin-flip"
        data-coin-phase={phase}
        data-coin-motion={
          display.kind === 'flip' ? display.flip.motion : 'spin'
        }
        data-coin-player-id={playerId}
        data-coin-result={result}
        style={
          {
            left: anchor.x,
            top: anchor.y,
            '--coin-size': `${anchor.size}px`,
          } as CSSProperties
        }
      >
        {showCoin ? (
          <>
            <span className="coin-flip__shadow" ref={shadowRef} />
            <span className="coin-flip__toss" ref={tossRef}>
              <span
                className="coin-flip__coin"
                ref={coinRef}
                style={settledFace ? { transform: settledFace } : undefined}
              >
                <span className="coin-flip__edge" />
                <span className="coin-flip__face coin-flip__face--heads">
                  <CoinFace side="heads" />
                </span>
                <span className="coin-flip__face coin-flip__face--tails">
                  <CoinFace side="tails" />
                </span>
              </span>
            </span>
          </>
        ) : null}
        {result && phase !== 'spinning' ? (
          <span className="coin-flip__result" data-coin-result-chip={result}>
            {result === 'heads' ? 'Heads' : 'Tails'}
          </span>
        ) : null}
      </div>
    </div>
  );
};
