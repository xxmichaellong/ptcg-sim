import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  catalogProblems,
  looksGarbled,
  parseCatalog,
  readCatalog,
  serializeCatalog,
  translationProblem,
} from './i18n-catalog.js';
import { parseReply, systemPrompt, userPrompt } from './translate.js';
import { LANGUAGE_GUIDES } from './translate-glossary.js';
import { LOCALES } from '../apps/web/src/i18n/locales.js';

describe('translationProblem', () => {
  it('accepts a translation that keeps the shape', () => {
    assert.equal(
      translationProblem('{name} drew a card.', '{name} zog eine Karte.', 'de'),
      undefined
    );
    assert.equal(
      translationProblem(
        '{count, plural, one {# card} other {# cards}}',
        '{count, plural, one {# karta} few {# karty} many {# kart} other {# karty}}',
        'pl'
      ),
      undefined
    );
    assert.equal(
      translationProblem(
        'Press <0>Set up</0>.',
        '<0>準備</0>を押します。',
        'ja'
      ),
      undefined
    );
    // A language without ordinals may say the bare number.
    assert.equal(
      translationProblem(
        '{place, selectordinal, one {#st} other {#th}} of {players}',
        '{players}人中{place}位',
        'ja'
      ),
      undefined
    );
  });

  it('rejects missing, renamed or added placeholders', () => {
    assert.equal(translationProblem('Hi', '', 'de'), 'missing');
    assert.equal(
      translationProblem('{name} drew', '{nom} a pioché', 'fr'),
      'lost {name}'
    );
    assert.equal(
      translationProblem('Drew', '{name} zog', 'de'),
      'added {name}'
    );
    assert.equal(
      translationProblem(
        '{count} cards',
        '{count, plural, other {# Karten}}',
        'de'
      ),
      '{count} became plural'
    );
  });

  it('rejects a plural without other, changed select cases and lost tags', () => {
    assert.equal(
      translationProblem(
        '{count, plural, one {# card} other {# cards}}',
        '{count, plural, one {# carta}}',
        'es'
      ),
      'a plural without "other" ({count})'
    );
    assert.equal(
      translationProblem(
        '{side, select, heads {Heads} other {Tails}}',
        '{side, select, cara {Cara} other {Cruz}}',
        'es'
      ),
      'changed the cases of {side}'
    );
    assert.equal(
      translationProblem('Press <0>Set up</0>.', 'Drücke Aufbauen.', 'de'),
      'changed the tags'
    );
    assert.match(
      translationProblem('A {b', 'A {b', 'de') ?? '',
      /English does not parse/u
    );
  });

  it('rejects text in the wrong script or mis-encoded', () => {
    assert.equal(looksGarbled('山札を切る', 'ja'), false);
    assert.equal(looksGarbled('Shuffle', 'ja', 'Shuffle the deck'), false);
    assert.equal(looksGarbled('Mélanger', 'ja'), true);
    assert.equal(looksGarbled('Spielerâ€™s Zug', 'de'), true);
    assert.equal(looksGarbled('Ã©tÃ©', 'fr'), true);
    assert.equal(looksGarbled('Зона', 'sr'), false);
    assert.equal(looksGarbled('Pokémon النشط', 'ar'), false);
    // Latin inside an Arabic or Cyrillic word, or a Latin word the English
    // doesn't have; names the English has stay, declined too.
    assert.equal(looksGarbled('يخلط دecksك', 'ar', 'shuffles your deck'), true);
    assert.equal(looksGarbled('يخلط deckك', 'ar', 'shuffles your deck'), true);
    // An ending glued to Pokémon, or across a tag, is one too.
    assert.equal(
      looksGarbled('اسحب Pokémonك من يدك', 'ar', 'Drag your Pokémon'),
      true
    );
    assert.equal(
      looksGarbled('اسحب <0>deck</0>ك', 'ar', 'Drag your <0>deck</0>'),
      true
    );
    assert.equal(
      looksGarbled('Перетащи Pokémonа из руки', 'ru', 'Drag a Pokémon'),
      true
    );
    assert.equal(
      looksGarbled('Перетащи Pokémon из руки', 'ru', 'Drag a Pokémon'),
      false
    );
    // A word only a case of the English has is a word of it too.
    assert.equal(
      looksGarbled(
        '{kind, select, gx {маркер GX} other {маркер VSTAR}}',
        'ru',
        '{kind, select, gx {GX} other {VSTAR}} marker'
      ),
      false
    );
    assert.equal(looksGarbled('Започни potez', 'sr', 'Start the turn'), true);
    assert.equal(
      looksGarbled(
        'Изабери <0>Marker оштећења</0>.',
        'sr',
        'Choose <0>Damage counter</0>.'
      ),
      true
    );
    assert.equal(
      looksGarbled(
        'Притисни <0>Esc</0> да затвориш.',
        'sr',
        'Press <0>Esc</0> to close.'
      ),
      false
    );
    assert.equal(looksGarbled('из Guelpha', 'sr', 'from Guelph'), false);
    assert.equal(
      looksGarbled('بطاقات Trainer الأخرى', 'ar', 'Other Trainers'),
      false
    );
    assert.equal(
      looksGarbled('بطاقات TCG وPocket', 'ar', 'TCG and Pocket cards'),
      false
    );
    assert.equal(
      looksGarbled(
        '{source, select, active {Pokémon النشط} other {المجموعة}}',
        'ar',
        '{source, select, active {active} other {deck}}'
      ),
      false
    );
    assert.equal(
      looksGarbled(
        '{count, plural, one {# карта} few {# карте} other {# карата}}',
        'sr',
        '{count, plural, one {# card} other {# cards}}'
      ),
      false
    );
    assert.equal(
      looksGarbled(
        '{side, select, main {Главни} other {Други}}',
        'ru',
        '{side, select, main {Main} other {Other}}'
      ),
      false
    );
  });
});

