// @vitest-environment happy-dom

import type { MatchViewState } from '@ptcgsim/game-core';
import {
  createBoardSceneForViewport,
  createRendererSpikeView,
  type BoardPresentation,
  type CardSceneNode,
} from '@ptcgsim/renderer-contract';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelAllDialogRequests } from '../../ui/dialog-requests.js';
import { preferences } from '../../preferences/preference-store.js';
import { TableMotionStore } from '../table-motion.js';
import { LANDING_MAX_MS, TOUCH_PICKUP_MS } from './useOverlayCardDrag.js';
import { ZONE_BROWSER_PREFERENCES } from './zone-browser-preferences.js';
import { OverlayHost } from '../../ui/OverlayHost.js';
import {
  createInitialBoardSessionControllerState,
  type BoardSessionControllerState,
} from '../BoardSessionController.js';
import {
  CONTEXT_MENU_EDGE_PX,
  contextMenuBox,
  LegacyBoardOverlays,
  resolveOpenedZoneDropTarget,
  selectLegacyContextEntries,
  sortRecipientSafeZoneCards,
  stackPreviewFrameStyle,
  stackPreviewOrder,
  zoneCopyCounts,
  type LegacyBoardOverlayActions,
} from './LegacyBoardOverlays.js';
import {
  stackPreviewLayout,
  workAreaPanelLayout,
  zoneBrowserLayout,
} from './overlayLayout.js';

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

/** Lets the dialog host's portal, focus and transitions settle. */
const settleDialogs = async (): Promise<void> => {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

/** Two paints: long enough for the table to set a dropped card off. */
const nextFrames = async (): Promise<void> => {
  for (let frame = 0; frame < 2; frame += 1)
    await new Promise((resolve) => requestAnimationFrame(resolve));
};

const openDialogs = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(
    '[data-ptcgsim-overlay="dialog"], [data-ptcgsim-overlay="alert"]'
  ),
];

