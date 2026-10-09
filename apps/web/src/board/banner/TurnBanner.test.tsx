// @vitest-environment happy-dom

import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TurnBanner } from './TurnBanner.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = createRendererSpikeView();
const atTurn = (number: number, currentPlayerId: string): MatchViewState => ({
  ...base,
  revision: base.revision + number,
  turn: {
    number,
    currentPlayerId:
      currentPlayerId as MatchViewState['turn']['currentPlayerId'],
  },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TurnBanner', () => {
  it('marks a new turn briefly, and only a new one', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = (view: MatchViewState) =>
      act(async () =>
        root.render(<TurnBanner view={view} bottomPlayerId="spike-blue" />)
      );
    await render(atTurn(4, 'spike-blue'));
    // Joining mid-game announces nothing.
    expect(host.querySelector('[data-turn-banner]')).toBeNull();

    await render(atTurn(5, 'spike-red'));
    const banner = host.querySelector<HTMLElement>('[data-turn-banner]')!;
    expect(banner.textContent).toContain("Red's turn");
    expect(banner.textContent).toContain('Turn 5');
    expect(banner.dataset.side).toBe('opponent');
    expect(banner.getAttribute('aria-hidden')).toBe('true');
    await act(async () => vi.advanceTimersByTime(1_400));
    expect(host.querySelector('[data-turn-banner]')).toBeNull();

    await render(atTurn(6, 'spike-blue'));
    expect(host.querySelector('[data-turn-banner]')?.textContent).toContain(
      'Your turn'
    );
    await act(async () => vi.advanceTimersByTime(1_400));
    // Going back (an undo, a replay seek) is not a new turn.
    await render(atTurn(5, 'spike-red'));
    expect(host.querySelector('[data-turn-banner]')).toBeNull();
    await act(async () => root.unmount());
  });
});
