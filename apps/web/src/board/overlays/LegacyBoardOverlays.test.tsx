// @vitest-environment happy-dom

import {
  createBoardSceneForViewport,
  createRendererSpikeView,
  type CardSceneNode,
} from '@ptcgsim/renderer-contract';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInitialBoardSessionControllerState,
  type BoardSessionControllerState,
} from '../BoardSessionController.js';
import {
  LegacyBoardOverlays,
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
  });

  it('renders a focused context menu and delegates one semantic action', async () => {
    const card = cardIn(`:${firstPlayer}:hand`);
    const callbacks = actions();
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            overlays: { contextMenuCardId: card.id, preview: null },
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
            overlays: { contextMenuCardId: null, preview: null },
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
});
