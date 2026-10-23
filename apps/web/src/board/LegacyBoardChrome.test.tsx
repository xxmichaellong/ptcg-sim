// @vitest-environment happy-dom

import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  createTableLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  flipBoardLayoutState,
  TABLE_CONTROL_CORNER_PX,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  tableVerticalLayout,
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
  handSortTooltip,
  LegacyBoardChrome,
  type LegacyBoardChromeRail,
  type TableHandCount,
} from './LegacyBoardChrome.js';
import { oncePerGameTooltip } from './OncePerGameTile.js';
import { tableCoinSpots } from './table-coin.js';

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

/**
 * Where the seam's right end is for the rail's actions: short of the near
 * piles that start at the seam, or of the table's edge.
 */
const seamEnd = (layout: ReturnType<typeof createTableLayoutSnapshot>) => {
  const stadium = layout.shared.stadium.physicalDeclaredBounds;
  const anchor = layout.shared.boardControlsAnchor;
  const lower = layout.players.find(
    (frame) => frame.physicalSide === 'lower' && !frame.hidden
  );
  const piles = (lower?.regions ?? [])
    .filter(
      (region) =>
        ['deck', 'discard', 'lostZone'].includes(region.kind) &&
        region.physicalDeclaredBounds.x > stadium.x + stadium.width &&
        region.physicalDeclaredBounds.y < anchor.y + anchor.height + 40
    )
    .map((region) => region.physicalDeclaredBounds.x - 8);
  return Math.min(layout.playAreaBounds.width - 8, ...piles);
};

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

  it('fits GX and VSTAR side by side in the corner beside the hand on an upright phone, clear of its first cards', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    for (const [width, height] of [
      [360, 780],
      [390, 844],
      [430, 932],
    ] as const) {
      const layout = createTableLayoutSnapshot({
        ...layoutState(),
        viewport: { width, height, devicePixelRatio: 1 },
        geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
        shellMode: 'fullscreen',
        vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
        oncePerGameMarkers: 2,
      });
      await act(async () =>
        root.render(
          <LegacyBoardChrome
            layout={layout}
            localPlayerId={asPlayerId('spike-blue')}
            players={players}
            darkMode={false}
            actions={{ toggleOncePerGame: vi.fn() }}
          />
        )
      );
      const at = `${String(width)}x${String(height)}`;
      const near = host.querySelector<HTMLElement>(
        '.legacy-player-frame-chrome[data-player-side="local"]'
      )!;
      expect(near.dataset['corner'], at).toBe('compact');
      const size = (kind: string) =>
        near.querySelector<HTMLElement>(
          `[data-once-per-game-marker="${kind}"]`
        )!.style;
      // shell.css lays them 6px in, 4px apart, 24px tall.
      expect(px(size('vstar').height), at).toBe(24);
      expect(px(size('gx').height), at).toBe(24);
      expect(
        6 + px(size('vstar').width) + 4 + px(size('gx').width),
        at
      ).toBeLessThanOrEqual(TABLE_CONTROL_CORNER_PX);
      // The hand starts past that corner, at its usual place.
      const hand = layout.players
        .find((player) => player.playerId === asPlayerId('spike-blue'))!
        .regions.find((region) => region.kind === 'hand')!;
      expect(hand.physicalDeclaredBounds.x, at).toBe(TABLE_CONTROL_CORNER_PX);
    }
    await act(async () => root.unmount());
    host.remove();
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

  it('lays the turn’s actions along the seam, the app bar apart in its corner', async () => {
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
      bar: <button id="barStub" type="button" />,
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
      // Three rarer actions: a menu's worth (fewer sit on the rail).
      more: [
        {
          id: 'mulliganButton',
          label: 'Announce mulligan',
          icon: ShuffleIcon,
          onSelect: mulligan,
        },
        {
          id: 'setupButton',
          label: 'Set up again',
          icon: ShuffleIcon,
          onSelect: vi.fn(),
        },
        {
          id: 'resetButton',
          label: 'Reset',
          icon: ShuffleIcon,
          onSelect: vi.fn(),
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

    // The rail spans the seam; the actions run from past the Stadium that
    // straddles it to the seam's right end (ADR-036).
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
    expect(actions.dataset.align).toBe('end');
    expect(px(actions.style.left)).toBeCloseTo(
      stadium.x + stadium.width + 8,
      3
    );
    // ...stopping short of the near piles there.
    expect(px(actions.style.left) + px(actions.style.width)).toBeCloseTo(
      seamEnd(layout),
      3
    );
    expect(seamEnd(layout)).toBeLessThan(layout.playAreaBounds.width - 8);

    // The app bar sits apart, in the corner the layout keeps clear.
    const slot = host.querySelector<HTMLElement>('.ptcgsim-app-bar-slot')!;
    expect(slot.querySelector('#barStub')).not.toBeNull();
    expect(slot.style.top).toBe('8px');
    expect(px(slot.style.right)).toBeCloseTo(
      layout.viewport.width - layout.playAreaBounds.width + 8,
      3
    );
    expect(actions.querySelector('#barStub')).toBeNull();

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
    // presses, but leaves the app bar in reach.
    await render(false, true);
    expect(actions.dataset.covered).toBe('true');
    expect(slot.closest('[data-covered]')).toBeNull();

    await act(async () => root.unmount());
    host.remove();
  });

  it('lines the actions up at the seam where the Stadium leaves room', async () => {
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
    const pastStadium = straddles ? stadium.x + stadium.width + 8 : anchor.x;
    const roomPast = seamEnd(layout) - pastStadium;
    if (roomPast >= 4 * anchor.height + 3 * 6) {
      expect(actions.dataset.align).toBe('end');
      expect(px(actions.style.left)).toBeCloseTo(pastStadium, 3);
      expect(end).toBeCloseTo(seamEnd(layout), 3);
    } else {
      expect(actions.dataset.align).toBe('start');
      expect(px(actions.style.left)).toBeCloseTo(anchor.x, 3);
      expect(end).toBeCloseTo(straddles ? stadium.x - 8 : seamEnd(layout), 3);
    }
    // No More without rarer actions, and no app bar unless a route gives one.
    expect(host.querySelector('#moreActionsButton')).toBeNull();
    expect(host.querySelectorAll('.ptcgsim-app-bar-slot')).toHaveLength(0);

    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the actions clear of the near half’s `+` where it reaches into the seam', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    // A small phone held sideways, the near half at its smallest.
    const layout = createTableLayoutSnapshot({
      ...layoutState(),
      geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
      viewport: { width: 568, height: 320, devicePixelRatio: 1 },
      shellMode: 'fullscreen',
      vertical: tableVerticalLayout(0.34),
      seamBandPx: 42,
      hideEmptyLostZone: true,
      appBarPx: { width: 3 * 36 + 2 * 4 + 6, height: 42 },
    });
    const anchor = layout.shared.boardControlsAnchor;
    const extras = layout.players.find(
      (frame) => frame.physicalSide === 'lower'
    )?.extras?.control;
    expect(extras).toBeDefined();
    expect(extras!.y).toBeLessThan(anchor.y + anchor.height);
    const action = (id: string) => ({
      id,
      label: id,
      icon: PlayIcon,
      onSelect: vi.fn(),
    });
    await act(async () =>
      root.render(
        <LegacyBoardChrome
          layout={layout}
          localPlayerId={asPlayerId('spike-blue')}
          players={players}
          darkMode={false}
          actions={{ toggleOncePerGame: vi.fn() }}
          rail={{
            actions: ['turn', 'attack', 'pass', 'coin', 'undo', 'switch'].map(
              action
            ),
            more: ['a', 'b', 'c'].map((id) => ({
              id,
              label: id,
              onSelect: vi.fn(),
            })),
          }}
        />
      )
    );
    // Wherever the actions go, they never start over the `+`.
    const actions = host.querySelector<HTMLElement>('#boardButtonContainer')!;
    expect(px(actions.style.left)).toBeGreaterThanOrEqual(
      extras!.x + extras!.width
    );

    await act(async () => root.unmount());
    host.remove();
  });

  it('puts a turn past the Stadium where it fits there, the coin lying on the table', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    // A desktop with the log docked beside the table.
    const layout = createTableLayoutSnapshot({
      ...layoutState(),
      geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
      viewport: { width: 1920, height: 1080, devicePixelRatio: 1 },
      shellMode: 'sidebar',
      vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
      seamBandPx: 42,
      hideEmptyLostZone: true,
      appBarPx: { width: 3 * 36 + 2 * 4 + 6, height: 42 },
    });
    expect(tableCoinSpots(layout).some((spot) => spot.own)).toBe(true);
    const action = (id: string) => ({
      id,
      label: id,
      icon: PlayIcon,
      onSelect: vi.fn(),
    });
    // A Solo turn's fullest rail with the coin on the table.
    const rail = (coinOnTable: boolean): LegacyBoardChromeRail => ({
      actions: ['turn', 'attack', 'pass', 'undo', 'switch'].map(action),
      more: ['a', 'b', 'c'].map((id) => ({
        id,
        label: id,
        onSelect: vi.fn(),
      })),
      ...(coinOnTable ? { coinOnTable } : {}),
    });
    const align = async (coinOnTable: boolean) => {
      await act(async () =>
        root.render(
          <LegacyBoardChrome
            layout={layout}
            localPlayerId={asPlayerId('spike-blue')}
            players={players}
            darkMode={false}
            actions={{ toggleOncePerGame: vi.fn() }}
            rail={rail(coinOnTable)}
          />
        )
      );
      const actions = host.querySelector<HTMLElement>('#boardButtonContainer')!;
      return {
        align: actions.dataset.align,
        shown: actions.querySelectorAll('.ptcgsim-rail-button').length,
      };
    };
    // Six buttons fit past the Stadium: a rail that could hold a Coin as
    // well stays before it, one that can't goes past it, losing nothing.
    expect(await align(false)).toMatchObject({ align: 'start' });
    expect(await align(true)).toEqual({ align: 'end', shown: 6 });

    await act(async () => root.unmount());
    host.remove();
  });

  it('styles the rail as rounded buttons from the design tokens', () => {
    const css = readFileSync(
      join(import.meta.dirname, 'rail', 'TableRail.css'),
      'utf8'
    );
    const buttonRule = css.slice(css.indexOf('.ptcgsim-rail-button {'));
    for (const token of [
      'var(--color-surface-2)',
      'var(--color-border)',
      'var(--shadow-2)',
      'var(--radius-control)',
      'var(--control-press-timing)',
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
    // The game actions are icons; the tooltips carry the words.
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

  it('counts the hand in a pill of the number and Sort, Sort named by its tooltip', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const toggleHandSort = vi.fn();
    const handCount = (
      playerId: string,
      side: 'local' | 'opponent',
      count: number
    ): TableHandCount => ({
      playerId: asPlayerId(playerId),
      node: {
        id: `${playerId}-hand-count`,
        zoneId: `${playerId}-hand`,
        playerId: asPlayerId(playerId),
        side,
        kind: 'hand',
        count,
        anchor: { x: 900, y: side === 'local' ? 680 : 40 },
        horizontalAlign: side === 'local' ? 'left' : 'right',
        verticalAlign: side === 'local' ? 'bottom' : 'top',
        fontSizePx: 13,
        color: 'rgb(90 110 188)',
        zIndex: 1,
        label: `${count} cards in hand`,
      },
    });
    const render = (sorted: ReadonlySet<string>) =>
      act(async () =>
        root.render(
          <LegacyBoardChrome
            layout={createTableLayoutSnapshot({
              ...layoutState(),
              geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
              shellMode: 'fullscreen',
              vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
            })}
            localPlayerId={asPlayerId('spike-blue')}
            players={players}
            darkMode
            actions={{ toggleOncePerGame: vi.fn(), toggleHandSort }}
            sortedHandPlayerIds={new Set([...sorted].map(asPlayerId))}
            handCounts={[
              handCount('spike-blue', 'local', 7),
              handCount('spike-red', 'opponent', 6),
            ]}
          />
        )
      );
    await render(new Set());
    const pill = host.querySelector<HTMLElement>('.table-hand-pill--local')!;
    // The number and Sort, nothing else (PX-046: no cards icon).
    expect(
      [...pill.children].map((child) => child.className.split(' ').at(-1))
    ).toEqual(['table-hand-pill__count', 'table-hand-pill__sort']);
    expect(pill.querySelector('.table-hand-pill__count')?.textContent).toBe(
      '7'
    );
    expect(pill.querySelector('.table-hand-pill__count svg')).toBeNull();
    // Sort is still v1's checkbox, its id and name on the input.
    const checkbox = pill.querySelector<HTMLInputElement>('#sortHandCheckbox')!;
    expect(checkbox.closest('label')?.textContent).toBe('Sort');
    await act(async () => {
      checkbox.focus();
      checkbox.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-ptcgsim-overlay="tooltip"]')?.textContent
      ).toBe('Sort hand in decklist order')
    );
    await act(async () => checkbox.click());
    expect(toggleHandSort).toHaveBeenCalledWith(asPlayerId('spike-blue'), true);
    await render(new Set(['spike-blue']));
    // A press puts the tooltip away; focus coming back brings it, reworded.
    await act(async () => {
      checkbox.blur();
      checkbox.focus();
      checkbox.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-ptcgsim-overlay="tooltip"]')?.textContent
      ).toBe('Stop sorting hand')
    );
    await act(async () => root.unmount());
  });

  it('words the Sort and marker tooltips by what a press does', () => {
    expect(handSortTooltip(false)).toBe('Sort hand in decklist order');
    expect(handSortTooltip(true)).toBe('Stop sorting hand');
    expect(oncePerGameTooltip('vstar', false)).toBe('Mark VSTAR used');
    expect(oncePerGameTooltip('gx', true)).toBe('GX used: press to undo');
  });
});
