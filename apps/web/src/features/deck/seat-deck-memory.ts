import { deckListOf, isDeckFormatId, type DeckList } from '@ptcgsim/deck-core';
import { V2_ROOM_CODE_PATTERN } from '@ptcgsim/protocol';

import type { DeckBuilderTarget, DeckSlotLabel } from './deck-builder-store.js';
import { decodeDeckList, MAX_DECK_NAME_LENGTH } from './deck-library.js';

/**
 * The decks a Solo table's seats hold, kept with its room (ADR-044): the
 * room sends a table on rejoining, not the lists that made it, so a reload
 * would leave the deck screen's seats empty over a game in play. Each seat's
 * deck is written as it goes on the table and read back when the page sits
 * down at the same room again.
 *
 * As the room itself is: this tab's in session storage, the browser's in
 * local storage. Each keeps the last few rooms' seats by room code, so a tab
 * still at an older room never writes over the latest room's.
 */

export interface SeatDeck {
  readonly deck: DeckList;
  readonly label?: DeckSlotLabel;
}

export type SeatDecks = Partial<Record<DeckBuilderTarget, SeatDeck>>;

const KEY = 'ptcgsim.solo-decks.v2';
const FORMAT = 'ptcgsim-solo-decks-v2';
const TARGETS = ['main', 'alternate'] as const;
/** Rooms kept in each storage, the latest written first. */
const MAX_ROOMS = 4;

interface KeptRoom {
  readonly roomCode: string;
  readonly seats: SeatDecks;
}

const storages = (): Storage[] => {
  const found: Storage[] = [];
  for (const kind of ['session', 'local'] as const) {
    try {
      const storage =
        kind === 'session'
          ? globalThis.sessionStorage
          : globalThis.localStorage;
      if (storage) found.push(storage);
    } catch {
      // Refused (a sandboxed frame): the seats are simply not kept.
    }
  }
  return found;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const decodeLabel = (value: unknown): DeckSlotLabel | undefined => {
  if (!isRecord(value)) return undefined;
  const { name, deckId, format } = value;
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > MAX_DECK_NAME_LENGTH
  ) {
    return undefined;
  }
  return {
    name,
    ...(typeof deckId === 'string' && deckId.length > 0 && deckId.length <= 64
      ? { deckId }
      : {}),
    ...(isDeckFormatId(format) ? { format } : {}),
  };
};

const decodeSeat = (value: unknown): SeatDeck | undefined => {
  if (!isRecord(value)) return undefined;
  const entries = decodeDeckList(value.deck);
  if (!entries || entries.length === 0) return undefined;
  const label = decodeLabel(value.label);
  return { deck: deckListOf(entries), ...(label ? { label } : {}) };
};

const decodeRoom = (value: unknown): KeptRoom | undefined => {
  if (
    !isRecord(value) ||
    typeof value.roomCode !== 'string' ||
    !V2_ROOM_CODE_PATTERN.test(value.roomCode) ||
    !isRecord(value.seats)
  ) {
    return undefined;
  }
  const seats: SeatDecks = {};
  for (const target of TARGETS) {
    const seat = decodeSeat(value.seats[target]);
    if (seat) seats[target] = seat;
  }
  return { roomCode: value.roomCode, seats };
};

/** The rooms kept in `storage`; anything damaged left out, room by room. */
const readFrom = (storage: Storage): KeptRoom[] => {
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.format !== FORMAT ||
      !Array.isArray(value.rooms)
    ) {
      return [];
    }
    return value.rooms.flatMap((room) => {
      const kept = decodeRoom(room);
      return kept ? [kept] : [];
    });
  } catch {
    return [];
  }
};

/**
 * The seats' decks kept for `roomCode`: this tab's first, then the
 * browser's latest. Anything damaged is left out, seat by seat.
 */
export const recallSeatDecks = (roomCode: string): SeatDecks => {
  if (!V2_ROOM_CODE_PATTERN.test(roomCode)) return {};
  for (const storage of storages()) {
    const kept = readFrom(storage).find((room) => room.roomCode === roomCode);
    if (kept) return kept.seats;
  }
  return {};
};

/**
 * Keeps `seat`'s deck as the one on `roomCode`'s table, beside the other
 * seat's (kept as it was, for the same room), and other rooms' as they
 * were. An empty deck (the seat cleared) forgets the seat's, so a reload
 * doesn't bring it back.
 */
export const rememberSeatDeck = (
  roomCode: string,
  target: DeckBuilderTarget,
  seat: SeatDeck
): void => {
  if (!V2_ROOM_CODE_PATTERN.test(roomCode)) return;
  const { [target]: _previous, ...others } = recallSeatDecks(roomCode);
  const seats: SeatDecks =
    seat.deck.length === 0 ? others : { ...others, [target]: seat };
  for (const storage of storages()) {
    const rooms = [
      { roomCode, seats },
      ...readFrom(storage).filter((room) => room.roomCode !== roomCode),
    ].slice(0, MAX_ROOMS);
    try {
      storage.setItem(KEY, JSON.stringify({ format: FORMAT, rooms }));
    } catch {
      // Storage full or refused: the seats are simply not kept.
    }
  }
};
