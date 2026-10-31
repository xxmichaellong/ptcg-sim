import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { BoardZoneKind } from '@ptcgsim/renderer-contract';

/**
 * The places on the table by name, for the overlays: a pile viewer's title
 * and the Move menu's destinations. Translated where they are shown.
 */
export const ZONE_NAMES: Partial<Record<BoardZoneKind, MessageDescriptor>> = {
  hand: msg({ message: 'Hand', context: 'zone' }),
  active: msg({ message: 'Active', context: 'zone' }),
  bench: msg({ message: 'Bench', context: 'zone' }),
  board: msg({ message: 'Board', context: 'zone' }),
  stadium: msg({ message: 'Stadium', context: 'zone' }),
  discard: msg({ message: 'Discard pile', context: 'zone' }),
  lostZone: msg({ message: 'Lost Zone', context: 'zone' }),
  prizes: msg({ message: 'Prizes', context: 'zone' }),
  deck: msg({ message: 'Deck', context: 'zone' }),
};
