/**
 * Durable room-session limits. Reconnecting sessions retain their place until
 * they explicitly leave or their grace period expires, so counting every
 * retained spectator session keeps admission and command fan-out bounded.
 */
export const MAX_ROOM_SPECTATOR_SESSIONS = 32;
