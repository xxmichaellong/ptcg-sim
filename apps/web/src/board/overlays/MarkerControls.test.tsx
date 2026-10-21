// @vitest-environment happy-dom

import { asViewCardId } from '@ptcgsim/game-core';
import type { MarkerSceneNode } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardSessionControllerState } from '../BoardSessionController.js';
import {
  MarkerControls,
  placeBeside,
  type MarkerControlsActions,
} from './MarkerControls.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cardId = asViewCardId('active-top');

const marker = (
  kind: MarkerSceneNode['kind'],
  value: string
): MarkerSceneNode => ({
  id: `${String(cardId)}:${kind}`,
  parentCardId: cardId,
  side: 'local',
  kind,
  presentation: 'legacyActiveQ0',
  value,
  bounds: { x: 400, y: 300, width: 30, height: 30 },
  zIndex: 200,
  label: `${kind}: ${value}`,
});

const stateWith = (
  node: MarkerSceneNode,
  rotationQuarterTurns = 0
): BoardSessionControllerState =>
  ({
    scene: {
      viewport: { width: 1000, height: 700 },
      markers: [node],
      cards: [
        {
          id: cardId,
          bounds: { x: 380, y: 280, width: 90, height: 126 },
          rotationQuarterTurns,
        },
      ],
    },
    overlays: {
      contextMenuCardId: null,
      preview: null,
      input: null,
      marker: { cardId, kind: node.kind },
    },
  }) as unknown as BoardSessionControllerState;

