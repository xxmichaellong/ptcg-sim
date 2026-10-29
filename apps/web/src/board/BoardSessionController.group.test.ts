import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import {
  createBoardSceneForViewport,
  NO_SELECTION,
  type BoardIntent,
  type BoardScene,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  createInitialBoardSessionControllerState,
  reduceBoardSessionController,
  type BoardProjectionFrame,
  type BoardSessionControllerAction,
  type BoardSessionControllerDependencies,
  type BoardSessionControllerEffect,
  type BoardSessionControllerState,
} from './BoardSessionController.js';
import * as compileGroupModule from './compile-group.js';
import { BLUE, RED, groupTable, piece } from './group-table.test-support.js';

vi.mock('./compile-group.js', async (original) => {
  const actual = await original<typeof compileGroupModule>();
  return { ...actual, compileGroup: vi.fn(actual.compileGroup) };
});

const createScene = (view: MatchViewState): BoardScene =>
  createBoardSceneForViewport(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId: BLUE,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
const dependencies: BoardSessionControllerDependencies = { createScene };

const frame = (
  frameToken: number,
  view: MatchViewState,
  overrides: Partial<BoardProjectionFrame> = {}
): BoardProjectionFrame => ({
  frameToken,
  source: { kind: 'live' },
  boundary: frameToken === 1 ? 'resync' : 'advance',
  sessionPhase: 'ready',
  view,
  submissionsBlocked: false,
  ...overrides,
});

/** A controller driven action by action, keeping what it emitted. */
const driver = (view: MatchViewState) => {
  let state: BoardSessionControllerState =
    createInitialBoardSessionControllerState();
  let effects: BoardSessionControllerEffect[] = [];
  const act = (action: BoardSessionControllerAction) => {
    const result = reduceBoardSessionController(state, action, dependencies);
    state = result.state;
    effects = [...result.effects];
    return result;
  };
  act({ kind: 'FrameReceived', frame: frame(1, view) });
  return {
    act,
    intent: (intent: BoardIntent) => act({ kind: 'RendererIntent', intent }),
    get state() {
      return state;
    },
    get effects() {
      return effects;
    },
    get selection() {
      return state.presentation.selection;
    },
    submitted: () =>
      effects.flatMap((effect) =>
        effect.kind === 'SubmitCommand' ? [effect.command] : []
      ),
  };
};

const add = (cardId: ViewCardId): BoardIntent => ({
  kind: 'CardSelected',
  cardId,
  mode: 'add',
});

const energy = { category: 'Energy' as const, name: 'Fire Energy' };

describe('a selection of several cards (ADR-042)', () => {
  it('takes cards in and out with Shift or ⌘/Ctrl, and a plain press picks one', () => {
    const table = groupTable();
    const [a, b, c] = table.put(BLUE, 'hand', energy, energy, energy);
    const board = driver(table.view);
    board.intent({ kind: 'CardSelected', cardId: a!, mode: 'toggle' });
    expect(board.selection).toEqual([a]);
    board.intent(add(b!));
    expect(board.selection).toEqual([a, b]);
    board.intent(add(c!));
    expect(board.selection).toEqual([a, b, c]);
    board.intent(add(a!));
    expect(board.selection).toEqual([b, c]);
    // A plain press: this card alone, as v1's click.
    board.intent({ kind: 'CardSelected', cardId: a!, mode: 'toggle' });
    expect(board.selection).toEqual([a]);
  });

  it('refuses with a reason what is no item: a pile top, a card of a selected Pokémon', () => {
    const table = groupTable();
    const [hand] = table.put(BLUE, 'hand', energy);
    const [discarded] = table.put(BLUE, 'discard', energy);
    const active = table.pokemon(
      BLUE,
      'active',
      [{ name: 'Pikachu' }],
      [energy]
    );
    const board = driver(table.view);
    board.intent(add(hand!));
    board.intent(add(discarded!));
    expect(board.selection).toEqual([hand]);
    expect(board.effects).toContainEqual(
      expect.objectContaining({ kind: 'IntentRejected', reason: 'not_an_item' })
    );
    board.intent(add(active.top));
    board.intent(add(active.attached[0]!));
    expect(board.selection).toEqual([hand, active.top]);
    expect(board.effects).toContainEqual(
      expect.objectContaining({
        kind: 'IntentRejected',
        reason: 'in_selected_pokemon',
      })
    );
  });

  it('takes a rectangle or Select all at once, leaving out what is no item without a word', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy);
    const [discarded] = table.put(BLUE, 'discard', energy);
    const benched = table.pokemon(BLUE, 'bench', [{ name: 'Pichu' }]);
    const board = driver(table.view);
    board.intent({
      kind: 'CardsSelected',
      cardIds: [...hand, discarded!],
      mode: 'replace',
    });
    expect(board.selection).toEqual(hand);
    expect(board.effects).not.toContainEqual(
      expect.objectContaining({ kind: 'IntentRejected' })
    );
    board.intent({
      kind: 'CardsSelected',
      cardIds: [benched.top],
      mode: 'add',
    });
    expect(board.selection).toEqual([...hand, benched.top]);
    board.intent({ kind: 'CardsSelected', cardIds: [], mode: 'replace' });
    expect(board.selection).toBe(NO_SELECTION);
  });

  it('keeps the group through its menu, a card read and its own drag; a press on felt puts it down', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy);
    const [other] = table.put(BLUE, 'hand', energy);
    const board = driver(table.view);
    board.intent({ kind: 'CardsSelected', cardIds: hand, mode: 'replace' });
    // Right-click on a selected card: the group's menu, the group kept.
    board.intent({ kind: 'CardContextRequested', cardId: hand[1]! });
    expect(board.selection).toEqual(hand);
    expect(board.state.overlays.contextMenuCardId).toBe(hand[1]);
    // On a card outside it: that card's own menu, as today.
    board.intent({ kind: 'CardContextRequested', cardId: other! });
    expect(board.selection).toEqual([]);
    board.intent({ kind: 'CardsSelected', cardIds: hand, mode: 'replace' });
    board.intent({ kind: 'CardPreviewRequested', cardId: hand[0]! });
    expect(board.selection).toEqual(hand);
    // A drag of a selected card carries the group; any other goes alone.
    board.act({
      kind: 'RendererPresentationUpdated',
      update: {
        kind: 'DragChanged',
        drag: {
          cardId: hand[0]!,
          x: 10,
          y: 10,
          targetId: null,
          groupCardIds: hand,
        },
      },
    });
    expect(board.selection).toEqual(hand);
    board.act({
      kind: 'RendererPresentationUpdated',
      update: {
        kind: 'DragChanged',
        drag: { cardId: other!, x: 10, y: 10, targetId: null },
      },
    });
    expect(board.selection).toEqual([]);
    // Felt: down it goes, a single card's selection too.
    board.intent({ kind: 'CardsSelected', cardIds: hand, mode: 'replace' });
    board.intent({ kind: 'BoardBackgroundPressed' });
    expect(board.selection).toEqual([]);
    board.intent({ kind: 'CardSelected', cardId: other!, mode: 'toggle' });
    board.intent({ kind: 'BoardBackgroundPressed' });
    expect(board.selection).toEqual([]);
  });

  it("touch's selection mode makes a tap take a card in or out, and ends with the last", () => {
    const table = groupTable();
    const [a, b] = table.put(BLUE, 'hand', energy, energy);
    const board = driver(table.view);
    board.intent({ kind: 'CardSelected', cardId: a!, mode: 'toggle' });
    board.intent({ kind: 'SelectionModeChanged', on: true });
    board.intent({ kind: 'CardSelected', cardId: b!, mode: 'toggle' });
    expect(board.selection).toEqual([a, b]);
    expect(board.state.presentation.selectionMode).toBe(true);
    board.intent({ kind: 'CardSelected', cardId: a!, mode: 'toggle' });
    board.intent({ kind: 'CardSelected', cardId: b!, mode: 'toggle' });
    expect(board.selection).toEqual([]);
    expect(board.state.presentation.selectionMode).toBe(false);
    board.intent({ kind: 'SelectionModeChanged', on: true });
    board.intent({ kind: 'CardSelected', cardId: a!, mode: 'toggle' });
    board.intent({ kind: 'SelectionModeChanged', on: false });
    expect(board.selection).toEqual([]);
  });

  it('moves the group as one command, puts it down, and gives it back when it never left', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy, energy);
    const board = driver(table.view);
    board.intent({ kind: 'CardsSelected', cardIds: hand, mode: 'replace' });
    board.act({
      kind: 'GroupActionRequested',
      action: { kind: 'send', to: 'discard' },
    });
    const [command] = board.submitted();
    expect(command?.type).toBe('ApplyCardSteps');
    expect(
      command?.type === 'ApplyCardSteps' &&
        command.steps.map((step) => 'cardId' in step && step.cardId)
    ).toEqual(hand);
    expect(board.selection).toEqual([]);
    // The session kept it (not connected): the selection is back.
    board.act({ kind: 'SubmissionRejected' });
    expect(board.selection).toEqual(hand);
  });

  it('gives a refused group its selection back: at once, or with the frame that takes its cards back', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy);
    const board = driver(table.view);
    const send = () => {
      board.intent({ kind: 'CardsSelected', cardIds: hand, mode: 'replace' });
      board.act({
        kind: 'GroupActionRequested',
        action: { kind: 'send', to: 'lostZone' },
      });
      expect(board.selection).toEqual([]);
    };
    // Not predicted: nothing moved on the table, so it comes back now.
    send();
    board.act({ kind: 'SubmissionQueued', commandId: 'first' });
    board.act({ kind: 'CommandRefused', commandId: 'first' });
    expect(board.selection).toEqual(hand);
    // Predicted: back with the frame withdrawing the prediction.
    send();
    board.act({
      kind: 'SubmissionQueued',
      commandId: 'second',
      predicted: true,
    });
    board.act({ kind: 'CommandRefused', commandId: 'second' });
    expect(board.selection).toEqual([]);
    board.act({
      kind: 'FrameReceived',
      frame: frame(
        2,
        { ...table.view },
        {
          boundary: 'refresh',
          motionHint: 'rollback',
          pendingCommandIds: [],
        }
      ),
    });
    expect(board.selection).toEqual(hand);
    // Taken by the room: let go, nothing to give back.
    send();
    board.act({ kind: 'SubmissionQueued', commandId: 'third' });
    board.act({
      kind: 'FrameReceived',
      frame: frame(
        3,
        { ...table.view, revision: 2 },
        { pendingCommandIds: [] }
      ),
    });
    expect(board.state.groupSubmissions).toEqual([]);
    board.act({ kind: 'CommandRefused', commandId: 'third' });
    expect(board.selection).toEqual([]);
  });

  it("gives a refused group from touch's selection mode its mode back too", () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy, energy);
    const board = driver(table.view);
    const send = () => {
      board.intent({ kind: 'SelectionModeChanged', on: true });
      board.intent({
        kind: 'CardsSelected',
        cardIds: hand.slice(0, 2),
        mode: 'replace',
      });
      expect(board.state.presentation.selectionMode).toBe(true);
      board.act({
        kind: 'GroupActionRequested',
        action: { kind: 'send', to: 'lostZone' },
      });
      expect(board.state.presentation.selectionMode).toBe(false);
    };
    // Refused at once: the group comes back in selection mode, so the next
    // tap adds to it rather than replacing it.
    send();
    board.act({ kind: 'SubmissionQueued', commandId: 'first' });
    board.act({ kind: 'CommandRefused', commandId: 'first' });
    expect(board.selection).toEqual(hand.slice(0, 2));
    expect(board.state.presentation.selectionMode).toBe(true);
    board.intent({ kind: 'CardSelected', cardId: hand[2]!, mode: 'toggle' });
    expect(board.selection).toEqual(hand);
    board.intent({ kind: 'SelectionModeChanged', on: false });
    // Predicted, then refused: back with the frame that takes it back.
    send();
    board.act({
      kind: 'SubmissionQueued',
      commandId: 'second',
      predicted: true,
    });
    board.act({ kind: 'CommandRefused', commandId: 'second' });
    board.act({
      kind: 'FrameReceived',
      frame: frame(
        2,
        { ...table.view },
        {
          boundary: 'refresh',
          motionHint: 'rollback',
          pendingCommandIds: [],
        }
      ),
    });
    expect(board.selection).toEqual(hand.slice(0, 2));
    expect(board.state.presentation.selectionMode).toBe(true);
  });

  it('gives a refused group its selection back when another move already took its cards back', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy, energy);
    const board = driver(table.view);
    board.intent({ kind: 'SelectionModeChanged', on: true });
    board.intent({
      kind: 'CardsSelected',
      cardIds: hand.slice(0, 2),
      mode: 'replace',
    });
    board.act({
      kind: 'GroupActionRequested',
      action: { kind: 'send', to: 'lostZone' },
    });
    board.act({
      kind: 'SubmissionQueued',
      commandId: 'group',
      predicted: true,
    });
    // The other player's move lands first and undoes the prediction: the
    // cards are shown in the hand again, the group still waiting.
    const competing = { ...table.view, revision: 2 };
    board.act({
      kind: 'FrameReceived',
      frame: frame(2, competing, { pendingCommandIds: ['group'] }),
    });
    expect(board.selection).toEqual([]);
    // Refused, the room republishes the same table with the queue emptied.
    board.act({ kind: 'CommandRefused', commandId: 'group' });
    board.act({
      kind: 'FrameReceived',
      frame: frame(3, competing, { pendingCommandIds: [] }),
    });
    expect(board.selection).toEqual(hand.slice(0, 2));
    expect(board.state.presentation.selectionMode).toBe(true);
    expect(board.state.selectionRestore ?? null).toBeNull();
  });

  it('keeps a group it hid selected, though the room gives the cards new aliases', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy, energy);
    const handZone = table.view.zones[table.zoneId(BLUE, 'hand')]!;
    const shown = {
      ...table.view,
      zones: {
        ...table.view.zones,
        [handZone.id]: {
          ...handZone,
          cards: handZone.cards.map((card) =>
            card.kind === 'known' ? { ...card, publiclyRevealed: true } : card
          ),
        },
      },
    };
    const board = driver(shown);
    board.intent({ kind: 'SelectionModeChanged', on: true });
    board.intent({
      kind: 'CardsSelected',
      cardIds: hand.slice(0, 2),
      mode: 'replace',
    });
    board.act({
      kind: 'GroupActionRequested',
      action: { kind: 'reveal', revealed: false },
    });
    expect(board.submitted()).toHaveLength(1);
    expect(board.selection).toEqual(hand.slice(0, 2));
    // Hidden again, the two come back under new aliases in their places.
    const renamed = ['renamed-0', 'renamed-1'] as ViewCardId[];
    const hidden = {
      ...shown,
      revision: shown.revision + 1,
      zones: {
        ...shown.zones,
        [handZone.id]: {
          ...handZone,
          cards: shown.zones[handZone.id]!.cards.map((card, index) =>
            index < 2
              ? { ...card, id: renamed[index]!, publiclyRevealed: false }
              : card
          ),
        },
      },
    };
    board.act({ kind: 'FrameReceived', frame: frame(2, hidden) });
    expect(board.selection).toEqual(renamed);
    expect(board.state.presentation.selectionMode).toBe(true);
  });

  it("opens a refused group's emptied pile again with its cards picked, unless the player put it away", () => {
    const table = groupTable();
    const pile = table.put(BLUE, 'discard', energy, energy);
    const pileId = table.zoneId(BLUE, 'discard');
    const lostId = table.zoneId(BLUE, 'lostZone');
    const before = table.view;
    // The group's prediction: the pile emptied into the Lost Zone.
    const emptied: MatchViewState = {
      ...before,
      zones: {
        ...before.zones,
        [pileId]: { ...before.zones[pileId]!, cards: [] },
        [lostId]: {
          ...before.zones[lostId]!,
          cards: [...before.zones[pileId]!.cards],
        },
      },
    };
    const refuse = (putAway: boolean) => {
      const board = driver(before);
      board.intent({ kind: 'ZoneOpened', zoneId: pileId });
      board.intent({ kind: 'CardsSelected', cardIds: pile, mode: 'replace' });
      board.act({
        kind: 'GroupActionRequested',
        action: { kind: 'send', to: 'lostZone' },
      });
      board.act({
        kind: 'SubmissionQueued',
        commandId: 'group',
        predicted: true,
      });
      board.act({
        kind: 'FrameReceived',
        frame: frame(2, emptied, {
          boundary: 'refresh',
          pendingCommandIds: ['group'],
        }),
      });
      // Emptied, the pile's viewer closed.
      expect(board.state.presentation.openedZoneId).toBeNull();
      if (putAway)
        board.act({ kind: 'DismissLocalPresentation', scope: 'zone' });
      board.act({ kind: 'CommandRefused', commandId: 'group' });
      board.act({
        kind: 'FrameReceived',
        frame: frame(
          3,
          { ...before },
          {
            boundary: 'refresh',
            motionHint: 'rollback',
            pendingCommandIds: [],
          }
        ),
      });
      return board;
    };
    const back = refuse(false);
    expect(back.state.presentation.openedZoneId).toBe(pileId);
    expect(back.selection).toEqual(pile);
    // Put away meanwhile: it stays shut.
    const shut = refuse(true);
    expect(shut.state.presentation.openedZoneId).toBeNull();
  });

  it('brings back a refused group shown where a move queued before it put it, once that is withdrawn', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy);
    const handId = table.zoneId(BLUE, 'hand');
    const deckId = table.zoneId(BLUE, 'deck');
    const before = table.view;
    // Shown on the deck by a prediction still standing.
    const shown: MatchViewState = {
      ...before,
      zones: {
        ...before.zones,
        [handId]: { ...before.zones[handId]!, cards: [] },
        [deckId]: {
          ...before.zones[deckId]!,
          cards: [
            ...before.zones[deckId]!.cards,
            ...before.zones[handId]!.cards,
          ],
        },
      },
    };
    const board = driver(before);
    board.intent({ kind: 'CardsSelected', cardIds: hand, mode: 'replace' });
    board.act({
      kind: 'GroupActionRequested',
      action: { kind: 'send', to: 'deckTop' },
    });
    board.act({ kind: 'SubmissionQueued', commandId: 'group' });
    board.act({
      kind: 'FrameReceived',
      frame: frame(2, shown, {
        boundary: 'refresh',
        pendingCommandIds: ['earlier', 'group'],
      }),
    });
    board.act({ kind: 'CommandRefused', commandId: 'group' });
    // Not back yet: the deck's cards aren't a selection's.
    expect(board.selection).toEqual([]);
    board.act({
      kind: 'FrameReceived',
      frame: frame(
        3,
        { ...before },
        {
          boundary: 'refresh',
          motionHint: 'rollback',
          pendingCommandIds: [],
        }
      ),
    });
    expect(board.selection).toEqual(hand);
  });

  it('leaves a refused group down when the player put the selection down while it was on its way', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy);
    const board = driver(table.view);
    board.intent({ kind: 'CardsSelected', cardIds: hand, mode: 'replace' });
    board.act({
      kind: 'GroupActionRequested',
      action: { kind: 'send', to: 'lostZone' },
    });
    board.act({ kind: 'SubmissionQueued', commandId: 'group' });
    // Escape before the room answers.
    board.act({ kind: 'DismissLocalPresentation', scope: 'all' });
    board.act({ kind: 'CommandRefused', commandId: 'group' });
    expect(board.selection).toEqual([]);
    // A press on the felt does the same.
    const felt = driver(table.view);
    felt.intent({ kind: 'CardsSelected', cardIds: hand, mode: 'replace' });
    felt.act({
      kind: 'GroupActionRequested',
      action: { kind: 'send', to: 'lostZone' },
    });
    felt.act({ kind: 'SubmissionQueued', commandId: 'group' });
    felt.intent({ kind: 'BoardBackgroundPressed' });
    felt.act({ kind: 'CommandRefused', commandId: 'group' });
    expect(felt.selection).toEqual([]);
  });

  it('marks every Pokémon of the group and leaves the group selected', () => {
    const table = groupTable();
    const active = table.pokemon(BLUE, 'active', [{ name: 'Pikachu' }]);
    const benched = table.pokemon(BLUE, 'bench', [{ name: 'Pichu' }], [], {
      damage: 20,
    });
    const board = driver(table.view);
    board.intent({
      kind: 'CardsSelected',
      cardIds: [active.top, benched.top],
      mode: 'replace',
    });
    board.act({
      kind: 'LegacyShortcutActionRequested',
      request: { action: 'groupAction', group: { kind: 'damage', delta: 10 } },
    });
    const [command] = board.submitted();
    expect(command?.type === 'ApplyCardSteps' && command.steps).toEqual([
      expect.objectContaining({ type: 'SetDamage', damage: 10 }),
      expect.objectContaining({ type: 'SetDamage', damage: 30 }),
    ]);
    expect(board.selection).toEqual([active.top, benched.top]);
  });

  it("says why a group can't go: the reason, and the card it stopped at by name", () => {
    const table = groupTable();
    const basics = table.put(
      BLUE,
      'hand',
      { name: 'Pikachu' },
      { name: 'Eevee' }
    );
    const [card] = table.put(BLUE, 'hand', { ...energy, name: 'Switch' });
    const benched = table.pokemon(BLUE, 'bench', [{ name: 'Pichu' }]);
    const board = driver(table.view);
    board.intent({ kind: 'CardsSelected', cardIds: basics, mode: 'replace' });
    board.act({
      kind: 'GroupActionRequested',
      action: { kind: 'play', slot: 'active' },
    });
    expect(board.submitted()).toEqual([]);
    expect(board.effects).toEqual([
      expect.objectContaining({
        kind: 'GroupActionRejected',
        reason: 'one_active',
        itemCount: 2,
      }),
    ]);
    expect(board.selection).toEqual(basics);
    board.intent({
      kind: 'CardsSelected',
      cardIds: [benched.top, card!],
      mode: 'replace',
    });
    board.act({
      kind: 'GroupActionRequested',
      action: { kind: 'damage', delta: 10 },
    });
    expect(board.effects).toEqual([
      expect.objectContaining({
        kind: 'GroupActionRejected',
        reason: 'not_in_play',
        cardId: card,
        cardName: 'Switch',
      }),
    ]);
  });

  it('holds a dropped group where it was let go, and lets its cards go together', () => {
    const table = groupTable();
    const hand = table.put(
      BLUE,
      'hand',
      energy,
      energy,
      energy,
      energy,
      energy,
      energy
    );
    const discard = table.zoneId(BLUE, 'discard');
    const board = driver(table.view);
    board.intent({ kind: 'CardsSelected', cardIds: hand, mode: 'replace' });
    board.intent({
      kind: 'CardDropRequested',
      cardId: hand[2]!,
      targetId: discard,
      x: 40,
      y: 50,
      groupCardIds: hand,
    });
    expect(board.submitted()[0]?.type).toBe('ApplyCardSteps');
    const settling = board.state.presentation.settling;
    // The grabbed card and four more, one drop, each where the hand held
    // it (carriedGroup): the grabbed card where it was let go, the others
    // fanned a little further down and to the right.
    expect(settling.map((entry) => entry.cardId)).toEqual([
      hand[2],
      hand[0],
      hand[1],
      hand[3],
      hand[4],
    ]);
    expect(new Set(settling.map((entry) => entry.dropId)).size).toBe(1);
    expect(settling[0]).toMatchObject({ x: 40, y: 50 });
    for (const [index, entry] of settling.entries()) {
      if (index === 0) continue;
      expect(entry.x).toBeGreaterThan(settling[index - 1]!.x);
      expect(entry.y).toBeGreaterThan(settling[index - 1]!.y);
    }
    board.act({ kind: 'SubmissionQueued', commandId: 'drop' });
    expect(
      board.state.presentation.settling.map(
        (entry) => (entry as { commandId?: string | null }).commandId
      )
    ).toEqual(['drop', 'drop', 'drop', 'drop', 'drop']);
    // Another group, never sent: all of it let go.
    board.act({
      kind: 'FrameReceived',
      frame: frame(
        2,
        { ...table.view, revision: 2 },
        { pendingCommandIds: [] }
      ),
    });
    expect(board.state.presentation.settling).toHaveLength(0);
    board.intent({
      kind: 'CardsSelected',
      cardIds: hand.slice(0, 2),
      mode: 'replace',
    });
    board.intent({
      kind: 'CardDropRequested',
      cardId: hand[0]!,
      targetId: discard,
      x: 1,
      y: 1,
      groupCardIds: hand.slice(0, 2),
    });
    expect(board.state.presentation.settling).toHaveLength(2);
    board.act({ kind: 'SubmissionRejected' });
    expect(board.state.presentation.settling).toHaveLength(0);
    expect(board.selection).toEqual(hand.slice(0, 2));
  });

  it("lights a group drag's target from one compilation per target and place", () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy);
    const active = table.pokemon(BLUE, 'active', [{ name: 'Pikachu' }]);
    const discard = table.zoneId(BLUE, 'discard');
    const board = driver(table.view);
    board.intent({ kind: 'CardsSelected', cardIds: hand, mode: 'replace' });
    const compile = vi.mocked(compileGroupModule.compileGroup);
    compile.mockClear();
    const drag = (targetId: string | null, x: number) =>
      board.act({
        kind: 'RendererPresentationUpdated',
        update: {
          kind: 'DragChanged',
          drag: { cardId: hand[0]!, x, y: 5, targetId, groupCardIds: hand },
        },
      });
    drag(discard, 1);
    drag(discard, 2);
    drag(discard, 3);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(board.state.presentation.drag?.targetId).toBe(discard);
    // Energy go on a Pokémon together: lit.
    drag(active.stackId, 4);
    expect(board.state.presentation.drag?.targetId).toBe(active.stackId);
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it('keeps a group across frames: what left the table drops out, an evolved Pokémon stays by its new top', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy);
    const benched = table.pokemon(BLUE, 'bench', [{ name: 'Charmander' }]);
    const board = driver(table.view);
    board.intent({
      kind: 'CardsSelected',
      cardIds: [...hand, benched.top],
      mode: 'replace',
    });
    const next = structuredClone(table.view) as {
      -readonly [K in keyof MatchViewState]: MatchViewState[K];
    } & MatchViewState;
    const handZone = next.zones[table.zoneId(BLUE, 'hand')]!;
    // The second card goes to the discard pile; the Pokémon evolves with
    // the first.
    const [first, second] = handZone.cards;
    (next.zones[table.zoneId(BLUE, 'discard')]!.cards as unknown[]).push(
      second
    );
    (handZone as { cards: unknown[] }).cards = [];
    (next.stacks[benched.stackId]!.evolutionCards as unknown[]).push(first);
    board.act({
      kind: 'FrameReceived',
      frame: frame(2, { ...next, revision: 2 }),
    });
    expect(board.selection).toEqual([hand[0]]);
  });

  it('picks with `q`/`e` the Pokémon all of a group go on, and sends them there', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy);
    const active = table.pokemon(BLUE, 'active', [{ name: 'Pikachu' }]);
    const [basic] = table.put(BLUE, 'hand', { name: 'Eevee' });
    const board = driver(table.view);
    board.intent({ kind: 'CardsSelected', cardIds: hand, mode: 'replace' });
    board.act({
      kind: 'LegacyShortcutActionRequested',
      request: { action: 'beginGroupAttach' },
    });
    expect(board.state.presentation.targetableCardIds).toEqual([active.top]);
    expect(board.selection).toEqual(hand);
    board.intent({ kind: 'CardSelected', cardId: active.top });
    expect(board.submitted()[0]?.type).toBe('ApplyCardSteps');
    expect(board.selection).toEqual([]);
    // A Pokémon among them: no Pokémon takes them all.
    board.intent({
      kind: 'CardsSelected',
      cardIds: [hand[0]!, basic!],
      mode: 'replace',
    });
    board.act({
      kind: 'LegacyShortcutActionRequested',
      request: { action: 'beginGroupAttach' },
    });
    expect(board.effects).toEqual([
      expect.objectContaining({
        kind: 'GroupActionRejected',
        reason: 'no_target',
        action: null,
      }),
    ]);
  });

  it("takes the other seat's face-down hand at a Solo table, and leaves it in a room", () => {
    const table = groupTable();
    const own = table.put(BLUE, 'hand', energy);
    const theirs = table.put(RED, 'hand', { concealed: true });
    const selectBoth = (controlsEverySeat: boolean) => {
      const deps = { createScene, controlsEverySeat: () => controlsEverySeat };
      const installed = reduceBoardSessionController(
        createInitialBoardSessionControllerState(),
        { kind: 'FrameReceived', frame: frame(1, table.view) },
        deps
      ).state;
      return reduceBoardSessionController(
        installed,
        {
          kind: 'RendererIntent',
          intent: {
            kind: 'CardsSelected',
            cardIds: [...own, ...theirs],
            mode: 'replace',
          },
        },
        deps
      ).state.presentation.selection;
    };
    expect(selectBoth(true)).toEqual([...own, ...theirs]);
    expect(selectBoth(false)).toEqual(own);
  });

  it('joins a lone V-UNION piece to its unfinished Pokémon with `b`, as a group does', () => {
    const table = groupTable();
    const union = (part: number) => ({
      name: 'Morpeko V-UNION',
      presentation: piece('swshp:155:Morpeko V-UNION', part),
    });
    const morpeko = table.pokemon(BLUE, 'bench', [union(0), union(1)]);
    const [third] = table.put(BLUE, 'hand', union(2));
    const board = driver(table.view);
    board.intent({ kind: 'CardSelected', cardId: third!, mode: 'toggle' });
    board.act({
      kind: 'LegacyShortcutActionRequested',
      request: { action: 'moveCardToPlay', cardId: third!, slot: 'bench' },
    });
    expect(board.submitted()).toEqual([
      expect.objectContaining({
        type: 'PlaceCardOnPlayStack',
        cardId: third,
        targetStackId: morpeko.stackId,
      }),
    ]);
    expect(board.selection).toEqual([]);
    // Any other card goes to the Bench as before.
    const [basic] = table.put(BLUE, 'hand', { name: 'Eevee' });
    const plain = driver(table.view);
    plain.intent({ kind: 'CardSelected', cardId: basic!, mode: 'toggle' });
    plain.act({
      kind: 'LegacyShortcutActionRequested',
      request: { action: 'moveCardToPlay', cardId: basic!, slot: 'bench' },
    });
    expect(plain.submitted()[0]?.type).toBe('MoveCardToPlay');
  });

  it('moves a group picked out of the open pile, and settles whole Pokémon whole', () => {
    const table = groupTable();
    const pile = table.put(BLUE, 'discard', energy, energy);
    const pileId = table.zoneId(BLUE, 'discard');
    const board = driver(table.view);
    board.intent({ kind: 'ZoneOpened', zoneId: pileId });
    board.intent({ kind: 'CardsSelected', cardIds: pile, mode: 'replace' });
    expect(board.selection).toEqual(pile);
    board.act({
      kind: 'OpenedZoneCardIntent',
      intent: {
        kind: 'CardDropRequested',
        cardId: pile[1]!,
        targetId: table.zoneId(BLUE, 'hand'),
        x: 5,
        y: 5,
        groupCardIds: pile,
      },
    });
    expect(board.submitted()[0]?.type).toBe('ApplyCardSteps');
    expect(board.selection).toEqual([]);

    const pokemon = groupTable();
    const tops = [
      pokemon.pokemon(BLUE, 'bench', [{ name: 'Pichu' }], [energy]).top,
      pokemon.pokemon(BLUE, 'bench', [{ name: 'Eevee' }]).top,
    ];
    const knocked = driver(pokemon.view);
    knocked.intent({ kind: 'CardsSelected', cardIds: tops, mode: 'replace' });
    knocked.intent({
      kind: 'CardDropRequested',
      cardId: tops[0]!,
      targetId: pokemon.zoneId(BLUE, 'discard'),
      x: 5,
      y: 5,
      groupCardIds: tops,
    });
    expect(
      knocked.state.presentation.settling.map((entry) => entry.wholeStack)
    ).toEqual([true, true]);
  });

  it('turns a Stadium in pieces into one Stadium with `g`', () => {
    const table = groupTable();
    const halves = table.put(
      BLUE,
      'hand',
      {
        name: 'Legendary Pyroduct',
        category: 'Trainer',
        presentation: piece('me3:94:Legendary Pyroduct', 0, 2, 1),
      },
      {
        name: 'Legendary Pyroduct',
        category: 'Trainer',
        presentation: piece('me3:94:Legendary Pyroduct', 1, 2, 1),
      }
    );
    const board = driver(table.view);
    board.intent({ kind: 'CardsSelected', cardIds: halves, mode: 'replace' });
    board.act({
      kind: 'LegacyShortcutActionRequested',
      request: { action: 'groupAction', group: { kind: 'stadium' } },
    });
    const [command] = board.submitted();
    expect(command?.type === 'ApplyCardSteps' && command.steps).toEqual([
      expect.objectContaining({ type: 'MoveCardToStadium' }),
      expect.objectContaining({ type: 'MoveCardToStadium', placement: 'add' }),
    ]);
  });
});
