// @vitest-environment happy-dom

import { asViewCardId } from '@ptcgsim/game-core';
import type { MarkerSceneNode } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardSessionControllerState } from '../BoardSessionController.js';
import {
  MarkerControls,
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

const stateWith = (node: MarkerSceneNode): BoardSessionControllerState =>
  ({
    scene: { viewport: { width: 1000, height: 700 }, markers: [node] },
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

  const render = (node: MarkerSceneNode) =>
    act(() =>
      root.render(
        <MarkerControls
          state={stateWith(node)}
          actions={actions as unknown as MarkerControlsActions}
        />
      )
    );
  const button = (label: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  it('steps damage by 10 either way and takes it off', () => {
    render(marker('damage', '60'));
    expect(host.querySelector('output')?.textContent).toBe('60');
    act(() => button('10 more damage').click());
    act(() => button('10 less damage').click());
    act(() => button('Remove all damage').click());
    expect(actions.submitDamageInput.mock.calls).toEqual([
      [cardId, '70'],
      [cardId, '50'],
      [cardId, ''],
    ]);
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
