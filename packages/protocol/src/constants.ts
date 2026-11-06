export const PROTOCOL_VERSION = 2 as const;
export const MAX_CLIENT_FRAME_CODE_UNITS = 64 * 1024;
export const MAX_SERVER_FRAME_CODE_UNITS = 512 * 1024;
export const MAX_CHAT_CODE_UNITS = 1_000;
/** Presentation events one publication or replay frame carries at most. */
export const MAX_PRESENTATION_EVENTS = 100;
/**
 * The presentation events this client reads, sent in its Hello. A tab still
 * running an earlier build across a deploy sends none (level 0), and the
 * room leaves out what its schema would refuse -- a frame it can't read
 * ends its session. Raise it with each new event or verb, and say in
 * `presentationEventsForLevel` what the level before it can't read.
 *
 * 1 (2026-11-05): DamageSet, ConditionSet, and CardMoved's `switched`.
 * 2 (2026-11-06): ConditionSet's `conditions` and `off` (several Special
 *   Conditions at once); level 1 gets its single `condition`.
 */
export const PRESENTATION_LEVEL = 2;
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
/**
 * Mirrors game-core's image-reference limit without coupling protocol schemas
 * to the reducer package. protocol.test.ts enforces equality.
 */
export const MAX_IMAGE_URL_CODE_UNITS = 4_096;
/**
 * The most steps one group move (ApplyCardSteps) carries: 60 cards moved,
 * with what they need besides (the pieces joined, a shuffle at the end).
 */
export const MAX_CARD_STEPS = 120;
/** One base projection plus at most 128 accepted revision projections. */
export const MAX_REPLAY_FRAMES = 129;
/**
 * Server-owned grace after an admitted transport disappears. The client retry
 * budget is deliberately bounded below this deadline so expiry remains an
 * authority decision rather than a browser-timer decision.
 */
export const SESSION_RECONNECT_GRACE_MS = 30_000;
