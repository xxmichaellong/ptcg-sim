// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { installFocusFrom, keyIntent } from './focus-from.js';

const key = (
  target: EventTarget,
  init: KeyboardEventInit & { readonly key: string }
): void => {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  );
};

describe('focus-from', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    document.body.replaceChildren();
  });

  it('tells keys that move the focus from keys that act', () => {
    const card = document.createElement('button');
    card.className = 'ptcgsim-card';
    const button = document.createElement('button');
    document.body.append(card, button);
    const at = (target: Element, name: string, shiftKey = false) =>
      keyIntent({ key: name, shiftKey, target });
    for (const name of ['Tab', 'F6', 'ContextMenu'])
      expect(at(button, name)).toBe('moves');
    expect(at(button, 'F10', true)).toBe('moves');
    for (const name of ['ArrowDown', 'Home', 'End', 'PageUp'])
      expect(at(button, name)).toBe('steers');
    // A selected card's hotkeys: to the Bench, a digit's damage, and the
    // arrows that send it to the deck.
    for (const name of ['b', '3', 'Enter', ' ', 'Escape', 'F10'])
      expect(at(card, name)).toBe('acts');
    for (const name of ['ArrowUp', 'ArrowDown', 'ArrowRight'])
      expect(at(card, name)).toBe('acts');
    expect(at(card, 'Tab')).toBe('moves');
  });

  it('marks the page by how the focus last moved', () => {
    let clock = 1_000;
    uninstall = installFocusFrom(document, () => clock);
    const root = document.documentElement;
    const card = document.createElement('button');
    card.className = 'ptcgsim-card';
    const rail = document.createElement('button');
    const next = document.createElement('button');
    document.body.append(card, rail, next);
    expect(root.dataset.focusFrom).toBeUndefined();
    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    card.focus();
    expect(root.dataset.focusFrom).toBe('pointer');
    // Hotkeys after the click: still the pointer's, so no ring.
    key(card, { key: 'b' });
    key(card, { key: 'ArrowUp' });
    expect(root.dataset.focusFrom).toBe('pointer');
    // An arrow from a clicked rail button that only acts (it sends the
    // selected card to the deck) leaves the focus, and the pointer's mark.
    rail.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    rail.focus();
    key(rail, { key: 'ArrowRight' });
    clock += 1_000;
    next.focus();
    expect(root.dataset.focusFrom).toBe('pointer');
    // An arrow that moves the focus along a toolbar: the keyboard's.
    rail.focus();
    key(rail, { key: 'ArrowRight' });
    next.focus();
    expect(root.dataset.focusFrom).toBe('keyboard');
    // Tab moves it outright. A handler that stops the key does not hide it.
    rail.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    card.addEventListener('keydown', (event) => event.stopPropagation());
    key(card, { key: 'Tab' });
    expect(root.dataset.focusFrom).toBe('keyboard');
    uninstall();
    uninstall = undefined;
    expect(root.dataset.focusFrom).toBeUndefined();
  });
});
