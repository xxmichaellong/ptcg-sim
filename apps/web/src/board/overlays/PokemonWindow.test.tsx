// @vitest-environment happy-dom

import type { CardText, MatchViewState } from '@ptcgsim/game-core';
import {
  createBoardSceneForViewport,
  createRendererSpikeView,
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
  type LegacyBoardOverlayActions,
} from './LegacyBoardOverlays.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The Pokémon window (ADR-043) from its text: Use and the attacks for the
 * Pokémon's player, the moves read for the other player's, and nothing to
 * press for a table that takes no commands.
 */

const TEXT: CardText = {
  hp: 120,
  types: ['Lightning'],
  stage: 'Basic',
  abilities: [{ name: 'Static Shock', kind: 'Ability', text: 'Zap.' }],
  attacks: [
    { name: 'Thunderbolt', cost: ['Lightning', 'Colorless'], damage: '90' },
  ],
  weakness: 'Fighting',
  retreat: 1,
};

const base = createRendererSpikeView();
const [blue, red] = base.playerOrder as [string, string];

/** The spike's view, every Pokémon's top card given the text above. */
const withText = (view: MatchViewState): MatchViewState => {
  const definitions = { ...view.definitions };
  for (const stack of Object.values(view.stacks)) {
    const top = stack.evolutionCards.at(-1);
    if (top?.kind !== 'known') continue;
    definitions[top.definitionId] = {
      ...definitions[top.definitionId]!,
      text: TEXT,
    };
  }
  return { ...view, definitions };
};

const view = withText(base);
const scene = createBoardSceneForViewport(view, {
  geometryVersion: 1,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  bottomPlayerId: blue,
  splitRatio: 0.5,
});

const stateFor = (
  playerId: string,
  patch: Partial<BoardSessionControllerState> = {}
): BoardSessionControllerState => {
  const stackId = view.boards[playerId]!.activeStackId!;
  return {
    ...createInitialBoardSessionControllerState(),
    generation: 1,
    sessionPhase: 'ready',
    source: { kind: 'live' },
    view,
    scene,
    canSubmitCommands: true,
    overlays: {
      contextMenuCardId: null,
      preview: {
        kind: 'stack',
        stackId,
        focusCardId: view.stacks[stackId]!.evolutionCards.at(-1)!.id,
      },
      input: null,
    },
    ...patch,
  };
};

const actions = (): LegacyBoardOverlayActions & {
  readonly invokeWindowAction: ReturnType<typeof vi.fn>;
} => ({
  emitOpenedZoneCardIntent: vi.fn(),
  updateDrag: vi.fn(),
  dismiss: vi.fn(),
  invokeContextAction: vi.fn(),
  invokeZoneAction: vi.fn(),
  invokeWindowAction: vi.fn(),
  submitDamageInput: vi.fn(),
  submitSpecialConditionInput: vi.fn(),
  submitCountInput: vi.fn(),
  submitShortcutCountInput: vi.fn(),
  submitCategoryChoice: vi.fn(),
  submitMoveChoice: vi.fn(),
});

