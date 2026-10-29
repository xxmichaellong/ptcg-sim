import { plural, t } from '@lingui/core/macro';
import type { ViewCardId } from '@ptcgsim/game-core';
import { useEffect, useRef, useState } from 'react';

/** Changes this close together are read as one (ADR-042 §7). */
export const SELECTION_ANNOUNCE_MS = 250;

/** A selection as it was read out: its items, and whether the mode was on. */
export interface AnnouncedSelection {
  readonly items: readonly ViewCardId[];
  readonly mode: boolean;
}

const count = (items: number): string =>
  plural(items, { one: '# selected', other: '# selected' });

/**
 * What a change to the selection says, from what was last read out to
 * what it is now: "3 cards selected", "Fire Energy added, 4 selected",
 * "Fire Energy removed, 3 selected", "2 cards left the selection" (moved
 * by the other player, a pile closed), "Selection cleared". One card
 * picked or let go of outside selection mode says nothing, as before
 * groups: the card's own name and state say it. Null when there is
 * nothing to say.
 */
export const selectionAnnouncement = (
  before: AnnouncedSelection,
  after: AnnouncedSelection,
  labelOf: (cardId: ViewCardId) => string | undefined,
  present: (cardId: ViewCardId) => boolean
): string | null => {
  const added = after.items.filter((item) => !before.items.includes(item));
  const removed = before.items.filter((item) => !after.items.includes(item));
  if (added.length === 0 && removed.length === 0) {
    if (!before.mode && after.mode)
      return t({
        message: 'Selecting: tap cards to add them',
        comment: 'Read out as touch selection mode starts.',
      });
    return null;
  }
  const grouped =
    before.items.length >= 2 ||
    after.items.length >= 2 ||
    before.mode ||
    after.mode;
  if (!grouped) return null;
  if (after.items.length === 0) return t`Selection cleared`;
  const left = removed.filter((item) => !present(item));
  if (left.length > 0 && added.length === 0)
    return t({
      message: `${plural(left.length, {
        one: '# card left the selection',
        other: '# cards left the selection',
      })}, ${count(after.items.length)}`,
      comment: 'Selected cards that were moved away, e.g. by the other player.',
    });
  if (added.length === 1 && removed.length === 0) {
    const name = labelOf(added[0]!);
    if (name)
      return t({
        message: `${name} added, ${count(after.items.length)}`,
        comment:
          'A card joined the selection, e.g. "Fire Energy added, 4 selected".',
      });
  }
  if (removed.length === 1 && added.length === 0) {
    const name = labelOf(removed[0]!);
    if (name)
      return t({
        message: `${name} removed, ${count(after.items.length)}`,
        comment:
          'A card left the selection, e.g. "Fire Energy removed, 3 selected".',
      });
  }
  return t`${plural(after.items.length, {
    one: '# card selected',
    other: '# cards selected',
  })}`;
};

/**
 * Says what the selection became, in a status region of its own (not the
 * room's announcement queue, which reads entries one by one): replaced,
 * not queued, and changes within SELECTION_ANNOUNCE_MS read as one, as a
 * rectangle drawn or Select all would otherwise be read card by card.
 */
export const SelectionAnnouncer = ({
  selection,
  selectionMode,
  labelOf,
  present,
}: {
  readonly selection: readonly ViewCardId[];
  readonly selectionMode: boolean;
  readonly labelOf: (cardId: ViewCardId) => string | undefined;
  readonly present: (cardId: ViewCardId) => boolean;
}) => {
  const [message, setMessage] = useState<string | null>(null);
  const latest = useRef<AnnouncedSelection>({
    items: selection,
    mode: selectionMode,
  });
  latest.current = { items: selection, mode: selectionMode };
  const read = useRef<AnnouncedSelection>(latest.current);
  const lookups = useRef({ labelOf, present });
  lookups.current = { labelOf, present };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const now = latest.current;
      const said = selectionAnnouncement(
        read.current,
        now,
        lookups.current.labelOf,
        lookups.current.present
      );
      read.current = now;
      if (said !== null) setMessage(said);
    }, SELECTION_ANNOUNCE_MS);
  }, [selection, selectionMode]);
  // Let go of, the timer is forgotten too: StrictMode runs this and the
  // effect above again at once, and a timer kept would silence it.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    },
    []
  );
  return (
    <div
      className="ds-visually-hidden"
      role="status"
      aria-live="polite"
      data-selection-announcer="true"
    >
      {message}
    </div>
  );
};
