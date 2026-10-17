// @vitest-environment happy-dom

import {
  asPlayerId,
  asViewCardId,
  type MatchViewState,
  type PlayerId,
} from '@ptcgsim/game-core';
import {
  createBoardScene,
  createEmptyBoardView,
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  type BoardLayoutState,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TableZoneAffordances,
  type TableZoneAffordancesProps,
} from './TableZoneAffordances.js';

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

/** The empty table with `count` face-down cards in one of a seat's zones. */
const withCards = (
  view: MatchViewState,
  playerId: PlayerId,
  kind: 'deck' | 'lostZone',
  count: number
): MatchViewState => {
  const id = `zone:${playerId}:${kind}`;
  return {
    ...view,
    zones: {
      ...view.zones,
      [id]: {
        ...view.zones[id]!,
        cards: Array.from({ length: count }, (_, index) => ({
          kind: 'concealed' as const,
          id: asViewCardId(`${playerId}-${kind}-${index}`),
          ownerId: playerId,
          cardBackUrl: '/back.png',
          publiclyRevealed: false as const,
        })),
      },
    },
  };
};

let host: HTMLDivElement;
let root: Root;

const render = async (
  view: MatchViewState,
  props: Partial<TableZoneAffordancesProps> = {},
  state: BoardLayoutState = layoutState()
) => {
  const layout = createTableLayoutSnapshot(state);
  const scene = createBoardScene(view, layout);
  await act(async () =>
    root.render(
      <TableZoneAffordances
        layout={layout}
        scene={scene}
        view={view}
        {...props}
      />
    )
  );
  return layout;
};

/** Lets Base UI's menus open, close and move focus. */
const settle = async (rounds = 3): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

