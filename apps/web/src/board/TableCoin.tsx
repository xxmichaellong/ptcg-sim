import { useLingui } from '@lingui/react/macro';
import type { PlayerId } from '@ptcgsim/game-core';
import type {
  BoardDepthProjection,
  BoardLayoutSnapshot,
  Rect,
} from '@ptcgsim/renderer-contract';
import { tablePoseMatrix } from '@ptcgsim/renderer-contract';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
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
import { Tooltip, withKeyHint } from '../ui/Tooltip.js';
import { tableCoinSpots } from './table-coin.js';
import './TableCoin.css';

/** A coin that was waiting for the room stays up this long after it answers. */
export const COIN_PENDING_GRACE_MS = 300;

const EMPTY: CoinFlipSnapshot = { flip: null };
const NO_SOURCE: PresentationStateSource<CoinFlipSnapshot> = {
  getSnapshot: () => EMPTY,
  subscribe: () => () => undefined,
};

type Face = 'heads' | 'tails';

/** Where the coin is pointed: heads up at 0 turns, tails at a half turn. */
const faceAngle = (result: Face): number => (result === 'tails' ? 180 : 0);

/**
 * The landing angle: at least three full turns past where the coin is now,
 * stopping on the rolled face.
 */
export const coinLandingAngle = (fromDegrees: number, result: Face): number =>
  Math.ceil((fromDegrees + 3 * 360 + 180) / 360) * 360 + faceAngle(result);

const TOSS_SPIN_PERIOD_MS = 380;

const rotate = (degrees: number): string => `rotateX(${degrees}deg)`;

const canAnimate = (element: Element | null): element is HTMLElement =>
  element !== null && typeof (element as HTMLElement).animate === 'function';

/** Stops an animation; its `finished` rejects, which is expected, not an error. */
const cancel = (animation: Animation | null | undefined): void => {
  if (!animation) return;
  // Some engines (and test DOMs) leave that rejection unhandled.
  (animation.finished as Promise<Animation> | undefined)?.catch(
    () => undefined
  );
  animation.cancel();
};

/** The coin's current angle while it spins in the air waiting for the room. */
const tossAngleOf = (animation: Animation | null, from: number): number => {
  const time = animation?.currentTime;
  if (typeof time !== 'number') return from;
  return from + ((time % TOSS_SPIN_PERIOD_MS) / TOSS_SPIN_PERIOD_MS) * 360;
};

/**
 * The coin is Pokémon TCG Pocket's starting Poké Ball coin: the red and
 * white ball for heads, the same ball struck in silver for tails.
 */
const COIN_FACE_URLS: Readonly<Record<Face, string>> = {
  heads: '/v2/assets/table/coin-heads.webp',
  tails: '/v2/assets/table/coin-tails.webp',
};

const CoinFace = ({ side }: { readonly side: Face }) => (
  <img src={COIN_FACE_URLS[side]} alt="" draggable={false} decoding="async" />
);

/** What one coin is doing: lying still, up in the air, or a room's flip. */
type CoinMotion =
  | { readonly kind: 'rest' }
  | { readonly kind: 'tossing' }
  | { readonly kind: 'flip'; readonly flip: CoinFlipShowing };

