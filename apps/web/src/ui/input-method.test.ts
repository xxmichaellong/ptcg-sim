import { describe, expect, it } from 'vitest';

import { isInputMethodKey } from './input-method.js';

describe("an input method's keys", () => {
  it('are every key while it composes, and the Enter or Esc Safari ends one with', () => {
    const key = (key: string, isComposing: boolean, keyCode: number) =>
      isInputMethodKey({ key, isComposing, keyCode });
    expect(key('a', true, 229)).toBe(true);
    // Safari: compositionend first, then the key that ended it.
    expect(key('Enter', false, 229)).toBe(true);
    expect(key('Escape', false, 229)).toBe(true);
    expect(key('Enter', false, 13)).toBe(false);
    expect(key('Escape', false, 27)).toBe(false);
    // Android's keyboards send 229 for an ordinary key.
    expect(key('Unidentified', false, 229)).toBe(false);
  });
});
