// @vitest-environment happy-dom

import {
  asViewCardId,
  type MatchViewState,
  type ViewCard,
  type ViewCardId,
} from '@ptcgsim/game-core';
import {
  createBoardScene,
  createBoardSceneForViewport,
  createRendererSpikeView,
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  type BoardPresentation,
  type Rect,
} from '@ptcgsim/renderer-contract';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInitialBoardSessionControllerState,
  type BoardSessionControllerState,
} from '../BoardSessionController.js';
import { groupMenuOf, type GroupMenu } from '../group-menu-entries.js';
import { groupAttachTargets, pokemonInPlayOf } from './group-context.js';
import {
  LegacyBoardOverlays,
  type GroupSurface,
  type LegacyBoardOverlayActions,
} from './LegacyBoardOverlays.js';

vi.mock('../group-menu-entries.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../group-menu-entries.js')>()),
  groupMenuOf: vi.fn(() => null),
}));
vi.mock('./group-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./group-context.js')>()),
  pokemonInPlayOf: vi.fn(() => []),
  groupAttachTargets: vi.fn(() => []),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const spike = createRendererSpikeView();
const firstPlayer = spike.playerOrder[0]!;
const zoneId = (kind: string): string => `zone:${firstPlayer}:${kind}`;
const known = (card: ViewCard): Extract<ViewCard, { kind: 'known' }> => {
  if (card.kind !== 'known') throw new Error('known card expected');
  return card;
};

// The table, with two halves of a LEGEND in the hand and three copies of
// one card in the discard pile.
const hand = spike.zones[zoneId('hand')]!;
const discard = spike.zones[zoneId('discard')]!;
const top = known(hand.cards[0]!);
const bottom = known(hand.cards[1]!);
const copy = known(discard.cards[0]!);
const legend = (part: 0 | 1) => ({
  ...spike.definitions[top.definitionId]!,
  name: 'Lugia LEGEND',
  presentation: {
    readingQuarterTurns: 1 as const,
    join: {
      key: 'hgss:113:Lugia LEGEND',
      columns: 1 as const,
      rows: 2 as const,
      part,
    },
  },
});
const view: MatchViewState = {
  ...spike,
  definitions: {
    ...spike.definitions,
    'legend-top': legend(0),
    'legend-bottom': legend(1),
  },
  zones: {
    ...spike.zones,
    [hand.id]: {
      ...hand,
      cards: hand.cards.map((card) =>
        card.id === top.id
          ? { ...top, definitionId: 'legend-top' }
          : card.id === bottom.id
            ? { ...bottom, definitionId: 'legend-bottom' }
            : card
      ),
    },
    [discard.id]: {
      ...discard,
      cards: discard.cards.map((card) =>
        card.kind === 'known'
          ? { ...card, definitionId: copy.definitionId }
          : card
      ),
    },
  },
} as MatchViewState;
const scene = createBoardSceneForViewport(view, {
  geometryVersion: 1,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  bottomPlayerId: firstPlayer,
  splitRatio: 0.5,
});
const copies = discard.cards.map((card) => card.id);
const other = known(hand.cards[2]!).id;

const presentation = (
  patch: Partial<BoardPresentation> = {}
): BoardPresentation => ({
  ...createInitialBoardSessionControllerState().presentation,
  ...patch,
});

const state = (
  patch: Partial<BoardSessionControllerState> = {}
): BoardSessionControllerState => ({
  ...createInitialBoardSessionControllerState(),
  generation: 1,
  sessionPhase: 'ready',
  source: { kind: 'live' },
  view,
  scene,
  canSubmitCommands: true,
  ...patch,
});

const actions = () =>
  ({
    emitOpenedZoneCardIntent: vi.fn(),
    updateDrag: vi.fn(),
    dismiss: vi.fn(),
    invokeContextAction: vi.fn(),
    invokeZoneAction: vi.fn(),
    submitDamageInput: vi.fn(),
    submitSpecialConditionInput: vi.fn(),
    submitCountInput: vi.fn(),
    submitShortcutCountInput: vi.fn(),
    submitCategoryChoice: vi.fn(),
    submitMoveChoice: vi.fn(),
    emitGroupAction: vi.fn(),
    emitSelectionIntent: vi.fn(),
  }) satisfies LegacyBoardOverlayActions;