describe('MarkerControls', () => {
  let host: HTMLDivElement;
  let root: Root;
  let actions: {
    [Key in keyof MarkerControlsActions]: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    actions = {
      dismiss: vi.fn(),
      submitDamageInput: vi.fn(),
      submitSpecialConditionInput: vi.fn(),
      invokeContextAction: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (node: MarkerSceneNode, rotationQuarterTurns = 0) =>
    act(() =>
      root.render(
        <MarkerControls
          state={stateWith(node, rotationQuarterTurns)}
          actions={actions as unknown as MarkerControlsActions}
        />
      )
    );
  const button = (label: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  it('sits beside a sideways card as it is painted, not its upright box', () => {
    render(marker('damage', '60'));
    const panel = () =>
      host.querySelector<HTMLElement>('.ptcgsim-marker-controls')!;
    expect(panel().style.left).toBe('480px');
    // Turned a quarter, the 90 x 126 card is 126 wide about the same centre.
    render(marker('damage', '60'), 1);
    expect(panel().style.left).toBe('498px');
  });

  const field = () =>
    host.querySelector<HTMLInputElement>('.ptcgsim-marker-controls__value')!;
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(field(), value);
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
  const press = (key: string) =>
    act(() => {
      field().dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      );
    });

  it('steps damage by 10 either way and takes it off', () => {
    render(marker('damage', '60'));
    expect(field().value).toBe('60');
    act(() => button('10 more damage').click());
    act(() => button('10 less damage').click());
    act(() => button('Remove all damage').click());
    expect(actions.submitDamageInput.mock.calls).toEqual([
      [cardId, '70'],
      [cardId, '50'],
      [cardId, ''],
    ]);
    // Taking it all off puts them away, as the counter goes.
    expect(actions.dismiss).toHaveBeenCalledExactlyOnceWith('marker');
  });

  it('takes damage typed into its number: Enter sets it and puts them away', () => {
    render(marker('damage', '60'));
    expect(field().getAttribute('aria-label')).toBe('Damage counter');
    type('120');
    expect(field().value).toBe('120');
    press('Enter');
    expect(actions.submitDamageInput.mock.calls).toEqual([[cardId, '120']]);
    expect(actions.dismiss).toHaveBeenCalledExactlyOnceWith('marker');
  });

  it('says what the number takes when something else is typed, and sets nothing', () => {
    render(marker('damage', '60'));
    type('70.5');
    press('Enter');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(
      host.querySelector('.ptcgsim-marker-controls__hint')?.textContent
    ).toBe('A whole number, up to 9990');
    expect(actions.submitDamageInput).not.toHaveBeenCalled();
    expect(actions.dismiss).not.toHaveBeenCalled();
    type('70');
    expect(host.querySelector('.ptcgsim-marker-controls__hint')).toBeNull();
    press('Enter');
    expect(actions.submitDamageInput.mock.calls).toEqual([[cardId, '70']]);
  });

  it('steps with the arrow keys, and from what is typed', () => {
    render(marker('damage', '60'));
    press('ArrowUp');
    press('ArrowDown');
    type('100');
    act(() => button('10 more damage').click());
    expect(actions.submitDamageInput.mock.calls).toEqual([
      [cardId, '70'],
      [cardId, '50'],
      [cardId, '110'],
    ]);
  });

  it('sets what was typed when a press elsewhere puts them away', () => {
    render(marker('damage', '60'));
    type('30');
    act(() => {
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true })
      );
    });
    expect(actions.submitDamageInput.mock.calls).toEqual([[cardId, '30']]);
    expect(actions.dismiss).toHaveBeenCalledWith('marker');
  });

  it('keeps typed keys from the table; Escape puts them away', () => {
    render(marker('damage', '60'));
    const heard: string[] = [];
    const listen = (event: KeyboardEvent) => heard.push(event.key);
    document.addEventListener('keydown', listen);
    press('2');
    expect(heard).toEqual([]);
    expect(actions.dismiss).not.toHaveBeenCalled();
    press('Escape');
    document.removeEventListener('keydown', listen);
    expect(actions.dismiss).toHaveBeenCalledWith('marker');
  });

  it('never steps damage below nothing or past the limit', () => {
    render(marker('damage', '10'));
    act(() => button('10 less damage').click());
    render(marker('damage', '9990'));
    act(() => button('10 more damage').click());
    expect(actions.submitDamageInput.mock.calls).toEqual([
      [cardId, ''],
      [cardId, '9990'],
    ]);
  });

  it('changes or removes the Special Condition, showing the current one', () => {
    render(marker('specialCondition', 'P'));
    expect(button('Poisoned').getAttribute('aria-pressed')).toBe('true');
    expect(button('Burned').getAttribute('aria-pressed')).toBe('false');
    act(() => button('Burned').click());
    act(() => button('Remove the Special Condition').click());
    // Written as v1's letters, which the keys' cycle reads too.
    expect(actions.submitSpecialConditionInput.mock.calls).toEqual([
      [cardId, 'B'],
      [cardId, ''],
    ]);
  });

  it('takes the Ability tick off, and goes on Escape', () => {
    render(marker('abilityUsed', 'used'));
    act(() =>
      host
        .querySelector<HTMLButtonElement>('.ptcgsim-marker-controls__button')!
        .click()
    );
    expect(actions.invokeContextAction).toHaveBeenCalledWith(
      'toggleAbility',
      cardId
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(actions.dismiss).toHaveBeenCalledWith('marker');
  });
});

describe('placeBeside', () => {
  const card = { x: 400, y: 300, width: 90, height: 126 };
  const marker = { x: 450, y: 310, width: 30, height: 30 };
  const size = { width: 200, height: 40 };

  it('sits right of the card, level with the marker', () => {
    expect(
      placeBeside(card, marker, size, { width: 1000, height: 700 })
    ).toEqual({ left: 500, top: 305, side: 'right' });
  });

  it('goes left of the card where the right has no room', () => {
    expect(
      placeBeside(card, marker, size, { width: 700, height: 700 })
    ).toEqual({ left: 190, top: 305, side: 'left' });
  });

  it('goes above the card on a table too narrow for either side, else below, inside the table', () => {
    const narrow = { width: 390, height: 700 };
    const onLeft = { ...card, x: 150 };
    expect(placeBeside(onLeft, marker, size, narrow)).toEqual({
      left: 95,
      top: 250,
      side: 'above',
    });
    expect(placeBeside({ ...onLeft, y: 20 }, marker, size, narrow)).toEqual({
      left: 95,
      top: 156,
      side: 'below',
    });
    expect(
      placeBeside({ ...onLeft, x: 0 }, marker, size, {
        width: 250,
        height: 700,
      }).left
    ).toBe(8);
  });
});
