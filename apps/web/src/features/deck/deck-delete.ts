import { t } from '@lingui/core/macro';

import { toast } from '../../ui/toast.js';
import { wordName } from './deck-home-covers.js';
import type { DeckLibraryActions } from './deck-library.js';

/** One notice at a time: a second deletion replaces the first's Undo. */
export const DECK_DELETED_TOAST_ID = 'deck-deleted';

/**
 * Deletes a saved deck at once, with Undo on the notice that says so (v1
 * asked first): Undo puts it back exactly as it was -- its cards, back,
 * name and place -- and on the seats it was on.
 */
export const deleteDeckWithUndo = (
  library: Pick<DeckLibraryActions, 'remove' | 'restore'>,
  deckId: string
): boolean => {
  const removed = library.remove(deckId);
  if (!removed) return false;
  const deckName = wordName(removed.name);
  toast({
    id: DECK_DELETED_TOAST_ID,
    title: t`${deckName} deleted`,
    action: { label: t`Undo`, onAction: () => library.restore(removed) },
  });
  return true;
};