const MENU: GroupMenu = {
  header: '2 cards',
  entries: [
    {
      id: 'send:discard',
      section: 'move',
      label: 'Discard 2 cards',
      detail: '2 ends on top',
      shortcut: 'D',
      run: { kind: 'action', action: { kind: 'send', to: 'discard' } },
    },
    {
      id: 'attach',
      section: 'move',
      label: 'Attach to…',
      run: { kind: 'picker', picker: 'attachTarget' },
    },
    {
      id: 'damage',
      section: 'annotate',
      label: 'Damage…',
      run: { kind: 'picker', picker: 'damage' },
    },
    {
      id: 'playAsOne',
      section: 'play',
      label: 'Play as one card',
      run: { kind: 'playAsOne' },
    },
    {
      id: 'deselect',
      section: 'selection',
      label: 'Deselect',
      run: { kind: 'deselect' },
    },
  ],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.replaceChildren(host);
  root = createRoot(host);
  vi.mocked(groupMenuOf).mockReturnValue(null);
  vi.mocked(pokemonInPlayOf).mockReturnValue([]);
  vi.mocked(groupAttachTargets).mockReturnValue([]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
});

const render = async (
  board: BoardSessionControllerState,
  callbacks: LegacyBoardOverlayActions,
  surface: {
    readonly groupSurface?: GroupSurface | null;
    readonly onGroupSurfaceChange?: (next: GroupSurface | null) => void;
  } = {}
): Promise<void> => {
  await act(async () =>
    root.render(
      createElement(LegacyBoardOverlays, {
        state: board,
        darkMode: false,
        actions: callbacks,
        allowOpponentResolution: true,
        ...surface,
      })
    )
  );
};

const groupMenu = () =>
  document.querySelector<HTMLElement>('[data-group-menu]');
const cardMenu = () =>
  document.querySelector<HTMLElement>('[data-legacy-card-context-menu]');