describe('catalogs', () => {
  it('round-trip in the shape Lingui writes', () => {
    const text =
      '{\n  "abc": {\n    "message": "Hi",\n    "context": "x",\n    "translation": "Hallo"\n  }\n}\n';
    assert.equal(serializeCatalog(parseCatalog(text, 't')), text);
  });

  it('list every live message a language lacks or breaks', () => {
    const source = parseCatalog(
      JSON.stringify({
        a: { message: 'Draw', translation: 'Draw' },
        b: { message: '{n} cards', translation: '{n} cards' },
        c: { message: 'Old', obsolete: true, translation: 'Old' },
      }),
      'en'
    );
    const target = parseCatalog(
      JSON.stringify({
        a: { message: 'Draw', translation: 'Ziehen' },
        b: { message: '{n} cards', translation: 'Karten' },
      }),
      'de'
    );
    assert.deepEqual(catalogProblems(source, target, 'de'), [
      { id: 'b', problem: 'lost {n}' },
    ]);
  });
});

describe('the translate script', () => {
  it('has a guide for every language the app offers', () => {
    for (const { locale } of LOCALES)
      if (locale !== 'en') assert.ok(LANGUAGE_GUIDES[locale], locale);
  });

  it('asks with the language guide and reads fenced or bare replies', () => {
    const prompt = systemPrompt('de', LANGUAGE_GUIDES['de']!);
    assert.match(prompt, /German \(de\)/u);
    assert.match(prompt, /Discard Pile: Ablagestapel/u);
    assert.deepEqual(
      JSON.parse(
        userPrompt([{ key: 'm0', id: 'x', message: 'Hi', context: 'c' }])
      ),
      [{ key: 'm0', message: 'Hi', context: 'c' }]
    );
    assert.deepEqual(
      parseReply('```json\n{"translations": {"m0": "Hallo"}}\n```'),
      { m0: 'Hallo' }
    );
    assert.deepEqual(parseReply({ translations: { m0: 'Hallo', m1: 3 } }), {
      m0: 'Hallo',
    });
    assert.throws(() => parseReply('nothing'), /no JSON object/u);
  });

  it('names the board in each language as the table labels it', async () => {
    const source = await readCatalog('en');
    // The zone's label on the table, on its window and on its key.
    const labels = Object.entries(source)
      .filter(
        ([, entry]) =>
          entry.message === 'Board' &&
          ['zone on the table', 'zone', 'shortcut key caption'].includes(
            entry.context ?? ''
          )
      )
      .map(([id]) => id);
    assert.equal(labels.length, 3);
    for (const [locale, guide] of Object.entries(LANGUAGE_GUIDES)) {
      const board = guide.terms['Board (the zone on the table)'];
      assert.ok(board, locale);
      const catalog = await readCatalog(locale);
      for (const id of labels)
        assert.equal(
          catalog[id]?.translation.toLocaleLowerCase(locale),
          board.toLocaleLowerCase(locale),
          `${locale} ${id}`
        );
    }
  });

  it('names Set up first in its title, as the welcome and the lessons say it', async () => {
    const source = await readCatalog('en');
    const idOf = (message: string, context?: string) =>
      Object.entries(source).find(
        ([, entry]) => entry.message === message && entry.context === context
      )?.[0];
    const label = idOf('Set up', 'set up the game');
    const title = idOf('Set up: shuffle, draw 7, set 6 prizes');
    assert.ok(label && title);
    for (const locale of Object.keys(LANGUAGE_GUIDES)) {
      const catalog = await readCatalog(locale);
      const name = catalog[label]?.translation ?? '';
      assert.ok(
        catalog[title]?.translation.startsWith(name),
        `${locale}: ${catalog[title]?.translation} / ${name}`
      );
    }
  });

  it('keeps out a note its glossary gives with a term', () => {
    let notes = 0;
    for (const [locale, guide] of Object.entries(LANGUAGE_GUIDES))
      for (const [english, term] of Object.entries(guide.terms)) {
        if (!term.includes('(')) continue;
        notes += 1;
        assert.equal(
          translationProblem(`Your ${english}`, `${term} 1`, locale),
          'kept a glossary note',
          `${locale} ${english}`
        );
      }
    assert.ok(notes > 0);
    assert.equal(
      translationProblem('Active', 'Actief', 'nl'),
      undefined,
      'the short label itself'
    );
  });
});
