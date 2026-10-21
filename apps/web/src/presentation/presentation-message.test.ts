import { i18n } from '@lingui/core';
import { afterEach, describe, expect, it } from 'vitest';

import { SOURCE_LOCALE } from '../i18n/locales.js';
import { presentationText } from './presentation-message.js';

const drew = {
  id: 'test.drew',
  message: '{name} drew {count} cards',
  values: { name: 'Blue', count: 2 },
};

describe('presentationText', () => {
  afterEach(() => {
    i18n.loadAndActivate({ locale: SOURCE_LOCALE, messages: {} });
  });

  it('puts the names in as they are, left to right', () => {
    expect(presentationText(drew)).toBe('Blue drew 2 cards');
  });

  it('sets a name apart in a right-to-left language, so it keeps its own order', () => {
    i18n.loadAndActivate({
      locale: 'ar',
      messages: { 'test.drew': '{name} سحب {count} بطاقات' },
    });
    expect(presentationText(drew)).toBe('⁨Blue⁩ سحب 2 بطاقات');
  });
});
