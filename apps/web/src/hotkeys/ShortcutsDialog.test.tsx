// @vitest-environment happy-dom

import { i18n } from '@lingui/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferenceStore } from '../preferences/preference-store.js';
import { HOTKEY_GROUPS } from './hotkey-catalogue.js';
import {
  HOTKEY_PREFERENCES,
  SHORTCUTS_DIALOG_PREFERENCES,
} from './hotkey-preferences.js';
import { ShortcutsDialog } from './ShortcutsDialog.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Lets Base UI's transitions and focus moves settle. */
const settle = async (rounds = 4): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

const row = (id: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-action="${id}"]`);
  if (!element) throw new Error(`No row for ${id}`);
  return element;
};

const keyButton = (id: string): HTMLButtonElement =>
  row(id).querySelector<HTMLButtonElement>('button.ptcgsim-shortcut-key')!;

const keycaps = (id: string): string[] =>
  [...row(id).querySelectorAll('.ptcgsim-keycap')].map(
    (cap) => cap.textContent ?? ''
  );

const press = async (target: Element, init: KeyboardEventInit) => {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    );
  });
};

const click = async (target: Element) => {
  await act(async () => {
    (target as HTMLElement).click();
  });
};

describe('ShortcutsDialog', () => {
  let host: HTMLDivElement;
  let root: Root;
  let store: PreferenceStore;
  const onOpenChange = vi.fn();

  const render = async (mode: 'card' | 'table' = 'card') => {
    await act(async () => {
      root.render(
        <ShortcutsDialog
          open
          mode={mode}
          onOpenChange={onOpenChange}
          store={store}
          platform="other"
        />
      );
    });
    await settle();
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    store = new PreferenceStore();
    onOpenChange.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('opens on the keys for what is selected, its keyboard map shown when asked for', async () => {
    await render('card');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(keycaps('card.toHand')).toEqual(['H']);
    expect(keycaps('card.addStadiumPiece')).toEqual(['Shift', 'G']);
    expect(document.querySelector('[data-action="deck.shuffle"]')).toBeNull();
    // Number keys and Esc are drawn but cannot be changed.
    expect(
      row('card.addDamage').querySelector('button.ptcgsim-shortcut-key')
    ).toBeNull();
    const mapKeys = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.ptcgsim-map-key[data-group]'
        ),
      ].map((key) => key.textContent);
    // The map is hidden until asked for, and stays as it was left.
    expect(mapKeys()).toEqual([]);
    await click(
      [...document.querySelectorAll('button')].find(
        (button) => button.textContent === 'Show keyboard'
      )!
    );
    expect(mapKeys()).toContain('HHand');
    expect(mapKeys()).toContain('5+50');
    expect(store.get(SHORTCUTS_DIALOG_PREFERENCES)).toEqual({
      showKeyboard: true,
    });

    await click(
      [...document.querySelectorAll('[role="radio"]')].find(
        (radio) => radio.textContent === 'Nothing selected'
      )!
    );
    expect(document.querySelector('[data-action="card.toHand"]')).toBeNull();
    expect(keycaps('deck.shuffle')).toEqual(['S']);
  });

  it('changes a shortcut with a click and a key press, and saves it', async () => {
    await render();
    await click(keyButton('card.toHand'));
    expect(keyButton('card.toHand').dataset.recording).toBe('true');
    await press(keyButton('card.toHand'), { key: 'x', code: 'KeyX' });
    expect(keycaps('card.toHand')).toEqual(['X']);
    expect(row('card.toHand').dataset.custom).toBe('true');
    expect(store.get(HOTKEY_PREFERENCES)).toEqual({ 'card.toHand': 'x' });

    // Back to v1's key with the row's reset button.
    await click(
      row('card.toHand').querySelector('.ptcgsim-shortcut-row__reset')!
    );
    expect(keycaps('card.toHand')).toEqual(['H']);
    expect(store.get(HOTKEY_PREFERENCES)).toEqual({});
  });

  it('asks before taking a key another shortcut uses, and can swap them', async () => {
    await render();
    await click(keyButton('card.toHand'));
    await press(keyButton('card.toHand'), { key: 'd', code: 'KeyD' });
    const conflict = row('card.toHand').querySelector(
      '.ptcgsim-shortcut-conflict'
    );
    expect(conflict?.textContent).toContain('already does To discard');
    expect(store.get(HOTKEY_PREFERENCES)).toEqual({});
    await click(
      [...conflict!.querySelectorAll('button')].find(
        (button) => button.textContent === 'Swap keys'
      )!
    );
    expect(keycaps('card.toHand')).toEqual(['D']);
    expect(keycaps('card.toDiscard')).toEqual(['H']);
    expect(store.get(HOTKEY_PREFERENCES)).toEqual({
      'card.toHand': 'd',
      'card.toDiscard': 'h',
    });
  });

  it('refuses fixed keys, and Esc cancels the choice without closing', async () => {
    await render();
    await click(keyButton('card.toBench'));
    await press(keyButton('card.toBench'), { key: '5', code: 'Digit5' });
    expect(row('card.toBench').textContent).toContain(
      '5 is reserved for add damage'
    );
    expect(keyButton('card.toBench').dataset.recording).toBe('true');
    await press(keyButton('card.toBench'), { key: 'Escape', code: 'Escape' });
    await settle();
    expect(keyButton('card.toBench').dataset.recording).toBeUndefined();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(keycaps('card.toBench')).toEqual(['B']);
  });

  it('finds shortcuts by name or key across both lists', async () => {
    await render();
    const search = document.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!;
      setValue.call(search, 'alt d');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const shown = [
      ...document.querySelectorAll<HTMLElement>('[data-action]'),
    ].map((element) => element.dataset.action);
    expect(shown).toEqual(['hand.discardAndDraw']);
    expect(row('hand.discardAndDraw').textContent).toContain(
      'Nothing selected'
    );
  });

  it('finds the board’s keys by the board’s name inside their group’s', async () => {
    // Japanese writes "your board" as one word: 自分の盤面.
    const board = HOTKEY_GROUPS.find((group) => group.id === 'board')!;
    i18n.load('xx', {
      [board.title.id!]: '自分の盤面',
      [board.place!.id!]: '盤面',
    });
    i18n.activate('xx');
    try {
      await render();
      const search = document.querySelector<HTMLInputElement>(
        'input[type="search"]'
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )!.set!.call(search, '盤面');
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const shown = [
        ...document.querySelectorAll<HTMLElement>('[data-action]'),
      ].map((element) => element.dataset.action);
      expect(shown).toEqual(
        expect.arrayContaining([
          'board.discardAll',
          'board.moveAllToHand',
          'board.shuffleAllIntoDeck',
        ])
      );
    } finally {
      i18n.activate('en');
    }
  });

  it('puts every shortcut back after a second confirming click', async () => {
    store.set(HOTKEY_PREFERENCES, { 'card.toHand': 'x', 'deck.shuffle': null });
    await render();
    expect(document.body.textContent).toContain('2 shortcuts changed');
    const reset = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reset to defaults'
    )!;
    await click(reset);
    expect(store.get(HOTKEY_PREFERENCES)).toEqual({
      'card.toHand': 'x',
      'deck.shuffle': null,
    });
    await click(
      [...document.querySelectorAll('button')].find(
        (button) => button.textContent === 'Reset all'
      )!
    );
    expect(store.get(HOTKEY_PREFERENCES)).toEqual({});
    expect(keycaps('card.toHand')).toEqual(['H']);
  });
});
