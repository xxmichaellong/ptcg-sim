// @vitest-environment happy-dom

import type { MatchViewState } from '@ptcgsim/game-core';
import {
  createBoardSceneForViewport,
  createRendererSpikeView,
  type CardSceneNode,
} from '@ptcgsim/renderer-contract';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelAllDialogRequests } from '../../ui/dialog-requests.js';
import { OverlayHost } from '../../ui/OverlayHost.js';
import {
  createInitialBoardSessionControllerState,
  type BoardSessionControllerState,
} from '../BoardSessionController.js';
import {
  LegacyBoardOverlays,
  legacyStackPreviewOrder,
  resolveOpenedZoneDropTarget,
  selectLegacyContextEntries,
  sortRecipientSafeZoneCards,
  stackPreviewFrameStyle,
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
      invalidMessage: 'Please enter a valid number for the draw amount.',
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
      message: 'How many cards do you want to look at?',
      initialValue: '1',
      minimum: 1,
      invalidMessage: 'Please enter a valid number for the view amount.',
    });
    expect(dialogButton('submit').textContent).toBe('View');
    // An invalid count keeps the question open with the source's message.
    await typeAndSubmit('2.5');
    expect(openDialogs()).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Please enter a valid number for the view amount.'
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
      invalidMessage: 'Please enter a valid number for the draw amount.',
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
      invalidMessage: 'Please enter a valid number for the draw amount.',
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
      invalidMessage: 'Please enter a valid number for the draw amount.',
    });
    expect(openDialogs()).toHaveLength(1);

    // The deck it counted is gone: the controller reconciles the input away.
    await render(null);
    expect(openDialogs()).toHaveLength(0);
    expect(callbacks.dismiss).not.toHaveBeenCalled();
    expect(callbacks.submitCountInput).not.toHaveBeenCalled();
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

  it('opens a pile large enough to read, with its count, copy badges and a Show board hold', async () => {
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
    // draws its cards at a third of the board's height (at most 300px).
    const layout = zoneBrowserLayout(scene.viewport, discardCards.length);
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
    expect([badge(first.id), badge(second.id), badge(third.id)]).toEqual([
      '×2',
      '×2',
      null,
    ]);
    // Face-down cards are never counted.
    expect(
      zoneCopyCounts([
        { ...first, concealed: true },
        { ...second, label: first.label, concealed: true },
      ]).size
    ).toBe(0);

    const scrim = host.querySelector<HTMLElement>('.ptcgsim-overlay-scrim')!;
    expect(scrim.getAttribute('aria-hidden')).toBe('true');
    const peek = browser.querySelector<HTMLButtonElement>(
      '.ptcgsim-peek-button'
    )!;
    await act(async () => {
      peek.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerId: 1,
        })
      );
    });
    expect(browser.classList).toContain('is-peeking');
    expect(scrim.classList).toContain('is-hidden');
    expect(peek.getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      peek.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })
      );
    });
    expect(browser.classList).not.toContain('is-peeking');
    expect(scrim.classList).not.toContain('is-hidden');
    // Holding it from the keyboard works the same way.
    await act(async () => {
      peek.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true })
      );
    });
    expect(browser.classList).toContain('is-peeking');
    await act(async () => {
      peek.dispatchEvent(
        new KeyboardEvent('keyup', { key: ' ', bubbles: true })
      );
    });
    expect(browser.classList).not.toContain('is-peeking');
    expect(callbacks.dismiss).not.toHaveBeenCalled();

    await act(async () => {
      browser.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
      );
    });
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
    expect(preview.dispatchEvent(tab)).toBe(false);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(preview);
  });

  it('keeps stable overlay-card geometry through arbitrary image failure and recovery', async () => {
    const callbacks = actions();
    const card = cardIn(`:${firstPlayer}:hand`);
    const renderPreview = async (imageUrl: string) => {
      await act(async () => {
        root.render(
          createElement(LegacyBoardOverlays, {
            state: state({
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
    expect(getComputedStyle(wrapper).aspectRatio).toBe('5 / 7');
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
    expect(source.getAttribute('draggable')).toBe('true');
    const transfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    };
    const event = (type: string, clientX = 0, clientY = 0): Event => {
      const dispatched = new Event(type, {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperties(dispatched, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        dataTransfer: { value: transfer },
      });
      return dispatched;
    };

    await act(async () => source.dispatchEvent(event('dragstart')));
    expect(callbacks.dismiss).toHaveBeenCalledExactlyOnceWith('selection');
    expect(transfer.effectAllowed).toBe('move');
    expect(transfer.setData).toHaveBeenCalledExactlyOnceWith(
      'application/x-ptcgsim-opened-zone-card',
      'card'
    );
    expect(
      host
        .querySelector('[data-legacy-zone-browser]')
        ?.getAttribute('data-zone-dragging-card')
    ).toBe(String(discardCards[0]!.id));

    const targetX = hand.bounds.x + hand.bounds.width / 2;
    const targetY = hand.bounds.y + hand.bounds.height / 2;
    await act(async () =>
      document.dispatchEvent(event('drop', targetX, targetY))
    );
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardDropRequested',
      cardId: discardCards[0]!.id,
      targetId: hand.id,
      x: targetX,
      y: targetY,
    });
    expect(
      host
        .querySelector('[data-legacy-zone-browser]')
        ?.hasAttribute('data-zone-dragging-card')
    ).toBe(false);

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
    await act(async () => readOnly.dispatchEvent(event('dragstart')));
    expect(callbacks.dismiss).toHaveBeenCalledTimes(1);
    expect(callbacks.emitOpenedZoneCardIntent).toHaveBeenCalledTimes(1);
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
    expect(question?.textContent).toContain(
      'Are you sure you want to shuffle all cards into the deck?'
    );
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
    const hint = () =>
      host.querySelector<HTMLElement>('.ptcgsim-marker-editor-hint');
    expect(hint()?.textContent).toBe('Enter to set · Esc to cancel');
    expect(hint()?.getAttribute('aria-hidden')).toBe('true');
    // The ring is the stylesheet's: the field's own box stays the counter's.
    expect(editor.style.outline).toBe('');
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
    expect(hint()?.textContent).toBe('A whole number, up to 9990');
    expect(hint()?.classList).toContain('is-invalid');

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

  it('anchors the active condition editor and previews the draft chip palette', async () => {
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
    // The draft previews its chip's colours: "Poisoned" is the orchid
    // Poison marker.
    expect(editor.style.background).toBe('rgb(178, 120, 180)');
    expect(editor.style.color).toBe('rgb(23, 18, 10)');

    await act(async () => {
      editor.focus();
      editor.textContent = 'Pa';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    // v1's "PA" is the Paralyzed chip: a yellow bolt on charcoal.
    expect(editor.style.background).toBe('rgb(43, 43, 48)');
    expect(editor.style.color).toBe('rgb(255, 214, 10)');

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
    ).toBe('Looking at cards...');
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
    // Read-only, the panel says whose cards these are and keeps Show board.
    const readOnly = host.querySelector<HTMLElement>(
      '[data-legacy-work-area]'
    )!;
    expect(readOnly.querySelector('.ptcgsim-overlay-hint')?.textContent).toBe(
      'Your opponent is looking at these cards'
    );
    expect(readOnly.querySelector('.ptcgsim-peek-button')).not.toBeNull();
  });
  it('lists a stack preview top card first and then its attachments newest-first, as v1 does', () => {
    const stackId = view.boards[firstPlayer]!.activeStackId!;
    const original = view.stacks[stackId]!;
    // Give the fixture's active a second stage and a second attachment by
    // borrowing two hand cards, then lay it out again.
    const hand = view.zones[`zone:${firstPlayer}:hand`]!;
    const [stage, extra] = hand.cards;
    if (!stage || !extra) throw new Error('Fixture hand is too small');
    const stack = {
      ...original,
      evolutionCards: [...original.evolutionCards, stage],
      attachmentCards: [...original.attachmentCards, extra],
    };
    const richScene = createBoardSceneForViewport(
      {
        ...view,
        zones: {
          ...view.zones,
          [hand.id]: { ...hand, cards: hand.cards.slice(2) },
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
    const ordered = legacyStackPreviewOrder(stack, cards).map(
      (card) => card.id
    );
    expect(ordered).toEqual([
      stack.evolutionCards.at(-1)!.id,
      ...[...stack.attachmentCards].reverse().map((card) => card.id),
      ...stack.evolutionCards
        .slice(0, -1)
        .reverse()
        .map((card) => card.id),
    ]);
  });
});
