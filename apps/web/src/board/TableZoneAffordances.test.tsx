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

  it('adds the optional Lost Zone from beneath the discard pile', async () => {
    const onShownChange = vi.fn();
    const layout = await render(
      createEmptyBoardView(),
      { lostZone: { shown: false, onShownChange } },
      layoutState({ hideEmptyLostZone: true })
    );
    const add = host.querySelector<HTMLButtonElement>('#addLostZoneButton')!;
    expect(add.getAttribute('aria-label')).toBe('Add the Lost Zone');
    expect(add.textContent).toBe('Lost Zone');
    expect(host.querySelector('#hideLostZoneButton')).toBeNull();
    // Only on the viewer's own half, in the Lost Zone's slot.
    expect(host.querySelectorAll('.table-zone-affordance')).toHaveLength(1);
    const lostZone = layout.players
      .find((frame) => frame.playerId === blue)!
      .regions.find(
        (region) => region.kind === 'lostZone'
      )!.physicalDeclaredBounds;
    const slot = add.closest<HTMLElement>('.table-zone-affordance')!;
    expect(slot.classList).toContain('table-zone-affordance--lost-zone-add');
    expect(Number.parseFloat(slot.style.top)).toBeCloseTo(lostZone.y, 6);
    await act(async () => add.click());
    expect(onShownChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('hides an empty Lost Zone again, and never one holding cards', async () => {
    const onShownChange = vi.fn();
    await render(createEmptyBoardView(), {
      lostZone: { shown: true, onShownChange },
    });
    const hide = host.querySelector<HTMLButtonElement>('#hideLostZoneButton')!;
    expect(hide.getAttribute('aria-label')).toBe('Hide the Lost Zone');
    expect(host.querySelector('#addLostZoneButton')).toBeNull();
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
      expect(
        host.querySelector('#addLostZoneButton'),
        String(shown)
      ).toBeNull();
    }
    // The other seat's Lost Zone is theirs: only the viewer's own decides.
    await render(
      withCards(createEmptyBoardView(), red, 'lostZone', 2),
      { lostZone: { shown: false, onShownChange } },
      layoutState({ hideEmptyLostZone: true })
    );
    expect(host.querySelector('#addLostZoneButton')).not.toBeNull();
  });

  it('offers nothing while a pile browser or work area covers the table', async () => {
    await render(createEmptyBoardView(), {
      loadDeck: { playerIds: [blue, red], onLoad: vi.fn() },
      lostZone: { shown: false, onShownChange: vi.fn() },
      covered: true,
    });
    expect(host.querySelector('[data-table-zone-affordances]')).toBeNull();
    expect(host.childElementCount).toBe(0);
  });
});
