import { formatDecklistText, formatSimCsv } from '@ptcgsim/deck-core';

import { toast } from '../../ui/toast.js';
import { deckFileName, downloadTextFile } from './deck-browser-io.js';
import type { DeckBuilderTarget } from './deck-builder-store.js';
import type { SavedDeck } from './deck-library.js';

/** What the deck screen calls each seat. */
export const SEAT_NAMES: Readonly<Record<DeckBuilderTarget, string>> = {
  main: 'P1',
  alternate: 'P2',
};

/** Copies text, saying how it went. */
export const copyText = async (text: string, what: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: `${what} copied`, tone: 'success' });
  } catch {
    toast({
      title: "The clipboard isn't available here",
      body: 'Download the list instead.',
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
  if (!ok) toast({ title: "The file couldn't be saved", tone: 'warning' });
};
