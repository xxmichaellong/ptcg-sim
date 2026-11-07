import { plural, t } from '@lingui/core/macro';

import type { ToastOptions } from '../ui/toast.js';
import type { BoardSessionControllerEffect } from './BoardSessionController.js';

/** One notice at a time: a second refusal replaces the first. */
export const GROUP_NOTICE_TOAST_ID = 'board-group-refused';

/**
 * A key that means something for one card only (Read, switch with the top
 * of the deck, change type, look/cover) pressed with several selected.
 */
export const selectOneNotice = (): ToastOptions => ({
  id: GROUP_NOTICE_TOAST_ID,
  title: t`Select one card for that`,
});

/**
 * A table key (draw, shuffle the deck, Alt+D…) pressed with cards
 * selected: it would act on the table, not on them, so it waits.
 */
export const tableKeyNotice = (): ToastOptions => ({
  id: GROUP_NOTICE_TOAST_ID,
  title: t`Press Esc to put the cards down`,
});

/** Why a card could not be taken into the selection (a modifier press, `x`). */
const selectionNotice = (reason: string): ToastOptions | undefined => {
  switch (reason) {
    case 'not_an_item':
      return {
        id: GROUP_NOTICE_TOAST_ID,
        title: t`Open the pile to pick cards from it`,
      };
    case 'uncontrolled':
      return { id: GROUP_NOTICE_TOAST_ID, title: t`You can't move that card` };
    case 'in_selected_pokemon':
      return {
        id: GROUP_NOTICE_TOAST_ID,
        title: t`Already part of the selected Pokémon`,
      };
    case 'full':
      return {
        id: GROUP_NOTICE_TOAST_ID,
        title: t`Up to 60 cards can be selected`,
      };
    default:
      return undefined;
  }
};

type GroupRejection = Extract<
  BoardSessionControllerEffect,
  { readonly kind: 'GroupActionRejected' }
>;

/** What to say when a group's move or mark can't be made. */
const groupNotice = (effect: GroupRejection): ToastOptions | undefined => {
  const { reason, cardName, itemCount: count, action } = effect;
  const named = (title: string, body?: string): ToastOptions => ({
    id: GROUP_NOTICE_TOAST_ID,
    title,
    ...(body ? { body } : {}),
    tone: 'warning',
  });
  switch (reason) {
    // Nothing went wrong, or it is no move of the player's.
    case 'no_installed_view':
    case 'not_ready':
    case 'read_only':
    case 'no_op':
      return undefined;
    case 'empty':
      return named(t`Nothing is selected`);
    case 'one_active':
      return named(t`Only one Pokémon can be Active`);
    case 'one_stadium':
      return named(t`Only one Stadium at a time`);
    case 'pokemon_to_play':
      return named(t`A Pokémon in play can't join a group going to the Bench`);
    case 'attachments_only':
      return named(t`Only attachments can go on a Pokémon together`);
    case 'not_in_play':
      return named(
        action?.kind === 'condition'
          ? t`Special Conditions go only on Active Pokémon`
          : t`Only Pokémon in play take damage`,
        cardName ? t`${cardName} isn't in play.` : undefined
      );
    case 'active_only':
      return named(
        t`Special Conditions go only on Active Pokémon`,
        cardName ? t`${cardName} is on the Bench.` : undefined
      );
    case 'unpredictable':
      return named(t`Can't move these together`, t`Try fewer cards.`);
    case 'too_many_steps':
      return named(t`Too many cards at once`, t`Try fewer cards.`);
    case 'stale_scene':
    case 'stale_target':
    case 'stale_player':
      return named(t`The table changed`, t`Try again.`);
    case 'no_target':
      return named(t`No Pokémon can take all of these`);
    case 'not_an_item':
    case 'uncontrolled':
    case 'in_selected_pokemon':
    case 'full': {
      const notice = selectionNotice(reason);
      return notice && cardName ? { ...notice, body: cardName } : notice;
    }
    default:
      return named(
        plural(count, {
          one: "Can't do that with this card",
          other: "Can't do that with these cards",
        }),
        cardName ? t`Because of ${cardName}.` : undefined
      );
  }
};

/**
 * The table's word on a group it kept from the room: why the selection
 * couldn't do what was asked, or why a card couldn't join it. Null for any
 * other effect, and for a refusal that needs no word (a drop back where
 * the cards lie, a table not ready for moves).
 */
export const groupRefusalNotice = (
  effect: BoardSessionControllerEffect
): ToastOptions | undefined => {
  if (effect.kind === 'GroupActionRejected') return groupNotice(effect);
  if (
    effect.kind === 'IntentRejected' &&
    (effect.intent.kind === 'CardSelected' ||
      effect.intent.kind === 'CardsSelected')
  ) {
    return selectionNotice(effect.reason);
  }
  return undefined;
};
