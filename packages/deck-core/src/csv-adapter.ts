import { isDatabaseCard, isFormattedDeckCard } from './card-compare.js';
import type { Deck, DeckCard, DeckCardGroup } from './types.js';

export const SIM_CSV_HEADER = 'QTY,Name,Type,URL';
export const MAX_DECK_CSV_CODE_UNITS = 1_000_000;
export const MAX_DECK_CSV_ROWS = 10_000;
export const MAX_DECK_CARD_QUANTITY = 10_000;
export const MAX_DECK_TOTAL_CARDS = 100_000;
export const MAX_DECK_CARD_NAME_CODE_UNITS = 256;
export const MAX_DECK_CARD_TYPE_CODE_UNITS = 64;
export const MAX_DECK_IMAGE_URL_CODE_UNITS = 4_096;

export const formatImageUrl = (card: DeckCard = {}): string => {
  if (isDatabaseCard(card)) return card.images?.large || '';

  if (isFormattedDeckCard(card)) {
    const image = card.image || '';
    if (image.startsWith('assets') && !image.includes('tishinator')) {
      return `https://tishinator.github.io/PTCGDeckBuilder${image}`;
    }
    return image;
  }
  return '';
};

export const formatCardType = (card: DeckCard = {}): string =>
  card.supertype || '';

const escapeCsvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const serializeDeckToSimCsv = (decklist: Deck = {}): string => {
  const rows: string[] = [];
  for (const [cardName, group] of Object.entries(decklist)) {
    for (const variant of group?.cards ?? []) {
      const type = formatCardType(variant.data);
      const url = formatImageUrl(variant.data);
      if (!cardName || !type || !url) continue;
      rows.push(
        [variant.count, cardName, type, url].map(escapeCsvCell).join(',')
      );
    }
  }
  return `${SIM_CSV_HEADER}\n${rows.join('\n')}`;
};

export type DeckCsvIssueCode =
  | 'csv_too_large'
  | 'too_many_rows'
  | 'unterminated_quote'
  | 'unexpected_quote'
  | 'invalid_header'
  | 'invalid_column_count'
  | 'invalid_quantity'
  | 'deck_too_large'
  | 'missing_name'
  | 'name_too_long'
  | 'missing_type'
  | 'type_too_long'
  | 'missing_url'
  | 'url_too_long';

export interface DeckCsvIssue {
  readonly code: DeckCsvIssueCode;
  readonly row?: number;
  readonly message: string;
}

export type ParseSimCsvResult =
  | { readonly ok: true; readonly deck: Deck }
  | { readonly ok: false; readonly issues: readonly DeckCsvIssue[] };

interface ParsedCsv {
  readonly rows: readonly (readonly string[])[];
  readonly issues: readonly DeckCsvIssue[];
}

const parseCsvRows = (source: string): ParsedCsv => {
  const rows: string[][] = [];
  const issues: DeckCsvIssue[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;

  const finishCell = (): void => {
    row.push(cell);
    cell = '';
    closedQuote = false;
  };
  const finishRow = (): void => {
    finishCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      if (cell.length === 0 && !closedQuote) quoted = true;
      else {
        issues.push({
          code: 'unexpected_quote',
          row: rows.length + 1,
          message: `Row ${rows.length + 1} contains an unexpected quote.`,
        });
        cell += character;
      }
    } else if (character === ',') {
      finishCell();
    } else if (character === '\n') {
      finishRow();
    } else if (character === '\r') {
      if (source[index + 1] === '\n') index += 1;
      finishRow();
    } else if (closedQuote) {
      issues.push({
        code: 'unexpected_quote',
        row: rows.length + 1,
        message: `Row ${rows.length + 1} has text after a closing quote.`,
      });
      cell += character;
    } else {
      cell += character;
    }
  }

  if (quoted) {
    issues.push({
      code: 'unterminated_quote',
      row: rows.length + 1,
      message: `Row ${rows.length + 1} contains an unterminated quote.`,
    });
  }
  if (cell.length > 0 || row.length > 0 || closedQuote) finishRow();
  return { rows, issues };
};

const setOwnGroup = (deck: Deck, name: string, group: DeckCardGroup): void => {
  Object.defineProperty(deck, name, {
    configurable: true,
    enumerable: true,
    value: group,
    writable: true,
  });
};

const isBlankRow = (row: readonly string[]): boolean =>
  row.length === 1 && (row[0] ?? '').trim() === '';