describe('the Pokémon window', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.replaceChildren(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  const render = async (
    state: BoardSessionControllerState,
    callbacks: LegacyBoardOverlayActions,
    allowOpponentResolution = false
  ) => {
    await act(async () => {
      root.render(
        createElement(LegacyBoardOverlays, {
          state,
          darkMode: false,
          actions: callbacks,
          allowOpponentResolution,
        })
      );
    });
    return host.querySelector<HTMLElement>('[data-pokemon-window]')!;
  };

  it('lays out the Pokémon’s cards, status and moves, and uses a move by name', async () => {
    const callbacks = actions();
    const window = await render(stateFor(blue), callbacks);
    expect(window).not.toBeNull();
    const stack = view.stacks[view.boards[blue]!.activeStackId!]!;
    const top = stack.evolutionCards.at(-1)!;
    expect(
      window.querySelectorAll(
        '.pokemon-window__hero [data-stack-preview-card-id]'
      )
    ).toHaveLength(1);
    expect(
      window.querySelectorAll(
        '.pokemon-window__stages [data-stack-preview-card-id]'
      )
    ).toHaveLength(stack.evolutionCards.length - 1);
    expect(
      window.querySelectorAll(
        '.pokemon-window__attached [data-stack-preview-card-id]'
      )
    ).toHaveLength(stack.attachmentCards.length);
    const damage = stack.damage ?? 0;
    expect(window.querySelector('.pokemon-window__hp-value')?.textContent).toBe(
      `${String(Math.max(0, 120 - damage))}/120`
    );

    window
      .querySelector<HTMLButtonElement>('[data-pokemon-window-move="ability"]')!
      .click();
    expect(callbacks.invokeWindowAction).toHaveBeenCalledWith({
      kind: 'context',
      action: 'useAbility',
      cardId: top.id,
      name: 'Static Shock',
    });
    expect(callbacks.dismiss).toHaveBeenCalledWith('preview');
    window
      .querySelector<HTMLButtonElement>('[data-pokemon-window-move="attack"]')!
      .click();
    expect(callbacks.invokeWindowAction).toHaveBeenCalledWith({
      kind: 'context',
      action: 'useAttack',
      cardId: top.id,
      name: 'Thunderbolt',
    });
    window
      .querySelector<HTMLButtonElement>('[aria-label="10 more damage"]')!
      .click();
    expect(callbacks.invokeWindowAction).toHaveBeenCalledWith({
      kind: 'context',
      action: 'setDamage',
      cardId: top.id,
      value: String(damage + 10),
    });
  });

  it('reads the other player’s moves without using them, at a table where they don’t play', async () => {
    const callbacks = actions();
    const window = await render(stateFor(red), callbacks);
    expect(window.textContent).toContain('Static Shock');
    expect(window.textContent).toContain('Thunderbolt');
    expect(window.querySelector('[data-pokemon-window-move]')).toBeNull();
    // Its damage and conditions are anyone's to set (the room's policy).
    expect(
      window.querySelector('[aria-label="10 more damage"]')
    ).not.toBeNull();
    // At a Solo table, the other seat's moves are the player's too.
    const solo = await render(stateFor(red), actions(), true);
    expect(
      solo.querySelector('[data-pokemon-window-move="ability"]')
    ).not.toBeNull();
  });

  it('offers nothing to press at a table that takes no commands', async () => {
    const window = await render(
      stateFor(blue, { canSubmitCommands: false }),
      actions()
    );
    expect(window.querySelector('[data-pokemon-window-move]')).toBeNull();
    expect(window.querySelector('[aria-label="10 more damage"]')).toBeNull();
    expect(
      window.querySelector('.pokemon-window__toggle[aria-pressed]')
    ).toBeNull();
  });

  it('steps damage from a typed 0, not from the damage it had', async () => {
    const callbacks = actions();
    const window = await render(stateFor(blue), callbacks);
    const stack = view.stacks[view.boards[blue]!.activeStackId!]!;
    const input = window.querySelector<HTMLInputElement>(
      '.pokemon-window__damage-input'
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, '0');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
      )
    );
    expect(callbacks.invokeWindowAction).toHaveBeenLastCalledWith({
      kind: 'context',
      action: 'setDamage',
      cardId: stack.evolutionCards.at(-1)!.id,
      value: '10',
    });
  });

  it('answers presses after a card read large from it and back, and leaves as itself', async () => {
    const callbacks = actions();
    const window = await render(stateFor(blue), callbacks);
    const hero = window.querySelector<HTMLButtonElement>(
      '.pokemon-window__hero [data-stack-preview-card-id]'
    )!;
    await act(async () => hero.click());
    const back = host.querySelector<HTMLButtonElement>('[data-preview-back]')!;
    expect(back).not.toBeNull();
    await act(async () => {
      back.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      back.click();
    });
    expect(callbacks.dismiss).not.toHaveBeenCalled();
    const again = host.querySelector<HTMLElement>('[data-pokemon-window]')!;
    expect(again).not.toBeNull();
    // A press inside the window it came back to is no press outside.
    await act(async () =>
      again
        .querySelector('.pokemon-window__status')!
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    );
    expect(callbacks.dismiss).not.toHaveBeenCalled();
    // Put away, the window it shows now fades out.
    await render(
      stateFor(blue, {
        overlays: { contextMenuCardId: null, preview: null, input: null },
      }),
      callbacks
    );
    await act(async () => Promise.resolve());
    expect(
      host.querySelector('.pokemon-window.ptcgsim-overlay-ghost')
    ).not.toBeNull();
  });
});
