import { describe, expect, it } from 'vitest';

import { LOCALES, textDirection } from './locales.js';

describe('textDirection', () => {
  it('writes Arabic right to left and every other language left to right', () => {
    expect(
      LOCALES.filter(({ locale }) => textDirection(locale) === 'rtl').map(
        ({ locale }) => locale
      )
    ).toEqual(['ar']);
  });

  it('reads an unknown tag as left to right', () => {
    expect(textDirection('xx')).toBe('ltr');
  });
});