/** The coin's square where it shows: placed flat, or laid on the tilted table. */
const placement = (
  rect: Rect,
  depth: BoardDepthProjection | undefined
): CSSProperties => {
  if (!depth?.enabled) {
    return {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }
  return {
    left: 0,
    top: 0,
    width: rect.width,
    height: rect.height,
    transformOrigin: '0 0',
    transform: `matrix3d(${tablePoseMatrix(depth.camera, {
      bounds: rect,
      turns: 0,
      elevation: 0,
      thickness: 0,
      plane: 1,
    }).join(',')})`,
  };
};

/**
 * Where the coin's result is read: below the near coin; above the far one,
 * whose lower edge lies toward the seam, under the rail's buttons.
 */
const chipAnchor = (
  rect: Rect,
  depth: BoardDepthProjection | undefined,
  above: boolean
): { readonly x: number; readonly y: number } => {
  const edge = {
    x: rect.x + rect.width / 2,
    y: above ? rect.y : rect.y + rect.height,
  };
  return depth?.enabled ? depth.point(edge) : edge;
};

interface TableCoinProps {
  readonly playerId: string;
  readonly own: boolean;
  readonly rect: Rect;
  readonly depth: BoardDepthProjection | undefined;
  readonly motion: CoinMotion;
  readonly face: Face;
  /** Turned to face the far player, as their cards are. */
  readonly turned: boolean;
  /** Flips this seat's coin; absent when the viewer cannot flip it. */
  readonly onFlip: (() => void) | undefined;
  readonly label: string;
  readonly hint: string | undefined;
  /** A pile viewer or work area is over the table. */
  readonly covered: boolean;
}

const TableCoin = ({
  playerId,
  own,
  rect,
  depth,
  motion,
  face,
  turned,
  onFlip,
  label,
  hint,
  covered,
}: TableCoinProps) => {
  const { t } = useLingui();
  const coinRef = useRef<HTMLSpanElement>(null);
  const tossRef = useRef<HTMLSpanElement>(null);
  const shadowRef = useRef<HTMLSpanElement>(null);
  const tossSpin = useRef<Animation | null>(null);
  const landedFlipId = useRef<number | null>(null);
  // The angle the coin lies at, kept across renders: React never writes it.
  const angle = useRef(faceAngle(face));

  const spinning =
    motion.kind === 'flip' &&
    motion.flip.motion === 'spin' &&
    motion.flip.phase === 'spinning'
      ? motion.flip
      : null;

  useLayoutEffect(() => {
    const coin = coinRef.current;
    const toss = tossRef.current;
    const shadow = shadowRef.current;
    if (!coin) return;
    if (motion.kind === 'tossing') {
      if (!canAnimate(coin) || tossSpin.current) return;
      const from = angle.current;
      tossSpin.current = coin.animate(
        [{ transform: rotate(from) }, { transform: rotate(from + 360) }],
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
    if (motion.kind === 'flip' && motion.flip.motion === 'static') {
      // Reduced motion: the coin simply lies on the rolled face.
      angle.current = faceAngle(motion.flip.result);
      coin.style.transform = rotate(angle.current);
      return;
    }
    if (!spinning) {
      // Lying still: put away any toss that never landed.
      if (tossSpin.current) {
        cancel(tossSpin.current);
        tossSpin.current = null;
        for (const element of [toss, shadow])
          if (canAnimate(element))
            for (const animation of element.getAnimations()) cancel(animation);
      }
      if (motion.kind === 'rest') angle.current = faceAngle(face);
      coin.style.transform = rotate(angle.current);
      return;
    }
    if (landedFlipId.current === spinning.id) return;
    landedFlipId.current = spinning.id;
    const airborne = tossSpin.current !== null;
    const from = tossAngleOf(tossSpin.current, angle.current);
    cancel(tossSpin.current);
    tossSpin.current = null;
    const to = coinLandingAngle(from, spinning.result);
    // The resting face; the animation only supplies how it got there.
    angle.current = to;
    coin.style.transform = rotate(to);
    if (!canAnimate(coin)) return;
    const duration = spinning.spinMs;
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
      for (const animation of toss.getAnimations()) cancel(animation);
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
      for (const animation of shadow.getAnimations()) cancel(animation);
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

  useEffect(
    () => () => {
      cancel(tossSpin.current);
      tossSpin.current = null;
    },
    []
  );

  const inAir = motion.kind === 'tossing' || spinning !== null;
  const phase =
    motion.kind === 'rest'
      ? 'resting'
      : motion.kind === 'tossing'
        ? 'tossing'
        : motion.flip.phase;
  const result =
    motion.kind === 'flip' && motion.flip.phase !== 'spinning'
      ? motion.flip.result
      : undefined;
  const chip = chipAnchor(rect, depth, !own);
  const coin = (
    <span className="table-coin__toss" ref={tossRef}>
      <span className="table-coin__coin" ref={coinRef}>
        <span className="table-coin__edge" />
        <span className="table-coin__face table-coin__face--heads">
          <CoinFace side="heads" />
        </span>
        <span className="table-coin__face table-coin__face--tails">
          <CoinFace side="tails" />
        </span>
      </span>
    </span>
  );
  return (
    <>
      <div
        className="table-coin"
        // A card carried over the coin is drawn over it (renderer-dom's lift).
        data-over-board=""
        data-table-coin={own ? 'local' : 'opponent'}
        data-coin-player-id={playerId}
        data-coin-phase={phase}
        data-coin-face={face}
        data-coin-result={result}
        data-coin-turned={turned ? 'true' : undefined}
        data-coin-in-air={inAir ? 'true' : undefined}
        data-covered={covered ? 'true' : undefined}
        style={
          {
            ...placement(rect, depth),
            '--coin-size': `${rect.width}px`,
          } as CSSProperties
        }
      >
        <span className="table-coin__shadow" ref={shadowRef} />
        {onFlip ? (
          <Tooltip content={withKeyHint(label, hint)} side="top">
            <button
              {...(own ? { id: 'flipCoinButton' } : {})}
              type="button"
              className="table-coin__button"
              aria-label={label}
              aria-busy={inAir || undefined}
              // Under an open pile viewer it stays on the felt, out of reach.
              disabled={covered}
              onClick={() => {
                // One toss at a time: a press while it is in the air waits
                // for nothing and asks the room for nothing.
                if (!inAir) onFlip();
              }}
            >
              {coin}
            </button>
          </Tooltip>
        ) : (
          <span className="table-coin__button" aria-hidden="true">
            {coin}
          </span>
        )}
      </div>
      {result ? (
        <span
          className="table-coin__result"
          data-coin-result-chip={result}
          data-coin-player-id={playerId}
          data-coin-phase={phase}
          data-chip-above={own ? undefined : 'true'}
          aria-hidden="true"
          style={{ left: chip.x, top: chip.y }}
        >
          {result === 'heads'
            ? t({ message: 'Heads', context: 'coin flip' })
            : t({ message: 'Tails', context: 'coin flip' })}
        </span>
      ) : null}
    </>
  );
};

export interface TableCoinsProps {
  /** The presentation runtime's coin flips, paced for the table. */
  readonly source?: PresentationStateSource<CoinFlipSnapshot>;
  readonly layout: BoardLayoutSnapshot;
  readonly depth?: BoardDepthProjection;
  /** The seat the viewer just flipped for, until the room answers. */
  readonly pendingPlayerId?: PlayerId | undefined;
  readonly reducedMotion: boolean;
  /**
   * The seats whose coin the viewer may flip, and what a flip does. Absent
   * for a spectator or a replay: the coins only show the room's flips.
   */
  readonly flip?: {
    readonly playerIds: readonly PlayerId[];
    readonly onFlip: (playerId: PlayerId) => void;
    /** The flip's key, shown in the tooltip. */
    readonly hint?: string;
  };
  /** The players' names, to say whose coin the far one is. */
  readonly names?: Readonly<Record<string, string>>;
  /** A pile viewer or work area is over the table. */
  readonly covered?: boolean;
}

/**
 * Each player's coin, lying on the felt beside their Active Pokémon (PX-051).
 * Pressing their own coin (or the flip key) asks the room for a flip: the
 * coin leaps and spins at once, lands on the room's result, shows it for a
 * moment and stays on that face. A flip by the other player tosses their
 * coin the same way, so both tables see the same toss and the same result.
 * The activity log and the announcement stay the record of the result;
 * reduced motion turns the coin straight to its face with the result beside
 * it.
 */
export const TableCoins = ({
  source = NO_SOURCE,
  layout,
  depth,
  pendingPlayerId,
  reducedMotion,
  flip: flipControl,
  names,
  covered = false,
}: TableCoinsProps) => {
  const { t } = useLingui();
  const { flip } = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot
  );
  // The flip already on the table when the viewer flipped: until a newer
  // one arrives, that seat's coin is in the air waiting for the room.
  const [awaiting, setAwaiting] = useState<
    { readonly playerId: PlayerId; readonly after: number | null } | undefined
  >(undefined);
  const flipId = flip?.id ?? null;
  const flipIdRef = useRef(flipId);
  flipIdRef.current = flipId;

  useEffect(() => {
    if (pendingPlayerId !== undefined && !reducedMotion) {
      setAwaiting((current) =>
        current?.playerId === pendingPlayerId
          ? current
          : { playerId: pendingPlayerId, after: flipIdRef.current }
      );
      return;
    }
    // A short grace: the answer's publication and its presentation event
    // can arrive in either order.
    const timeout = setTimeout(
      () => setAwaiting(undefined),
      COIN_PENDING_GRACE_MS
    );
    return () => clearTimeout(timeout);
  }, [pendingPlayerId, reducedMotion]);

  const answered =
    awaiting !== undefined && flipId !== null && flipId !== awaiting.after;
  useEffect(() => {
    // The answer arrived: the waiting coin becomes that flip.
    if (answered) setAwaiting(undefined);
  }, [answered]);

  // The face each coin last landed on; it lies that way until the next flip.
  const [faces, setFaces] = useState<Readonly<Record<string, Face>>>({});
  const landedPlayerId =
    flip && flip.phase !== 'spinning' ? flip.playerId : undefined;
  const landedResult =
    flip && flip.phase !== 'spinning' ? flip.result : undefined;
  useEffect(() => {
    if (landedPlayerId === undefined || landedResult === undefined) return;
    setFaces((current) =>
      current[landedPlayerId] === landedResult
        ? current
        : { ...current, [landedPlayerId]: landedResult }
    );
  }, [landedPlayerId, landedResult]);

  const spots = useMemo(() => tableCoinSpots(layout), [layout]);
  const canFlip = new Set(flipControl?.playerIds ?? []);
  const onFlip = flipControl?.onFlip;
  const handlers = useMemo(() => {
    const byPlayer = new Map<PlayerId, () => void>();
    if (onFlip)
      for (const spot of spots)
        byPlayer.set(spot.playerId, () => onFlip(spot.playerId));
    return byPlayer;
  }, [onFlip, spots]);

  if (spots.length === 0) return null;
  return (
    <div className="table-coins" data-table-coins="true">
      {spots.map((spot) => {
        const tossing =
          awaiting !== undefined &&
          !answered &&
          awaiting.playerId === spot.playerId;
        const motion: CoinMotion = tossing
          ? { kind: 'tossing' }
          : flip && flip.playerId === spot.playerId
            ? { kind: 'flip', flip }
            : { kind: 'rest' };
        const name = names?.[spot.playerId];
        return (
          <TableCoin
            key={spot.playerId}
            playerId={spot.playerId}
            own={spot.own}
            rect={spot.rect}
            depth={depth}
            motion={motion}
            face={faces[spot.playerId] ?? 'heads'}
            // Theirs faces them, as their cards do, unless the viewer reads
            // the far side upright (PX-043).
            turned={!spot.own && !layout.farCardsUpright}
            onFlip={
              canFlip.has(spot.playerId)
                ? handlers.get(spot.playerId)
                : undefined
            }
            label={
              spot.own || !name
                ? t`Flip a coin`
                : t({
                    message: `Flip a coin for ${name}`,
                    comment: 'name is the player the coin is flipped for.',
                  })
            }
            hint={spot.own ? flipControl?.hint : undefined}
            covered={covered}
          />
        );
      })}
    </div>
  );
};
