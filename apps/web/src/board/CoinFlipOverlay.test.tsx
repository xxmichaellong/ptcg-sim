// @vitest-environment happy-dom

import { asPlayerId } from '@ptcgsim/game-core';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CoinFlipShowing,
  CoinFlipSnapshot,
} from '../presentation/CoinFlipController.js';
import type { PresentationStateSource } from '../presentation/PresentationRuntime.js';
import {
  COIN_PENDING_GRACE_MS,
  CoinFlipOverlay,
  coinAnchor,
  coinLandingAngle,
} from './CoinFlipOverlay.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const blue = asPlayerId('spike-blue');
const red = asPlayerId('spike-red');
const layout = createBoardLayoutSnapshot({
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  playerIds: [blue, red],
  bottomPlayerId: blue,
  shellMode: 'sidebar',
  vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
});

class CoinSource implements PresentationStateSource<CoinFlipSnapshot> {
  private snapshot: CoinFlipSnapshot = { flip: null };
  private readonly listeners = new Set<() => void>();
  getSnapshot = (): CoinFlipSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(flip: CoinFlipShowing | null): void {
    this.snapshot = { flip };
    for (const listener of [...this.listeners]) listener();
  }
}

const flip = (overrides: Partial<CoinFlipShowing> = {}): CoinFlipShowing => ({
  id: 1,
  playerId: 'spike-blue',
  result: 'tails',
  motion: 'spin',
  phase: 'spinning',
  spinMs: 1_050,
  ...overrides,
});

interface AnimateCall {
  readonly element: HTMLElement;
  readonly keyframes: readonly Keyframe[];
  readonly options: KeyframeAnimationOptions;
  readonly animation: { currentTime: number | null; cancel: () => void };
}

