import { parseSimCsv } from '../../../setup/deck-builder/core/csv-adapter.mjs';

export const deckRowsToSimCsv = (deckRows = []) => {
  const header = 'QTY,Name,Type,URL';
  const body = (Array.isArray(deckRows) ? deckRows : [])
    .filter((row) => Array.isArray(row) && row.length >= 4)
    .map((row) => [row[0], row[1], row[2], row[3]].join(','));

  return `${header}\n${body.join('\n')}`;
};

export const syncDeckFromLoadedRows = (deckRows = []) => {
  return parseSimCsv(deckRowsToSimCsv(deckRows));
};
