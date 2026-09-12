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

const players = {
  'spike-blue': {
    id: asPlayerId('spike-blue'),
    displayName: 'Blue',
    cardBackUrl: '/blue.png',
    coachingConsent: false,
    oncePerGame: { gxUsed: false, vstarUsed: true },
  },
  'spike-red': {
    id: asPlayerId('spike-red'),
    displayName: 'Red',
    cardBackUrl: '/red.png',
    coachingConsent: false,
    oncePerGame: { gxUsed: true, vstarUsed: false },
  },
};

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
      toggleOncePerGame: vi.fn(),
    };
    const initial = createBoardLayoutSnapshot(layoutState());

    await act(async () =>
      root.render(
        <LegacyBoardChrome
          layout={initial}
          localPlayerId={asPlayerId('spike-blue')}
          players={players}
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
    expect(
      host
        .querySelector<HTMLButtonElement>(
          '[data-player-id="spike-blue"][data-once-per-game-marker="vstar"]'
        )
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      host.querySelector<HTMLButtonElement>(
        '[data-player-id="spike-red"][data-once-per-game-marker="gx"]'
      )?.classList
    ).toContain('used-special-move');

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
    host
      .querySelector<HTMLButtonElement>(
        '[data-player-id="spike-blue"][data-once-per-game-marker="gx"]'
      )
      ?.click();
    expect(actions.toggleOncePerGame).toHaveBeenCalledWith(
      asPlayerId('spike-blue'),
      'gx'
    );

    const flipped = createBoardLayoutSnapshot(
      flipBoardLayoutState(layoutState())
    );
    await act(async () =>
      root.render(
        <LegacyBoardChrome
          layout={flipped}
          localPlayerId={asPlayerId('spike-blue')}
          players={players}
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
    const flippedLocalFrame = host.querySelector<HTMLElement>(
      '[data-player-frame-chrome="spike-blue"]'
    );
    const flippedOpponentFrame = host.querySelector<HTMLElement>(
      '[data-player-frame-chrome="spike-red"]'
    );
    expect(flippedLocalFrame?.dataset.playerSide).toBe('local');
    expect(flippedLocalFrame?.dataset.playerLayoutSide).toBe('opponent');
    expect(flippedLocalFrame?.dataset.playerPhysicalSide).toBe('upper');
    expect(flippedOpponentFrame?.dataset.playerSide).toBe('opponent');
    expect(flippedOpponentFrame?.dataset.playerLayoutSide).toBe('local');
    expect(flippedOpponentFrame?.dataset.playerPhysicalSide).toBe('lower');
    expect(
      flippedLocalFrame
        ?.querySelector<HTMLButtonElement>(
          '[data-once-per-game-marker="vstar"]'
        )
        ?.getAttribute('aria-pressed')
    ).toBe('true');

    await act(async () =>
      root.render(
        <LegacyBoardChrome
          layout={flipped}
          localPlayerId={asPlayerId('spike-blue')}
          players={players}
          darkMode={true}
          actions={actions}
          visibility={{ playerActions: false, flipBoard: false }}
          refreshingImages
        />
      )
    );
    expect(host.querySelector('#turnButton')).toBeNull();
    expect(host.querySelector('#flipCoinButton')).toBeNull();
    expect(host.querySelector('#flipBoardButton')).toBeNull();
    expect(host.querySelector('#refreshButton')).not.toBeNull();
    expect(host.querySelector('#fullscreenPlaymatButton')).not.toBeNull();
    expect(host.querySelector<HTMLElement>('#refreshIcon')?.style.display).toBe(
      'none'
    );
    expect(
      host.querySelector<HTMLElement>('#loadingCircle')?.style.display
    ).toBe('block');

    await act(async () => root.unmount());
  });
});
