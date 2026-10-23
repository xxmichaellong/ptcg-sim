// @vitest-environment happy-dom

import { asPlayerId } from '@ptcgsim/game-core';
import {
  BoardDepthProjection,
  createBoardScene,
  createEmptyBoardView,
  createTableLayoutSnapshot,
  DEFAULT_BOARD_DEPTH,
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  type BoardLayoutState,
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
  TableCoins,
  coinLandingAngle,
  type TableCoinsProps,
} from './TableCoin.js';
import { tableCoinSpots } from './table-coin.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const blue = asPlayerId('lobby-blue');
const red = asPlayerId('lobby-red');
const layoutState = (
  extra: Partial<BoardLayoutState> = {}
): BoardLayoutState => ({
  geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  playerIds: [blue, red],
  bottomPlayerId: blue,
  shellMode: 'fullscreen',
  vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
  ...extra,
});
const layout = createTableLayoutSnapshot(layoutState());

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
  playerId: blue,
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

describe('TableCoins', () => {
  let host: HTMLDivElement;
  let root: Root;
  let source: CoinSource;
  let calls: AnimateCall[];
  let onFlip: ReturnType<typeof vi.fn<(playerId: string) => void>>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    source = new CoinSource();
    calls = [];
    onFlip = vi.fn<(playerId: string) => void>();
    // happy-dom has no Web Animations; record what the coin asks for.
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

  const render = async (props: Partial<TableCoinsProps> = {}) =>
    act(async () =>
      root.render(
        <TableCoins
          source={source}
          layout={layout}
          reducedMotion={false}
          flip={{ playerIds: [blue], onFlip, hint: 'F' }}
          names={{ [blue]: 'Blue', [red]: 'Red' }}
          {...props}
        />
      )
    );
  const coin = (side: 'local' | 'opponent') =>
    host.querySelector<HTMLElement>(`[data-table-coin="${side}"]`);
  const coinCalls = (side: 'local' | 'opponent' = 'local') =>
    calls.filter(
      (call) =>
        call.element.className === 'table-coin__coin' &&
        call.element.closest(`[data-table-coin="${side}"]`)
    );

  it('lays both players’ coins on the table, heads up, where the layout has room', async () => {
    await render();
    const spots = tableCoinSpots(layout);
    for (const side of ['local', 'opponent'] as const) {
      const element = coin(side)!;
      const spot = spots.find(
        (candidate) => candidate.own === (side === 'local')
      )!;
      expect(element.dataset.coinPhase).toBe('resting');
      expect(element.dataset.coinFace).toBe('heads');
      expect(Number.parseFloat(element.style.left)).toBeCloseTo(spot.rect.x, 6);
      expect(Number.parseFloat(element.style.top)).toBeCloseTo(spot.rect.y, 6);
      expect(element.style.getPropertyValue('--coin-size')).toBe(
        `${spot.rect.width}px`
      );
    }
    // Theirs faces them, as their cards do.
    expect(coin('opponent')!.dataset.coinTurned).toBe('true');
    expect(coin('local')!.dataset.coinTurned).toBeUndefined();
    // Only the seats the viewer flips for take a press; the button keeps
    // the rail's old id and name.
    const own = host.querySelector<HTMLButtonElement>('#flipCoinButton')!;
    expect(own.closest('[data-table-coin]')).toBe(coin('local'));
    expect(own.getAttribute('aria-label')).toBe('Flip a coin');
    expect(coin('opponent')!.querySelector('button')).toBeNull();
    expect(
      coin('opponent')!
        .querySelector('.table-coin__button')!
        .getAttribute('aria-hidden')
    ).toBe('true');
  });

  it('flips a seat’s coin when it is pressed, and Solo’s far coin for its seat', async () => {
    await render({ flip: { playerIds: [blue, red], onFlip } });
    host.querySelector<HTMLButtonElement>('#flipCoinButton')!.click();
    expect(onFlip).toHaveBeenLastCalledWith(blue);
    const far = coin('opponent')!.querySelector('button')!;
    expect(far.getAttribute('aria-label')).toBe('Flip a coin for Red');
    expect(far.id).not.toBe('flipCoinButton');
    far.click();
    expect(onFlip).toHaveBeenLastCalledWith(red);
  });

  it('only shows the room’s flips to a spectator or a replay', async () => {
    await render({ flip: undefined });
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('#flipCoinButton')).toBeNull();
    expect(coin('local')).not.toBeNull();
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

  it('tosses at once on a press, lands on the room’s result and lies on that face', async () => {
    await render();
    await render({ pendingPlayerId: blue });
    expect(coin('local')!.dataset.coinPhase).toBe('tossing');
    expect(coin('local')!.dataset.coinInAir).toBe('true');
    expect(coin('opponent')!.dataset.coinPhase).toBe('resting');
    const [spin] = coinCalls();
    expect(spin?.options).toMatchObject({ iterations: Infinity });
    // In the air it asks the room for nothing more.
    host.querySelector<HTMLButtonElement>('#flipCoinButton')!.click();
    expect(onFlip).not.toHaveBeenCalled();
    // Mid-air, a quarter of the way round when the answer comes.
    spin!.animation.currentTime = 95;
    const element = host.querySelector<HTMLElement>(
      '[data-table-coin="local"] .table-coin__coin'
    )!;

    await act(async () => source.set(flip({ result: 'tails' })));
    expect(coin('local')!.dataset.coinPhase).toBe('spinning');
    expect(
      host.querySelector('[data-table-coin="local"] .table-coin__coin')
    ).toBe(element);
    expect(spin!.animation.cancel).toHaveBeenCalled();
    const landing = coinCalls().at(-1)!;
    expect(landing).not.toBe(spin);
    expect(landing.options.duration).toBe(1_050);
    const from = 90;
    const to = coinLandingAngle(from, 'tails');
    // It overshoots and settles back: a small bounce on landing.
    expect(landing.keyframes.map((frame) => frame.transform)).toEqual([
      `rotateX(${from}deg)`,
      `rotateX(${to + 16}deg)`,
      `rotateX(${to - 6}deg)`,
      `rotateX(${to}deg)`,
    ]);
    expect(element.style.transform).toBe(`rotateX(${to}deg)`);
    expect(host.querySelector('[data-coin-result-chip]')).toBeNull();

    // The room's answer also clears the pending seat; the coin stays put.
    await render({ pendingPlayerId: undefined });
    expect(coin('local')!.dataset.coinPhase).toBe('spinning');

    await act(async () => source.set(flip({ phase: 'landed' })));
    expect(coinCalls()).toHaveLength(2);
    expect(host.querySelector('[data-coin-result-chip]')?.textContent).toBe(
      'Tails'
    );
    expect(coin('local')!.dataset.coinFace).toBe('tails');
    await act(async () => source.set(flip({ phase: 'fading' })));
    expect(
      host
        .querySelector('[data-coin-result-chip]')
        ?.getAttribute('data-coin-phase')
    ).toBe('fading');
    await act(async () => source.set(null));
    // The chip goes; the coin lies on its face until the next flip.
    expect(host.querySelector('[data-coin-result-chip]')).toBeNull();
    expect(coin('local')!.dataset.coinPhase).toBe('resting');
    expect(coin('local')!.dataset.coinFace).toBe('tails');
    // The same face, its turns counted afresh for the next toss.
    expect(element.style.transform).toBe('rotateX(180deg)');
    host.querySelector<HTMLButtonElement>('#flipCoinButton')!.click();
    expect(onFlip).toHaveBeenCalledWith(blue);
  });

  it('tosses the other player’s coin on their side', async () => {
    await render();
    await act(async () =>
      source.set(flip({ id: 9, playerId: red, result: 'heads' }))
    );
    expect(coin('opponent')!.dataset.coinPhase).toBe('spinning');
    expect(coin('local')!.dataset.coinPhase).toBe('resting');
    const landing = coinCalls('opponent').at(-1)!;
    expect(landing.keyframes[0]?.transform).toBe('rotateX(0deg)');
    expect(landing.keyframes.at(-1)?.transform).toBe(
      `rotateX(${coinLandingAngle(0, 'heads')}deg)`
    );
    // The toss rises and falls, with a small bounce at the end.
    const toss = calls.find(
      (call) =>
        call.element.className === 'table-coin__toss' &&
        call.element.closest('[data-table-coin="opponent"]')
    )!;
    expect(toss.keyframes.map((frame) => frame.transform)).toContain(
      'translateY(-7%) scale(1.01)'
    );
  });

  it('turns straight to the face, with the result beside it, when motion is reduced', async () => {
    await render({ reducedMotion: true, pendingPlayerId: blue });
    expect(coin('local')!.dataset.coinPhase).toBe('resting');
    await act(async () =>
      source.set(flip({ motion: 'static', phase: 'landed', result: 'tails' }))
    );
    expect(coin('local')!.dataset.coinFace).toBe('tails');
    expect(
      host.querySelector<HTMLElement>(
        '[data-table-coin="local"] .table-coin__coin'
      )!.style.transform
    ).toBe('rotateX(180deg)');
    expect(host.querySelector('[data-coin-result-chip]')?.textContent).toBe(
      'Tails'
    );
    expect(calls).toEqual([]);
  });

  it('puts the coin down when the room never answers', async () => {
    vi.useFakeTimers();
    await render({ pendingPlayerId: blue });
    expect(coin('local')!.dataset.coinPhase).toBe('tossing');
    await render({ pendingPlayerId: undefined });
    expect(coin('local')!.dataset.coinPhase).toBe('tossing');
    await act(async () => vi.advanceTimersByTime(COIN_PENDING_GRACE_MS));
    expect(coin('local')!.dataset.coinPhase).toBe('resting');
    expect(coin('local')!.dataset.coinFace).toBe('heads');
  });

  it('tosses again on a second press while the last result lingers', async () => {
    await render();
    await act(async () => source.set(flip({ id: 1, phase: 'landed' })));
    expect(host.querySelector('[data-coin-result-chip]')).not.toBeNull();
    await render({ pendingPlayerId: blue });
    expect(coin('local')!.dataset.coinPhase).toBe('tossing');
    expect(host.querySelector('[data-coin-result-chip]')).toBeNull();
    await act(async () => source.set(flip({ id: 2, result: 'heads' })));
    expect(coin('local')!.dataset.coinPhase).toBe('spinning');
    await act(async () =>
      source.set(flip({ id: 2, phase: 'landed', result: 'heads' }))
    );
    expect(coin('local')!.dataset.coinResult).toBe('heads');
    expect(coin('local')!.dataset.coinFace).toBe('heads');
  });

  it('stays out of reach under an open pile viewer', async () => {
    await render({ covered: true });
    const button = host.querySelector<HTMLButtonElement>('#flipCoinButton')!;
    expect(button.disabled).toBe(true);
    expect(coin('local')!.dataset.covered).toBe('true');
  });

  it('lies on the tilted table with the cards’ projection', async () => {
    const scene = createBoardScene(createEmptyBoardView(), layout);
    const depth = new BoardDepthProjection(scene, {
      ...DEFAULT_BOARD_PREFERENCES,
      depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' },
    });
    await render({ depth });
    const element = coin('local')!;
    expect(element.style.transform).toMatch(/^matrix3d\(/u);
    expect(element.style.left).toBe('0px');
    expect(element.style.top).toBe('0px');
  });

  it('has no coin where the table has no room for one', async () => {
    await act(async () =>
      root.render(
        <TableCoins
          layout={createTableLayoutSnapshot(
            layoutState({
              viewport: { width: 200, height: 300, devicePixelRatio: 1 },
            })
          )}
          reducedMotion={false}
        />
      )
    );
    expect(host.querySelector('[data-table-coins]')).toBeNull();
  });
});