const row = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-group-entry="${id}"]`)!;
const anchor: Rect = { x: 400, y: 500, width: 120, height: 44 };

describe('the group menu', () => {
  it("opens on a right-click of a selected item of a group, in place of that card's menu", async () => {
    vi.mocked(groupMenuOf).mockReturnValue(MENU);
    const callbacks = actions();
    await render(
      state({
        presentation: presentation({ selection: [top.id, other] }),
        overlays: { contextMenuCardId: other, preview: null, input: null },
      }),
      callbacks
    );
    expect(cardMenu()).toBeNull();
    const menu = groupMenu()!;
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('aria-label')).toBe('2 cards');
    expect(
      [...menu.querySelectorAll<HTMLElement>('[data-group-entry]')].map(
        (entry) => entry.dataset.groupEntry
      )
    ).toEqual(['send:discard', 'attach', 'damage', 'playAsOne', 'deselect']);
    // State-true rows, a second line where the order matters, its key, and
    // a separator between sections.
    expect(row('send:discard').textContent).toBe(
      'Discard 2 cards2 ends on top'
    );
    expect(row('send:discard').getAttribute('aria-label')).toBe(
      'Discard 2 cards, 2 ends on top'
    );
    expect(row('send:discard').dataset.menuHint).toBe('D');
    expect(row('send:discard').className).toContain('is-danger');
    expect(row('damage').closest('li')!.className).toContain('is-boundary');
    expect(row('attach').closest('li')!.className).not.toContain('is-boundary');

    await act(async () => row('send:discard').click());
    expect(callbacks.emitGroupAction).toHaveBeenCalledExactlyOnceWith({
      kind: 'send',
      to: 'discard',
    });
    expect(callbacks.dismiss).toHaveBeenCalledWith('context');
  });

  it("keeps the card's own menu for one item, and while the group has no menu of its own", async () => {
    vi.mocked(groupMenuOf).mockReturnValue(MENU);
    const callbacks = actions();
    await render(
      state({
        presentation: presentation({ selection: [other] }),
        overlays: { contextMenuCardId: other, preview: null, input: null },
      }),
      callbacks
    );
    expect(groupMenu()).toBeNull();
    expect(cardMenu()).not.toBeNull();

    vi.mocked(groupMenuOf).mockReturnValue(null);
    await render(
      state({
        presentation: presentation({ selection: [top.id, other] }),
        overlays: { contextMenuCardId: other, preview: null, input: null },
      }),
      callbacks
    );
    expect(groupMenu()).toBeNull();
    expect(cardMenu()).not.toBeNull();

    // A card outside the group opens its own menu too.
    vi.mocked(groupMenuOf).mockReturnValue(MENU);
    const outside = known(hand.cards[3]!).id;
    await render(
      state({
        presentation: presentation({ selection: [top.id, other] }),
        overlays: { contextMenuCardId: outside, preview: null, input: null },
      }),
      callbacks
    );
    expect(groupMenu()).toBeNull();
    expect(cardMenu()?.dataset.contextCardId).toBe(String(outside));
  });

  it('plays as one card the set the menu offered it for, not a set already whole in the selection', async () => {
    vi.mocked(groupMenuOf).mockReturnValue(MENU);
    const callbacks = actions();
    // Two pieces of a V-UNION in the hand, beside the LEGEND's halves.
    const piece = (part: number) => ({
      ...spike.definitions[top.definitionId]!,
      name: 'Mewtwo V-UNION',
      presentation: {
        readingQuarterTurns: 0 as const,
        join: {
          key: 'swshp:159:Mewtwo V-UNION',
          columns: 2 as const,
          rows: 2 as const,
          part,
        },
      },
    });
    const handNow = view.zones[hand.id]!;
    const [first, second] = [handNow.cards[3]!.id, handNow.cards[4]!.id];
    const withUnion = {
      ...view,
      definitions: {
        ...view.definitions,
        'union-0': piece(0),
        'union-1': piece(1),
      },
      zones: {
        ...view.zones,
        [hand.id]: {
          ...handNow,
          cards: handNow.cards.map((card) =>
            card.kind !== 'known'
              ? card
              : card.id === first
                ? { ...card, definitionId: 'union-0' }
                : card.id === second
                  ? { ...card, definitionId: 'union-1' }
                  : card
          ),
        },
      },
    } as MatchViewState;
    const unionScene = createBoardSceneForViewport(withUnion, {
      geometryVersion: 1,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      bottomPlayerId: firstPlayer,
      splitRatio: 0.5,
    });
    // The LEGEND whole, then one V-UNION piece: Play as one is the V-UNION's.
    await render(
      state({
        view: withUnion,
        scene: unionScene,
        presentation: presentation({
          selection: [top.id, bottom.id, first],
        }),
      }),
      callbacks,
      { groupSurface: { kind: 'menu', anchor }, onGroupSurfaceChange: vi.fn() }
    );
    await act(async () => row('playAsOne').click());
    expect(callbacks.emitSelectionIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardsSelected',
      cardIds: [first, second],
      mode: 'replace',
    });
  });

  it('opens from the group bar, and Escape or a press elsewhere puts it away', async () => {
    vi.mocked(groupMenuOf).mockReturnValue(MENU);
    const callbacks = actions();
    const change = vi.fn();
    const board = state({
      presentation: presentation({ selection: [top.id, other] }),
    });
    await render(board, callbacks, {
      groupSurface: { kind: 'menu', anchor },
      onGroupSurfaceChange: change,
    });
    const menu = groupMenu()!;
    expect(menu).not.toBeNull();
    // It opens under what opened it, inside the table.
    expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(0);
    await act(async () =>
      menu.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    );
    expect(change).toHaveBeenLastCalledWith(null);
    change.mockClear();
    await act(async () =>
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true })
      )
    );
    expect(change).toHaveBeenLastCalledWith(null);
    // Nothing selected, nothing shown, whatever was asked for.
    await render(state(), callbacks, {
      groupSurface: { kind: 'menu', anchor },
      onGroupSurfaceChange: change,
    });
    expect(groupMenu()).toBeNull();
  });

  it("opens the group's damage stepper, which marks every Pokémon in it at each press", async () => {
    vi.mocked(groupMenuOf).mockReturnValue(MENU);
    vi.mocked(pokemonInPlayOf).mockReturnValue([
      'stack:a',
      'stack:b',
      'stack:c',
    ]);
    const callbacks = actions();
    const change = vi.fn();
    const board = state({
      presentation: presentation({ selection: [top.id, other] }),
    });
    await render(board, callbacks, {
      groupSurface: { kind: 'menu', anchor },
      onGroupSurfaceChange: change,
    });
    await act(async () => row('damage').click());
    expect(change).toHaveBeenLastCalledWith({ kind: 'damage', anchor });

    await render(board, callbacks, {
      groupSurface: { kind: 'damage', anchor },
      onGroupSurfaceChange: change,
    });
    const stepper = document.querySelector<HTMLElement>(
      '[data-group-damage-controls]'
    )!;
    expect(stepper.getAttribute('aria-label')).toBe(
      'Damage on each of 3 Pokémon'
    );
    const press = async (label: string) =>
      act(async () =>
        stepper
          .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
          .click()
      );
    await press('10 more damage on each');
    await press('10 less damage on each');
    await press('Remove all damage from each');
    expect(vi.mocked(callbacks.emitGroupAction).mock.calls).toEqual([
      [{ kind: 'damage', delta: 10 }],
      [{ kind: 'damage', delta: -10 }],
      [{ kind: 'clearDamage' }],
    ]);
    await press('Done');
    expect(change).toHaveBeenLastCalledWith(null);

    // No Pokémon in play in the group: no stepper.
    vi.mocked(pokemonInPlayOf).mockReturnValue([]);
    await render(board, callbacks, {
      groupSurface: { kind: 'damage', anchor },
      onGroupSurfaceChange: change,
    });
    expect(document.querySelector('[data-group-damage-controls]')).toBeNull();
  });

  it('lists the Pokémon the whole group can go on under Attach to…', async () => {
    vi.mocked(groupMenuOf).mockReturnValue(MENU);
    vi.mocked(groupAttachTargets).mockReturnValue([
      { id: 'stack:a', label: 'Pikachu, Active' },
    ]);
    const callbacks = actions();
    await render(
      state({ presentation: presentation({ selection: [top.id, other] }) }),
      callbacks,
      { groupSurface: { kind: 'menu', anchor }, onGroupSurfaceChange: vi.fn() }
    );
    expect(row('attach').getAttribute('aria-expanded')).toBe('false');
    await act(async () => row('attach').click());
    expect(row('attach').getAttribute('aria-expanded')).toBe('true');
    const target = document.querySelector<HTMLButtonElement>(
      '[data-group-attach-target="stack:a"]'
    )!;
    expect(target.textContent).toBe('Pikachu, Active');
    await act(async () => target.click());
    expect(callbacks.emitGroupAction).toHaveBeenCalledExactlyOnceWith({
      kind: 'drop',
      targetId: 'stack:a',
    });

    // None to go on: the row says so, and opens nothing.
    vi.mocked(groupAttachTargets).mockReturnValue([]);
    await render(
      state({ presentation: presentation({ selection: [top.id, other] }) }),
      callbacks,
      { groupSurface: { kind: 'menu', anchor }, onGroupSurfaceChange: vi.fn() }
    );
    expect(row('attach').getAttribute('aria-disabled')).toBe('true');
  });

  it('puts the selection down, and ends selection mode with it', async () => {
    vi.mocked(groupMenuOf).mockReturnValue(MENU);
    const callbacks = actions();
    const change = vi.fn();
    await render(
      state({
        presentation: presentation({
          selection: [top.id, other],
          selectionMode: true,
        }),
      }),
      callbacks,
      { groupSurface: { kind: 'menu', anchor }, onGroupSurfaceChange: change }
    );
    await act(async () => row('deselect').click());
    expect(callbacks.emitSelectionIntent).toHaveBeenCalledWith({
      kind: 'SelectionModeChanged',
      on: false,
    });
    expect(callbacks.dismiss).toHaveBeenCalledWith('selection');
    expect(change).toHaveBeenLastCalledWith(null);
  });
});

describe('Play as one card', () => {
  it("is on a piece's own menu while its other pieces are in sight, and takes them with it", async () => {
    const callbacks = actions();
    const change = vi.fn();
    await render(
      state({
        presentation: presentation({ selection: [top.id] }),
        overlays: { contextMenuCardId: top.id, preview: null, input: null },
      }),
      callbacks,
      { onGroupSurfaceChange: change }
    );
    const entry = cardMenu()!.querySelector<HTMLButtonElement>(
      '[data-context-action="playAsOne"]'
    )!;
    expect(entry.textContent).toBe('Play as one card');
    await act(async () => entry.click());
    // Both halves, in part order, and the group menu on where they go.
    expect(callbacks.emitSelectionIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardsSelected',
      cardIds: [top.id, bottom.id],
      mode: 'replace',
    });
    expect(callbacks.dismiss).toHaveBeenCalledWith('context');
    expect(change).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'menu' })
    );
  });

  it('is not on a card printed whole', async () => {
    await render(
      state({
        presentation: presentation({ selection: [other] }),
        overlays: { contextMenuCardId: other, preview: null, input: null },
      }),
      actions()
    );
    expect(cardMenu()).not.toBeNull();
    expect(
      cardMenu()!.querySelector('[data-context-action="playAsOne"]')
    ).toBeNull();
  });
});

describe('a selection in the pile viewer', () => {
  const opened = (selection: readonly ViewCardId[], mode = false) =>
    state({
      presentation: presentation({
        openedZoneId: discard.id,
        selection,
        selectionMode: mode,
      }),
    });
  const tile = () =>
    document.querySelector<HTMLButtonElement>('.ptcgsim-zone-card')!;
  const click = (target: HTMLElement, init: MouseEventInit = {}) =>
    act(async () =>
      target.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
      )
    );

  it('adds a card with Shift or the platform key, on every click and with no preview', async () => {
    const callbacks = actions();
    await render(opened([]), callbacks);
    // The three copies stack on one tile; Shift takes the first.
    expect(tile().dataset.copyStack).toBe('3');
    await click(tile(), { shiftKey: true, detail: 2 });
    await act(async () =>
      tile().dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, shiftKey: true, detail: 2 })
      )
    );
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardSelected',
      cardId: copies[0],
      mode: 'add',
    });
  });

  it('takes a stacked tile copy by copy ("2/5"), then lets them all go', async () => {
    const callbacks = actions();
    await render(opened([copies[0]!, other]), callbacks);
    const badge = tile().querySelector<HTMLElement>(
      '[data-zone-select-badge]'
    )!;
    expect(badge.textContent).toBe('1/3');
    expect(tile().getAttribute('aria-pressed')).toBe('true');
    await click(tile(), { shiftKey: true });
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenLastCalledWith({
      kind: 'CardSelected',
      cardId: copies[1],
      mode: 'add',
    });

    vi.mocked(callbacks.emitOpenedZoneCardIntent).mockClear();
    await render(opened([...copies]), callbacks);
    expect(tile().querySelector('[data-zone-select-badge]')!.textContent).toBe(
      '3/3'
    );
    await click(tile(), { shiftKey: true });
    expect(
      vi
        .mocked(callbacks.emitOpenedZoneCardIntent)
        .mock.calls.map(([intent]) => intent.cardId)
    ).toEqual(copies);
  });

  it("taps add and take out in selection mode, and a tile's name says where it is", async () => {
    const callbacks = actions();
    await render(opened([other, copies[0]!], true), callbacks);
    expect(tile().getAttribute('aria-label')).toMatch(/, selected, 2 of 2$/u);
    const grid = document.querySelector<HTMLElement>(
      '.ptcgsim-legacy-zone-cards'
    )!;
    expect(grid.getAttribute('role')).toBe('group');
    expect(grid.getAttribute('aria-label')).toMatch(/, 1 selected$/u);
    await click(tile());
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenLastCalledWith({
      kind: 'CardSelected',
      cardId: copies[1],
      mode: 'add',
    });
  });

  it('selects every copy of every tile, and with all of them in, lets them go', async () => {
    const callbacks = actions();
    await render(opened([]), callbacks);
    const selectAll = () =>
      document.querySelector<HTMLButtonElement>(
        '[data-card-action="select-all"]'
      )!;
    expect(selectAll().textContent).toBe('Select all');
    await act(async () => selectAll().click());
    expect(callbacks.emitSelectionIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardsSelected',
      cardIds: copies,
      mode: 'add',
    });
    await render(opened([...copies]), callbacks);
    expect(selectAll().textContent).toBe('Deselect all');
    await act(async () => selectAll().click());
    expect(callbacks.dismiss).toHaveBeenCalledWith('selection');
  });

  it("offers Move N… for a group, which opens the group's menu from the button", async () => {
    const callbacks = actions();
    const change = vi.fn();
    await render(opened([copies[0]!, copies[1]!]), callbacks, {
      onGroupSurfaceChange: change,
    });
    expect(
      document.querySelector('[data-card-actions-group] [data-selected-count]')
        ?.textContent
    ).toBe('2 selected');
    const move = document.querySelector<HTMLButtonElement>(
      '[data-card-action="move-group"]'
    )!;
    expect(move.textContent).toBe('Move 2…');
    await act(async () => move.click());
    expect(change).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: 'menu' })
    );
  });

  it('stays open for a card added from the table with a modifier, and closes for a plain press', async () => {
    const callbacks = actions();
    await render(opened([]), callbacks);
    const tableCard = document.createElement('div');
    tableCard.dataset.cardId = String(other);
    document.body.append(tableCard);
    await act(async () =>
      tableCard.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, shiftKey: true })
      )
    );
    expect(callbacks.dismiss).not.toHaveBeenCalledWith('zone');
    await act(async () =>
      tableCard.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true })
      )
    );
    expect(callbacks.dismiss).toHaveBeenCalledWith('zone');
  });
});

describe('the group carried out of the pile viewer', () => {
  it('drags every selected item with the card picked up from among them', async () => {
    const callbacks = actions();
    await render(
      state({
        presentation: presentation({
          openedZoneId: discard.id,
          selection: [copies[0]!, other],
        }),
      }),
      callbacks
    );
    const overlay = host.querySelector<HTMLElement>(
      '[data-legacy-board-overlays]'
    )!;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: scene.viewport.width,
      bottom: scene.viewport.height,
      width: scene.viewport.width,
      height: scene.viewport.height,
      toJSON: () => ({}),
    });
    const source = host.querySelector<HTMLElement>('.ptcgsim-zone-card')!;
    expect(source.dataset.overlayCardId).toBe(String(copies[0]));
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 226,
      bottom: 276,
      width: 126,
      height: 176,
      toJSON: () => ({}),
    });
    const pointer = (type: string, x: number, y: number): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: x },
        clientY: { value: y },
        pointerId: { value: 9 },
        button: { value: 0 },
        pointerType: { value: 'mouse' },
      });
      return event;
    };
    await act(async () =>
      source.dispatchEvent(pointer('pointerdown', 163, 188))
    );
    await act(async () =>
      document.dispatchEvent(pointer('pointermove', 300, 300))
    );
    expect(callbacks.updateDrag).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cardId: copies[0],
        groupCardIds: [copies[0], other],
      })
    );
    const handZone = scene.zones.find((zone) => zone.id === hand.id)!;
    await act(async () =>
      document.dispatchEvent(
        pointer(
          'pointerup',
          handZone.bounds.x + handZone.bounds.width / 2,
          handZone.bounds.y + handZone.bounds.height / 2
        )
      )
    );
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CardDropRequested',
        cardId: copies[0],
        groupCardIds: [copies[0], other],
      })
    );
  });

  it('makes room in the hand counting only the cards that stay, not the selected ones it carries', async () => {
    const callbacks = actions();
    const [first] = hand.cards.map((card) => card.id);
    // The table's own layout, where the hand keeps an order.
    const table = createBoardScene(
      view,
      createTableLayoutSnapshot({
        geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
        playerIds: [view.playerOrder[0]!, view.playerOrder[1]!],
        bottomPlayerId: firstPlayer,
        shellMode: 'fullscreen',
        vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
      })
    );
    await render(
      state({
        scene: table,
        presentation: presentation({
          openedZoneId: discard.id,
          selection: [copies[0]!, first!],
        }),
      }),
      callbacks
    );
    const overlay = host.querySelector<HTMLElement>(
      '[data-legacy-board-overlays]'
    )!;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: scene.viewport.width,
      bottom: scene.viewport.height,
      width: scene.viewport.width,
      height: scene.viewport.height,
      toJSON: () => ({}),
    });
    const source = host.querySelector<HTMLElement>('.ptcgsim-zone-card')!;
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 226,
      bottom: 276,
      width: 126,
      height: 176,
      toJSON: () => ({}),
    });
    const pointer = (type: string, x: number, y: number): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: x },
        clientY: { value: y },
        pointerId: { value: 9 },
        button: { value: 0 },
        pointerType: { value: 'mouse' },
      });
      return event;
    };
    // Let go just inside the hand's second card: the first, carried with
    // it, leaves, so this is the hand's first place.
    const second = table.cards.filter((card) => card.parentId === hand.id)[1]!;
    const at = {
      x: second.bounds.x + 4,
      y: second.bounds.y + second.bounds.height / 2,
    };
    await act(async () =>
      source.dispatchEvent(pointer('pointerdown', 163, 188))
    );
    await act(async () =>
      document.dispatchEvent(pointer('pointermove', at.x, at.y))
    );
    await act(async () =>
      document.dispatchEvent(pointer('pointerup', at.x, at.y))
    );
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CardDropRequested',
        cardId: copies[0],
        targetId: hand.id,
        index: 0,
        groupCardIds: [copies[0], first],
      })
    );
  });

  it('carries a card picked up from outside the selection alone', async () => {
    const callbacks = actions();
    const [first, second, third] = hand.cards
      .slice(3, 6)
      .map((card) => card.id);
    // The hand's viewer shows each card on its own.
    await render(
      state({
        presentation: presentation({
          openedZoneId: hand.id,
          selection: [first!, second!],
        }),
      }),
      callbacks
    );
    const overlay = host.querySelector<HTMLElement>(
      '[data-legacy-board-overlays]'
    )!;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: scene.viewport.width,
      bottom: scene.viewport.height,
      width: scene.viewport.width,
      height: scene.viewport.height,
      toJSON: () => ({}),
    });
    const source = host.querySelector<HTMLElement>(
      `[data-overlay-card-id="${String(third)}"]`
    )!;
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 226,
      bottom: 276,
      width: 126,
      height: 176,
      toJSON: () => ({}),
    });
    const event = (type: string, x: number, y: number): Event => {
      const dispatched = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(dispatched, {
        clientX: { value: x },
        clientY: { value: y },
        pointerId: { value: 9 },
        button: { value: 0 },
        pointerType: { value: 'mouse' },
      });
      return dispatched;
    };
    await act(async () => source.dispatchEvent(event('pointerdown', 163, 188)));
    await act(async () =>
      document.dispatchEvent(event('pointermove', 300, 300))
    );
    const drag = vi.mocked(callbacks.updateDrag).mock.calls.at(-1)?.[0];
    expect(drag?.cardId).toBe(third);
    expect(drag?.groupCardIds).toBeUndefined();
    expect(asViewCardId(String(third))).toBe(third);
  });
});
