// @vitest-environment happy-dom

import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  createTableLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  flipBoardLayoutState,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  type BoardLayoutState,
} from '@ptcgsim/renderer-contract';
import { asPlayerId } from '@ptcgsim/game-core';
import { CoinIcon } from '@phosphor-icons/react/dist/csr/Coin';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { ShuffleIcon } from '@phosphor-icons/react/dist/csr/Shuffle';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LegacyBoardChrome,
  type LegacyBoardChromeRail,
} from './LegacyBoardChrome.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const layoutState = (): BoardLayoutState => ({
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  playerIds: [asPlayerId('spike-blue'), asPlayerId('spike-red')],
  bottomPlayerId: asPlayerId('spike-blue'),
  shellMode: 'sidebar',
  vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
});

const px = (value: string): number => Number.parseFloat(value);

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
    const actions = { toggleOncePerGame: vi.fn(), toggleHandSort };
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
    const actions = { toggleOncePerGame };
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

  it('lays the table rail along the seam: menu, game actions, More, the log', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const layout = createTableLayoutSnapshot({
      ...layoutState(),
      geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
      shellMode: 'fullscreen',
      vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
    });
    const takeTurn = vi.fn();
    const flipCoin = vi.fn();
    const mulligan = vi.fn();
    const rail = (coinPending: boolean): LegacyBoardChromeRail => ({
      start: <button id="menuStub" type="button" />,
      end: <button id="logStub" type="button" />,
      actions: [
        {
          id: 'turnButton',
          label: 'Turn',
          title: 'Start turn',
          icon: PlayIcon,
          hint: 'Alt+T',
          onSelect: takeTurn,
        },
        {
          id: 'flipCoinButton',
          label: 'Coin',
          title: 'Flip a coin',
          icon: CoinIcon,
          pending: coinPending,
          onSelect: flipCoin,
        },
      ],
      more: [
        {
          id: 'mulliganButton',
          label: 'Announce mulligan',
          icon: ShuffleIcon,
          onSelect: mulligan,
        },
      ],
    });
    const render = (coinPending: boolean, covered = false) =>
      act(async () =>
        root.render(
          <LegacyBoardChrome
            layout={layout}
            localPlayerId={asPlayerId('spike-blue')}
            players={players}
            darkMode
            actions={{ toggleOncePerGame: vi.fn() }}
            rail={rail(coinPending)}
            coveredByPopup={covered}
          />
        )
      );
    await render(false);

    // The rail spans the seam; the actions start at the layout's anchor and
    // stop short of the Stadium that straddles it.
    const anchor = layout.shared.boardControlsAnchor;
    const stadium = layout.shared.stadium.physicalDeclaredBounds;
    const strip = host.querySelector<HTMLElement>('[data-table-rail]')!;
    expect(px(strip.style.top)).toBeCloseTo(anchor.y, 3);
    expect(px(strip.style.height)).toBeCloseTo(anchor.height, 3);
    expect(strip.style.getPropertyValue('--rail-height')).toBe(
      `${anchor.height}px`
    );
    const actions = host.querySelector<HTMLElement>('#boardButtonContainer')!;
    expect(actions.getAttribute('role')).toBe('toolbar');
    expect(actions.getAttribute('aria-label')).toBe('Game actions');
    expect(px(actions.style.left)).toBeCloseTo(anchor.x, 3);
    expect(px(actions.style.left) + px(actions.style.width)).toBeCloseTo(
      stadium.x - 8,
      3
    );

    // The menu at the left end, the log at the right, outside the actions.
    const [startGroup, endGroup] = [
      ...host.querySelectorAll<HTMLElement>('.ptcgsim-table-rail__end-group'),
    ];
    expect(startGroup?.querySelector('#menuStub')).not.toBeNull();
    expect(startGroup?.style.left).toBe('8px');
    expect(endGroup?.querySelector('#logStub')).not.toBeNull();
    expect(endGroup?.style.right).toBe('8px');
    expect(actions.querySelector('#menuStub, #logStub')).toBeNull();

    // A toolbar: the arrow keys move between its buttons and wrap, and the
    // table never sees them.
    const railButtons = [
      ...actions.querySelectorAll<HTMLButtonElement>(
        'button.ptcgsim-rail-button'
      ),
    ];
    railButtons[0]!.focus();
    const arrow = (key: string) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        document.activeElement!.dispatchEvent(event);
      });
      return event;
    };
    expect(arrow('ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(railButtons[1]);
    arrow('ArrowLeft');
    arrow('ArrowLeft');
    expect(document.activeElement).toBe(railButtons.at(-1));

    // Short words on the pills, the full name for assistive tech.
    const turn = host.querySelector<HTMLButtonElement>('#turnButton')!;
    expect(turn.className).toBe('ptcgsim-rail-button');
    expect(turn.getAttribute('aria-label')).toBe('Start turn');
    expect(turn.textContent).toBe('Turn');
    expect(
      turn
        .querySelector('svg.ptcgsim-rail-button__icon')
        ?.getAttribute('aria-hidden')
    ).toBe('true');
    await act(async () => turn.click());
    expect(takeTurn).toHaveBeenCalledOnce();

    // The coin is the one action that waits on the room, and says so; it
    // stays pressable, as v1 lets you flip again while one is in flight.
    const coin = () =>
      host.querySelector<HTMLButtonElement>('#flipCoinButton')!;
    expect(coin().getAttribute('aria-busy')).toBeNull();
    expect(coin().dataset.controlPending).toBeUndefined();
    await render(true);
    expect(coin().getAttribute('aria-busy')).toBe('true');
    expect(coin().dataset.controlPending).toBe('true');
    expect(turn.getAttribute('aria-busy')).toBeNull();
    expect(coin().disabled).toBe(false);
    await act(async () => coin().click());
    expect(flipCoin).toHaveBeenCalledOnce();

    // The rarer actions wait behind More.
    const more = host.querySelector<HTMLButtonElement>('#moreActionsButton')!;
    expect(more.getAttribute('aria-label')).toBe('More');
    expect(host.querySelector('#mulliganButton')).toBeNull();
    await act(async () => more.click());
    const entry = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('#mulliganButton');
      expect(found).not.toBeNull();
      return found!;
    });
    await act(async () => entry.click());
    expect(mulligan).toHaveBeenCalledOnce();

    // A pile browser over the table dims the actions and takes their
    // presses, but leaves the menu and the log in reach.
    await render(false, true);
    expect(actions.dataset.covered).toBe('true');
    expect(startGroup?.closest('[data-covered]')).toBeNull();
    expect(endGroup?.closest('[data-covered]')).toBeNull();

    await act(async () => root.unmount());
    host.remove();
  });

  it('runs the actions to the end reserve when nothing straddles the seam', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    // With the opponent's half hidden, the Stadium sits beside the Active
    // rather than across the seam.
    const layout = createTableLayoutSnapshot({
      ...layoutState(),
      geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
      shellMode: 'fullscreen',
      vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
      hiddenPhysicalSide: 'upper',
    });
    const anchor = layout.shared.boardControlsAnchor;
    const stadium = layout.shared.stadium.physicalDeclaredBounds;
    const straddles =
      stadium.y < anchor.y + anchor.height &&
      stadium.y + stadium.height > anchor.y &&
      stadium.x > anchor.x;
    await act(async () =>
      root.render(
        <LegacyBoardChrome
          layout={layout}
          localPlayerId={asPlayerId('spike-blue')}
          players={players}
          darkMode={false}
          actions={{ toggleOncePerGame: vi.fn() }}
          rail={{ actions: [] }}
        />
      )
    );
    const actions = host.querySelector<HTMLElement>('#boardButtonContainer')!;
    const end = px(actions.style.left) + px(actions.style.width);
    if (straddles) expect(end).toBeCloseTo(stadium.x - 8, 3);
    else expect(end).toBeCloseTo(layout.playAreaBounds.width - 64 - 8, 3);
    // No More without rarer actions, and no ends unless a route gives them.
    expect(host.querySelector('#moreActionsButton')).toBeNull();
    expect(
      host.querySelectorAll('.ptcgsim-table-rail__end-group')
    ).toHaveLength(0);

    await act(async () => root.unmount());
    host.remove();
  });

  it('styles the rail as glassy pills from the design tokens', () => {
    const css = readFileSync(
      join(import.meta.dirname, 'rail', 'TableRail.css'),
      'utf8'
    );
    const buttonRule = css.slice(css.indexOf('.ptcgsim-rail-button {'));
    for (const token of [
      'var(--color-surface-2)',
      'var(--color-border)',
      'var(--shadow-2)',
      'var(--radius-pill)',
      'var(--duration-instant)',
      'var(--rail-height, 32px)',
    ]) {
      expect(buttonRule.slice(0, buttonRule.indexOf('}')), token).toContain(
        token
      );
    }
    expect(css).toMatch(
      /\.ptcgsim-rail-button:active \{\s*scale: var\(--control-press-scale\);/
    );
    expect(css).toContain('.ptcgsim-rail-button:focus-visible {');
    expect(css).toMatch(
      /\.ptcgsim-table-rail__actions\[data-covered='true'\] \{\s*opacity: 0\.15;/
    );
    // Short of room (the rail decides), the labels give way to the icons.
    expect(css).toMatch(
      /\[data-labels='none'\] \.ptcgsim-rail-button__label \{\s*display: none;/
    );

    const chrome = readFileSync(
      join(import.meta.dirname, 'LegacyBoardChrome.css'),
      'utf8'
    );
    expect(chrome).toMatch(
      /\.legacy-board-resizer\[data-player-side='local'\] \{\s*--ptcgsim-resizer-seat: var\(--color-you/
    );
    // The old toolbar's own rules are gone with it.
    expect(chrome).not.toContain('legacy-board-control-button');
    expect(chrome).not.toContain('tooltiptext');
  });

  it('paints source-shaped physical handles and the seats GX/VSTAR controls', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const actions = { toggleOncePerGame: vi.fn() };
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
    // Without a rail, the seam stays empty.
    expect(host.querySelector('#boardButtonContainer')).toBeNull();
    expect(host.querySelector('[data-table-rail]')).toBeNull();
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
    expect(
      flippedLocalFrame?.querySelector('[data-once-per-game-marker="gx"]')
        ?.classList
    ).toContain('dark-mode-2');

    await act(async () => root.unmount());
  });

  it('drops the resize handles on the play-mat table, and a hidden half with its markers', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const table = (hidden?: 'upper') =>
      createTableLayoutSnapshot({
        ...layoutState(),
        geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
        shellMode: 'fullscreen',
        vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
        ...(hidden ? { hiddenPhysicalSide: hidden } : {}),
      });
    const render = (hidden?: 'upper') =>
      act(async () =>
        root.render(
          <LegacyBoardChrome
            layout={table(hidden)}
            localPlayerId={asPlayerId('spike-blue')}
            players={players}
            darkMode
            actions={{ toggleOncePerGame: vi.fn() }}
          />
        )
      );
    await render();
    // The table is split from Settings, not dragged.
    expect(host.querySelector('#selfResizer')).toBeNull();
    expect(host.querySelector('#oppResizer')).toBeNull();
    expect(host.querySelectorAll('[data-player-frame-chrome]')).toHaveLength(2);
    // A hidden half takes its markers and Sort box with it.
    await render('upper');
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-player-frame-chrome]')].map(
        (frame) => frame.dataset.playerFrameChrome
      )
    ).toEqual(['spike-blue']);
    await act(async () => root.unmount());
  });
});
