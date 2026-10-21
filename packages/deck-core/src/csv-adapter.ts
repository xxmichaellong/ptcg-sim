import { t } from '@lingui/core/macro';

import {
  customCardId,
  deckListOf,
  type CardCategory,
  type DeckCard,
  type DeckList,
} from './deck-list.js';

/**
 * The simulator's own deck file, kept from v1 so existing files still open:
 *
 *   QTY,Name,Type,URL[,Presentation]
 *   4,Dreepy,Pokémon,https://…/TWM_128_R_EN.png
 *
 * Parsing is transactional: a file with any bad row gives no deck at all,
 * only the issues, so a half-read deck never replaces a good one.
 */

export const SIM_CSV_HEADER = 'QTY,Name,Type,URL';
export const MAX_DECK_CSV_CODE_UNITS = 1_000_000;
export const MAX_DECK_CSV_ROWS = 10_000;
export const MAX_DECK_CARD_QUANTITY = 999;
export const MAX_DECK_TOTAL_CARDS = 100_000;
export const MAX_DECK_CARD_NAME_CODE_UNITS = 256;
export const MAX_DECK_CARD_TYPE_CODE_UNITS = 64;
export const MAX_DECK_IMAGE_URL_CODE_UNITS = 4_096;

const escapeCsvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const formatSimCsv = (list: DeckList): string => {
  const hasPresentation = list.some(
    (entry) => entry.card.presentation !== undefined
  );
  const rows = list.map(({ card, count }) =>
    [
      count,
      card.name,
      card.category,
      card.image,
      ...(hasPresentation
        ? [
            card.presentation === undefined
              ? ''
              : JSON.stringify(card.presentation),
          ]
        : []),
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  return `${SIM_CSV_HEADER}${hasPresentation ? ',Presentation' : ''}\n${rows.join('\n')}`;
};

/** A card type as v1 files and decklists spell it. */
export const cardCategoryOf = (value: string): CardCategory | undefined => {
  const folded = value.trim().toLowerCase().replaceAll('é', 'e');
  if (folded === 'pokemon') return 'Pokémon';
  if (folded === 'trainer') return 'Trainer';
  if (folded === 'energy') return 'Energy';
  return undefined;
};

export type DeckCsvIssueCode =
  | 'csv_too_large'
  | 'too_many_rows'
  | 'unterminated_quote'
  | 'unexpected_quote'
  | 'invalid_header'
  | 'invalid_column_count'
  | 'invalid_presentation'
  | 'invalid_quantity'
  | 'deck_too_large'
  | 'missing_name'
  | 'name_too_long'
  | 'missing_type'
  | 'type_too_long'
  | 'invalid_type'
  | 'missing_url'
  | 'url_too_long';

export interface DeckCsvIssue {
  readonly code: DeckCsvIssueCode;
  readonly row?: number;
  readonly message: string;
}

export type ParseSimCsvResult =
  | { readonly ok: true; readonly cards: DeckList }
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
          message: t`Row ${{ row: rows.length + 1 }}: unexpected quote.`,
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
        message: t`Row ${{ row: rows.length + 1 }}: text after a closing quote.`,
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
      message: t`Row ${{ row: rows.length + 1 }}: unterminated quote.`,
    });
  }
  if (cell.length > 0 || row.length > 0 || closedQuote) finishRow();
  return { rows, issues };
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
          message: t`The deck file is too long.`,
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
      message: t`The deck file has more than ${{ max: MAX_DECK_CSV_ROWS }} rows.`,
    });
  }

  const header = rows[0];
  const normalizedHeader = header
    ? [
        ...header.slice(0, 1).map((cell) => cell.replace(/^\uFEFF/u, '')),
        ...header.slice(1),
      ]
    : [];
  const hasPresentation =
    normalizedHeader.join(',') === `${SIM_CSV_HEADER},Presentation`;
  if (!hasPresentation && normalizedHeader.join(',') !== SIM_CSV_HEADER) {
    issues.push({
      code: 'invalid_header',
      row: 1,
      message: t`The deck file must start with ${{ header: SIM_CSV_HEADER }}.`,
    });
  }

  const entries: { card: DeckCard; count: number }[] = [];
  let totalCards = 0;
  for (
    let index = 1;
    index < rows.length && index <= MAX_DECK_CSV_ROWS;
    index += 1
  ) {
    const row = rows[index];
    if (!row) continue;
    const rowNumber = index + 1;
    if (row.length !== (hasPresentation ? 5 : 4)) {
      issues.push({
        code: 'invalid_column_count',
        row: rowNumber,
        message: hasPresentation
          ? t`Row ${rowNumber}: needs exactly five columns.`
          : t`Row ${rowNumber}: needs exactly four columns.`,
      });
      continue;
    }

    let presentation: unknown;
    if (hasPresentation && row[4]?.trim()) {
      try {
        if (row[4].length > 1024) throw new Error('too large');
        presentation = JSON.parse(row[4]);
        if (
          !presentation ||
          typeof presentation !== 'object' ||
          Array.isArray(presentation)
        )
          throw new Error('not an object');
      } catch {
        issues.push({
          code: 'invalid_presentation',
          row: rowNumber,
          message: t`Row ${rowNumber}: invalid presentation JSON.`,
        });
        continue;
      }
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
        message: t`Row ${rowNumber}: quantity must be 1 to ${{ max: MAX_DECK_CARD_QUANTITY }}.`,
      });
      rowValid = false;
    }
    if (!name) {
      issues.push({
        code: 'missing_name',
        row: rowNumber,
        message: t`Row ${rowNumber}: no card name.`,
      });
      rowValid = false;
    } else if (name.length > MAX_DECK_CARD_NAME_CODE_UNITS) {
      issues.push({
        code: 'name_too_long',
        row: rowNumber,
        message: t`Row ${rowNumber}: card name too long.`,
      });
      rowValid = false;
    }
    if (!supertype) {
      issues.push({
        code: 'missing_type',
        row: rowNumber,
        message: t`Row ${rowNumber}: no card type.`,
      });
      rowValid = false;
    } else if (supertype.length > MAX_DECK_CARD_TYPE_CODE_UNITS) {
      issues.push({
        code: 'type_too_long',
        row: rowNumber,
        message: t`Row ${rowNumber}: card type too long.`,
      });
      rowValid = false;
    } else if (!cardCategoryOf(supertype)) {
      issues.push({
        code: 'invalid_type',
        row: rowNumber,
        message: t`Row ${rowNumber}: card type must be Pokémon, Trainer or Energy.`,
      });
      rowValid = false;
    }
    if (!image) {
      issues.push({
        code: 'missing_url',
        row: rowNumber,
        message: t`Row ${rowNumber}: no image URL.`,
      });
      rowValid = false;
    } else if (image.length > MAX_DECK_IMAGE_URL_CODE_UNITS) {
      issues.push({
        code: 'url_too_long',
        row: rowNumber,
        message: t`Row ${rowNumber}: image URL too long.`,
      });
      rowValid = false;
    }

    if (!rowValid) continue;
    totalCards += quantity;
    if (totalCards > MAX_DECK_TOTAL_CARDS) {
      issues.push({
        code: 'deck_too_large',
        row: rowNumber,
        message: t`The deck has more than ${{ max: MAX_DECK_TOTAL_CARDS }} cards.`,
      });
      continue;
    }

    const category = cardCategoryOf(supertype)!;
    entries.push({
      card: Object.freeze({
        id: customCardId([name, category, image, presentation]),
        name,
        category,
        image,
        ...(presentation ? { presentation } : {}),
      }),
      count: quantity,
    });
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, cards: deckListOf(entries) };
};
