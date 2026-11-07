import { t } from '@lingui/core/macro';
import { formatDecklistText, formatSimCsv } from '@ptcgsim/deck-core';

import { toast } from '../../ui/toast.js';
import { deckFileName, downloadTextFile } from './deck-browser-io.js';
import type { DeckBuilderTarget } from './deck-builder-store.js';
import type { SavedDeck } from './deck-library.js';

/**
 * What the deck screen calls each seat. Short tags, the same in every
 * language, as the table's own seat badges are.
 */
export const SEAT_NAMES: Readonly<Record<DeckBuilderTarget, string>> = {
  main: 'P1',
  alternate: 'P2',
};

/** Copies a decklist, saying how it went. */
export const copyDecklist = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: t`Decklist copied`, tone: 'success' });
  } catch {
    toast({
      title: t`The clipboard isn't available here`,
      body: t`Download the list instead.`,
      tone: 'warning',
    });
  }
};

export const downloadDeck = (
  deck: Pick<SavedDeck, 'name' | 'cards'>,
  kind: 'text' | 'csv'
): void => {
  const ok =
    kind === 'text'
      ? downloadTextFile(formatDecklistText(deck.cards), {
          name: deckFileName(deck.name, 'txt'),
          type: 'text/plain;charset=utf-8',
        })
      : downloadTextFile(formatSimCsv(deck.cards), {
          name: deckFileName(deck.name, 'csv'),
          type: 'text/csv;charset=utf-8',
        });
  if (!ok) toast({ title: t`The file couldn't be saved`, tone: 'warning' });
};
