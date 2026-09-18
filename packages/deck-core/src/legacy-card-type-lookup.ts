import currentTypeTablesJson from './legacy-card-types.json';
import oldTypeTablesJson from './legacy-old-card-types.json';

/*
 * Data provenance (SHA-256 of the frozen source files at extraction):
 * - client/src/setup/deck-constructor/find-type.js
 *   46c5e242664f99079f2b3c01f6741219e1504f0da491f5a4e53449c62c9076e1
 * - client/src/setup/deck-constructor/find-old-type-database.js
 *   fb9e115a15c502c337ead91496c2d498aa6f7f1425101ca47547c54ff2900af2
 *
 * The JSON files contain only those extracted tables. Keeping provenance here
 * leaves their runtime shape identical to the source objects.
 */

export type LegacyCardType = 'Pokémon' | 'Trainer' | 'Energy' | 'Unknown';

type TypeThresholds = Readonly<Record<string, LegacyCardType>>;
type TypeTables = Readonly<Record<string, TypeThresholds>>;

const currentTypeTables = currentTypeTablesJson as TypeTables;
const oldTypeTables = oldTypeTablesJson as TypeTables;

const CURRENT_SET_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'PR-SV': 'SVP',
  'PR-SW': 'SP',
  'PR-SM': 'SMP',
  'PR-XY': 'XYP',
  'PR-BLW': 'BWP',
  'PR-HS': 'HSP',
  sma: 'HIF',
});

const typeBelowFirstGreaterThreshold = (
  thresholds: TypeThresholds,
  cardNumber: number
): LegacyCardType => {
  for (const [threshold, type] of Object.entries(thresholds)) {
    if (cardNumber < Number(threshold)) return type;
  }
  return 'Unknown';
};

/** Source-equivalent lookup for the current-set threshold table. */
export const getLegacyCurrentCardType = (
  sourceSetName: string,
  sourceCardNumber: string
): LegacyCardType => {
  let setName = CURRENT_SET_ALIASES[sourceSetName] ?? sourceSetName;
  let cardNumber = sourceCardNumber;
  const separated = /^([a-zA-Z]+)(\d+)$/u.exec(cardNumber);
  if (separated) {
    setName += separated[1];
    cardNumber = separated[2] ?? '';
  }

  const numericCardNumber = Number.parseInt(cardNumber, 10);
  const thresholds = currentTypeTables[setName];
  return thresholds && Number.isFinite(numericCardNumber)
    ? typeBelowFirstGreaterThreshold(thresholds, numericCardNumber)
    : 'Unknown';
};

const splitOldCardId = (
  cardId: string
): { readonly key: string; readonly cardNumber: number } | undefined => {
  const [setId, dirtyNumber] = cardId.split('-');
  if (!setId || dirtyNumber === undefined) return undefined;

  let prefix = '';
  let digits = '';
  let suffix = '';
  let stage: 'prefix' | 'digits' | 'suffix' = 'prefix';
  for (const character of dirtyNumber) {
    const isDigit = character >= '0' && character <= '9';
    if (stage === 'prefix' && isDigit) stage = 'digits';
    if (stage === 'digits' && !isDigit) stage = 'suffix';
    if (stage === 'prefix') prefix += character;
    else if (stage === 'digits') digits += character;
    else suffix += character;
  }

  return {
    key: `${setId}/${prefix}/${suffix}`,
    cardNumber: digits ? Number.parseInt(digits, 10) : 0,
  };
};

/** Source-equivalent lookup for pokemontcg.io-style legacy IDs. */
export const getLegacyOldCardType = (cardId: string): LegacyCardType => {
  const parsed = splitOldCardId(cardId);
  if (!parsed) return 'Unknown';
  const thresholds = oldTypeTables[parsed.key];
  if (!thresholds) return 'Unknown';
  if (parsed.cardNumber === 0) return thresholds['0'] ?? 'Unknown';
  return typeBelowFirstGreaterThreshold(thresholds, parsed.cardNumber);
};
