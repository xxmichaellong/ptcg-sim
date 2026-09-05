/**
 * The shared "this room already exists" signal.
 *
 * Room creation retries a fresh code when a durable object turns out to be
 * taken. That check crosses the durable-object RPC boundary, which does not
 * preserve prototypes, so it matches the message rather than using
 * `instanceof` — and both the throw site and the retry share this constant so
 * the retry cannot silently stop working if the wording changes.
 *
 * Deliberately not re-exported from `index.ts`: this is internal coordination
 * between the durable store and the worker, not part of the package surface.
 */
export const ROOM_ALREADY_INITIALIZED_MESSAGE =
  'Room authority snapshot is already initialized';

export const isRoomAlreadyInitialized = (error: unknown): boolean =>
  error instanceof Error && error.message === ROOM_ALREADY_INITIALIZED_MESSAGE;
