import {
  MAX_DECK_CARDS,
  asCardDefinitionId,
  type CardCategory,
  type CardDefinition,
  type DeckEntry,
} from '@ptcgsim/game-core';

import type {
  LegacyDeckData,
  LegacyDeckRow,
  LegacyExportUser,
  ParsedLegacyExport,
} from './parse-export.js';

const MAX_CARD_NAME_CODE_UNITS = 256;
const MAX_CARD_IMAGE_URL_CODE_UNITS = 4_096;

const LEGACY_CARD_CATEGORIES = [
  'Pokémon',
  'Trainer',
  'Energy',
  'Unknown',
] as const satisfies readonly CardCategory[];

export type LegacyV1DeckDecodeIssueCode =
  | 'invalid_deck_quantity'
  | 'too_many_deck_cards'
  | 'invalid_card_name'
  | 'invalid_card_category'
  | 'invalid_card_image_url';

export interface LegacyV1DeckDecodeIssue {
  readonly code: LegacyV1DeckDecodeIssueCode;
  readonly player: LegacyExportUser;
  readonly recordIndex: 1 | 2;
  readonly path: string;
  readonly message: string;
}

export type LegacyV1DeckDecodeResult =
  | {
      readonly ok: true;
      readonly definitions: readonly CardDefinition[];
      readonly selfEntries: readonly DeckEntry[];
      readonly opponentEntries: readonly DeckEntry[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly LegacyV1DeckDecodeIssue[];
    };

type MaterializedDeck =
  | { readonly ok: true; readonly entries: readonly DeckEntry[] }
  | { readonly ok: false; readonly issue: LegacyV1DeckDecodeIssue };

const cardCategories = new Set<string>(LEGACY_CARD_CATEGORIES);

const isCardCategory = (value: string): value is CardCategory =>
  cardCategories.has(value);

const parseQuantity = (value: string): number | null => {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) ? quantity : null;
};

const definitionIdentity = (row: LegacyDeckRow): string =>
  JSON.stringify([row[1], row[2], row[3]]);

const decodeLegacyV1Deck = (
  deck: LegacyDeckData,
  player: LegacyExportUser,
  recordIndex: 1 | 2,
  definitionsByIdentity: Map<string, CardDefinition[]>,
  definitions: CardDefinition[]
): MaterializedDeck => {
  if (deck === '') return { ok: true, entries: [] };

  const entries: DeckEntry[] = [];
  const runCountByIdentity = new Map<string, number>();
  let totalCards = 0;
  let previousIdentity: string | undefined;

  for (let rowIndex = 0; rowIndex < deck.length; rowIndex += 1) {
    const row = deck[rowIndex]!;
    const rowPath = `$[${recordIndex}].parameters[0][${rowIndex}]`;
    const quantity = parseQuantity(row[0]);
    if (quantity === null) {
      return {
        ok: false,
        issue: {
          code: 'invalid_deck_quantity',
          player,
          recordIndex,
          path: `${rowPath}[0]`,
          message: 'Legacy deck quantities must be positive decimal integers',
        },
      };
    }
    totalCards += quantity;
    if (totalCards > MAX_DECK_CARDS) {
      return {
        ok: false,
        issue: {
          code: 'too_many_deck_cards',
          player,
          recordIndex,
          path: `${rowPath}[0]`,
          message: `A converted deck cannot exceed ${MAX_DECK_CARDS} cards`,
        },
      };
    }

    const name = row[1];
    if (name.length === 0 || name.length > MAX_CARD_NAME_CODE_UNITS) {
      return {
        ok: false,
        issue: {
          code: 'invalid_card_name',
          player,
          recordIndex,
          path: `${rowPath}[1]`,
          message: `Card names must contain 1 to ${MAX_CARD_NAME_CODE_UNITS} code units`,
        },
      };
    }

    const category = row[2];
    if (!isCardCategory(category)) {
      return {
        ok: false,
        issue: {
          code: 'invalid_card_category',
          player,
          recordIndex,
          path: `${rowPath}[2]`,
          message: 'Card category is not supported by the canonical model',
        },
      };
    }

    const imageUrl = row[3];
    if (
      imageUrl.length === 0 ||
      imageUrl.length > MAX_CARD_IMAGE_URL_CODE_UNITS
    ) {
      return {
        ok: false,
        issue: {
          code: 'invalid_card_image_url',
          player,
          recordIndex,
          path: `${rowPath}[3]`,
          message: `Card image URLs must contain 1 to ${MAX_CARD_IMAGE_URL_CODE_UNITS} code units`,
        },
      };
    }

    const identity = definitionIdentity(row);
    if (identity === previousIdentity) {
      const previousEntry = entries.at(-1)!;
      entries[entries.length - 1] = {
        definition: previousEntry.definition,
        count: previousEntry.count + quantity,
      };
      continue;
    }

    const runIndex = runCountByIdentity.get(identity) ?? 0;
    runCountByIdentity.set(identity, runIndex + 1);
    const matchingDefinitions = definitionsByIdentity.get(identity) ?? [];
    let definition = matchingDefinitions[runIndex];
    if (!definition) {
      definition = {
        id: asCardDefinitionId(
          `legacy:v1:def:${String(definitions.length).padStart(3, '0')}`
        ),
        name,
        category,
        imageUrl,
      };
      matchingDefinitions.push(definition);
      definitionsByIdentity.set(identity, matchingDefinitions);
      definitions.push(definition);
    }
    entries.push({ definition, count: quantity });
    previousIdentity = identity;
  }

  return { ok: true, entries };
};

/**
 * Converts parser-verified deck tuples into bounded canonical deck entries.
 * Definitions receive encounter-ordered IDs, so identity is deterministic
 * without embedding untrusted card text or relying on a collision-prone hash.
 */
export const decodeLegacyV1Decks = (
  parsed: ParsedLegacyExport
): LegacyV1DeckDecodeResult => {
  const definitions: CardDefinition[] = [];
  const definitionsByIdentity = new Map<string, CardDefinition[]>();
  const self = decodeLegacyV1Deck(
    parsed.selfDeck,
    'self',
    1,
    definitionsByIdentity,
    definitions
  );
  if (!self.ok) return { ok: false, issues: [self.issue] };

  const opponent = decodeLegacyV1Deck(
    parsed.opponentDeck,
    'opp',
    2,
    definitionsByIdentity,
    definitions
  );
  if (!opponent.ok) return { ok: false, issues: [opponent.issue] };

  return {
    ok: true,
    definitions,
    selfEntries: self.entries,
    opponentEntries: opponent.entries,
  };
};