describe('CoinFlipOverlay', () => {
  let host: HTMLDivElement;
  let root: Root;
  let source: CoinSource;
  let calls: AnimateCall[];

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    source = new CoinSource();
    calls = [];
    // happy-dom has no Web Animations; record what the overlay asks for.
    HTMLElement.prototype.animate = function animate(
      this: HTMLElement,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions
    ) {
      const animation = { currentTime: 0 as number | null, cancel: vi.fn() };
      calls.push({
        element: this,
        keyframes: keyframes as Keyframe[],
        options: options as KeyframeAnimationOptions,
        animation,
      });
      return animation as unknown as Animation;
    };
    HTMLElement.prototype.getAnimations = () => [];
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations;
  });

  const render = async (props: {
    readonly pending?: boolean;
    readonly reducedMotion?: boolean;
    readonly pendingPlayerId?: string;
  }) =>
    act(async () =>
      root.render(
        <CoinFlipOverlay
          source={source}
          layout={layout}
          pending={props.pending ?? false}
          pendingPlayerId={props.pendingPlayerId ?? 'spike-blue'}
          reducedMotion={props.reducedMotion ?? false}
        />
      )
    );
  const coinElement = () => host.querySelector<HTMLElement>('.coin-flip');
  const coinCalls = () =>
    calls.filter((call) => call.element.className === 'coin-flip__coin');

  it('lands each player’s coin beside their own Active Pokémon', () => {
    for (const frame of layout.players) {
      const active = frame.regions.find(
        (region) => region.kind === 'active'
      )!.physicalDeclaredBounds;
      const anchor = coinAnchor(layout, frame.playerId);
      expect(anchor.size).toBeGreaterThanOrEqual(44);
      expect(anchor.size).toBeLessThanOrEqual(96);
      expect(anchor.y).toBeCloseTo(active.y + active.height / 2, 6);
      if (frame.rotationQuarterTurns === 0) {
        expect(anchor.x - anchor.size / 2).toBeGreaterThan(
          active.x + active.width
        );
      } else {
        // The opponent's half is turned around: their right is our left.
        expect(anchor.x + anchor.size / 2).toBeLessThan(active.x);
      }
    }
    // An unknown seat falls back to the lower half.
    expect(coinAnchor(layout, 'nobody')).toEqual(coinAnchor(layout, blue));
  });

  it('turns at least three times and stops on the rolled face', () => {
    for (const from of [0, 37, 180, 359.5, 1_000]) {
      for (const result of ['heads', 'tails'] as const) {
        const to = coinLandingAngle(from, result);
        expect(to - from, `${from} ${result}`).toBeGreaterThanOrEqual(3 * 360);
        expect(((to % 360) + 360) % 360).toBe(result === 'heads' ? 0 : 180);
      }
    }
  });

  it('starts tossing on Coin and lands the same coin on the room’s result', async () => {
    await render({});
    const layer = host.querySelector('.coin-flip-layer')!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(coinElement()).toBeNull();

    await render({ pending: true });
    const tossing = coinElement()!;
    expect(tossing.dataset.coinPhase).toBe('tossing');
    expect(tossing.dataset.coinPlayerId).toBe('spike-blue');
    const anchor = coinAnchor(layout, blue);
    expect(Number.parseFloat(tossing.style.left)).toBeCloseTo(anchor.x, 6);
    expect(Number.parseFloat(tossing.style.top)).toBeCloseTo(anchor.y, 6);
    const [spin] = coinCalls();
    expect(spin?.options).toMatchObject({ iterations: Infinity });
    // Mid-air, a quarter of the way round when the answer comes.
    spin!.animation.currentTime = 95;
    const coin = host.querySelector<HTMLElement>('.coin-flip__coin')!;

    await act(async () => source.set(flip({ result: 'tails' })));
    expect(coinElement()?.dataset.coinPhase).toBe('spinning');
    expect(host.querySelector('.coin-flip__coin')).toBe(coin);
    expect(spin!.animation.cancel).toHaveBeenCalled();
    const landing = coinCalls().at(-1)!;
    expect(landing).not.toBe(spin);
    expect(landing.options.duration).toBe(1_050);
    const from = 90;
    const to = coinLandingAngle(from, 'tails');
    expect(landing.keyframes[0]?.transform).toBe(`rotateX(${from}deg)`);
    expect(landing.keyframes.at(-1)?.transform).toBe(`rotateX(${to}deg)`);
    // It overshoots and settles back: a small bounce on landing.
    expect(landing.keyframes.map((frame) => frame.transform)).toEqual([
      `rotateX(${from}deg)`,
      `rotateX(${to + 16}deg)`,
      `rotateX(${to - 6}deg)`,
      `rotateX(${to}deg)`,
    ]);
    expect(coin.style.transform).toBe(`rotateX(${to}deg)`);
    expect(host.querySelector('.coin-flip__result')).toBeNull();

    // The room's answer also clears the pending state; the coin stays put.
    await render({ pending: false });
    expect(coinElement()?.dataset.coinPhase).toBe('spinning');

    await act(async () => source.set(flip({ phase: 'landed' })));
    expect(coinCalls()).toHaveLength(2);
    expect(host.querySelector('.coin-flip__result')?.textContent).toBe('Tails');
    await act(async () => source.set(flip({ phase: 'fading' })));
    expect(coinElement()?.dataset.coinPhase).toBe('fading');
    await act(async () => source.set(null));
    expect(coinElement()).toBeNull();
  });

  it('tosses an opponent’s coin from the table on their side', async () => {
    await render({});
    await act(async () =>
      source.set(flip({ id: 9, playerId: 'spike-red', result: 'heads' }))
    );
    const coin = coinElement()!;
    expect(coin.dataset.coinPlayerId).toBe('spike-red');
    expect(Number.parseFloat(coin.style.left)).toBeCloseTo(
      coinAnchor(layout, red).x,
      6
    );
    const landing = coinCalls().at(-1)!;
    expect(landing.keyframes[0]?.transform).toBe('rotateX(0deg)');
    expect(landing.keyframes.at(-1)?.transform).toBe(
      `rotateX(${coinLandingAngle(0, 'heads')}deg)`
    );
    // The toss rises and falls, with a small bounce at the end.
    const toss = calls.find(
      (call) => call.element.className === 'coin-flip__toss'
    )!;
    expect(toss.keyframes.map((frame) => frame.transform)).toContain(
      'translateY(-7%) scale(1.01)'
    );
  });

  it('shows only the result chip when motion is reduced', async () => {
    await render({ reducedMotion: true, pending: true });
    expect(coinElement()).toBeNull();
    await act(async () =>
      source.set(flip({ motion: 'static', phase: 'landed', result: 'heads' }))
    );
    expect(coinElement()?.dataset.coinMotion).toBe('static');
    expect(host.querySelector('.coin-flip__coin')).toBeNull();
    expect(host.querySelector('.coin-flip__result')?.textContent).toBe('Heads');
    expect(calls).toEqual([]);
  });

  it('puts the coin away when the room never answers', async () => {
    vi.useFakeTimers();
    await render({ pending: true });
    expect(coinElement()?.dataset.coinPhase).toBe('tossing');
    await render({ pending: false });
    expect(coinElement()?.dataset.coinPhase).toBe('tossing');
    await act(async () => vi.advanceTimersByTime(COIN_PENDING_GRACE_MS));
    expect(coinElement()).toBeNull();
  });

  it('tosses again on a second Coin while the last result lingers', async () => {
    await render({});
    await act(async () => source.set(flip({ id: 1, phase: 'landed' })));
    expect(host.querySelector('.coin-flip__result')).not.toBeNull();
    await render({ pending: true });
    expect(coinElement()?.dataset.coinPhase).toBe('tossing');
    expect(host.querySelector('.coin-flip__result')).toBeNull();
    await act(async () => source.set(flip({ id: 2, result: 'heads' })));
    expect(coinElement()?.dataset.coinPhase).toBe('spinning');
    expect(coinElement()?.dataset.coinResult).toBe('heads');
  });
});
