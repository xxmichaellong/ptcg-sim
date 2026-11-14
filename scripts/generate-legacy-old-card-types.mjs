/**
 * Regenerates `packages/deck-core/src/legacy-old-card-types.json` from the
 * upstream card corpus, replacing v1's
 * `client/src/setup/deck-constructor/find-old-type-database_updater.py`.
 *
 * The corpus is https://github.com/PokemonTCG/pokemon-tcg-data. Clone it and
 * point `--data` at the clone:
 *
 *   node scripts/generate-legacy-old-card-types.mjs --data ../pokemon-tcg-data
 *   node scripts/generate-legacy-old-card-types.mjs --data ../pokemon-tcg-data --check
 *
 * `--check` writes nothing. It reports every committed threshold the corpus
 * now contradicts, and counts the keys the corpus has gained since the table
 * was frozen. A newer corpus is expected to add sets; it must not change what
 * an existing card number resolves to, because that would silently reclassify
 * cards in decks people already saved.
 *
 * The table is a run-length encoding by card number, exactly as v1 built it:
 * each key is `setId/prefixLetters/suffixLetters`, and each entry maps the
 * first card number at which the supertype changes to the supertype that
 * applies *below* it, which is what `legacy-card-type-lookup.ts` reads.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TABLE_PATH = 'packages/deck-core/src/legacy-old-card-types.json';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** v1's `get_card_key_and_number`: split `swsh4-025a` into a key and 25. */
export const splitCardId = (cardId) => {
  const separator = cardId.indexOf('-');
  if (separator < 0) return undefined;
  const setId = cardId.slice(0, separator);
  const dirtyNumber = cardId.slice(separator + 1);
  let prefix = '';
  let digits = '';
  let suffix = '';
  let stage = 0;
  for (const character of dirtyNumber) {
    const isDigit = character >= '0' && character <= '9';
    if (stage === 0) {
      if (!isDigit) {
        prefix += character;
        continue;
      }
      stage = 1;
    }
    if (stage === 1) {
      if (isDigit) {
        digits += character;
        continue;
      }
      stage = 2;
    }
    suffix += character;
  }
  return {
    key: `${setId}/${prefix}/${suffix}`,
    cardNumber: digits === '' ? 0 : Number.parseInt(digits, 10),
  };
};

/** Collapses one key's `number -> supertype` map into v1's thresholds. */
export const thresholdsForKey = (typesByNumber) => {
  const thresholds = {};
  const zero = typesByNumber.get(0);
  if (zero !== undefined) thresholds['0'] = zero;
  const highest = Math.max(...typesByNumber.keys());
  let previous = typesByNumber.get(1) ?? 'Unknown';
  for (let number = 1; number < highest + 2; number += 1) {
    const current = typesByNumber.get(number) ?? 'Unknown';
    if (current !== previous) {
      thresholds[String(number)] = previous;
      previous = current;
    }
  }
  return thresholds;
};

export const buildTable = async (dataRoot) => {
  const sets = JSON.parse(
    await readFile(join(dataRoot, 'sets', 'en.json'), 'utf8')
  );
  const typesByKey = new Map();
  for (const set of sets) {
    const cards = JSON.parse(
      await readFile(join(dataRoot, 'cards', 'en', `${set.id}.json`), 'utf8')
    );
    for (const card of cards) {
      const split = splitCardId(card.id);
      if (!split) continue;
      const existing = typesByKey.get(split.key) ?? new Map();
      // v1 asserts here: two cards must never share one key and number.
      if (existing.has(split.cardNumber)) {
        throw new Error(
          `Corpus has two cards at ${split.key} ${String(split.cardNumber)}`
        );
      }
      existing.set(split.cardNumber, card.supertype);
      typesByKey.set(split.key, existing);
    }
  }
  const table = {};
  for (const [key, typesByNumber] of typesByKey) {
    table[key] = thresholdsForKey(typesByNumber);
  }
  return table;
};

const main = async (argv) => {
  const dataIndex = argv.indexOf('--data');
  const dataRoot = dataIndex < 0 ? undefined : argv[dataIndex + 1];
  if (!dataRoot) {
    throw new Error(
      'Usage: generate-legacy-old-card-types.mjs --data <pokemon-tcg-data clone> [--check]'
    );
  }
  const table = await buildTable(resolve(dataRoot));
  const tablePath = join(repoRoot, TABLE_PATH);
  if (!argv.includes('--check')) {
    await writeFile(tablePath, `${JSON.stringify(table, null, 2)}\n`, 'utf8');
    process.stdout.write(
      `Wrote ${TABLE_PATH} (${String(Object.keys(table).length)} keys).\n`
    );
    return;
  }
  const committed = JSON.parse(await readFile(tablePath, 'utf8'));
  const contradictions = [];
  for (const [key, thresholds] of Object.entries(committed)) {
    const generated = table[key];
    if (!generated) {
      contradictions.push(`${key}: the corpus no longer has this key`);
      continue;
    }
    for (const [threshold, type] of Object.entries(thresholds)) {
      if (generated[threshold] !== type) {
        contradictions.push(
          `${key} ${threshold}: committed ${type}, corpus ${String(generated[threshold])}`
        );
      }
    }
  }
  const added = Object.keys(table).filter((key) => !(key in committed));
  process.stdout.write(
    `${String(added.length)} key(s) added by the corpus since the table was frozen.\n`
  );
  if (contradictions.length > 0) {
    for (const line of contradictions) process.stdout.write(`${line}\n`);
    throw new Error(
      `${String(contradictions.length)} committed threshold(s) contradicted`
    );
  }
  process.stdout.write('No committed threshold is contradicted.\n');
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
