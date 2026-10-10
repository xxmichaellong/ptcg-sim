// @vitest-environment happy-dom

import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  flipBoardLayoutState,
  type BoardLayoutState,
} from '@ptcgsim/renderer-contract';
import { asPlayerId } from '@ptcgsim/game-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('paints v1 hand Sort checkboxes in each player frame and reports their state', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const toggleHandSort = vi.fn();
    const actions = {
      takeTurn: vi.fn(),
      flipCoin: vi.fn(),
      flipBoard: vi.fn(),
      refreshImages: vi.fn(),
      toggleFullscreen: vi.fn(),
      toggleOncePerGame: vi.fn(),
      toggleHandSort,
    };
    await act(async () =>
      root.render(
        <LegacyBoardChrome
          layout={createBoardLayoutSnapshot(layoutState())}
          localPlayerId={asPlayerId('spike-blue')}
          players={players}
          darkMode={false}
          actions={actions}
          sortedHandPlayerIds={new Set([asPlayerId('spike-red')])}
        />
      )
    );
    const own = host.querySelector<HTMLInputElement>('#sortHandCheckbox')!;
    const opponent = host.querySelector<HTMLInputElement>(
      '#oppSortHandCheckbox'
    )!;
    expect(own.checked).toBe(false);
    expect(opponent.checked).toBe(true);
    // Each checkbox lives in its player's rotated frame, at v1's `#handLabel`
    // spot, with the opponent's text flipped back upright.
    expect(
      own
        .closest('[data-player-frame-chrome]')
        ?.getAttribute('data-player-side')
    ).toBe('local');
    expect(
      opponent
        .closest('[data-player-frame-chrome]')
        ?.getAttribute('data-player-side')
    ).toBe('opponent');
    expect(
      opponent.parentElement?.querySelector('.opp-text')?.textContent
    ).toBe('Sort');
    await act(async () => own.click());
    expect(toggleHandSort).toHaveBeenCalledWith(asPlayerId('spike-blue'), true);
    await act(async () => opponent.click());
    expect(toggleHandSort).toHaveBeenCalledWith(asPlayerId('spike-red'), false);
    await act(async () => root.unmount());
  });

  it('paints GX and VSTAR as tiles that turn face down when used', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const toggleOncePerGame = vi.fn();
    const actions = {
      takeTurn: vi.fn(),
      flipCoin: vi.fn(),
      flipBoard: vi.fn(),
      refreshImages: vi.fn(),
      toggleFullscreen: vi.fn(),
      toggleOncePerGame,
    };
    const layout = createBoardLayoutSnapshot(layoutState());
    const render = async (gxUsed: boolean): Promise<void> => {
      await act(async () =>
        root.render(
          <LegacyBoardChrome
            layout={layout}
            localPlayerId={asPlayerId('spike-blue')}
            players={{
              ...players,
              'spike-blue': {
                ...players['spike-blue'],
                oncePerGame: { gxUsed, vstarUsed: true },
              },
            }}
            darkMode={false}
            actions={actions}
          />
        )
      );
    };
    const marker = (side: 'local' | 'opponent', kind: 'gx' | 'vstar') =>
      host.querySelector<HTMLButtonElement>(
        `[data-player-side="${side}"][data-once-per-game-marker="${kind}"]`
      )!;

    await render(false);
    const gx = marker('local', 'gx');
    // A real button with the player's name, its state and both faces.
    expect(gx.tagName).toBe('BUTTON');
    expect(gx.getAttribute('aria-label')).toBe('Blue GX');
    expect(gx.getAttribute('aria-pressed')).toBe('false');
    const tile = gx.querySelector<HTMLElement>('.once-per-game-tile')!;
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(
      [...tile.children].map((face) => face.className.split(' ').at(-1))
    ).toEqual([
      'once-per-game-tile__face--front',
      'once-per-game-tile__face--back',
    ]);
    expect(tile.querySelectorAll('svg')).toHaveLength(2);
    // Inline SVG ids stay unique across the four tiles on the page.
    const ids = [...host.querySelectorAll('[id]')]
      .map((element) => element.id)
      .filter((id) => /^(gx|vstar)-/.test(id));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const side of ['local', 'opponent'] as const) {
      for (const kind of ['gx', 'vstar'] as const) {
        const button = marker(side, kind);
        expect(
          Number.parseFloat(button.style.height),
          `${side} ${kind}`
        ).toBeGreaterThanOrEqual(32);
        // The VSTAR die-cut is wider than the GX tile.
        expect(Number.parseFloat(button.style.width)).toBeGreaterThan(
          Number.parseFloat(button.style.height)
        );
      }
    }
    expect(marker('local', 'vstar').getAttribute('aria-pressed')).toBe('true');
    expect(marker('opponent', 'gx').getAttribute('aria-pressed')).toBe('true');

    await act(async () => gx.click());
    expect(toggleOncePerGame).toHaveBeenCalledExactlyOnceWith(
      asPlayerId('spike-blue'),
      'gx'
    );
    // The room's answer turns it over; the same node keeps focus and input.
    await render(true);
    expect(marker('local', 'gx')).toBe(gx);
    expect(gx.getAttribute('aria-pressed')).toBe('true');
    expect(gx.classList).toContain('used-special-move');
    await render(false);
    expect(gx.getAttribute('aria-pressed')).toBe('false');

    await act(async () => root.unmount());
    host.remove();
  });

  it('turns the tiles in 3D and keeps them still when motion is reduced', () => {
    const css = readFileSync(
      join(import.meta.dirname, 'LegacyBoardChrome.css'),
      'utf8'
    );
    expect(css).toMatch(
      /\[aria-pressed='true'\]\s+\.once-per-game-tile\s*\{\s*transform: rotateY\(180deg\);/
    );
    expect(css).toContain('backface-visibility: hidden;');
    expect(css).toMatch(
      /transition: transform var\(--duration-slow, 320ms\)\s+var\(--ease-snappy/
    );
    expect(css).toMatch(
      /:root\[data-motion='reduced'\] \.ptcgsim-legacy-board-chrome \.once-per-game-tile,/
    );
  });

  it('paints the board controls as icon pills that keep their names and anchors', async () => {
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
    const render = async (shellMode: 'sidebar' | 'fullscreen') =>
      act(async () =>
        root.render(
          <LegacyBoardChrome
            layout={createBoardLayoutSnapshot({ ...layoutState(), shellMode })}
            localPlayerId={asPlayerId('spike-blue')}
            players={players}
            darkMode={false}
            actions={actions}
          />
        )
      );
    await render('sidebar');
    const controls = [
      ['turnButton', 'Start turn', 'Turn'],
      ['flipCoinButton', 'Flip coin', 'Coin'],
      ['flipBoardButton', 'Flip board', ''],
      ['refreshButton', 'Refresh images', ''],
      ['fullscreenPlaymatButton', 'Full screen', ''],
    ] as const;
    for (const [id, name, text] of controls) {
      const wrapper = host.querySelector<HTMLElement>(`#${id}`)!;
      const button = wrapper.querySelector<HTMLButtonElement>('button')!;
      expect(button.className, id).toBe('legacy-board-control-button');
      expect(button.getAttribute('aria-label'), id).toBe(name);
      // A Phosphor icon replaces v1's glyphs; it is decoration only.
      const icon = button.querySelector('svg.legacy-board-control-icon');
      expect(icon?.getAttribute('aria-hidden'), id).toBe('true');
      expect(button.textContent, id).toBe(text);
      const tooltip = wrapper.querySelector<HTMLElement>('.tooltiptext')!;
      expect(tooltip.textContent).toBe(name);
      expect(tooltip.getAttribute('aria-hidden')).toBe('true');
    }
    expect(host.textContent).not.toMatch(/[⇅↻⌞⌝]|\+Turn/u);
    const sidebarIcon = host.querySelector('#fullscreenIcon')!.innerHTML;
    await render('fullscreen');
    // The full-screen control shows which way it will go.
    expect(host.querySelector('#fullscreenIcon')!.innerHTML).not.toBe(
      sidebarIcon
    );
    expect(
      host
        .querySelector('#fullscreenPlaymatButton button')
        ?.getAttribute('aria-label')
    ).toBe('Full screen');

    const css = readFileSync(
      join(import.meta.dirname, 'LegacyBoardChrome.css'),
      'utf8'
    );
    const buttonRule = css.slice(
      css.indexOf('.ptcgsim-legacy-board-chrome .legacy-board-control-button {')
    );
    for (const token of [
      'var(--color-surface-2',
      'var(--color-border',
      'var(--shadow-2',
      'var(--radius-pill',
      'var(--duration-instant',
    ]) {
      expect(buttonRule.slice(0, buttonRule.indexOf('}')), token).toContain(
        token
      );
    }
    expect(css).toMatch(
      /\.legacy-board-control-button:active \{\s*scale: 0\.96;/
    );
    expect(css).toContain('.legacy-board-control-button:focus-visible {');
    expect(css).toMatch(
      /\.legacy-board-resizer\[data-player-side='local'\] \{\s*--ptcgsim-resizer-seat: var\(--color-you/
    );

    await act(async () => root.unmount());
    host.remove();
  });

  it('marks the coin control as waiting on the room, and only that one', async () => {
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
    const layout = createBoardLayoutSnapshot(layoutState());
    const render = async (coinPending: boolean): Promise<void> => {
      await act(async () =>
        root.render(
          <LegacyBoardChrome
            layout={layout}
            localPlayerId={asPlayerId('spike-blue')}
            players={players}
            darkMode={false}
            actions={actions}
            coinPending={coinPending}
          />
        )
      );
    };
    const coin = () =>
      host.querySelector<HTMLButtonElement>('#flipCoinButton button');
    const turn = () =>
      host.querySelector<HTMLButtonElement>('#turnButton button');

    await render(false);
    expect(coin()?.getAttribute('aria-busy')).toBeNull();
    expect(coin()?.dataset.controlPending).toBeUndefined();

    // The coin is the one control that cannot be predicted, so it is the one
    // control that says it is waiting.
    await render(true);
    expect(coin()?.getAttribute('aria-busy')).toBe('true');
    expect(coin()?.dataset.controlPending).toBe('true');
    expect(turn()?.getAttribute('aria-busy')).toBeNull();
    // It stays pressable: v1 lets you flip again while one is in flight.
    expect(coin()?.disabled).toBe(false);
    coin()?.click();
    expect(actions.flipCoin).toHaveBeenCalled();

    await render(false);
    expect(coin()?.getAttribute('aria-busy')).toBeNull();

    await act(async () => root.unmount());
    host.remove();
  });

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
    // Each pill wears its seat's colour token through `data-player-side`.
    expect(lower?.style.background).toBe('');
    expect(upper?.style.background).toBe('');
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
    // No Sort checkbox is painted until a route supplies the callback.
    expect(host.querySelector('#sortHandCheckbox')).toBeNull();

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
