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

  it('marks each Ability used on itself, takes a mark off from it, and changes the HP an effect adds', async () => {
    // A Pokémon with an Ability and a Poké-Power; only the Poké-Power used,
    // +30 HP from an effect (a Tool's).
    const text: CardText = {
      ...TEXT,
      abilities: [
        { name: 'Static Shock', kind: 'Ability', text: 'Zap.' },
        { name: 'Power Surge', kind: 'Poké-Power', text: 'Surge.' },
        // Written by hand, its spacing loose: kept by the room as one line.
        { name: ' Calm  Mind ', kind: 'Poké-Body', text: 'Calm.' },
      ],
    };
    const stackId = view.boards[blue]!.activeStackId!;
    const top = view.stacks[stackId]!.evolutionCards.at(-1)!;
    const marked: MatchViewState = {
      ...view,
      definitions: {
        ...view.definitions,
        ...(top.kind === 'known'
          ? {
              [top.definitionId]: {
                ...view.definitions[top.definitionId]!,
                text,
              },
            }
          : {}),
      },
      stacks: {
        ...view.stacks,
        [stackId]: {
          ...view.stacks[stackId]!,
          damage: 20,
          abilityUsed: true,
          abilitiesUsed: ['Power Surge', 'Calm Mind'],
          hpModifier: 30,
        },
      },
    };
    const callbacks = actions();
    const window = await render(
      {
        ...stateFor(blue),
        view: marked,
        scene: createBoardSceneForViewport(marked, {
          geometryVersion: 1,
          viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
          bottomPlayerId: blue,
          splitRatio: 0.5,
        }),
      },
      callbacks
    );
    // The Poké-Power wears its own Used mark; the Ability, none.
    const used = window.querySelector<HTMLButtonElement>(
      '[data-pokemon-window-used="Power Surge"]'
    );
    expect(used).not.toBeNull();
    expect(
      window.querySelector('[data-pokemon-window-used="Static Shock"]')
    ).toBeNull();
    // The hand-written one is found by the name the room kept.
    const calm = window.querySelector<HTMLButtonElement>(
      '[data-pokemon-window-used=" Calm  Mind "]'
    );
    expect(calm).not.toBeNull();
    await act(async () => calm!.click());
    expect(callbacks.invokeWindowAction).toHaveBeenCalledWith({
      kind: 'context',
      action: 'unmarkAbility',
      cardId: top.id,
      name: ' Calm  Mind ',
    });
    // Pressed, the mark comes off that Power alone.
    await act(async () => used!.click());
    expect(callbacks.invokeWindowAction).toHaveBeenCalledWith({
      kind: 'context',
      action: 'unmarkAbility',
      cardId: top.id,
      name: 'Power Surge',
    });
    // Its HP: the printed 120 and the effect's 30, less 20 damage.
    expect(window.querySelector('.pokemon-window__hp-value')?.textContent).toBe(
      '130/150'
    );
    expect(
      window.querySelector('.pokemon-window__hp-modifier')?.textContent
    ).toBe('+30');
    await act(async () =>
      window
        .querySelector<HTMLButtonElement>('[aria-label="10 more HP"]')!
        .click()
    );
    expect(callbacks.invokeWindowAction).toHaveBeenCalledWith({
      kind: 'context',
      action: 'setHpModifier',
      cardId: top.id,
      value: 40,
    });
    await act(async () =>
      window
        .querySelector<HTMLButtonElement>('[aria-label="10 less HP"]')!
        .click()
    );
    expect(callbacks.invokeWindowAction).toHaveBeenCalledWith({
      kind: 'context',
      action: 'setHpModifier',
      cardId: top.id,
      value: 20,
    });
    // No attack's damage (effects change it), and no reminders to toggle:
    // only the Active's Special Conditions.
    const attack = window.querySelector('.pokemon-window__move.is-attack')!;
    expect(attack.textContent).toContain('Thunderbolt');
    expect(attack.textContent).not.toContain('90');
    expect(window.querySelectorAll('.pokemon-window__toggle')).toHaveLength(5);
  });

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
    // A press on the attack's name or text, to read it, declares nothing:
    // only its Attack button does.
    const attackRow = window.querySelector<HTMLElement>(
      '.pokemon-window__move.is-attack'
    )!;
    attackRow.querySelector<HTMLElement>('.pokemon-window__move-name')!.click();
    attackRow.click();
    expect(callbacks.invokeWindowAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'useAttack' })
    );
    const attack = attackRow.querySelector<HTMLButtonElement>(
      '[data-pokemon-window-move="attack"]'
    )!;
    expect(attack.getAttribute('aria-label')).toBe('Attack with Thunderbolt');
    attack.click();
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

  it('attacks unnamed where the table knows none of the Pokémon’s attacks, and only there', async () => {
    const callbacks = actions();
    // Text with no attacks written (a card made by hand, say): the window
    // says so, and still offers an Attack.
    const definitions = { ...view.definitions };
    for (const stack of Object.values(view.stacks)) {
      const top = stack.evolutionCards.at(-1);
      if (top?.kind !== 'known') continue;
      definitions[top.definitionId] = {
        ...definitions[top.definitionId]!,
        text: { hp: 60, stage: 'Basic' },
      };
    }
    const untold = { ...view, definitions };
    const window = await render({ ...stateFor(blue), view: untold }, callbacks);
    expect(window.textContent).toContain('No Abilities or attacks');
    const plain = window.querySelector<HTMLButtonElement>(
      '.pokemon-window__plain-attack [data-pokemon-window-move="attack"]'
    )!;
    expect(plain.textContent).toBe('Attack');
    plain.click();
    const top =
      untold.stacks[untold.boards[blue]!.activeStackId!]!.evolutionCards.at(
        -1
      )!;
    expect(callbacks.invokeWindowAction).toHaveBeenCalledWith({
      kind: 'context',
      action: 'declareAttack',
      cardId: top.id,
    });
    expect(callbacks.dismiss).toHaveBeenCalledWith('preview');
    // With its attacks known, each has its own button and no plain one.
    const known = await render(stateFor(blue), actions());
    expect(known.querySelector('.pokemon-window__plain-attack')).toBeNull();
    // Across the table, where this player doesn't play it, none.
    const theirs = await render({ ...stateFor(red), view: untold }, actions());
    expect(theirs.querySelector('.pokemon-window__plain-attack')).toBeNull();
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

  it('steps damage from a number just typed, before the table has it', async () => {
    const callbacks = actions();
    const window = await render(stateFor(blue), callbacks);
    const stack = view.stacks[view.boards[blue]!.activeStackId!]!;
    const input = window.querySelector<HTMLInputElement>(
      '.pokemon-window__damage-input'
    )!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, '80');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const more = window.querySelector<HTMLButtonElement>(
      '[aria-label="10 more damage"]'
    )!;
    // Pressing + takes the focus from the number (which sets it), then
    // steps on from it; the table still shows the old damage.
    await act(async () => {
      input.blur();
      more.click();
    });
    const sent = callbacks.invokeWindowAction.mock.calls.map(
      ([request]) => (request as { value?: string }).value
    );
    expect(sent).toEqual(['80', '90']);
    expect(stack.damage ?? 0).not.toBe(80);
  });

  it('reads a card printed in pieces whole: each move once, the others as its pieces', async () => {
    const stackId = base.boards[blue]!.activeStackId!;
    const stack = base.stacks[stackId]!;
    const known = stack.evolutionCards.filter((card) => card.kind === 'known');
    if (known.length < 2) return;
    const definitions = { ...base.definitions };
    const shared = { name: 'Thunderbolt', cost: [], damage: '90' } as const;
    known.forEach((card, part) => {
      if (card.kind !== 'known') return;
      definitions[card.definitionId] = {
        ...definitions[card.definitionId]!,
        presentation: {
          readingQuarterTurns: 0,
          join: {
            key: 'union',
            columns: 2,
            rows: 2,
            part: part as 0 | 1 | 2 | 3,
          },
        },
        text:
          part === 0
            ? { attacks: [shared] }
            : {
                abilities: [{ name: 'Piece Power', kind: 'Ability', text: '' }],
                attacks: [shared],
              },
      };
    });
    const pieced = { ...base, definitions };
    const piecedScene = createBoardSceneForViewport(pieced, {
      geometryVersion: 1,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      bottomPlayerId: blue,
      splitRatio: 0.5,
    });
    await render(
      stateFor(blue, { view: pieced, scene: piecedScene }),
      actions()
    );
    // Shown whole first; Details opens its window.
    const details = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Details'
    )!;
    await act(async () => details.click());
    const window = host.querySelector<HTMLElement>('[data-pokemon-window]')!;
    expect(
      window.querySelectorAll('.pokemon-window__move.is-attack')
    ).toHaveLength(1);
    expect(window.textContent).toContain('Piece Power');
    expect(
      window.querySelector('.pokemon-window__stages .pokemon-window__label')
        ?.textContent
    ).toBe('Pieces');
  });

  it('gives the focus back to what opened it, after a card read large and Back', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const callbacks = actions();
    const window = await render(stateFor(blue), callbacks);
    await act(async () =>
      window
        .querySelector<HTMLButtonElement>(
          '.pokemon-window__hero [data-stack-preview-card-id]'
        )!
        .click()
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-preview-back]')!.click()
    );
    await render(
      stateFor(blue, {
        overlays: { contextMenuCardId: null, preview: null, input: null },
      }),
      callbacks
    );
    await act(async () => Promise.resolve());
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps the window open for an Esc that ends an input method’s composing', async () => {
    const callbacks = actions();
    const window = await render(stateFor(blue), callbacks);
    const input = window.querySelector<HTMLInputElement>(
      '.pokemon-window__damage-input'
    )!;
    input.focus();
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          isComposing: true,
          bubbles: true,
          cancelable: true,
        })
      )
    );
    expect(callbacks.dismiss).not.toHaveBeenCalled();
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
      )
    );
    expect(callbacks.dismiss).toHaveBeenCalledWith('preview');
  });

  it('keeps a step asked for when the answer to an earlier one comes first', async () => {
    const callbacks = actions();
    const window = await render(stateFor(blue), callbacks);
    const stackId = view.boards[blue]!.activeStackId!;
    const start = view.stacks[stackId]!.damage ?? 0;
    const more = () =>
      host.querySelector<HTMLButtonElement>('[aria-label="10 more damage"]')!;
    await act(async () => more().click());
    await act(async () => more().click());
    // The table answers the first step only.
    const answered: MatchViewState = {
      ...view,
      stacks: {
        ...view.stacks,
        [stackId]: { ...view.stacks[stackId]!, damage: start + 10 },
      },
    };
    await render(stateFor(blue, { view: answered }), callbacks);
    await act(async () => more().click());
    expect(
      callbacks.invokeWindowAction.mock.calls.map(
        ([request]) => (request as { value?: string }).value
      )
    ).toEqual([String(start + 10), String(start + 20), String(start + 30)]);
    expect(window).not.toBeNull();
  });

  it('sets a damage typed before a press outside puts the window away', async () => {
    const callbacks = actions();
    const window = await render(stateFor(blue), callbacks);
    const input = window.querySelector<HTMLInputElement>(
      '.pokemon-window__damage-input'
    )!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, '80');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const outside = document.createElement('div');
    document.body.append(outside);
    await act(async () =>
      outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    );
    expect(callbacks.invokeWindowAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'setDamage', value: '80' })
    );
    expect(callbacks.dismiss).toHaveBeenCalledWith('preview');
    outside.remove();
  });

  it('lets a step that never shows go after a while, and steps from the damage shown', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const callbacks = actions();
    await render(stateFor(blue), callbacks);
    const stackId = view.boards[blue]!.activeStackId!;
    const start = view.stacks[stackId]!.damage ?? 0;
    const more = () =>
      host.querySelector<HTMLButtonElement>('[aria-label="10 more damage"]')!;
    await act(async () => more().click());
    // Refused, and someone else sets 170 meanwhile.
    const elsewhere: MatchViewState = {
      ...view,
      stacks: {
        ...view.stacks,
        [stackId]: { ...view.stacks[stackId]!, damage: 170 },
      },
    };
    await render(stateFor(blue, { view: elsewhere }), callbacks);
    now.mockReturnValue(10_000);
    await act(async () => more().click());
    expect(
      callbacks.invokeWindowAction.mock.calls.map(
        ([request]) => (request as { value?: string }).value
      )
    ).toEqual([String(start + 10), '180']);
    now.mockRestore();
  });

  it('lets a step go once the table shows it: a change straight after is the base', async () => {
    const callbacks = actions();
    await render(stateFor(blue), callbacks);
    const stackId = view.boards[blue]!.activeStackId!;
    const start = view.stacks[stackId]!.damage ?? 0;
    const at = (damage: number): MatchViewState => ({
      ...view,
      stacks: {
        ...view.stacks,
        [stackId]: { ...view.stacks[stackId]!, damage },
      },
    });
    const more = () =>
      host.querySelector<HTMLButtonElement>('[aria-label="10 more damage"]')!;
    await act(async () => more().click());
    await render(stateFor(blue, { view: at(start + 10) }), callbacks);
    await render(stateFor(blue, { view: at(170) }), callbacks);
    await act(async () => more().click());
    expect(callbacks.invokeWindowAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'setDamage', value: '180' })
    );
  });

  it('sets a damage typed before a card is read large from the window', async () => {
    const callbacks = actions();
    const window = await render(stateFor(blue), callbacks);
    const input = window.querySelector<HTMLInputElement>(
      '.pokemon-window__damage-input'
    )!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, '80');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      window
        .querySelector<HTMLButtonElement>(
          '.pokemon-window__hero [data-stack-preview-card-id]'
        )!
        .click()
    );
    expect(callbacks.invokeWindowAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'setDamage', value: '80' })
    );
    expect(host.querySelector('[data-preview-kind="card"]')).not.toBeNull();
  });

  it('reads a BREAK made by hand by its layout and stage, whatever its name', async () => {
    const stackId = base.boards[blue]!.activeStackId!;
    const stack = base.stacks[stackId]!;
    const [lower, top] = [
      stack.evolutionCards.at(-2),
      stack.evolutionCards.at(-1),
    ];
    if (lower?.kind !== 'known' || top?.kind !== 'known') return;
    const definitions = { ...base.definitions };
    definitions[lower.definitionId] = {
      ...definitions[lower.definitionId]!,
      text: {
        attacks: [{ name: 'Base Move', cost: [], damage: '10' }],
        retreat: 2,
      },
    };
    definitions[top.definitionId] = {
      ...definitions[top.definitionId]!,
      name: 'Homebrew',
      presentation: { readingQuarterTurns: 1, overlay: 'upper-half' },
      text: {
        hp: 160,
        stage: 'BREAK',
        attacks: [{ name: 'Broken Move', cost: [], damage: '90' }],
      },
    };
    const broken = { ...base, definitions };
    const brokenScene = createBoardSceneForViewport(broken, {
      geometryVersion: 1,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      bottomPlayerId: blue,
      splitRatio: 0.5,
    });
    await render(
      stateFor(blue, { view: broken, scene: brokenScene }),
      actions()
    );
    let window = host.querySelector<HTMLElement>('[data-pokemon-window]');
    if (!window) {
      const details = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Details'
      )!;
      await act(async () => details.click());
      window = host.querySelector<HTMLElement>('[data-pokemon-window]')!;
    }
    expect(window.textContent).toContain('Broken Move');
    expect(window.textContent).toContain('Base Move');
    expect(
      window
        .querySelectorAll('.pokemon-window__stats div')[2]!
        .querySelectorAll('.energy-symbol')
    ).toHaveLength(2);
  });

  it('leaves an input method’s Enter and arrows in the damage field to it', async () => {
    const callbacks = actions();
    const window = await render(stateFor(blue), callbacks);
    const input = window.querySelector<HTMLInputElement>(
      '.pokemon-window__damage-input'
    )!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, '80');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (const init of [
      { key: 'Enter', isComposing: true },
      { key: 'ArrowUp', isComposing: true },
      { key: 'Enter', keyCode: 229 },
    ])
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            ...init,
            bubbles: true,
            cancelable: true,
          })
        )
      );
    expect(callbacks.invokeWindowAction).not.toHaveBeenCalled();
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      )
    );
    expect(callbacks.invokeWindowAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'setDamage', value: '80' })
    );
  });
});