const deckButton = (playerId: string) =>
  host.querySelector<HTMLButtonElement>(
    `[data-load-deck-player="${playerId}"]`
  );

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe('TableZoneAffordances', () => {
  it("puts a + on each listed seat's empty deck that loads that seat's deck", async () => {
    const onLoad = vi.fn();
    const layout = await render(createEmptyBoardView(), {
      loadDeck: { playerIds: [blue, red], onLoad },
    });
    const own = deckButton(blue)!;
    const other = deckButton(red)!;
    expect(own.getAttribute('aria-label')).toBe('Load a deck');
    expect(other.getAttribute('aria-label')).toBe("Load the other side's deck");
    expect(
      own.closest<HTMLElement>('.table-zone-affordance')?.dataset.playerSide
    ).toBe('local');
    expect(
      other.closest<HTMLElement>('.table-zone-affordance')?.dataset.playerSide
    ).toBe('opponent');

    // Each sits in its seat's deck slot.
    const deck = layout.players
      .find((frame) => frame.playerId === blue)!
      .regions.find((region) => region.kind === 'deck')!.physicalDeclaredBounds;
    const slot = own.closest<HTMLElement>('.table-zone-affordance')!;
    expect(Number.parseFloat(slot.style.left)).toBeCloseTo(deck.x, 6);
    expect(Number.parseFloat(slot.style.top)).toBeCloseTo(deck.y, 6);
    expect(Number.parseFloat(slot.style.width)).toBeCloseTo(deck.width, 6);

    await act(async () => own.click());
    await act(async () => other.click());
    expect(onLoad.mock.calls).toEqual([[blue], [red]]);
  });

  it('offers the + only to listed seats that have no cards yet', async () => {
    const onLoad = vi.fn();
    await render(createEmptyBoardView(), {
      loadDeck: { playerIds: [blue], onLoad },
    });
    expect(deckButton(blue)).not.toBeNull();
    expect(deckButton(red)).toBeNull();

    // A deck on the table, even one not yet set up, is not offered again.
    await render(withCards(createEmptyBoardView(), blue, 'deck', 60), {
      loadDeck: { playerIds: [blue, red], onLoad },
    });
    expect(deckButton(blue)).toBeNull();
    expect(deckButton(red)).not.toBeNull();

    // Without a route to load decks, nothing is offered.
    await render(createEmptyBoardView());
    expect(host.querySelector('[data-load-deck-player]')).toBeNull();
  });

  it('leaves a hidden half alone', async () => {
    await render(
      createEmptyBoardView(),
      { loadDeck: { playerIds: [blue, red], onLoad: vi.fn() } },
      layoutState({ hiddenPhysicalSide: 'upper' })
    );
    expect(deckButton(blue)).not.toBeNull();
    expect(deckButton(red)).toBeNull();
  });

  it("adds the optional pieces from a small + in the viewer's staging area", async () => {
    const lostZone = { shown: false, onShownChange: vi.fn() };
    const markers = {
      vstar: false,
      gx: false,
      onShownChange: vi.fn(),
      onToggle: vi.fn(),
    };
    const layout = await render(
      createEmptyBoardView(),
      { lostZone, markers },
      layoutState({ hideEmptyLostZone: true })
    );
    // Only on the viewer's own half, inside its staging area.
    const add = host.querySelectorAll<HTMLButtonElement>('#tableExtrasButton');
    expect(add).toHaveLength(1);
    expect(add[0]!.getAttribute('aria-label')).toBe('Add to the table');
    const own = layout.players.find((frame) => frame.playerId === blue)!;
    const board = own.regions.find(
      (region) => region.kind === 'board'
    )!.physicalDeclaredBounds;
    const slot = add[0]!.closest<HTMLElement>('.table-zone-affordance')!;
    const left = Number.parseFloat(slot.style.left);
    const top = Number.parseFloat(slot.style.top);
    expect(left).toBeGreaterThanOrEqual(board.x);
    expect(top + Number.parseFloat(slot.style.height)).toBeLessThanOrEqual(
      board.y + board.height
    );

    await act(async () => add[0]!.click());
    await settle();
    const items = [
      ...document.querySelectorAll('[role="menu"] [role="menuitem"][id]'),
    ].map((item) => item.id);
    expect(items).toEqual([
      'lostZoneToggle',
      'vstarMarkerToggle',
      'gxMarkerToggle',
    ]);
    await act(async () =>
      document.querySelector<HTMLElement>('#lostZoneToggle')!.click()
    );
    expect(lostZone.onShownChange).toHaveBeenCalledExactlyOnceWith(true);
    await act(async () => add[0]!.click());
    await settle();
    await act(async () =>
      document.querySelector<HTMLElement>('#vstarMarkerToggle')!.click()
    );
    expect(markers.onShownChange).toHaveBeenCalledExactlyOnceWith(
      'vstar',
      true
    );
  });

  it('puts an empty Lost Zone away again, and never one holding cards', async () => {
    const onShownChange = vi.fn();
    await render(createEmptyBoardView(), {
      lostZone: { shown: true, onShownChange },
    });
    const hide = host.querySelector<HTMLButtonElement>('#hideLostZoneButton')!;
    expect(hide.getAttribute('aria-label')).toBe('Put the Lost Zone away');
    await act(async () => hide.click());
    expect(onShownChange).toHaveBeenCalledExactlyOnceWith(false);

    for (const shown of [true, false]) {
      await render(
        withCards(createEmptyBoardView(), blue, 'lostZone', 2),
        { lostZone: { shown, onShownChange } },
        layoutState(shown ? {} : { hideEmptyLostZone: true })
      );
      expect(
        host.querySelector('#hideLostZoneButton'),
        String(shown)
      ).toBeNull();
      // Holding cards, it stays: its entry in the + is on and cannot change.
      await act(async () =>
        host.querySelector<HTMLButtonElement>('#tableExtrasButton')!.click()
      );
      await settle();
      const entry = document.querySelector<HTMLElement>('#lostZoneToggle')!;
      expect(entry.textContent, String(shown)).toContain('In use');
      expect(entry.getAttribute('aria-disabled'), String(shown)).toBe('true');
      await act(async () => root.render(<></>));
      await settle();
    }
  });

  it("lays each player's markers on the mat beside their prizes", async () => {
    const onToggle = vi.fn();
    const view = createEmptyBoardView();
    const used: MatchViewState = {
      ...view,
      players: {
        ...view.players,
        [red]: {
          ...view.players[red]!,
          oncePerGame: { ...view.players[red]!.oncePerGame, gxUsed: true },
        },
      },
    };
    const layout = await render(
      used,
      {
        markers: {
          vstar: true,
          gx: true,
          onShownChange: vi.fn(),
          onToggle,
        },
      },
      layoutState({ oncePerGameMarkers: 2 })
    );
    const groups = [...host.querySelectorAll<HTMLElement>('.table-markers')];
    expect(groups.map((group) => group.dataset.playerSide)).toEqual([
      'local',
      'opponent',
    ]);
    for (const frame of layout.players) {
      const group = groups.find(
        (candidate) =>
          candidate.dataset.playerSide ===
          (frame.playerId === blue ? 'local' : 'opponent')
      )!;
      expect(Number.parseFloat(group.style.left)).toBeCloseTo(
        frame.extras!.markers!.x,
        6
      );
    }
    const redGx = host.querySelector<HTMLButtonElement>(
      `[data-once-per-game-marker="gx"][data-player-id="${red}"]`
    )!;
    expect(redGx.getAttribute('aria-pressed')).toBe('true');
    const blueVstar = host.querySelector<HTMLButtonElement>(
      `[data-once-per-game-marker="vstar"][data-player-id="${blue}"]`
    )!;
    expect(blueVstar.getAttribute('aria-pressed')).toBe('false');
    await act(async () => blueVstar.click());
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(blue, 'vstar');

    // Off, as by default, there are none.
    await render(
      used,
      {
        markers: { vstar: false, gx: false, onShownChange: vi.fn(), onToggle },
      },
      layoutState()
    );
    expect(host.querySelector('.table-markers')).toBeNull();
  });

  it('offers nothing while a pile browser or work area covers the table', async () => {
    await render(createEmptyBoardView(), {
      loadDeck: { playerIds: [blue, red], onLoad: vi.fn() },
      lostZone: { shown: false, onShownChange: vi.fn() },
      covered: true,
    });
    expect(host.querySelector('[data-table-zone-affordances]')).toBeNull();
    expect(host.childElementCount).toBe(0);

    // The markers stay in view beneath it, faded and out of reach.
    await render(
      createEmptyBoardView(),
      {
        markers: {
          vstar: true,
          gx: false,
          onShownChange: vi.fn(),
          onToggle: vi.fn(),
        },
        covered: true,
      },
      layoutState({ oncePerGameMarkers: 1 })
    );
    expect(host.querySelector('#tableExtrasButton')).toBeNull();
    const covered = [...host.querySelectorAll<HTMLElement>('.table-markers')];
    expect(covered).toHaveLength(2);
    expect(covered.every((group) => group.dataset.covered === 'true')).toBe(
      true
    );
  });
});