export const parseSimCsvResult = (csvData: string = ''): ParseSimCsvResult => {
  const source = String(csvData);
  if (source.length > MAX_DECK_CSV_CODE_UNITS) {
    return {
      ok: false,
      issues: [
        {
          code: 'csv_too_large',
          message: `Deck CSV exceeds ${MAX_DECK_CSV_CODE_UNITS} code units.`,
        },
      ],
    };
  }

  const parsed = parseCsvRows(source);
  const rows = parsed.rows.filter((row) => !isBlankRow(row));
  const issues = [...parsed.issues];
  if (rows.length > MAX_DECK_CSV_ROWS + 1) {
    issues.push({
      code: 'too_many_rows',
      message: `Deck CSV contains more than ${MAX_DECK_CSV_ROWS} card rows.`,
    });
  }

  const header = rows[0];
  const normalizedHeader = header
    ? [
        ...header.slice(0, 1).map((cell) => cell.replace(/^\uFEFF/u, '')),
        ...header.slice(1),
      ]
    : [];
  if (
    normalizedHeader.length !== 4 ||
    normalizedHeader.join(',') !== SIM_CSV_HEADER
  ) {
    issues.push({
      code: 'invalid_header',
      row: 1,
      message: `Deck CSV must start with ${SIM_CSV_HEADER}.`,
    });
  }

  const deck: Deck = {};
  let totalCards = 0;
  for (
    let index = 1;
    index < rows.length && index <= MAX_DECK_CSV_ROWS;
    index += 1
  ) {
    const row = rows[index];
    if (!row) continue;
    const rowNumber = index + 1;
    if (row.length !== 4) {
      issues.push({
        code: 'invalid_column_count',
        row: rowNumber,
        message: `Row ${rowNumber} must contain exactly four columns.`,
      });
      continue;
    }

    const quantityText = (row[0] ?? '').trim();
    const name = (row[1] ?? '').trim();
    const supertype = (row[2] ?? '').trim();
    const image = (row[3] ?? '').trim();
    const quantity = Number(quantityText);
    let rowValid = true;

    if (
      !/^\d+$/u.test(quantityText) ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      quantity > MAX_DECK_CARD_QUANTITY
    ) {
      issues.push({
        code: 'invalid_quantity',
        row: rowNumber,
        message: `Row ${rowNumber} quantity must be an integer from 1 to ${MAX_DECK_CARD_QUANTITY}.`,
      });
      rowValid = false;
    }
    if (!name) {
      issues.push({
        code: 'missing_name',
        row: rowNumber,
        message: `Row ${rowNumber} is missing a card name.`,
      });
      rowValid = false;
    } else if (name.length > MAX_DECK_CARD_NAME_CODE_UNITS) {
      issues.push({
        code: 'name_too_long',
        row: rowNumber,
        message: `Row ${rowNumber} card name exceeds ${MAX_DECK_CARD_NAME_CODE_UNITS} code units.`,
      });
      rowValid = false;
    }
    if (!supertype) {
      issues.push({
        code: 'missing_type',
        row: rowNumber,
        message: `Row ${rowNumber} is missing a card type.`,
      });
      rowValid = false;
    } else if (supertype.length > MAX_DECK_CARD_TYPE_CODE_UNITS) {
      issues.push({
        code: 'type_too_long',
        row: rowNumber,
        message: `Row ${rowNumber} card type exceeds ${MAX_DECK_CARD_TYPE_CODE_UNITS} code units.`,
      });
      rowValid = false;
    }
    if (!image) {
      issues.push({
        code: 'missing_url',
        row: rowNumber,
        message: `Row ${rowNumber} is missing an image URL.`,
      });
      rowValid = false;
    } else if (image.length > MAX_DECK_IMAGE_URL_CODE_UNITS) {
      issues.push({
        code: 'url_too_long',
        row: rowNumber,
        message: `Row ${rowNumber} image URL exceeds ${MAX_DECK_IMAGE_URL_CODE_UNITS} code units.`,
      });
      rowValid = false;
    }

    if (!rowValid) continue;
    totalCards += quantity;
    if (totalCards > MAX_DECK_TOTAL_CARDS) {
      issues.push({
        code: 'deck_too_large',
        row: rowNumber,
        message: `Deck contains more than ${MAX_DECK_TOTAL_CARDS} cards.`,
      });
      continue;
    }

    let group = Object.prototype.hasOwnProperty.call(deck, name)
      ? deck[name]
      : undefined;
    if (!group) {
      group = { cards: [], totalCount: 0 };
      setOwnGroup(deck, name, group);
    }
    const existing = group.cards.find(
      (variant) => variant.data.image === image
    );
    if (existing) existing.count += quantity;
    else {
      group.cards.push({
        data: { count: quantityText, name, supertype, image },
        count: quantity,
      });
    }
    group.totalCount += quantity;
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, deck };
};

export class DeckCsvParseError extends Error {
  readonly issues: readonly DeckCsvIssue[];

  constructor(issues: readonly DeckCsvIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'DeckCsvParseError';
    this.issues = issues;
  }
}

export const parseSimCsv = (csvData: string = ''): Deck => {
  const result = parseSimCsvResult(csvData);
  if (!result.ok) throw new DeckCsvParseError(result.issues);
  return result.deck;
};
