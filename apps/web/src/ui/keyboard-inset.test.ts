import { describe, expect, it } from 'vitest';

import { keyboardInsetOf } from './keyboard-inset.js';

describe('keyboardInsetOf', () => {
  it('is the page left under a keyboard laid over its foot', () => {
    expect(keyboardInsetOf(844, { height: 508, offsetTop: 0, scale: 1 })).toBe(
      336
    );
    // Safari scrolls the page to the field: the keyboard covers the rest.
    expect(
      keyboardInsetOf(844, { height: 508, offsetTop: 120, scale: 1 })
    ).toBe(216);
  });

  it('is nothing without a keyboard, a visual viewport, or while zoomed in', () => {
    expect(keyboardInsetOf(844, { height: 844, offsetTop: 0, scale: 1 })).toBe(
      0
    );
    expect(keyboardInsetOf(844, undefined)).toBe(0);
    expect(keyboardInsetOf(844, { height: 422, offsetTop: 0, scale: 2 })).toBe(
      0
    );
  });
});
