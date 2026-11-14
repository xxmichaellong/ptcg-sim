import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  splitCardId,
  thresholdsForKey,
} from './generate-legacy-old-card-types.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const committed = JSON.parse(
  await readFile(
    join(repoRoot, 'packages/deck-core/src/legacy-old-card-types.json'),
    'utf8'
  )
);

test('splits a card id into v1 key and number', () => {
  assert.deepEqual(splitCardId('base1-70'), {
    key: 'base1//',
    cardNumber: 70,
  });
  // Letters before and after the digits become the key's two halves.
  assert.deepEqual(splitCardId('swsh4-025a'), {
    key: 'swsh4//a',
    cardNumber: 25,
  });
  assert.deepEqual(splitCardId('sm75-SM158'), {
    key: 'sm75/SM/',
    cardNumber: 158,
  });
  // A number with no digits at all is v1's zero key.
  assert.deepEqual(splitCardId('basep-XY'), {
    key: 'basep/XY/',
    cardNumber: 0,
  });
  assert.equal(splitCardId('nodash'), undefined);
});

test('reproduces a committed run-length entry from raw supertypes', () => {
  // Base Set: 1-69 Pokémon, 70-95 Trainer, 96-102 Energy.
  const typesByNumber = new Map();
  for (let number = 1; number <= 102; number += 1) {
    typesByNumber.set(
      number,
      number < 70 ? 'Pokémon' : number < 96 ? 'Trainer' : 'Energy'
    );
  }
  assert.deepEqual(thresholdsForKey(typesByNumber), committed['base1//']);
});

test('keeps a zero-numbered card and closes the final run', () => {
  assert.deepEqual(
    thresholdsForKey(
      new Map([
        [0, 'Trainer'],
        [1, 'Pokémon'],
        [2, 'Pokémon'],
      ])
    ),
    { 0: 'Trainer', 3: 'Pokémon' }
  );
});
