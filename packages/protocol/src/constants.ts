export const PROTOCOL_VERSION = 2 as const;
export const MAX_CLIENT_FRAME_CODE_UNITS = 64 * 1024;
export const MAX_SERVER_FRAME_CODE_UNITS = 512 * 1024;
export const MAX_CHAT_CODE_UNITS = 1_000;
export const MAX_ROOM_CODE_LENGTH = 64;
/** Generated v2 room discovery codes omit ambiguous I/O/0/1 characters. */
export const V2_ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/u;
export const MAX_DECK_ENTRIES = 200;
/**
 * Mirrors game-core's reducer limit. Keep this local to the wire package so
 * importing protocol schemas cannot pull the game engine into web bundles;
 * protocol.test.ts enforces equality across the package boundary.
 */
export const MAX_DECK_CARDS = 200;
/** One base projection plus at most 128 accepted revision projections. */
export const MAX_REPLAY_FRAMES = 129;
