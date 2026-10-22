import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { afterEach, describe, expect, it } from 'vitest';

import { wordName } from './DeckHome.js';

const locale = i18n.locale;
afterEach(() => i18n.activate(locale));

describe('a deck name with a finish', () => {
  it('says the finish in the page’s language, and leaves a plain name as it is', () => {
    expect(wordName('Gardevoir ex')).toBe('Gardevoir ex');
    expect(wordName('Gardevoir ex — 1st of 67')).toBe(
      'Gardevoir ex — 1st of 67'
    );
    // The finish's own message, said another way.
    const finish = msg({
      comment:
        "A deck's best finish in a tournament: its place among the players, as 1st of 285",
      message: `{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} of {players}`,
    });
    i18n.load('xx', { [finish.id!]: '{place}. von {players}' });
    i18n.activate('xx');
    expect(wordName('Gardevoir ex — 1st of 67')).toBe(
      'Gardevoir ex — 1. von 67'
    );
    // A copy's name goes on after the finish, kept as it is.
    expect(wordName('Gardevoir ex — 1st of 67 (copy)')).toBe(
      'Gardevoir ex — 1. von 67 (copy)'
    );
  });
});
