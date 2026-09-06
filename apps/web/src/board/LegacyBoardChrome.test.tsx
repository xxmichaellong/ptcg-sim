// @vitest-environment happy-dom

import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  flipBoardLayoutState,
  type BoardLayoutState,
} from '@ptcgsim/renderer-contract';
import { asPlayerId } from '@ptcgsim/game-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LegacyBoardChrome } from './LegacyBoardChrome.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const layoutState = (): BoardLayoutState => ({
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  playerIds: [asPlayerId('spike-blue'), asPlayerId('spike-red')],
  bottomPlayerId: asPlayerId('spike-blue'),
  shellMode: 'sidebar',
  vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
});

describe('LegacyBoardChrome', () => {
  afterEach(() => document.body.replaceChildren());

  it('paints source-shaped physical handles and delegates every legacy control', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const actions = {
      takeTurn: vi.fn(),
      flipCoin: vi.fn(),
      flipBoard: vi.fn(),
      refreshImages: vi.fn(),
      toggleFullscreen: vi.fn(),
    };
    const initial = createBoardLayoutSnapshot(layoutState());

    await act(async () =>
      root.render(
        <LegacyBoardChrome
          layout={initial}
          localPlayerId={asPlayerId('spike-blue')}
          darkMode={false}
          actions={actions}
        />
      )
    );

    const chrome = host.querySelector<HTMLElement>(
      '[data-legacy-board-chrome="true"]'
    );
    const lower = host.querySelector<HTMLElement>('#selfResizer');
    const upper = host.querySelector<HTMLElement>('#oppResizer');
    const controls = host.querySelector<HTMLElement>('#boardButtonContainer');
    expect(chrome?.style).toMatchObject({
      width: '1280px',
      height: '720px',
      pointerEvents: 'none',
    });
    expect(lower?.dataset.playerSide).toBe('local');
    expect(upper?.dataset.playerSide).toBe('opponent');
    expect(lower?.className).toBe('legacy-board-resizer');
    expect(lower?.style.background).toContain('rgba(90, 110, 188, 0.864)');
    expect(upper?.style.background).toContain('rgba(188, 90, 113, 0.864)');
    expect(Number.parseFloat(lower?.style.left ?? '')).toBeCloseTo(
      initial.resizeHandles[0].bounds.x,
      10
    );
    expect(Number.parseFloat(lower?.style.bottom ?? '')).toBeCloseTo(
      initial.viewport.height * initial.resizeHandles[0].authoredBottomRatio,
      10
    );
    expect(controls?.className).toBe('legacy-board-controls');
    expect(Number.parseFloat(controls?.style.left ?? '')).toBeCloseTo(
      initial.shared.boardControlsAnchor.x,
      10
    );
    expect(Number.parseFloat(controls?.style.top ?? '')).toBeCloseTo(
      initial.shared.boardControlsAnchor.y,
      10
    );
    expect(
      host.querySelector<HTMLButtonElement>('#turnButton button')?.className
    ).toBe('legacy-board-control-button');

    for (const id of [
      'turnButton',
      'flipCoinButton',
      'flipBoardButton',
      'refreshButton',
      'fullscreenPlaymatButton',
    ]) {
      host.querySelector<HTMLButtonElement>(`#${id} button`)?.click();
    }
    expect(actions.takeTurn).toHaveBeenCalledOnce();
    expect(actions.flipCoin).toHaveBeenCalledOnce();
    expect(actions.flipBoard).toHaveBeenCalledOnce();
    expect(actions.refreshImages).toHaveBeenCalledOnce();
    expect(actions.toggleFullscreen).toHaveBeenCalledOnce();

    const flipped = createBoardLayoutSnapshot(
      flipBoardLayoutState(layoutState())
    );
    await act(async () =>
      root.render(
        <LegacyBoardChrome
          layout={flipped}
          localPlayerId={asPlayerId('spike-blue')}
          darkMode={true}
          actions={actions}
        />
      )
    );
    expect(lower?.dataset.playerSide).toBe('opponent');
    expect(upper?.dataset.playerSide).toBe('local');
    expect(lower?.style.background).toContain('rgba(188, 90, 113, 0.864)');
    expect(upper?.style.background).toContain('rgba(90, 110, 188, 0.864)');
    expect(
      host.querySelector<HTMLButtonElement>('#turnButton button')?.className
    ).toBe('legacy-board-control-button dark-mode-2');

    await act(async () => root.unmount());
  });
});