const dialogButton = (action: string): HTMLButtonElement => {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-dialog-action="${action}"]`
  );
  if (!button) throw new Error(`No dialog ${action} button`);
  return button;
};

const dialogField = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>(
    '.ptcgsim-ui-field__input'
  );
  if (!input) throw new Error('No prompt field');
  return input;
};

const typeAndSubmit = async (value: string): Promise<void> => {
  const input = dialogField();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.form?.requestSubmit());
  await settleDialogs();
};

const actions = (): LegacyBoardOverlayActions => ({
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
});

describe('legacy board overlays', () => {
  let host: HTMLDivElement;
  let root: Root;
  let overlayRoot: Root | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.replaceChildren(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      cancelAllDialogRequests();
      root.unmount();
      overlayRoot?.unmount();
    });
    overlayRoot = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** The application's overlay host, as main.tsx mounts it. */
  const mountOverlayHost = async (): Promise<void> => {
    const element = document.createElement('div');
    document.body.append(element);
    overlayRoot = createRoot(element);
    await act(async () => overlayRoot?.render(createElement(OverlayHost)));
  };

  it('lays the stack view out upright over its player frame, sized to its cards', () => {
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
    // v1's 69% x 70% frame box (883.2 x 252 here) and the opponent's
    // half-turn were v1 visuals, retired by ADR-027: the view now fits its
    // cards, drawn as large as the board allows, upright on either half.
    for (const [frame, count] of [
      [local, 2],
      [opponent, 2],
      [local, 7],
    ] as const) {
      const layout = stackPreviewLayout(frame.bounds, scene.viewport, count);
      const style = stackPreviewFrameStyle(frame, scene.viewport, count);
      expect(style).toEqual({
        left: layout.left,
        top: layout.top,
        width: layout.width,
        height: layout.height,
        '--ptcgsim-stack-card-height': `${layout.cardHeight.toFixed(2)}px`,
      });
      expect(style.transform).toBeUndefined();
    }
    const pair = stackPreviewLayout(local.bounds, scene.viewport, 2);
    expect(pair.cardHeight).toBeCloseTo(720 * 0.34);
    expect(pair.left + pair.width / 2).toBeCloseTo(640);
    expect(pair.top + pair.height / 2).toBeCloseTo(540);
    const opponentPair = stackPreviewLayout(opponent.bounds, scene.viewport, 2);
    expect(opponentPair.top + opponentPair.height / 2).toBeCloseTo(180);
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

  it('gives the own-only menu entries to the seat at the bottom of a flipped board', () => {
    // v1's selfView: after Alt-F in Solo the other seat's deck offers Draw
    // and its hand the discard/shuffle entries, while the viewer's own hand
    // reads as the opponent's.
    const opponent = view.playerOrder[1]!;
    const flippedScene = createBoardSceneForViewport(view, {
      geometryVersion: 1,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      bottomPlayerId: opponent,
      splitRatio: 0.5,
    });
    const flipped = state({ scene: flippedScene });
    const entryIds = (card: CardSceneNode) =>
      selectLegacyContextEntries(flipped, card)
        .filter((entry) => entry.kind === 'action')
        .map((entry) => entry.id);
    const opponentDeck = flippedScene.cards.find(
      (card) =>
        card.parentId.endsWith(`:${opponent}:deck`) &&
        card.primaryAction?.kind === 'openZone'
    )!;
    expect(entryIds(opponentDeck)).toContain('drawCards');
    const opponentHand = flippedScene.cards.find((card) =>
      card.parentId.endsWith(`:${opponent}:hand`)
    )!;
    expect(entryIds(opponentHand)).toEqual(
      expect.arrayContaining(['discardHand', 'shuffleHandToDeck'])
    );
    const ownHand = flippedScene.cards.find((card) =>
      card.parentId.endsWith(`:${firstPlayer}:hand`)
    )!;
    expect(entryIds(ownHand)).toEqual(
      expect.arrayContaining(['toggleOpponentHand', 'randomOpponentHandCard'])
    );
    expect(entryIds(ownHand)).not.toContain('discardHand');
  });

  it('delegates a focused context-menu action to controller-owned teardown', async () => {
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
    expect(callbacks.dismiss).not.toHaveBeenCalled();
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
    expect(callbacks.dismiss).not.toHaveBeenCalled();
  });

  describe('a card menu kept inside the board', () => {
    const EDGE = CONTEXT_MENU_EDGE_PX;
    const isMenu = (element: HTMLElement) =>
      element.classList.contains('ptcgsim-legacy-card-context-menu');
    /**
     * Lays the menu out at `width` by `rows` (plus `opened` with a submenu
     * open), as happy-dom lays nothing out; drawn at `drawnScale`, as while
     * it scales in.
     */
    const layOut = ({
      width,
      rows,
      opened = 0,
      drawnScale = 1,
    }: {
      readonly width: number;
      readonly rows: number;
      readonly opened?: number;
      readonly drawnScale?: number;
    }) => {
      const content = (element: HTMLElement) =>
        rows +
        (element.querySelector('[data-submenu-open="true"]') ? opened : 0);
      const shown = (element: HTMLElement) => {
        const max = parseFloat(element.style.maxHeight);
        return Number.isFinite(max)
          ? Math.min(content(element), max)
          : content(element);
      };
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
        function (this: HTMLElement) {
          return isMenu(this) ? width : 0;
        }
      );
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
        function (this: HTMLElement) {
          return isMenu(this) ? shown(this) : 0;
        }
      );
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
        function (this: HTMLElement) {
          return isMenu(this) ? shown(this) : 0;
        }
      );
      vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(
        function (this: Element) {
          return this instanceof HTMLElement && isMenu(this)
            ? content(this)
            : 0;
        }
      );
      const rect = Element.prototype.getBoundingClientRect;
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
        function (this: Element) {
          if (!(this instanceof HTMLElement) || !isMenu(this))
            return rect.call(this);
          const left = parseFloat(this.style.left) || 0;
          const top = parseFloat(this.style.top) || 0;
          return new DOMRect(
            left,
            top,
            width * drawnScale,
            shown(this) * drawnScale
          );
        }
      );
    };
    const narrowWindow = (narrow: boolean) =>
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query: string) =>
          ({
            matches: narrow && query.includes('max-width'),
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
          }) as unknown as MediaQueryList
      );
    const openMenu = async (card: CardSceneNode) => {
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
            actions: actions(),
          })
        );
      });
      return host.querySelector<HTMLElement>(
        '[data-legacy-card-context-menu]'
      )!;
    };
    const box = (menu: HTMLElement) => ({
      left: parseFloat(menu.style.left),
      top: parseFloat(menu.style.top),
      width: menu.offsetWidth,
      height: menu.offsetHeight,
    });
    const expectInside = (menu: HTMLElement) => {
      const { left, top, width, height } = box(menu);
      expect(left).toBeGreaterThanOrEqual(EDGE);
      expect(top).toBeGreaterThanOrEqual(EDGE);
      expect(left + width).toBeLessThanOrEqual(scene.viewport.width - EDGE);
      expect(top + height).toBeLessThanOrEqual(scene.viewport.height - EDGE);
    };

    it('keeps its edge inset, or centres a menu with no room for it', () => {
      const viewport = { width: 390, height: 844 };
      const size = { width: 232, height: 300 };
      expect(contextMenuBox({ left: 300, top: 700 }, size, viewport)).toEqual({
        left: 390 - EDGE - 232,
        top: 844 - EDGE - 300,
      });
      expect(contextMenuBox({ left: -40, top: 2 }, size, viewport)).toEqual({
        left: EDGE,
        top: EDGE,
      });
      expect(contextMenuBox({ left: 50, top: 100 }, size, viewport)).toEqual({
        left: 50,
        top: 100,
      });
      expect(
        contextMenuBox(
          { left: 0, top: 0 },
          { width: 380, height: 300 },
          viewport
        )
      ).toEqual({ left: 5, top: EDGE });
    });

    it('is placed by its laid-out size, not as drawn while it scales in', async () => {
      narrowWindow(false);
      // The hand's last card: its menu opens at its left edge, and is wide
      // enough to be pulled in from the board's right edge.
      const hand = scene.cards.filter((candidate) =>
        candidate.parentId.endsWith(`:${firstPlayer}:hand`)
      );
      const last = hand.reduce((right, candidate) =>
        candidate.bounds.x > right.bounds.x ? candidate : right
      );
      const width = Math.ceil(scene.viewport.width - last.bounds.x + 60);
      // Drawn at 96% as it scales in: placed by that, it ran 4% past the
      // edge it was kept from.
      layOut({ width, rows: 300, drawnScale: 0.96 });
      const menu = await openMenu(last);
      expectInside(menu);
      expect(parseFloat(menu.style.left)).toBe(
        scene.viewport.width - EDGE - width
      );
    });

    it('scrolls, its submenus in place, when its rows are taller than the board', async () => {
      narrowWindow(false);
      layOut({ width: 260, rows: 900 });
      const menu = await openMenu(cardIn(`:${firstPlayer}:hand`));
      expect(menu.dataset['menuCompact']).toBe('true');
      expect(parseFloat(menu.style.maxHeight)).toBe(
        scene.viewport.height - 2 * EDGE
      );
      expectInside(menu);
    });

    it('moves up when a submenu opening in place makes it taller', async () => {
      narrowWindow(true);
      layOut({ width: 232, rows: 260, opened: 230 });
      const menu = await openMenu(cardIn(`:${firstPlayer}:hand`));
      expect(menu.dataset['menuCompact']).toBe('true');
      expectInside(menu);
      const move = menu.querySelector<HTMLButtonElement>(
        '[data-context-action="moveCard"]'
      )!;
      await act(async () => move.click());
      expect(move.getAttribute('aria-expanded')).toBe('true');
      expect(menu.offsetHeight).toBe(490);
      expectInside(menu);
    });
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
    expect(callbacks.dismiss).not.toHaveBeenCalled();
  });

  it('reads keyboard hints from the shortcut catalogue without changing item text', async () => {
    const opponent = view.playerOrder[1]!;
    const renderMenu = async (card: CardSceneNode) => {
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
            actions: actions(),
          })
        );
      });
    };
    const hint = (selector: string) =>
      host.querySelector<HTMLElement>(selector)?.dataset.menuHint;

    await renderMenu(cardIn(`:${firstPlayer}:hand`));
    expect(hint('[data-context-action="discardHand"]')).toBe('Alt+D');
    expect(hint('[data-context-action="shuffleHandToDeck"]')).toBe('Alt+S');
    expect(hint('[data-context-action="shuffleHandToDeckBottom"]')).toBe(
      'Alt+↓'
    );
    // No catalogue key toggles a reveal both ways, so the row has no hint.
    expect(hint('[data-context-action="revealCard"]')).toBeUndefined();
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-move-choice]')].map(
        (choice) => [choice.textContent, choice.dataset.menuHint]
      )
    ).toEqual([
      ['to Board', 'Space'],
      ['to Deck (top)', '↑'],
      ['to Deck (bottom)', '↓'],
      ['to Deck (switch)', '→'],
      ['to Deck (shuffle)', 'S'],
    ]);
    expect(
      host.querySelector('[data-context-action="discardHand"]')?.textContent
    ).toBe('Discard hand');
    expect(
      host
        .querySelector('[data-context-action="discardHand"]')
        ?.classList.contains('is-danger')
    ).toBe(true);

    // Deck keys act on the acting seat's own deck, so the opponent's deck
    // menu offers the same rows without them.
    await renderMenu(cardIn(`:${firstPlayer}:deck`));
    expect(hint('[data-context-action="drawCards"]')).toBe('1–9');
    expect(hint('[data-context-action="viewDeckTop"]')).toBe('Alt+1–9');
    expect(hint('[data-context-action="viewDeckBottom"]')).toBe('Ctrl+1–9');
    await renderMenu(cardIn(`:${opponent}:deck`));
    expect(
      host.querySelector('[data-context-action="viewDeckTop"]')
    ).not.toBeNull();
    expect(hint('[data-context-action="viewDeckTop"]')).toBeUndefined();

    const activeStack = view.stacks[view.boards[firstPlayer]!.activeStackId!]!;
    const active = scene.cards.find(
      (candidate) => candidate.id === activeStack.evolutionCards.at(-1)!.id
    )!;
    await renderMenu(active);
    expect(hint('[data-context-action="toggleAbility"]')).toBe('W');
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-category-choice]')].map(
        (choice) => choice.dataset.menuHint
      )
    ).toEqual(['Alt+E', 'Alt+T', 'Alt+P']);
  });

  it('plays a closed menu out as an inert ghost that no selector can find', async () => {
    const card = cardIn(`:${firstPlayer}:hand`);
    const renderMenu = async (
      contextMenuCardId: CardSceneNode['id'] | null
    ) => {
      await act(async () => {
        root.render(
          createElement(
            StrictMode,
            null,
            createElement(LegacyBoardOverlays, {
              state: state({
                overlays: { contextMenuCardId, preview: null, input: null },
              }),
              darkMode: false,
              actions: actions(),
            })
          )
        );
        await Promise.resolve();
      });
    };

    await renderMenu(card.id);
    // StrictMode's effect replay leaves the open menu alone.
    expect(host.querySelectorAll('.ptcgsim-overlay-ghost')).toHaveLength(0);

    await renderMenu(null);
    expect(host.querySelector('[data-legacy-card-context-menu]')).toBeNull();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector('[role="menuitem"]')).toBeNull();
    const ghosts = host.querySelectorAll<HTMLElement>('.ptcgsim-overlay-ghost');
    expect(ghosts).toHaveLength(1);
    const ghost = ghosts[0]!;
    expect(ghost.classList).toContain('is-exit-menu');
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.hasAttribute('inert')).toBe(true);
    const attributes = [ghost, ...ghost.querySelectorAll('*')].flatMap(
      (element) => element.getAttributeNames()
    );
    expect(
      attributes.filter(
        (name) =>
          (name.startsWith('data-') && name !== 'data-menu-hint') ||
          name === 'role' ||
          name === 'tabindex' ||
          name === 'id'
      )
    ).toEqual([]);
    expect(ghost.textContent).toContain('Discard hand');

    await act(async () => {
      ghost.dispatchEvent(new Event('animationend'));
    });
    expect(host.querySelectorAll('.ptcgsim-overlay-ghost')).toHaveLength(0);
  });

  it('leaves no ghost for an overlay that was hidden when it closed', async () => {
    const card = cardIn(`:${firstPlayer}:hand`);
    const renderMenu = async (
      contextMenuCardId: CardSceneNode['id'] | null
    ) => {
      await act(async () => {
        root.render(
          createElement(LegacyBoardOverlays, {
            state: state({
              overlays: { contextMenuCardId, preview: null, input: null },
            }),
            darkMode: false,
            actions: actions(),
          })
        );
        await Promise.resolve();
      });
    };
    await renderMenu(card.id);
    // A drag hides a panel by its state attributes, which a ghost loses:
    // a copy would flash back into view.
    host.querySelector<HTMLElement>(
      '[data-legacy-card-context-menu]'
    )!.style.opacity = '0';
    await renderMenu(null);
    expect(host.querySelectorAll('.ptcgsim-overlay-ghost')).toHaveLength(0);
  });

  it('fades a closed zone browser out with its scrim beneath its panel', async () => {
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const render = async (openedZoneId: string | null) => {
      await act(async () => {
        root.render(
          createElement(LegacyBoardOverlays, {
            state: state({
              presentation: {
                selectedCardId: null,
                hoveredCardId: null,
                drag: null,
                openedZoneId,
              },
              overlays: { contextMenuCardId: null, preview: null, input: null },
            }),
            darkMode: false,
            actions: actions(),
          })
        );
        await Promise.resolve();
      });
    };
    await render(discard.id);
    expect(host.querySelector('[data-legacy-zone-browser]')).not.toBeNull();
    await render(null);
    const ghosts = [
      ...host.querySelectorAll<HTMLElement>('.ptcgsim-overlay-ghost'),
    ];
    expect(
      ghosts.map((ghost) => ghost.classList.contains('is-exit-scrim'))
    ).toEqual([true, false]);
    expect(ghosts[1]!.classList).toContain('is-exit-panel');
  });

  it('asks each controller count descriptor in one StrictMode-safe prompt dialog', async () => {
    await mountOverlayHost();
    const callbacks = actions();
    const card = cardIn(`:${firstPlayer}:deck`);
    const alert = vi.fn();
    const prompt = vi.fn();
    vi.stubGlobal('alert', alert);
    vi.stubGlobal('prompt', prompt);
    const renderInput = async (
      input: BoardSessionControllerState['overlays']['input']
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
      await settleDialogs();
    };

    await renderInput({
      kind: 'count',
      action: 'drawCards',
      cardId: card.id,
      zoneId: card.parentId,
      message: 'Draw how many cards?',
      initialValue: '1',
      minimum: 1,
      invalidMessage: 'Enter a number',
    });
    // StrictMode replays the effect; the player still sees one question.
    expect(openDialogs()).toHaveLength(1);
    expect(openDialogs()[0]?.textContent).toContain('Draw how many cards?');
    expect(dialogField().value).toBe('1');
    expect(dialogField().inputMode).toBe('numeric');
    expect(dialogButton('submit').textContent).toBe('Draw');
    await typeAndSubmit(' 3 ');
    expect(callbacks.submitCountInput).toHaveBeenCalledExactlyOnceWith(
      'drawCards',
      card.id,
      ' 3 '
    );
    expect(openDialogs()).toHaveLength(0);

    await renderInput({
      kind: 'count',
      action: 'viewDeckTop',
      cardId: card.id,
      zoneId: card.parentId,
      message: 'Look at how many cards?',
      initialValue: '1',
      minimum: 1,
      invalidMessage: 'Enter a number',
    });
    expect(dialogButton('submit').textContent).toBe('View');
    // An invalid count keeps the question open with the source's message.
    await typeAndSubmit('2.5');
    expect(openDialogs()).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Enter a number'
    );
    expect(callbacks.submitCountInput).toHaveBeenCalledTimes(1);
    expect(callbacks.dismiss).not.toHaveBeenCalled();
    await act(async () => dialogButton('cancel').click());
    await settleDialogs();
    expect(callbacks.dismiss).toHaveBeenCalledExactlyOnceWith('input');
    expect(callbacks.submitCountInput).toHaveBeenCalledTimes(1);
    expect(openDialogs()).toHaveLength(0);

    // Cancelling Alt+D's question simply withdraws it -- no error.
    await renderInput({
      kind: 'shortcutCount',
      action: 'discardOwnHandAndDraw',
      playerId: firstPlayer,
      zoneId: `zone:${firstPlayer}:hand`,
      message: 'Draw how many cards?',
      initialValue: '0',
      minimum: 0,
      invalidMessage: 'Enter a number',
    });
    expect(dialogField().value).toBe('0');
    await act(async () => dialogButton('cancel').click());
    await settleDialogs();
    expect(callbacks.dismiss).toHaveBeenCalledTimes(2);
    expect(callbacks.dismiss).toHaveBeenLastCalledWith('input');
    expect(callbacks.submitShortcutCountInput).not.toHaveBeenCalled();
    expect(document.querySelector('[data-ptcgsim-overlay="toast"]')).toBeNull();

    await renderInput({
      kind: 'shortcutCount',
      action: 'shuffleOwnHandAndDraw',
      playerId: firstPlayer,
      zoneId: `zone:${firstPlayer}:hand`,
      message: 'Draw how many cards?',
      initialValue: '0',
      minimum: 0,
      invalidMessage: 'Enter a number',
    });
    await typeAndSubmit('2');
    expect(callbacks.submitShortcutCountInput).toHaveBeenCalledExactlyOnceWith(
      'shuffleOwnHandAndDraw',
      '2'
    );
    expect(alert).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('withdraws the count question when the controller drops it', async () => {
    await mountOverlayHost();
    const callbacks = actions();
    const card = cardIn(`:${firstPlayer}:deck`);
    const render = async (
      input: BoardSessionControllerState['overlays']['input']
    ) => {
      await act(async () => {
        root.render(
          createElement(LegacyBoardOverlays, {
            state: state({
              overlays: { contextMenuCardId: null, preview: null, input },
            }),
            darkMode: false,
            actions: callbacks,
          })
        );
      });
      await settleDialogs();
    };
    await render({
      kind: 'count',
      action: 'drawCards',
      cardId: card.id,
      zoneId: card.parentId,
      message: 'Draw how many cards?',
      initialValue: '1',
      minimum: 1,
      invalidMessage: 'Enter a number',
    });
    expect(openDialogs()).toHaveLength(1);

    // The deck it counted is gone: the controller reconciles the input away.
    await render(null);
    expect(openDialogs()).toHaveLength(0);
    expect(callbacks.dismiss).not.toHaveBeenCalled();
    expect(callbacks.submitCountInput).not.toHaveBeenCalled();
  });

  it('reads the selected assembled-card piece and returns to the composition', async () => {
    const stackId = view.boards[firstPlayer]!.activeStackId!;
    const stages = view.stacks[stackId]!.evolutionCards;
    const selectedId = stages[0]!.id;
    const composedScene = {
      ...scene,
      cards: scene.cards.map((card): CardSceneNode => {
        const part = stages.findIndex((stage) => stage.id === card.id);
        return part < 0
          ? card
          : {
              ...card,
              finish: part === 0 ? 'holo' : 'rainbow',
              presentation: {
                readingQuarterTurns: 1,
                join: { key: 'test-legend', columns: 1, rows: 2, part },
              },
            };
      }),
    };
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            scene: composedScene,
            overlays: {
              contextMenuCardId: null,
              preview: { kind: 'stack', stackId, focusCardId: selectedId },
              input: null,
            },
          }),
          darkMode: false,
          actions: actions(),
        })
      );
    });
    expect(
      host.querySelector('[data-preview-kind="composition"]')
    ).not.toBeNull();
    const control = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.includes(label)
      )!;
    await act(async () => control('View each card').click());
    // A window of its own, named for the card, the pieces in reading order
    // and then what is attached to them.
    const pieces = host.querySelector('.ptcgsim-legacy-stack-preview')!;
    expect(pieces.classList.contains('is-piece-list')).toBe(true);
    expect(pieces.querySelector('.ptcgsim-overlay-title')?.textContent).toBe(
      composedScene.cards.find((card) => card.id === selectedId)!.label
    );
    const attachments = view.stacks[stackId]!.attachmentCards;
    expect(
      [...pieces.querySelectorAll('.ptcgsim-stack-cards-group')].map((group) =>
        [...group.querySelectorAll('[data-stack-preview-card-id]')].map(
          (card) => card.getAttribute('data-stack-preview-card-id')
        )
      )
    ).toEqual([
      stages.map((stage) => String(stage.id)),
      ...(attachments.length > 0
        ? [[...attachments].reverse().map((card) => String(card.id))]
        : []),
    ]);
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          `[data-stack-preview-card-id="${selectedId}"]`
        )!
        .click();
    });
    const selected = composedScene.cards.find(
      (card) => card.id === selectedId
    )!;
    const preview = host.querySelector('[data-preview-kind="card"]')!;
    expect(preview.getAttribute('aria-label')).toBe(selected.label);
    expect(preview.getAttribute('data-landscape')).toBe('true');
    expect(
      preview.querySelector('img')?.getAttribute('data-overlay-card-id')
    ).toBe(selectedId);
    expect(preview.querySelector('img')?.getAttribute('src')).toBe(
      selected.imageUrl
    );
    expect(
      preview.querySelector('.card-material')?.getAttribute('data-finish')
    ).toBe('holo');
    await act(async () => control('View whole card').click());
    expect(
      host.querySelectorAll(
        '[data-preview-kind="composition"] .ptcgsim-composition-piece'
      )
    ).toHaveLength(stages.length);
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

  it('opens a pile large enough to read, with its count, copy badges and a Board hold', async () => {
    const callbacks = actions();
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const discardCards = scene.cards.filter(
      (candidate) => candidate.parentId === discard.id
    );
    const [first, second, third] = discardCards;
    if (!first || !second || !third)
      throw new Error('Fixture discard is small');
    // Two copies of one card, and one other.
    const twinned = scene.cards.map((card) =>
      card.id === second.id
        ? { ...card, label: first.label, imageUrl: first.imageUrl }
        : card
    );
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            scene: { ...scene, cards: twinned },
            presentation: {
              selectedCardId: null,
              hoveredCardId: null,
              targetableCardIds: [],
              drag: null,
              openedZoneId: discard.id,
            },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });

    const browser = host.querySelector<HTMLElement>(
      '[data-legacy-zone-browser]'
    )!;
    // Sized from the board area, not from v1's player frame: a short pile
    // draws its cards at a third of the board's height (at most 300px). It
    // is sized for its tiles: the two copies share one.
    const layout = zoneBrowserLayout(scene.viewport, discardCards.length - 1);
    expect(layout.cardHeight).toBeCloseTo(Math.min(720 * 0.34, 300));
    expect(Number.parseFloat(browser.style.left)).toBeCloseTo(layout.left);
    expect(Number.parseFloat(browser.style.top)).toBeCloseTo(layout.top);
    expect(Number.parseFloat(browser.style.width)).toBeCloseTo(layout.width);
    expect(Number.parseFloat(browser.style.height)).toBeCloseTo(layout.height);
    expect(browser.style.getPropertyValue('--ptcgsim-zone-card-height')).toBe(
      `${layout.cardHeight.toFixed(2)}px`
    );
    expect(browser.querySelector('.ptcgsim-overlay-title')?.textContent).toBe(
      'Discard pile'
    );
    expect(browser.querySelector('.ptcgsim-overlay-count')?.textContent).toBe(
      `${discard.count} cards`
    );

    const badge = (id: CardSceneNode['id']) =>
      host.querySelector(
        `[data-overlay-card-id="${id}"] .ptcgsim-zone-copy-badge`
      )?.textContent ?? null;
    // A pile stacks its copies by default: the first copy's tile counts
    // them, the second has none of its own, and a single card has no ×1.
    expect([badge(first.id), badge(second.id), badge(third.id)]).toEqual([
      '×2',
      null,
      null,
    ]);
    expect(host.querySelector(`[data-overlay-card-id="${second.id}"]`)).toBe(
      null
    );
    // Face-down cards are never counted.
    expect(
      zoneCopyCounts([
        { ...first, concealed: true },
        { ...second, label: first.label, concealed: true },
      ]).size
    ).toBe(0);

    const scrim = host.querySelector<HTMLElement>('.ptcgsim-overlay-scrim')!;
    expect(scrim.getAttribute('aria-hidden')).toBe('true');
    const showBoard = browser.querySelector<HTMLButtonElement>(
      '.ptcgsim-show-board-button'
    )!;
    expect(showBoard.textContent).toBe('Board');
    // One click puts the panel aside; no holding.
    await act(async () => showBoard.click());
    expect(browser.classList).toContain('is-showing-board');
    expect(scrim.classList).toContain('is-hidden');
    expect(showBoard.getAttribute('aria-pressed')).toBe('true');
    // The same button, where it was, is the way back.
    expect(showBoard.textContent).toBe('Back to Discard pile');
    await act(async () => showBoard.focus());
    for (const shiftKey of [false, true]) {
      const tab = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => showBoard.dispatchEvent(tab));
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(showBoard);
    }
    await act(async () => showBoard.click());
    expect(browser.classList).not.toContain('is-showing-board');
    expect(scrim.classList).not.toContain('is-hidden');
    expect(showBoard.textContent).toBe('Board');

    // From the board, Esc steps back to the panel; a second Esc closes it.
    await act(async () => showBoard.click());
    const escape = () =>
      act(async () => {
        browser.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          })
        );
      });
    await escape();
    expect(browser.classList).not.toContain('is-showing-board');
    expect(callbacks.dismiss).not.toHaveBeenCalled();
    await escape();
    expect(callbacks.dismiss).toHaveBeenCalledExactlyOnceWith('zone');
  });

  it('traps card-preview focus and exposes only the topmost nested dialog as modal', async () => {
    const callbacks = actions();
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const card = scene.cards.find(
      (candidate) => candidate.parentId === discard.id
    )!;
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            presentation: {
              selectedCardId: null,
              hoveredCardId: null,
              targetableCardIds: [],
              drag: null,
              openedZoneId: discard.id,
            },
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

    const browser = host.querySelector<HTMLElement>(
      '[data-legacy-zone-browser]'
    )!;
    const preview = host.querySelector<HTMLElement>(
      '[data-preview-kind="card"]'
    )!;
    expect(preview.getAttribute('aria-modal')).toBe('true');
    expect(browser.getAttribute('aria-modal')).toBeNull();
    expect(browser.getAttribute('aria-hidden')).toBe('true');
    expect(browser.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(preview);

    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    // One control (Close): Tab stays inside the preview, on it.
    const controls = [
      ...preview.querySelectorAll<HTMLButtonElement>('[data-preview-tabbable]'),
    ];
    expect(controls).toHaveLength(1);
    controls[0]!.focus();
    expect(controls[0]!.dispatchEvent(tab)).toBe(false);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(controls[0]);
    expect(callbacks.dismiss).not.toHaveBeenCalled();
  });

  it('keeps stable overlay-card geometry through arbitrary image failure and recovery', async () => {
    const callbacks = actions();
    const card = cardIn(`:${firstPlayer}:hand`);
    const projected = view.zones[card.parentId]!.cards.find(
      (entry) => entry.id === card.id
    )!;
    if (projected.kind !== 'known') throw new Error('known card required');
    const renderPreview = async (imageUrl: string) => {
      await act(async () => {
        root.render(
          createElement(LegacyBoardOverlays, {
            state: state({
              view: {
                ...view,
                definitions: {
                  ...view.definitions,
                  [projected.definitionId]: {
                    ...view.definitions[projected.definitionId]!,
                    imageUrl,
                  },
                },
              },
              scene: {
                ...scene,
                cards: scene.cards.map((candidate) =>
                  candidate.id === card.id
                    ? { ...candidate, imageUrl }
                    : candidate
                ),
              },
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
    };

    await renderPreview('https://images.example.invalid/broken.png');
    const wrapper = host.querySelector<HTMLElement>(
      '[data-overlay-image-card-id]'
    )!;
    const image = wrapper.querySelector<HTMLImageElement>('img')!;
    expect(wrapper.classList).toContain('is-preview');
    expect(wrapper.getAttribute('data-overlay-image-state')).toBe('loading');

    await act(async () => image.dispatchEvent(new Event('error')));
    expect(wrapper.getAttribute('data-overlay-image-state')).toBe('failed');
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(getComputedStyle(wrapper).aspectRatio).toBe('63 / 88');
    expect(getComputedStyle(image).opacity).toBe('0');

    await renderPreview('https://images.example.invalid/recovered.png');
    const stableWrapper = host.querySelector<HTMLElement>(
      '[data-overlay-image-card-id]'
    )!;
    const stableImage = stableWrapper.querySelector<HTMLImageElement>('img')!;
    expect(stableWrapper).toBe(wrapper);
    expect(stableImage).toBe(image);
    expect(stableWrapper.getAttribute('data-overlay-image-state')).toBe(
      'loading'
    );
    await act(async () => stableImage.dispatchEvent(new Event('load')));
    expect(stableWrapper.getAttribute('data-overlay-image-state')).toBe(
      'ready'
    );
    expect(getComputedStyle(stableImage).opacity).toBe('1');
  });

  it('sorts only disclosed decklist ranks locally and restores authoritative scene order', async () => {
    const callbacks = actions();
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const canonicalCards = scene.cards.filter(
      (candidate) => candidate.parentId === discard.id
    );
    // v1 paints the declared decklist order, so the last-declared card sorts
    // last and the two copies of one name keep their authoritative order.
    const ranks = [9, 2, 2];
    const relabeledCards = scene.cards.map((card) => {
      const index = canonicalCards.findIndex(
        (candidate) => candidate.id === card.id
      );
      return index === -1 ? card : { ...card, decklistRank: ranks[index]! };
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

    // A card the viewer cannot read carries no rank and never moves.
    const concealedCards = [
      {
        ...canonicalCards[1]!,
        label: 'Face-down card',
        decklistRank: undefined,
      },
      {
        ...canonicalCards[0]!,
        label: 'Face-down card',
        decklistRank: undefined,
      },
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

  it('keeps recipient-safe discard ability markers attached through local sorting', async () => {
    const callbacks = actions();
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const discardCards = scene.cards.filter(
      (candidate) => candidate.parentId === discard.id
    );
    const markedCard = discardCards[0]!;
    const viewDiscard = view.zones[discard.id]!;
    const markedView = {
      ...view,
      zones: {
        ...view.zones,
        [discard.id]: {
          ...viewDiscard,
          cards: viewDiscard.cards.map((card) =>
            card.id === markedCard.id && card.kind === 'known'
              ? { ...card, abilityUsed: true }
              : card
          ),
        },
      },
    };
    const opened = (nextView: typeof view) =>
      state({
        view: nextView,
        presentation: {
          selectedCardId: null,
          hoveredCardId: null,
          targetableCardIds: [],
          drag: null,
          openedZoneId: discard.id,
        },
      });

    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: opened(markedView),
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    const markerSelector = `[data-opened-zone-ability-marker][data-marker-card-id="${markedCard.id}"]`;
    const marker = host.querySelector<HTMLElement>(markerSelector)!;
    expect(marker).not.toBeNull();
    expect(marker.getAttribute('aria-hidden')).toBe('true');
    expect(
      marker
        .closest('[data-overlay-card-id]')
        ?.getAttribute('data-overlay-card-id')
    ).toBe(markedCard.id);
    expect(
      host.querySelectorAll('[data-opened-zone-ability-marker]')
    ).toHaveLength(1);

    await act(async () =>
      host
        .querySelector<HTMLInputElement>('[data-zone-action="sortZone"]')!
        .click()
    );
    expect(
      host
        .querySelector<HTMLElement>(markerSelector)
        ?.closest('[data-overlay-card-id]')
        ?.getAttribute('data-overlay-card-id')
    ).toBe(markedCard.id);
    expect(callbacks.invokeZoneAction).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: opened(view),
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    expect(
      host.querySelectorAll('[data-opened-zone-ability-marker]')
    ).toHaveLength(0);

    const deck = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:deck`
    )!;
    const viewDeck = view.zones[deck.id]!;
    const invalidDeckView = {
      ...view,
      zones: {
        ...view.zones,
        [deck.id]: {
          ...viewDeck,
          cards: viewDeck.cards.map((card, index) =>
            index === 0 && card.kind === 'known'
              ? { ...card, abilityUsed: true }
              : card
          ),
        },
      },
    };
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            view: invalidDeckView,
            presentation: {
              selectedCardId: null,
              hoveredCardId: null,
              targetableCardIds: [],
              drag: null,
              openedZoneId: deck.id,
            },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    expect(
      host.querySelectorAll('[data-opened-zone-ability-marker]')
    ).toHaveLength(0);
  });

  describe('public pile ordering', () => {
    const renderPile = async (
      kind: 'discard' | 'lostZone' | 'hand' | 'deck',
      selectedIndex: number | null,
      patch: Partial<BoardSessionControllerState> = {}
    ) => {
      const zone = scene.zones.find(
        (candidate) => candidate.id === `zone:${firstPlayer}:${kind}`
      )!;
      const cards = scene.cards.filter((card) => card.parentId === zone.id);
      const callbacks = actions();
      await act(async () => {
        root.render(
          createElement(LegacyBoardOverlays, {
            state: state({
              presentation: {
                selectedCardId:
                  selectedIndex === null ? null : cards[selectedIndex]!.id,
                hoveredCardId: null,
                targetableCardIds: [],
                drag: null,
                openedZoneId: zone.id,
              },
              ...patch,
            }),
            darkMode: false,
            actions: callbacks,
          })
        );
      });
      return { zone, cards, callbacks };
    };

    it.each(['discard', 'lostZone'] as const)(
      'puts one selected %s card at the live top of the same pile',
      async (kind) => {
        const { zone, cards, callbacks } = await renderPile(kind, 0);
        const top = host.querySelector<HTMLButtonElement>(
          '[data-card-action="pile-top"]'
        );
        const bottom = host.querySelector<HTMLButtonElement>(
          '[data-card-action="pile-bottom"]'
        );
        expect(top?.getAttribute('aria-label')).toBe('Put on top');
        expect(top?.disabled).toBe(false);
        expect(bottom?.disabled).toBe(true);
        await act(async () => top!.click());
        expect(
          callbacks.emitOpenedZoneCardIntent
        ).toHaveBeenCalledExactlyOnceWith({
          kind: 'CardDropRequested',
          cardId: cards[0]!.id,
          targetId: zone.id,
          pilePosition: 'top',
          x: zone.bounds.x + zone.bounds.width / 2,
          y: zone.bounds.y + zone.bounds.height / 2,
        });
      }
    );

    it('uses the canonical endpoints while sorted and returns to pile order on a move', async () => {
      const { zone, cards, callbacks } = await renderPile('discard', 2);
      const sort = host.querySelector<HTMLInputElement>(
        '[data-zone-action="sortZone"]'
      )!;
      await act(async () => sort.click());
      expect(sort.checked).toBe(true);
      expect(
        host.querySelector<HTMLButtonElement>('[data-card-action="pile-top"]')
          ?.disabled
      ).toBe(true);
      const bottom = host.querySelector<HTMLButtonElement>(
        '[data-card-action="pile-bottom"]'
      );
      expect(bottom?.getAttribute('aria-label')).toBe('Put on bottom');
      expect(bottom?.disabled).toBe(false);
      await act(async () => bottom!.click());
      expect(sort.checked).toBe(false);
      expect(
        callbacks.emitOpenedZoneCardIntent
      ).toHaveBeenCalledExactlyOnceWith({
        kind: 'CardDropRequested',
        cardId: cards[2]!.id,
        targetId: zone.id,
        pilePosition: 'bottom',
        x: zone.bounds.x + zone.bounds.width / 2,
        y: zone.bounds.y + zone.bounds.height / 2,
      });
    });

    it('keeps the controls mounted but disabled without a selection or permission', async () => {
      for (const [selected, canSubmitCommands] of [
        [null, true],
        [0, false],
      ] as const) {
        const { callbacks } = await renderPile('discard', selected, {
          canSubmitCommands,
        });
        const buttons = host.querySelectorAll<HTMLButtonElement>(
          '[data-card-action^="pile-"]'
        );
        expect(buttons).toHaveLength(2);
        for (const button of buttons) {
          expect(button.disabled).toBe(true);
          await act(async () => button.click());
        }
        expect(callbacks.emitOpenedZoneCardIntent).not.toHaveBeenCalled();
      }
    });

    it('moves only the selected representative copy and preserves the stacking preference', async () => {
      const discard = scene.zones.find(
        (zone) => zone.id === `zone:${firstPlayer}:discard`
      )!;
      const cards = scene.cards.filter((card) => card.parentId === discard.id);
      const first = cards[0]!;
      const second = cards[1]!;
      const previous = preferences().get(ZONE_BROWSER_PREFERENCES);
      preferences().set(ZONE_BROWSER_PREFERENCES, {
        ...previous,
        stackPiles: true,
      });
      try {
        const { callbacks } = await renderPile('discard', 0, {
          scene: {
            ...scene,
            cards: scene.cards.map((card) =>
              card.id === second.id
                ? { ...card, label: first.label, imageUrl: first.imageUrl }
                : card
            ),
          },
        });
        expect(host.querySelectorAll('[data-overlay-card-id]')).toHaveLength(2);
        expect(
          host.querySelector('.ptcgsim-zone-copy-badge')?.textContent
        ).toBe('×2');
        await act(async () =>
          host
            .querySelector<HTMLButtonElement>('[data-card-action="pile-top"]')!
            .click()
        );
        expect(
          callbacks.emitOpenedZoneCardIntent
        ).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ cardId: first.id, pilePosition: 'top' })
        );
        expect(preferences().get(ZONE_BROWSER_PREFERENCES).stackPiles).toBe(
          true
        );
      } finally {
        await act(async () => {
          preferences().set(ZONE_BROWSER_PREFERENCES, previous);
        });
      }
    });

    it.each(['hand', 'deck'] as const)(
      'does not offer public-pile ordering for a %s',
      async (kind) => {
        await renderPile(kind, 0);
        expect(
          host.querySelectorAll('[data-card-action^="pile-"]')
        ).toHaveLength(0);
      }
    );
  });

  it('routes writable opened-zone drags through the shared scene hit test', async () => {
    const callbacks = actions();
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const discardCards = scene.cards.filter(
      (candidate) => candidate.parentId === discard.id
    );
    const hand = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:hand`
    )!;
    const overlayState = state({
      presentation: {
        selectedCardId: discardCards[0]!.id,
        hoveredCardId: null,
        targetableCardIds: [],
        drag: null,
        openedZoneId: discard.id,
      },
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
    const source = host.querySelector<HTMLButtonElement>(
      `[data-overlay-card-id="${discardCards[0]!.id}"]`
    )!;
    expect(source.getAttribute('draggable')).toBe('false');
    // Moved out of the viewer, the card flies from here.
    expect(source.dataset.motionOrigin).toBe(String(discardCards[0]!.id));
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue({
      x: 20,
      y: 20,
      left: 20,
      top: 20,
      right: 146,
      bottom: 196,
      width: 126,
      height: 176,
      toJSON: () => ({}),
    });
    const event = (type: string, clientX = 40, clientY = 40): Event => {
      const dispatched = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(dispatched, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: 7 },
        button: { value: 0 },
      });
      return dispatched;
    };
    await act(async () => source.dispatchEvent(event('pointerdown')));
    expect(callbacks.emitOpenedZoneCardIntent).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(event('pointermove', 80, 80)));
    // The card is held over the table by the table's own drag: no copy of it
    // is drawn here.
    expect(callbacks.updateDrag).toHaveBeenLastCalledWith(
      expect.objectContaining({ cardId: discardCards[0]!.id })
    );
    expect(document.querySelectorAll('.ptcgsim-panel-drag-face')).toHaveLength(
      0
    );
    expect(
      host
        .querySelector('[data-legacy-zone-browser]')
        ?.getAttribute('data-zone-dragging-card')
    ).toBe(String(discardCards[0]!.id));

    const targetX = hand.bounds.x + hand.bounds.width / 2;
    const targetY = hand.bounds.y + hand.bounds.height / 2;
    await act(async () =>
      document.dispatchEvent(event('pointerup', targetX, targetY))
    );
    // It comes down where the held card's centre is: gripped 20px into a
    // 126 x 176 face, the centre trails the pointer by the rest of the half.
    const held = discardCards[0]!.bounds;
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardDropRequested',
      cardId: discardCards[0]!.id,
      targetId: hand.id,
      x: expect.closeTo(targetX + (0.5 - 20 / 126) * held.width, 6),
      y: expect.closeTo(targetY + (0.5 - 20 / 176) * held.height, 6),
    });
    expect(callbacks.updateDrag).toHaveBeenLastCalledWith(null);
    // Let go, it is seen to land before the viewer comes back: here nothing
    // holds it and the table is still, so that is the next paint or so.
    const browser = () => host.querySelector('[data-legacy-zone-browser]');
    expect(browser()?.getAttribute('data-zone-dragging-card')).toBe(
      String(discardCards[0]!.id)
    );
    await act(nextFrames);
    expect(browser()?.hasAttribute('data-zone-dragging-card')).toBe(false);

    expect(document.querySelectorAll('.ptcgsim-panel-drag-face')).toHaveLength(
      0
    );
    await act(async () => source.dispatchEvent(event('pointerdown')));
    await act(async () => document.dispatchEvent(event('pointermove', 80, 80)));
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    );
    await act(async () =>
      document.dispatchEvent(event('pointerup', targetX, targetY))
    );
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenCalledTimes(1);
    expect(callbacks.dismiss).not.toHaveBeenCalled();
    expect(callbacks.updateDrag).toHaveBeenLastCalledWith(null);
    expect(
      resolveOpenedZoneDropTarget(
        scene,
        { left: 100, top: 50, width: 640, height: 360 },
        discardCards[0]!.id,
        100 + (targetX * 640) / scene.viewport.width,
        50 + (targetY * 360) / scene.viewport.height
      )
    ).toBe(hand.id);
    expect(
      resolveOpenedZoneDropTarget(
        scene,
        { left: 0, top: 0, width: 0, height: 0 },
        discardCards[0]!.id,
        targetX,
        targetY
      )
    ).toBeNull();

    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: { ...overlayState, canSubmitCommands: false },
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    const readOnly = host.querySelector<HTMLButtonElement>(
      `[data-overlay-card-id="${discardCards[0]!.id}"]`
    )!;
    expect(readOnly.getAttribute('draggable')).toBe('false');
    await act(async () => readOnly.dispatchEvent(event('pointerdown')));
    await act(async () =>
      document.dispatchEvent(event('pointerup', targetX, targetY))
    );
    expect(callbacks.dismiss).not.toHaveBeenCalled();
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenCalledTimes(1);
  });

  /** The overlay root spans the board, one board pixel to one client pixel. */
  const boardSizedOverlay = (): void => {
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
  };
  const pointer = (
    type: string,
    clientX: number,
    clientY: number,
    pointerType = 'mouse'
  ): Event => {
    const dispatched = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(dispatched, {
      clientX: { value: clientX },
      clientY: { value: clientY },
      pointerId: { value: 9 },
      button: { value: 0 },
      pointerType: { value: pointerType },
    });
    return dispatched;
  };

  it("never lets a window's card start a native drag of its picture, which would take the gesture from the table", async () => {
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const pileCard = scene.cards.find(
      (candidate) => candidate.parentId === discard.id
    )!;
    const stackId = view.boards[firstPlayer]!.activeStackId!;
    const render = (patch: Partial<BoardSessionControllerState>) =>
      act(async () => {
        root.render(
          createElement(LegacyBoardOverlays, {
            state: state(patch),
            darkMode: false,
            actions: actions(),
          })
        );
      });
    const dragStartIsCancelled = (selector: string) => {
      const picture = host.querySelector(`${selector} img`)!;
      const event = new Event('dragstart', { bubbles: true, cancelable: true });
      picture.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // A pile's viewer.
    await render({
      presentation: {
        ...createInitialBoardSessionControllerState().presentation,
        openedZoneId: discard.id,
      },
    });
    expect(
      dragStartIsCancelled(`[data-overlay-card-id="${pileCard.id}"]`)
    ).toBe(true);
    // The stack view, and a card's own preview.
    await render({
      overlays: {
        contextMenuCardId: null,
        preview: { kind: 'stack', stackId },
        input: null,
      },
    });
    expect(dragStartIsCancelled('[data-stack-preview-card-id]')).toBe(true);
    await render({
      overlays: {
        contextMenuCardId: null,
        preview: { kind: 'card', cardId: pileCard.id },
        input: null,
      },
    });
    expect(dragStartIsCancelled('.ptcgsim-card-preview-stage')).toBe(true);
  });

  it('keeps a viewer aside until the card dropped out of it has landed, and never longer than a few seconds', async () => {
    const callbacks = actions();
    const motion = new TableMotionStore();
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const card = scene.cards.find(
      (candidate) => candidate.parentId === discard.id
    )!;
    const hand = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:hand`
    )!;
    const presentation = (settling: BoardPresentation['settling']) => ({
      ...createInitialBoardSessionControllerState().presentation,
      openedZoneId: discard.id,
      settling,
    });
    const render = (settling: BoardPresentation['settling']) =>
      act(async () => {
        root.render(
          createElement(LegacyBoardOverlays, {
            state: state({ presentation: presentation(settling) }),
            darkMode: false,
            actions: callbacks,
            tableMotion: motion,
          })
        );
      });
    await render([]);
    const overlay = host.querySelector<HTMLElement>(
      '[data-legacy-board-overlays]'
    )!;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({
        width: scene.viewport.width,
        height: scene.viewport.height,
      })
    );
    const source = host.querySelector<HTMLElement>(
      `[data-overlay-card-id="${card.id}"]`
    )!;
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 20, y: 20, width: 126, height: 176 })
    );
    const event = (type: string, clientX = 40, clientY = 40): Event => {
      const dispatched = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(dispatched, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: 9 },
        button: { value: 0 },
      });
      return dispatched;
    };
    const drop = async () => {
      await act(async () => source.dispatchEvent(event('pointerdown')));
      await act(async () =>
        document.dispatchEvent(event('pointermove', 80, 80))
      );
      await act(async () =>
        document.dispatchEvent(
          event(
            'pointerup',
            hand.bounds.x + hand.bounds.width / 2,
            hand.bounds.y + hand.bounds.height / 2
          )
        )
      );
    };
    const aside = () =>
      host
        .querySelector('[data-legacy-zone-browser]')
        ?.getAttribute('data-zone-dragging-card') ?? null;
    const scrimHidden = () =>
      host
        .querySelector('.ptcgsim-overlay-scrim')
        ?.classList.contains('is-hidden');

    await drop();
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenCalledTimes(1);
    // The table holds it where it was dropped until the room answers...
    await render([{ cardId: card.id, x: 300, y: 600 }]);
    await act(nextFrames);
    expect(aside()).toBe(String(card.id));
    expect(scrimHidden()).toBe(true);
    // ...then it flies to where it was put; the viewer waits for it.
    motion.set(true);
    await render([]);
    await act(nextFrames);
    expect(aside()).toBe(String(card.id));
    await act(async () => motion.set(false));
    expect(aside()).toBeNull();
    expect(scrimHidden()).toBe(false);

    // A drop the room never answers still gives the viewer back.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await drop();
      await render([{ cardId: card.id, x: 300, y: 600 }]);
      expect(aside()).toBe(String(card.id));
      await act(async () => vi.advanceTimersByTime(LANDING_MAX_MS - 1));
      expect(aside()).toBe(String(card.id));
      await act(async () => vi.advanceTimersByTime(1));
      expect(aside()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('drags a card out of the stack view onto the table, and the view steps aside', async () => {
    const callbacks = { ...actions(), emitCardIntent: vi.fn() };
    const stackId = view.boards[firstPlayer]!.activeStackId!;
    const top = view.stacks[stackId]!.evolutionCards.at(-1)!;
    const hand = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:hand`
    )!;
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            overlays: {
              contextMenuCardId: null,
              preview: { kind: 'stack', stackId, focusCardId: top.id },
              input: null,
            },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    boardSizedOverlay();
    const source = host.querySelector<HTMLElement>(
      `[data-stack-preview-card-id="${top.id}"]`
    )!;
    // Moved out of the preview, the card flies from here.
    expect(source.dataset.motionOrigin).toBe(String(top.id));
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
    await act(async () =>
      source.dispatchEvent(pointer('pointerdown', 163, 188))
    );
    await act(async () =>
      document.dispatchEvent(pointer('pointermove', 300, 300))
    );
    expect(callbacks.updateDrag).toHaveBeenLastCalledWith(
      expect.objectContaining({ cardId: top.id })
    );
    expect(
      host
        .querySelector('[data-preview-kind="stack"]')
        ?.getAttribute('data-preview-dragging-card')
    ).toBe(String(top.id));
    const handX = hand.bounds.x + hand.bounds.width / 2;
    const handY = hand.bounds.y + hand.bounds.height / 2;
    await act(async () =>
      document.dispatchEvent(pointer('pointerup', handX, handY))
    );
    // A card in play goes through the table's own intent, and the view,
    // having done its job, closes.
    expect(callbacks.emitCardIntent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: 'CardDropRequested',
        cardId: top.id,
        targetId: hand.id,
      })
    );
    expect(callbacks.emitOpenedZoneCardIntent).not.toHaveBeenCalled();
    expect(callbacks.dismiss).toHaveBeenCalledWith('preview');
    expect(callbacks.updateDrag).toHaveBeenLastCalledWith(null);
  });

  it('picks a pile card up with a held finger, and lets a swipe scroll', async () => {
    const callbacks = actions();
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const card = scene.cards.find(
      (candidate) => candidate.parentId === discard.id
    )!;
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            presentation: {
              ...state().presentation,
              openedZoneId: discard.id,
            },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    boardSizedOverlay();
    const source = host.querySelector<HTMLElement>(
      `[data-overlay-card-id="${card.id}"]`
    )!;
    // No move handle: the whole card is what is picked up.
    expect(source.querySelector('[data-panel-drag-handle]')).toBeNull();
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue({
      x: 20,
      y: 20,
      left: 20,
      top: 20,
      right: 146,
      bottom: 196,
      width: 126,
      height: 176,
      toJSON: () => ({}),
    });
    // A swipe before the hold scrolls the pile; nothing is picked up.
    await act(async () =>
      source.dispatchEvent(pointer('pointerdown', 60, 60, 'touch'))
    );
    await act(async () =>
      document.dispatchEvent(pointer('pointermove', 60, 90, 'touch'))
    );
    await act(async () =>
      document.dispatchEvent(pointer('pointerup', 60, 90, 'touch'))
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, TOUCH_PICKUP_MS + 50));
    });
    expect(callbacks.updateDrag).not.toHaveBeenCalled();
    // Held still, it is picked up, and then follows the finger.
    await act(async () =>
      source.dispatchEvent(pointer('pointerdown', 60, 60, 'touch'))
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, TOUCH_PICKUP_MS + 50));
    });
    expect(source.getAttribute('data-armed')).toBe('true');
    await act(async () =>
      document.dispatchEvent(pointer('pointermove', 260, 300, 'touch'))
    );
    expect(callbacks.updateDrag).toHaveBeenLastCalledWith(
      expect.objectContaining({ cardId: card.id })
    );
    await act(async () =>
      document.dispatchEvent(pointer('pointercancel', 260, 300, 'touch'))
    );
    expect(callbacks.updateDrag).toHaveBeenLastCalledWith(null);
  });

  it('stacks copies in a pile and not in the hand by default, and remembers each choice', async () => {
    const zoneOf = (kind: string) =>
      scene.zones.find(
        (candidate) => candidate.id === `zone:${firstPlayer}:${kind}`
      )!;
    const discard = zoneOf('discard');
    const hand = zoneOf('hand');
    const pileOf = (zoneId: string) =>
      scene.cards.filter((card) => card.parentId === zoneId);
    const pile = pileOf(discard.id);
    const held = pileOf(hand.id);
    expect(pile.length).toBeGreaterThan(1);
    expect(held.length).toBeGreaterThan(1);
    // Every card in each a copy of that zone's first.
    const copies = {
      ...scene,
      cards: scene.cards.map((card) => {
        const first =
          card.parentId === discard.id
            ? pile[0]
            : card.parentId === hand.id
              ? held[0]
              : undefined;
        return first
          ? {
              ...card,
              label: first.label,
              imageUrl: first.imageUrl,
              concealed: false,
            }
          : card;
      }),
    };
    preferences().reset(ZONE_BROWSER_PREFERENCES);
    try {
      const render = async (openedZoneId: string) =>
        act(async () => {
          root.render(
            createElement(LegacyBoardOverlays, {
              state: state({
                scene: copies,
                presentation: {
                  ...state().presentation,
                  openedZoneId,
                },
              }),
              darkMode: false,
              actions: actions(),
            })
          );
        });
      const tiles = () => host.querySelectorAll('[data-overlay-card-id]');
      const toggle = () =>
        host.querySelector<HTMLButtonElement>(
          '[data-zone-action="stackCopies"]'
        )!;

      // A pile opens stacked: one tile counting its copies.
      await render(discard.id);
      expect(tiles()).toHaveLength(1);
      const stacked = tiles()[0]!;
      expect(stacked.getAttribute('data-copy-stack')).toBe(String(pile.length));
      expect(stacked.textContent).toContain(`×${pile.length}`);
      expect(toggle().getAttribute('aria-pressed')).toBe('true');

      // The hand opens with every card on its own.
      await act(async () => root.render(null));
      await render(hand.id);
      expect(tiles()).toHaveLength(held.length);
      expect(toggle().getAttribute('aria-pressed')).toBe('false');

      // Unstacking the pile leaves the hand's choice alone, and is kept.
      await act(async () => root.render(null));
      await render(discard.id);
      await act(async () => toggle().click());
      expect(preferences().get(ZONE_BROWSER_PREFERENCES)).toMatchObject({
        stackPiles: false,
        stackHand: false,
      });
      expect(tiles()).toHaveLength(pile.length);
      await act(async () => root.render(null));
      await render(discard.id);
      expect(tiles()).toHaveLength(pile.length);
    } finally {
      preferences().reset(ZONE_BROWSER_PREFERENCES);
    }
  });

  it('preserves the source discard confirmation without adding one to deck shuffle', async () => {
    await mountOverlayHost();
    const callbacks = actions();
    const confirm = vi.fn();
    vi.stubGlobal('confirm', confirm);
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const opened = (zoneId: string | null) =>
      state({
        presentation: {
          selectedCardId: null,
          hoveredCardId: null,
          targetableCardIds: [],
          drag: null,
          openedZoneId: zoneId,
        },
      });
    const render = async (zoneId: string | null) => {
      await act(async () => {
        root.render(
          createElement(LegacyBoardOverlays, {
            state: opened(zoneId),
            darkMode: false,
            actions: callbacks,
          })
        );
      });
    };

    await render(discard.id);
    const discardAction = () =>
      host.querySelector<HTMLButtonElement>(
        '[data-zone-action="shuffleDiscardToDeck"]'
      )!;
    await act(async () => discardAction().click());
    await settleDialogs();
    const question = openDialogs()[0];
    expect(question?.getAttribute('role')).toBe('alertdialog');
    expect(question?.textContent).toContain('Shuffle all into the deck?');
    expect(dialogButton('confirm').dataset.variant).toBe('danger');
    // Asking twice while the question is open asks once.
    await act(async () => discardAction().click());
    await settleDialogs();
    expect(openDialogs()).toHaveLength(1);
    expect(callbacks.invokeZoneAction).not.toHaveBeenCalled();

    // Pressing inside the dialog answers it; it is not a press outside the
    // pile browser, so the browser stays open.
    await act(async () => {
      dialogButton('cancel').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true })
      );
      dialogButton('cancel').click();
    });
    await settleDialogs();
    expect(callbacks.dismiss).not.toHaveBeenCalled();
    expect(callbacks.invokeZoneAction).not.toHaveBeenCalled();
    expect(openDialogs()).toHaveLength(0);

    await act(async () => discardAction().click());
    await settleDialogs();
    await act(async () => {
      dialogButton('confirm').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true })
      );
      dialogButton('confirm').click();
    });
    await settleDialogs();
    expect(callbacks.dismiss).not.toHaveBeenCalled();
    expect(callbacks.invokeZoneAction).toHaveBeenCalledExactlyOnceWith(
      'shuffleDiscardToDeck',
      discard.id
    );

    // Closing the pile withdraws an unanswered question.
    await act(async () => discardAction().click());
    await settleDialogs();
    expect(openDialogs()).toHaveLength(1);
    await render(null);
    await settleDialogs();
    expect(openDialogs()).toHaveLength(0);
    expect(callbacks.invokeZoneAction).toHaveBeenCalledTimes(1);

    const deck = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:deck`
    )!;
    await render(deck.id);
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[data-zone-action="shuffleDeck"]')!
        .click()
    );
    await settleDialogs();
    expect(openDialogs()).toHaveLength(0);
    expect(callbacks.invokeZoneAction).toHaveBeenNthCalledWith(
      2,
      'shuffleDeck',
      deck.id
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('returns focus to the shuffle button on cancel and to the pile opener once confirmed', async () => {
    await mountOverlayHost();
    const discard = scene.zones.find(
      (candidate) => candidate.id === `zone:${firstPlayer}:discard`
    )!;
    const opener = document.createElement('button');
    opener.textContent = 'Discard pile';
    document.body.prepend(opener);
    opener.focus();
    let openedZoneId: string | null = discard.id;
    const callbacks = actions();
    const overlays = () =>
      createElement(LegacyBoardOverlays, {
        state: state({
          presentation: {
            selectedCardId: null,
            hoveredCardId: null,
            targetableCardIds: [],
            drag: null,
            openedZoneId,
          },
        }),
        darkMode: false,
        actions: callbacks,
      });
    const render = async () => {
      await act(async () => root.render(overlays()));
    };
    // As the controller does: shuffling the pile into the deck closes it,
    // straight away -- before the confirmation has finished animating out.
    vi.mocked(callbacks.invokeZoneAction).mockImplementation(() => {
      openedZoneId = null;
      root.render(overlays());
    });
    await render();
    await settleDialogs();
    const shuffle = host.querySelector<HTMLButtonElement>(
      '[data-zone-action="shuffleDiscardToDeck"]'
    )!;

    shuffle.focus();
    await act(async () => shuffle.click());
    await settleDialogs();
    // Like v1's confirm(), Enter would answer yes.
    expect(document.activeElement).toBe(dialogButton('confirm'));
    await act(async () => dialogButton('cancel').click());
    await settleDialogs();
    expect(openDialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(shuffle);

    await act(async () => shuffle.click());
    await settleDialogs();
    await act(async () => dialogButton('confirm').click());
    await settleDialogs();
    expect(callbacks.invokeZoneAction).toHaveBeenCalledExactlyOnceWith(
      'shuffleDiscardToDeck',
      discard.id
    );
    expect(host.querySelector('[data-legacy-zone-browser]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
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

  it("opens a Pokémon's damage controls where its first counter will lie, the number taking the keys", async () => {
    const callbacks = actions();
    const active = view.stacks[view.boards[firstPlayer]!.activeStackId!]!;
    const cardId = active.evolutionCards.at(-1)!.id;
    // A Pokémon with no damage yet: no counter to open them from.
    const undamaged = {
      ...scene,
      markers: scene.markers.filter(
        (marker) =>
          !(marker.parentCardId === cardId && marker.kind === 'damage')
      ),
    };
    const markerSnapshot = JSON.stringify(undamaged.markers);
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            scene: undamaged,
            overlays: {
              contextMenuCardId: null,
              preview: null,
              input: null,
              marker: { cardId, kind: 'damage', takesFocus: true },
            },
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const panel = host.querySelector<HTMLElement>(
      '.ptcgsim-marker-controls[data-marker-controls="damage"]'
    )!;
    expect(panel.getAttribute('aria-label')).toBe('0 damage');
    const field = panel.querySelector<HTMLInputElement>('input')!;
    expect(field.value).toBe('');
    expect(field.placeholder).toBe('0');
    expect(document.activeElement).toBe(field);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(field, '120');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(callbacks.submitDamageInput).toHaveBeenCalledExactlyOnceWith(
      cardId,
      '120'
    );
    expect(callbacks.dismiss).toHaveBeenCalledWith('marker');
    expect(JSON.stringify(undamaged.markers)).toBe(markerSnapshot);
  });

  it('offers Leave in play only while a Pokémon is staged to put back', async () => {
    const hand = Object.values(view.zones).find(
      (zone) => zone.kind === 'hand' && zone.ownerId === firstPlayer
    )!;
    const [first, second] = hand.cards;
    if (!first || !second) throw new Error('Fixture hand is too small');
    const staged = (evolutionCards: readonly (typeof first)[]) => {
      const stagedView: MatchViewState = {
        ...view,
        zones: {
          ...view.zones,
          [hand.id]: { ...hand, cards: hand.cards.slice(2) },
        },
        workAreas: {
          ...view.workAreas,
          [firstPlayer]: {
            inspection: null,
            attachmentResolution: {
              id: 'work-area:staged',
              sourceStackId: 'stack:gone',
              cards: [first, second],
              evolutionCards,
              attachmentCards: [first, second].filter(
                (card) => !evolutionCards.includes(card)
              ),
              suggestedSlot: 'bench',
            },
          },
        },
      } as MatchViewState;
      return {
        view: stagedView,
        scene: createBoardSceneForViewport(stagedView, {
          geometryVersion: 1,
          viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
          bottomPlayerId: firstPlayer,
          splitRatio: 0.5,
        }),
      };
    };
    const offered = async (evolutionCards: readonly (typeof first)[]) => {
      await act(async () => {
        root.render(
          createElement(LegacyBoardOverlays, {
            state: state(staged(evolutionCards)),
            darkMode: false,
            actions: { ...actions(), invokeWorkAreaAction: vi.fn() },
          })
        );
      });
      return [
        ...host.querySelectorAll(
          '[data-legacy-work-area="staged"] [data-work-area-action]'
        ),
      ].map((button) => button.getAttribute('data-work-area-action'));
    };
    // The Pokémon itself turned into a Tool: nothing to put back in play.
    expect(await offered([])).not.toContain('leaveInPlay');
    expect(await offered([first])).toContain('leaveInPlay');
  });

  it('paints the source work-area popup with its cards and bulk buttons', async () => {
    // Move two of the fixture's hand cards into a "Looking at cards..."
    // inspection; the scene lays them out where v1's popup images sit and
    // the overlay draws the popup around them.
    const hand = Object.values(view.zones).find(
      (zone) => zone.kind === 'hand' && zone.ownerId === firstPlayer
    )!;
    const [first, second] = hand.cards;
    if (!first || !second) throw new Error('Fixture hand is too small');
    const inspectingView: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(2) },
      },
      workAreas: {
        ...view.workAreas,
        [firstPlayer]: {
          inspection: {
            id: 'work-area:inspection',
            cards: [first, second],
            sourceZoneId: hand.id,
          },
          attachmentResolution: null,
        },
      },
    };
    const inspectingScene = createBoardSceneForViewport(inspectingView, {
      geometryVersion: 1,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      bottomPlayerId: firstPlayer,
      splitRatio: 0.5,
    });
    const callbacks = {
      ...actions(),
      emitCardIntent: vi.fn(),
      invokeWorkAreaAction: vi.fn(),
    };
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({ view: inspectingView, scene: inspectingScene }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });

    const panel = host.querySelector<HTMLElement>(
      '[data-legacy-work-area="inspection"]'
    )!;
    const zone = inspectingScene.zones.find(
      (candidate) => candidate.id === 'work-area:inspection'
    )!;
    const local = inspectingScene.layout.players.find(
      (frame) => frame.side === 'local'
    )!;
    // 69% x 75% of the player's frame plus 20px padding and a 1px border,
    // centred in the frame.
    expect(zone.bounds.width).toBeCloseTo(local.bounds.width * 0.69 + 42);
    expect(zone.bounds.height).toBeCloseTo(local.bounds.height * 0.75 + 42);
    expect(zone.bounds.x + zone.bounds.width / 2).toBeCloseTo(
      local.bounds.x + local.bounds.width / 2
    );
    // The panel no longer traces v1's popup box (ADR-027): it covers that
    // box -- the scene still paints its own copies of the cards there -- and
    // grows around it to draw the cards at a third of the board's height.
    const layout = workAreaPanelLayout(
      zone.bounds,
      inspectingScene.viewport,
      2,
      true,
      true
    );
    const panelBox = {
      left: Number.parseFloat(panel.style.left),
      top: Number.parseFloat(panel.style.top),
      width: Number.parseFloat(panel.style.width),
      height: Number.parseFloat(panel.style.height),
    };
    expect(panelBox.left).toBeCloseTo(layout.left);
    expect(panelBox.top).toBeCloseTo(layout.top);
    expect(panelBox.width).toBeCloseTo(layout.width);
    expect(panelBox.height).toBeCloseTo(layout.height);
    expect(panelBox.left).toBeLessThanOrEqual(zone.bounds.x);
    expect(panelBox.top).toBeLessThanOrEqual(zone.bounds.y);
    expect(panelBox.left + panelBox.width).toBeGreaterThanOrEqual(
      zone.bounds.x + zone.bounds.width
    );
    expect(panelBox.top + panelBox.height).toBeGreaterThanOrEqual(
      zone.bounds.y + zone.bounds.height
    );
    expect(layout.cardHeight).toBeCloseTo(Math.min(720 * 0.34, 300));
    expect(panel.style.getPropertyValue('--ptcgsim-work-card-height')).toBe(
      `${layout.cardHeight.toFixed(2)}px`
    );
    expect(
      panel.querySelector('.ptcgsim-legacy-work-area-header')?.textContent
    ).toBe('Looking at cards');
    expect(panel.querySelector('.ptcgsim-overlay-count')?.textContent).toBe(
      '2 cards'
    );
    expect(
      [...panel.querySelectorAll('[data-work-area-action]')].map(
        (button) => button.textContent
      )
    ).toEqual([
      'Discard all',
      'Shuffle all',
      'Shuffle to bottom',
      'Lost Zone all',
      'To Hand',
    ]);

    const cards = [
      ...panel.querySelectorAll<HTMLButtonElement>('[data-work-area-card-id]'),
    ];
    expect(cards.map((card) => card.dataset.workAreaCardId)).toEqual([
      first.id,
      second.id,
    ]);
    // Moved out of the window, each flies from where it is shown.
    expect(cards.map((card) => card.dataset.motionOrigin)).toEqual([
      first.id,
      second.id,
    ]);
    // The scene keeps v1's layout for its own copies (33% of the content
    // height, flowing left to right); the panel's cards flow in its own row
    // and take no position from them.
    const firstNode = inspectingScene.cards.find(
      (card) => card.id === first.id
    )!;
    expect(firstNode.bounds.height).toBeCloseTo(
      local.bounds.height * 0.75 * 0.33
    );
    expect(cards[0]!.getAttribute('style')).toBeNull();
    const secondNode = inspectingScene.cards.find(
      (card) => card.id === second.id
    )!;
    expect(secondNode.bounds.x).toBeGreaterThan(firstNode.bounds.x);
    expect(secondNode.bounds.y).toBe(firstNode.bounds.y);

    await act(async () => {
      cards[1]!.click();
    });
    expect(callbacks.emitCardIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardSelected',
      cardId: second.id,
      toggle: true,
    });
    await act(async () => {
      panel
        .querySelector<HTMLButtonElement>(
          '[data-work-area-action="shuffleBottom"]'
        )!
        .click();
    });
    expect(callbacks.invokeWorkAreaAction).toHaveBeenCalledExactlyOnceWith(
      'inspection',
      'shuffleBottom'
    );

    // A spectator sees the popup but none of its bulk buttons.
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state: state({
            view: { ...inspectingView, viewer: { kind: 'spectator' } },
            scene: inspectingScene,
            canSubmitCommands: false,
          }),
          darkMode: false,
          actions: callbacks,
        })
      );
    });
    expect(
      host.querySelectorAll('[data-legacy-work-area] [data-work-area-action]')
    ).toHaveLength(0);
    expect(
      host.querySelector<HTMLButtonElement>('[data-work-area-card-id]')
        ?.disabled
    ).toBe(true);
    // Read-only, the panel says whose cards these are and keeps Board.
    const readOnly = host.querySelector<HTMLElement>(
      '[data-legacy-work-area]'
    )!;
    expect(readOnly.querySelector('.ptcgsim-overlay-hint')?.textContent).toBe(
      'Opponent is looking'
    );
    expect(readOnly.querySelector('.ptcgsim-show-board-button')).not.toBeNull();
  });
  it('lists the stack view Pokémon first, top card down, then its Energy, then everything else attached', () => {
    const stackId = view.boards[firstPlayer]!.activeStackId!;
    const original = view.stacks[stackId]!;
    // Give the fixture's active a second stage, a Tool and a second Energy
    // by borrowing three hand cards, then lay it out again.
    const hand = view.zones[`zone:${firstPlayer}:hand`]!;
    const [stage, tool, energy] = hand.cards;
    const oldEnergy = original.attachmentCards[0];
    if (!stage || !tool || !energy || !oldEnergy)
      throw new Error('Fixture is too small');
    const as = <Card extends (typeof hand.cards)[number]>(
      card: Card,
      category: 'Energy' | 'Trainer'
    ): Card => (card.kind === 'known' ? { ...card, category } : card);
    const stack = {
      ...original,
      evolutionCards: [...original.evolutionCards, stage],
      attachmentCards: [
        as(oldEnergy, 'Energy'),
        as(tool, 'Trainer'),
        as(energy, 'Energy'),
      ],
    };
    const richScene = createBoardSceneForViewport(
      {
        ...view,
        zones: {
          ...view.zones,
          [hand.id]: { ...hand, cards: hand.cards.slice(3) },
        },
        stacks: { ...view.stacks, [stackId]: stack },
      },
      {
        geometryVersion: 1,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
        bottomPlayerId: firstPlayer,
        splitRatio: 0.5,
      }
    );
    const cards = richScene.cards.filter((card) => card.parentId === stackId);
    expect(cards).toHaveLength(
      stack.evolutionCards.length + stack.attachmentCards.length
    );
    expect(stackPreviewOrder(stack, cards).map((card) => card.id)).toEqual([
      stage.id,
      ...[...original.evolutionCards].reverse().map((card) => card.id),
      // Energy newest first, then the Tool.
      energy.id,
      oldEnergy.id,
      tool.id,
    ]);
  });
});
