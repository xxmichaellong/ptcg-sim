// @vitest-environment happy-dom

import {
  createBoardSceneForViewport,
  createRendererSpikeView,
  type CardSceneNode,
} from '@ptcgsim/renderer-contract';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInitialBoardSessionControllerState,
  type BoardSessionControllerState,
} from '../BoardSessionController.js';
import {
  LegacyBoardOverlays,
  legacyStackPreviewFrameStyle,
  legacyZoneBrowserFrameStyle,
  selectLegacyContextEntries,
  sortRecipientSafeZoneCards,
  type LegacyBoardOverlayActions,
} from './LegacyBoardOverlays.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const view = createRendererSpikeView();
const firstPlayer = view.playerOrder[0]!;
const scene = createBoardSceneForViewport(view, {
  geometryVersion: 1,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  bottomPlayerId: firstPlayer,
  splitRatio: 0.5,
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

const cardIn = (suffix: string): CardSceneNode => {
  const card = scene.cards.find((candidate) =>
    candidate.parentId.endsWith(suffix)
  );
  if (!card) throw new Error(`Missing fixture card in ${suffix}`);
  return card;
};

const actions = (): LegacyBoardOverlayActions => ({
  emitOpenedZoneCardIntent: vi.fn(),
  dismiss: vi.fn(),
  invokeContextAction: vi.fn(),
  invokeZoneAction: vi.fn(),
  submitDamageInput: vi.fn(),
  submitSpecialConditionInput: vi.fn(),
  submitCountInput: vi.fn(),
  submitShortcutCountInput: vi.fn(),
  submitCategoryChoice: vi.fn(),
  submitMoveChoice: vi.fn(),
});

describe('legacy board overlays', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.replaceChildren(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('projects source iframe-relative overlays into physical player frames', () => {
    const local = scene.layout.players.find((frame) => frame.side === 'local')!;
    const opponent = scene.layout.players.find(
      (frame) => frame.side === 'opponent'
    )!;
    expect(local.bounds).toEqual({
      x: 0,
      y: 360,
      width: 1280,
      height: 360,
    });
    expect(opponent.bounds).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 360,
    });
    const localStack = legacyStackPreviewFrameStyle(local, 'local');
    expect(localStack).toMatchObject({
      left: 640,
      top: 540,
      transform: 'translate(-50%, -50%)',
    });
    expect(localStack.width).toBeCloseTo(883.2, 10);
    expect(localStack.height).toBeCloseTo(252, 10);
    const opponentStack = legacyStackPreviewFrameStyle(opponent, 'opponent');
    expect(opponentStack).toMatchObject({
      left: 640,
      top: 180,
      transform: 'translate(-50%, -50%) rotate(180deg)',
    });
    expect(opponentStack.width).toBeCloseTo(883.2, 10);
    expect(opponentStack.height).toBeCloseTo(252, 10);
    expect(legacyZoneBrowserFrameStyle(local, 'local')).toEqual({
      left: 640,
      top: 540,
      width: 1088,
      height: 270,
      transform: 'translate(-50%, -50%)',
    });
    expect(legacyZoneBrowserFrameStyle(opponent, 'opponent')).toEqual({
      left: 640,
      top: 68,
      width: 1088,
      height: 270,
      transform: 'translateX(-50%)',
    });
  });

  it('selects the source-ordered player menu without granting authority', () => {
    const actionIds = (card: CardSceneNode) =>
      selectLegacyContextEntries(state(), card)
        .filter((entry) => entry.kind === 'action')
        .map((entry) => entry.id);
    const localHand = cardIn(`:${firstPlayer}:hand`);
    expect(
      selectLegacyContextEntries(state(), localHand).map((entry) => [
        entry.kind,
        entry.id,
        entry.label,
      ])
    ).toEqual([
      ['header', 'hand', 'Hand'],
      ['action', 'discardHand', 'Discard hand'],
      ['action', 'shuffleHandToDeck', 'Shuffle hand to deck'],
      ['action', 'shuffleHandToDeckBottom', 'Shuffle hand to bottom'],
      ['action', 'moveCard', 'Move card...'],
      ['action', 'revealCard', 'Reveal/hide card'],
    ]);

    const opponent = view.playerOrder[1]!;
    const opponentHand = cardIn(`:${opponent}:hand`);
    expect(
      selectLegacyContextEntries(state(), opponentHand)
        .filter((entry) => entry.kind === 'action')
        .map((entry) => entry.id)
    ).toEqual([
      'toggleOpponentHand',
      'randomOpponentHandCard',
      'moveCard',
      'revealCard',
    ]);

    const active = cardIn('stack:blue:active');
    expect(actionIds(active)).toEqual([
      'toggleAbility',
      'setDamage',
      'setSpecialCondition',
      'moveCard',
      'revealCard',
      'changeCardType',
    ]);
    expect(actionIds(cardIn(`:${firstPlayer}:prizes`))).toEqual([
      'shufflePrizes',
      'revealPrizes',
      'togglePrizes',
      'shufflePrizesToDeckBottom',
      'moveCard',
      'revealCard',
    ]);
    expect(actionIds(cardIn(`:${firstPlayer}:deck`))).toEqual([
      'shuffleDeck',
      'drawCards',
      'viewDeckTop',
      'viewDeckBottom',
      'moveCard',
      'revealCard',
    ]);
    expect(actionIds(cardIn(`:${firstPlayer}:board`))).toEqual([
      'discardBoard',
      'moveBoardToHand',
      'shuffleBoardToDeck',
      'moveBoardToLostZone',
      'moveCard',
      'revealCard',
    ]);
    expect(actionIds(cardIn(`:${firstPlayer}:discard`))).toEqual([
      'toggleAbility',
      'moveCard',
      'revealCard',
    ]);
    expect(actionIds(cardIn(`:${firstPlayer}:lostZone`))).toEqual([
      'moveCard',
      'revealCard',
    ]);
    expect(actionIds(cardIn('zone:shared:stadium'))).toEqual([
      'toggleAbility',
      'moveCard',
      'revealCard',
    ]);
    expect(
      selectLegacyContextEntries(
        state({ source: { kind: 'replay' }, canSubmitCommands: false }),
        localHand
      )
    ).toEqual([]);

    const replayState = state({
      source: {
        kind: 'replay',
        replayId: 'solo-replay',
        playbackGeneration: 1,
        frameIndex: 0,
      },
      canSubmitCommands: false,
      replayLocalDisplay: {
        disclosure: {
          definitions: [],
          zoneIds: [
            `zone:${firstPlayer}:prizes`,
            `zone:${opponent}:prizes`,
            `zone:${opponent}:hand`,
          ],
          cards: [],
        },
        zoneModes: {},
        cardModes: {},
      },
    });
    expect(
      selectLegacyContextEntries(
        replayState,
        cardIn(`:${firstPlayer}:prizes`)
      ).map((entry) => [entry.kind, entry.id])
    ).toEqual([
      ['header', 'prizes'],
      ['action', 'revealPrizes'],
      ['action', 'togglePrizes'],
      ['action', 'revealCard'],
    ]);
    expect(
      selectLegacyContextEntries(replayState, cardIn(`:${opponent}:hand`)).map(
        (entry) => [entry.kind, entry.id]
      )
    ).toEqual([
      ['header', 'hand'],
      ['action', 'toggleOpponentHand'],
      ['action', 'revealCard'],
    ]);
    expect(
      selectLegacyContextEntries(replayState, cardIn(`:${firstPlayer}:deck`))
    ).toEqual([]);
  });

  it('renders a focused context menu and delegates one semantic action', async () => {
    const card = cardIn(`:${firstPlayer}:hand`);
    const callbacks = actions();
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            overlays: {
              contextMenuCardId: card.id,
              preview: null,
              input: null,
            },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    const menu = host.querySelector<HTMLElement>(
      '[data-legacy-card-context-menu]'
    );
    expect(menu?.getAttribute('role')).toBe('menu');
    const firstAction = host.querySelector<HTMLButtonElement>(
      '[data-context-action="discardHand"]'
    );
    expect(document.activeElement).toBe(firstAction);

    firstAction?.click();
    expect(callbacks.invokeContextAction).toHaveBeenCalledExactlyOnceWith(
      'discardHand',
      card.id
    );
    expect(callbacks.dismiss).toHaveBeenCalledExactlyOnceWith('context');
  });

  it('recreates the ordered category submenu and delegates one typed choice', async () => {
    const activeStack = view.stacks[view.boards[firstPlayer]!.activeStackId!]!;
    const cardId = activeStack.evolutionCards.at(-1)!.id;
    const card = scene.cards.find((candidate) => candidate.id === cardId)!;
    const callbacks = actions();
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            overlays: {
              contextMenuCardId: card.id,
              preview: null,
              input: null,
            },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>(
      '[data-context-action="changeCardType"]'
    )!;
    const submenu = host.querySelector<HTMLElement>(
      '[data-context-submenu="changeCardType"]'
    )!;
    const choices = [
      ...submenu.querySelectorAll<HTMLButtonElement>('[data-category-choice]'),
    ];
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(choices.map((choice) => choice.textContent)).toEqual([
      'to Energy',
      'to Tool',
      'to Pokémon',
    ]);
    expect(choices.map((choice) => choice.dataset.categoryChoice)).toEqual([
      'Energy',
      'Trainer',
      'Pokémon',
    ]);

    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(choices[0]);

    await act(async () => {
      choices[0]!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(document.activeElement).toBe(choices[1]);
    await act(async () => {
      choices[1]!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'End',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(document.activeElement).toBe(choices[2]);
    await act(async () => {
      choices[2]!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await act(async () => trigger.click());
    await act(async () => choices[1]!.click());
    expect(callbacks.submitCategoryChoice).toHaveBeenCalledExactlyOnceWith(
      card.id,
      'Trainer'
    );
    expect(callbacks.invokeContextAction).not.toHaveBeenCalled();
    expect(callbacks.dismiss).toHaveBeenCalledExactlyOnceWith('context');
  });

  it('recreates the ordered move submenu and delegates one typed choice', async () => {
    const card = cardIn(`:${firstPlayer}:hand`);
    const callbacks = actions();
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            overlays: {
              contextMenuCardId: card.id,
              preview: null,
              input: null,
            },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>(
      '[data-context-action="moveCard"]'
    )!;
    const submenu = host.querySelector<HTMLElement>(
      '[data-context-submenu="moveCard"]'
    )!;
    const choices = [
      ...submenu.querySelectorAll<HTMLButtonElement>('[data-move-choice]'),
    ];
    expect(trigger.parentElement?.classList.contains('is-boundary')).toBe(true);
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(choices.map((choice) => choice.textContent)).toEqual([
      'to Board',
      'to Deck (top)',
      'to Deck (bottom)',
      'to Deck (switch)',
      'to Deck (shuffle)',
    ]);
    expect(choices.map((choice) => choice.dataset.moveChoice)).toEqual([
      'board',
      'deckTop',
      'deckBottom',
      'deckSwitch',
      'deckShuffle',
    ]);

    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(choices[0]);
    await act(async () => {
      choices[0]!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'End',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(document.activeElement).toBe(choices[4]);
    await act(async () => {
      trigger.parentElement?.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          relatedTarget: document.body,
        })
      );
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(choices[4]);
    await act(async () => {
      choices[4]!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await act(async () => trigger.click());
    await act(async () => choices[3]!.click());
    expect(callbacks.submitMoveChoice).toHaveBeenCalledExactlyOnceWith(
      card.id,
      'deckSwitch'
    );
    expect(callbacks.invokeContextAction).not.toHaveBeenCalled();
    expect(callbacks.dismiss).toHaveBeenCalledExactlyOnceWith('context');
  });

  it('runs each controller count descriptor through one strict-safe native prompt', async () => {
    const callbacks = actions();
    const card = cardIn(`:${firstPlayer}:deck`);
    const prompt = vi
      .fn()
      .mockReturnValueOnce(' 3 ')
      .mockReturnValueOnce('2.5')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('2');
    const alert = vi.fn();
    vi.stubGlobal('prompt', prompt);
    vi.stubGlobal('alert', alert);
    const renderInput = async (
      input: NonNullable<BoardSessionControllerState['overlays']['input']>
    ) => {
      await act(async () => {
        root.render(
          createElement(
            StrictMode,
            null,
            createElement(LegacyBoardOverlays, {
              state: state({
                overlays: {
                  contextMenuCardId: null,
                  preview: null,
                  input,
                },
              }),
              darkMode: false,
              actions: callbacks,
            })
          )
        );
      });
    };

    await renderInput({
      kind: 'count',
      action: 'drawCards',
      cardId: card.id,
      zoneId: card.parentId,
      message: 'Draw how many cards?',
      initialValue: '1',
      minimum: 1,
      invalidMessage: 'Please enter a valid number for the draw amount.',
    });
    expect(prompt).toHaveBeenCalledExactlyOnceWith('Draw how many cards?', '1');
    expect(callbacks.submitCountInput).toHaveBeenCalledExactlyOnceWith(
      'drawCards',
      card.id,
      ' 3 '
    );

    await renderInput({
      kind: 'count',
      action: 'viewDeckTop',
      cardId: card.id,
      zoneId: card.parentId,
      message: 'How many cards do you want to look at?',
      initialValue: '1',
      minimum: 1,
      invalidMessage: 'Please enter a valid number for the view amount.',
    });
    expect(alert).toHaveBeenCalledExactlyOnceWith(
      'Please enter a valid number for the view amount.'
    );
    expect(callbacks.dismiss).toHaveBeenCalledExactlyOnceWith('input');
    expect(callbacks.submitCountInput).toHaveBeenCalledTimes(1);

    await renderInput({
      kind: 'count',
      action: 'viewDeckBottom',
      cardId: card.id,
      zoneId: card.parentId,
      message: 'How many cards do you want to look at?',
      initialValue: '1',
      minimum: 1,
      invalidMessage: 'Please enter a valid number for the view amount.',
    });
    expect(prompt).toHaveBeenCalledTimes(3);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(callbacks.dismiss).toHaveBeenCalledTimes(2);
    expect(callbacks.submitCountInput).toHaveBeenCalledTimes(1);

    await renderInput({
      kind: 'shortcutCount',
      action: 'shuffleOwnHandAndDraw',
      playerId: firstPlayer,
      zoneId: `zone:${firstPlayer}:hand`,
      message: 'Draw how many cards?',
      initialValue: '0',
      minimum: 0,
      invalidMessage: 'Please enter a valid number for the draw amount.',
    });
    expect(prompt).toHaveBeenCalledTimes(4);
    expect(callbacks.submitShortcutCountInput).toHaveBeenCalledExactlyOnceWith(
      'shuffleOwnHandAndDraw',
      '2'
    );
  });

  it('projects recipient-safe card, stack, and zone images into source-shaped dialogs', async () => {
    const callbacks = actions();
    const card = cardIn(`:${firstPlayer}:hand`);
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            overlays: {
              contextMenuCardId: null,
              preview: { kind: 'card', cardId: card.id },
              input: null,
            },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    expect(
      host
        .querySelector('[data-legacy-card-preview]')
        ?.getAttribute('data-preview-kind')
    ).toBe('card');
    expect(
      host
        .querySelector<HTMLImageElement>('[data-overlay-card-id]')
        ?.getAttribute('src')
    ).toBe(card.imageUrl);

    const stackId = view.boards[firstPlayer]!.activeStackId!;
    const stackCards = scene.cards.filter(
      (candidate) => candidate.parentId === stackId
    );
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            overlays: {
              contextMenuCardId: null,
              preview: {
                kind: 'stack',
                stackId,
                focusCardId: stackCards[0]!.id,
              },
              input: null,
            },
          }),
          darkMode: true,
          actions: callbacks,
        })
      );
    });
    expect(
      host.querySelectorAll(
        '[data-preview-kind="stack"] [data-overlay-card-id]'
      )
    ).toHaveLength(stackCards.length);

    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const discardCards = scene.cards.filter(
      (candidate) => candidate.parentId === discard.id
    );
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            presentation: {
              selectedCardId: null,
              hoveredCardId: null,
              drag: null,
              openedZoneId: discard.id,
            },
            overlays: { contextMenuCardId: null, preview: null, input: null },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    const browser = host.querySelector<HTMLElement>(
      '[data-legacy-zone-browser]'
    );
    expect(browser?.getAttribute('aria-label')).toContain(
      `${discard.count} cards`
    );
    expect(
      host.querySelectorAll('[data-legacy-zone-browser] [data-overlay-card-id]')
    ).toHaveLength(discardCards.length);
    expect(document.activeElement).toBe(
      host.querySelector('[data-zone-close]')
    );

    const duplicate = host.querySelector<HTMLElement>(
      '[data-legacy-zone-browser] [data-overlay-card-id]'
    );
    await act(async () => {
      duplicate?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      );
    });
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardContextRequested',
      cardId: discardCards[0]!.id,
    });
  });

  it('sorts only disclosed labels locally and restores authoritative scene order', async () => {
    const callbacks = actions();
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const canonicalCards = scene.cards.filter(
      (candidate) => candidate.parentId === discard.id
    );
    const labels = ['Zulu', 'Alpha', 'Alpha'];
    const relabeledCards = scene.cards.map((card) => {
      const index = canonicalCards.findIndex(
        (candidate) => candidate.id === card.id
      );
      return index === -1 ? card : { ...card, label: labels[index]! };
    });
    const overlayState = state({
      scene: { ...scene, cards: relabeledCards },
      presentation: {
        selectedCardId: null,
        hoveredCardId: null,
        drag: null,
        openedZoneId: discard.id,
      },
    });
    const cardIds = () =>
      [...host.querySelectorAll('[data-overlay-card-id]')].map((node) =>
        node.getAttribute('data-overlay-card-id')
      );

    const concealedCards = [
      { ...canonicalCards[1]!, label: 'Face-down card' },
      { ...canonicalCards[0]!, label: 'Face-down card' },
    ];
    expect(
      sortRecipientSafeZoneCards(concealedCards).map((card) => card.id)
    ).toEqual([canonicalCards[1]!.id, canonicalCards[0]!.id]);
    expect(concealedCards.map((card) => card.id)).toEqual([
      canonicalCards[1]!.id,
      canonicalCards[0]!.id,
    ]);

    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: overlayState,
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    expect(cardIds()).toEqual(canonicalCards.map((card) => card.id));

    const sort = host.querySelector<HTMLInputElement>(
      '[data-zone-action="sortZone"]'
    )!;
    await act(async () => sort.click());
    expect(sort.checked).toBe(true);
    expect(cardIds()).toEqual([
      canonicalCards[1]!.id,
      canonicalCards[2]!.id,
      canonicalCards[0]!.id,
    ]);
    expect(callbacks.invokeZoneAction).not.toHaveBeenCalled();

    await act(async () => sort.click());
    expect(sort.checked).toBe(false);
    expect(cardIds()).toEqual(canonicalCards.map((card) => card.id));
    expect(callbacks.invokeZoneAction).not.toHaveBeenCalled();

    await act(async () => sort.click());
    expect(sort.checked).toBe(true);
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state(),
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: overlayState,
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    expect(
      host.querySelector<HTMLInputElement>('[data-zone-action="sortZone"]')
        ?.checked
    ).toBe(false);
    expect(cardIds()).toEqual(canonicalCards.map((card) => card.id));
    expect(callbacks.invokeZoneAction).not.toHaveBeenCalled();
  });

  it('preserves the external opener across StrictMode focus-effect replay', async () => {
    const callbacks = actions();
    const opener = document.createElement('button');
    opener.textContent = 'Open deck';
    document.body.prepend(opener);
    opener.focus();
    const deck = scene.zones.find(
      (candidate) =>
        candidate.id === `zone:${firstPlayer}:deck` && candidate.interactive
    )!;
    const renderOpenedZone = async (openedZoneId: string | null) => {
      await act(async () => {
        root.render(
          createElement(
            StrictMode,
            null,
            createElement(LegacyBoardOverlays, {
              state: state({
                presentation: {
                  selectedCardId: null,
                  hoveredCardId: null,
                  drag: null,
                  openedZoneId,
                },
              }),
              darkMode: false,
              actions: callbacks,
            })
          )
        );
        await Promise.resolve();
      });
    };

    await renderOpenedZone(deck.id);
    expect(document.activeElement).toBe(
      host.querySelector('[data-zone-close]')
    );

    await renderOpenedZone(null);
    expect(host.querySelector('[data-legacy-zone-browser]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('anchors a bounded temporary damage editor without mutating scene markers', async () => {
    const callbacks = actions();
    const active = view.stacks[view.boards[firstPlayer]!.activeStackId!]!;
    const cardId = active.evolutionCards.at(-1)!.id;
    const marker = scene.markers.find(
      (candidate) =>
        candidate.parentCardId === cardId && candidate.kind === 'damage'
    )!;
    const markerSnapshot = JSON.stringify(scene.markers);
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            overlays: {
              contextMenuCardId: null,
              preview: null,
              input: { kind: 'damage', cardId, initialValue: '120' },
            },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });

    const editor = host.querySelector<HTMLDivElement>(
      '[data-legacy-marker-editor="damage"]'
    )!;
    expect(editor.textContent).toBe('120');
    expect(editor.getAttribute('role')).toBe('textbox');
    expect(editor.getAttribute('aria-label')).toBe('Damage counter');
    expect(Number.parseFloat(editor.style.left)).toBeCloseTo(
      marker.bounds.x,
      5
    );
    expect(Number.parseFloat(editor.style.top)).toBeCloseTo(marker.bounds.y, 5);
    expect(Number.parseFloat(editor.style.width)).toBeCloseTo(
      marker.bounds.width,
      5
    );
    expect(Number.parseFloat(editor.style.height)).toBeCloseTo(
      marker.bounds.height,
      5
    );

    await act(async () => {
      editor.focus();
      editor.blur();
    });
    expect(callbacks.dismiss).toHaveBeenCalledExactlyOnceWith('input');
    expect(callbacks.submitDamageInput).not.toHaveBeenCalled();
    vi.mocked(callbacks.dismiss).mockClear();

    await act(async () => {
      editor.focus();
      editor.textContent = '70.5';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
      editor.blur();
    });
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(editor);
    expect(callbacks.submitDamageInput).not.toHaveBeenCalled();

    await act(async () => {
      editor.textContent = '70';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
      editor.blur();
    });
    expect(callbacks.submitDamageInput).toHaveBeenCalledExactlyOnceWith(
      cardId,
      '70'
    );
    expect(callbacks.invokeContextAction).not.toHaveBeenCalled();
    expect(JSON.stringify(scene.markers)).toBe(markerSnapshot);

    vi.mocked(callbacks.submitDamageInput).mockClear();
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(callbacks.dismiss).toHaveBeenCalledWith('input');
    expect(callbacks.submitDamageInput).not.toHaveBeenCalled();
  });

  it('anchors the active condition editor and follows the legacy draft palette', async () => {
    const callbacks = actions();
    const legacyScene = createBoardSceneForViewport(view, {
      geometryVersion: 1,
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      bottomPlayerId: firstPlayer,
      splitRatio: 0.5,
    });
    const active = view.stacks[view.boards[firstPlayer]!.activeStackId!]!;
    const cardId = active.evolutionCards.at(-1)!.id;
    const marker = legacyScene.markers.find(
      (candidate) =>
        candidate.parentCardId === cardId &&
        candidate.kind === 'specialCondition'
    )!;
    const markerSnapshot = JSON.stringify(legacyScene.markers);
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            scene: legacyScene,
            overlays: {
              contextMenuCardId: null,
              preview: null,
              input: {
                kind: 'specialCondition',
                cardId,
                initialValue: 'Poisoned',
              },
            },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });

    const editor = host.querySelector<HTMLDivElement>(
      '[data-legacy-marker-editor="specialCondition"]'
    )!;
    expect(editor.textContent).toBe('Poisoned');
    expect(editor.getAttribute('aria-label')).toBe('Special condition');
    expect(Number.parseFloat(editor.style.left)).toBeCloseTo(
      marker.bounds.x,
      5
    );
    expect(Number.parseFloat(editor.style.top)).toBeCloseTo(marker.bounds.y, 5);
    expect(editor.style.background).toBe('#efefef');
    expect(editor.style.color).toBe('#111');

    await act(async () => {
      editor.focus();
      editor.textContent = 'Pa';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(editor.style.background).toBe('rgb(255, 255, 0)');
    expect(editor.style.color).toBe('rgb(0, 0, 0)');

    await act(async () => {
      editor.textContent = 'condition text too long';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
      editor.blur();
    });
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(editor);
    expect(callbacks.submitSpecialConditionInput).not.toHaveBeenCalled();

    await act(async () => {
      editor.textContent = ' B ';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
      editor.blur();
    });
    expect(
      callbacks.submitSpecialConditionInput
    ).toHaveBeenCalledExactlyOnceWith(cardId, ' B ');
    expect(callbacks.submitDamageInput).not.toHaveBeenCalled();
    expect(JSON.stringify(legacyScene.markers)).toBe(markerSnapshot);
  });
});
