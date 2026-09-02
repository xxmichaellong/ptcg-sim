// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LegacyReplayControls } from './LegacyReplayControls.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('LegacyReplayControls', () => {
  beforeEach(() => document.body.replaceChildren());

  it('preserves legacy visibility, order, symbols, colors, and action mapping', async () => {
    const handlers = {
      restart: vi.fn(),
      previous: vi.fn(),
      next: vi.fn(),
      fastForward: vi.fn(),
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () =>
      root.render(<LegacyReplayControls visible={false} handlers={handlers} />)
    );
    expect(host.childElementCount).toBe(0);

    await act(async () =>
      root.render(<LegacyReplayControls visible handlers={handlers} />)
    );
    const buttons = [...host.querySelectorAll('button')];
    expect(
      buttons.map((button) => ({
        id: button.id,
        symbol: button.textContent?.trim(),
        className: button.className,
        disabled: button.disabled,
      }))
    ).toEqual([
      {
        id: 'setupButton',
        symbol: '⏮',
        className: 'neutral-color',
        disabled: false,
      },
      {
        id: 'resetButton',
        symbol: '◀',
        className: 'spectator-color',
        disabled: false,
      },
      {
        id: 'setupBothButton',
        symbol: '▶',
        className: 'spectator-color',
        disabled: false,
      },
      {
        id: 'resetBothButton',
        symbol: '⏭',
        className: 'neutral-color',
        disabled: false,
      },
    ]);

    for (const button of buttons) {
      await act(async () => button.click());
    }
    expect(handlers.restart).toHaveBeenCalledTimes(1);
    expect(handlers.previous).toHaveBeenCalledTimes(1);
    expect(handlers.next).toHaveBeenCalledTimes(1);
    expect(handlers.fastForward).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});
