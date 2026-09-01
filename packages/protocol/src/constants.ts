export const PROTOCOL_VERSION = 1 as const;
export const MAX_CLIENT_FRAME_CODE_UNITS = 64 * 1024;
export const MAX_SERVER_FRAME_CODE_UNITS = 512 * 1024;
export const MAX_CHAT_CODE_UNITS = 1_000;
export const MAX_ROOM_CODE_LENGTH = 64;
export const MAX_DECK_ENTRIES = 200;
export const MAX_DECK_CARDS = 200;
/** One base projection plus at most 128 accepted revision projections. */
export const MAX_REPLAY_FRAMES = 129;
