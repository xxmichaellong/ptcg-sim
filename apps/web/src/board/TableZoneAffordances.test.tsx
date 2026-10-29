// @vitest-environment happy-dom

import {
  asPlayerId,
  asViewCardId,
  type MatchViewState,
  type PlayerId,
} from '@ptcgsim/game-core';
import {
  countBadgeAnchorWithin,
  countBadgeBox,
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
  cancelAllDialogRequests,
  dialogRequestsSnapshot,
  settleDialogRequest,
} from '../ui/dialog-requests.js';
import {
  deckPlusPlacement,
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
  cancelAllDialogRequests();
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

  it("colours each seat's + by the player, not the half it sits in", async () => {
    const affordance = (playerId: string) =>
      deckButton(playerId)!.closest<HTMLElement>('.table-zone-affordance')!
        .dataset;
    const loadDeck = { playerIds: [blue, red], onLoad: vi.fn() };
    await render(createEmptyBoardView(), { loadDeck });
    expect(affordance(blue).seatTone).toBe('local');
    expect(affordance(red).seatTone).toBe('opponent');
    // Turned around, Red sits at the bottom in Red's colour.
    await render(
      createEmptyBoardView(),
      { loadDeck },
      layoutState({ bottomPlayerId: red })
    );
    expect(affordance(red).playerSide).toBe('local');
    expect(affordance(red).seatTone).toBe('opponent');
    expect(affordance(blue).playerSide).toBe('opponent');
    expect(affordance(blue).seatTone).toBe('local');
  });

  it("keeps an empty deck's 0 clear of its + where the pile is narrower than the + (a phone held sideways)", async () => {
    const layout = await render(
      createEmptyBoardView(),
      { loadDeck: { playerIds: [blue, red], onLoad: vi.fn() } },
      layoutState({
        viewport: { width: 844, height: 390, devicePixelRatio: 1 },
        seamBandPx: 46,
        appBarPx: { width: 146, height: 50 },
      })
    );
    for (const playerId of [blue, red]) {
      const deck = layout.players
        .find((frame) => frame.playerId === playerId)!
        .regions.find((region) => region.kind === 'deck')!;
      const box = deck.physicalDeclaredBounds;
      const button = deckButton(playerId)!;
      const size = Number.parseFloat(button.style.width);
      // Across the table the pile is narrower than the + itself.
      if (playerId === red) expect(size).toBeGreaterThan(box.width);
      const [dx = 0, dy = 0] = (button.style.translate || '0px 0px')
        .split(' ')
        .map((part) => Number.parseFloat(part));
      const plus = {
        x: box.x + (box.width - size) / 2 + dx,
        y: box.y + (box.height - size) / 2 + dy,
        width: size,
        height: size,
      };
      const badge = countBadgeBox({
        ...deck.countLabel!,
        anchor: countBadgeAnchorWithin(deck.countLabel!, layout.playAreaBounds),
      });
      const overlap =
        plus.x < badge.x + badge.width &&
        badge.x < plus.x + plus.width &&
        plus.y < badge.y + badge.height &&
        badge.y < plus.y + plus.height;
      expect(overlap, `${playerId}'s + over its 0`).toBe(false);
      // Still mostly on its own pile.
      expect(Math.abs(dx) + Math.abs(dy), playerId).toBeLessThan(size / 2);
    }
  });

  it('centres the + on a pile that leaves its count clear', () => {
    const badge = { x: 300, y: 300, width: 26, height: 22 };
    const plus = deckPlusPlacement(
      { x: 100, y: 100, width: 110, height: 154 },
      badge
    );
    expect(plus.size).toBeCloseTo(46.2, 6);
    expect([plus.dx, plus.dy]).toEqual([0, 0]);
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

  it("adds the optional pieces from a small + beside the viewer's pieces by the prizes", async () => {
    const lostZone = { choice: 'auto' as const, onChoiceChange: vi.fn() };
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
    // Only on the viewer's own half: in the Active's row on their left,
    // past the coin's column by the prizes.
    const add = host.querySelectorAll<HTMLButtonElement>('#tableExtrasButton');
    expect(add).toHaveLength(1);
    expect(add[0]!.getAttribute('aria-label')).toBe('Add to the table');
    const own = layout.players.find((frame) => frame.playerId === blue)!;
    const active = own.regions.find(
      (region) => region.kind === 'active'
    )!.physicalDeclaredBounds;
    const coin = own.extras!.coin;
    const slot = add[0]!.closest<HTMLElement>('.table-zone-affordance')!;
    const left = Number.parseFloat(slot.style.left);
    const top = Number.parseFloat(slot.style.top);
    expect(left).toBeGreaterThanOrEqual(coin.x + coin.width);
    expect(left + Number.parseFloat(slot.style.width)).toBeLessThanOrEqual(
      active.x
    );
    expect(top).toBeGreaterThanOrEqual(active.y);
    expect(top + Number.parseFloat(slot.style.height)).toBeLessThanOrEqual(
      active.y + active.height
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
    expect(lostZone.onChoiceChange).toHaveBeenCalledExactlyOnceWith('shown');
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

  it('puts an empty Lost Zone away again from the +, and asks first to put one away that holds cards', async () => {
    const onChoiceChange = vi.fn();
    await render(createEmptyBoardView(), {
      lostZone: { choice: 'shown', onChoiceChange },
    });
    // No second control on the pile: the + puts it away, back to showing
    // only while it holds cards.
    expect(host.querySelector('.ptcgsim-zone-lostZone button')).toBeNull();
    const openEntry = async () => {
      await act(async () =>
        host.querySelector<HTMLButtonElement>('#tableExtrasButton')!.click()
      );
      await settle();
      return document.querySelector<HTMLElement>('#lostZoneToggle')!;
    };
    await act(async () => (await openEntry()).click());
    expect(onChoiceChange).toHaveBeenCalledExactlyOnceWith('auto');
    expect(dialogRequestsSnapshot()).toEqual([]);
    await act(async () => root.render(<></>));
    await settle();

    // Holding cards it is on the table whichever way it was left: its entry
    // is on and says how many it holds; putting it away asks first.
    for (const choice of ['auto', 'shown'] as const) {
      onChoiceChange.mockClear();
      await render(
        withCards(createEmptyBoardView(), blue, 'lostZone', 2),
        { lostZone: { choice, onChoiceChange } },
        layoutState(choice === 'auto' ? { hideEmptyLostZone: true } : {})
      );
      const entry = await openEntry();
      expect(entry.textContent, choice).toContain('Lost Zone, on');
      expect(entry.textContent, choice).toContain('2 cards');
      expect(entry.getAttribute('aria-disabled'), choice).not.toBe('true');
      await act(async () => entry.click());
      await settle();
      const [asked] = dialogRequestsSnapshot();
      expect(asked?.kind, choice).toBe('confirm');
      expect(asked?.options.title).toBe('Hide the Lost Zone?');
      expect(asked?.options.body).toBe('You have 2 cards in it.');
      // Kept: nothing changes.
      await act(async () => {
        settleDialogRequest(asked!.id, false);
        await Promise.resolve();
      });
      expect(onChoiceChange).not.toHaveBeenCalled();
      // Confirmed: put away, cards and all.
      await act(async () => (await openEntry()).click());
      await settle();
      await act(async () => {
        settleDialogRequest(dialogRequestsSnapshot()[0]!.id, true);
        await Promise.resolve();
      });
      expect(onChoiceChange).toHaveBeenCalledExactlyOnceWith('hidden');
      await act(async () => root.render(<></>));
      await settle();
    }

    // Put away holding cards: its entry is off, still counts them, and
    // brings it back without asking.
    onChoiceChange.mockClear();
    await render(
      withCards(createEmptyBoardView(), blue, 'lostZone', 1),
      { lostZone: { choice: 'hidden', onChoiceChange } },
      layoutState({ hideEmptyLostZone: true, hideLostZone: true })
    );
    const entry = await openEntry();
    expect(entry.textContent).toContain('Lost Zone, off');
    expect(entry.textContent).toContain('1 card');
    await act(async () => entry.click());
    expect(dialogRequestsSnapshot()).toEqual([]);
    expect(onChoiceChange).toHaveBeenCalledExactlyOnceWith('shown');
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
      lostZone: { choice: 'auto', onChoiceChange: vi.fn() },
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
