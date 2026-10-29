import * as v from 'valibot';

import {
  RoomInvitationHandoffSchema,
  type RoomInvitationHandoff,
} from './schemas.js';

export const ROOM_INVITATION_HANDOFF_TEXT_PREFIX = 'PTCGSIM2-INVITE:';
export const MAX_ROOM_INVITATION_HANDOFF_TEXT_CODE_UNITS = 1_024;

export type RoomInvitationHandoffTextParseResult =
  | { readonly ok: true; readonly value: RoomInvitationHandoff }
  | {
      readonly ok: false;
      readonly reason:
        | 'invalid_type'
        | 'text_too_large'
        | 'invalid_prefix'
        | 'invalid_json'
        | 'invalid_handoff';
    };

/**
 * Produces the deliberately non-URL invitation envelope copied between
 * browsers. The prefix lets the lobby distinguish an invitation paste from a
 * harmless room-code paste before any value reaches an input element.
 */
export const serializeRoomInvitationHandoffText = (
  value: RoomInvitationHandoff
): string => {
  const handoff = v.parse(RoomInvitationHandoffSchema, value);
  const serialized = `${ROOM_INVITATION_HANDOFF_TEXT_PREFIX}${JSON.stringify(
    handoff
  )}`;
  if (serialized.length > MAX_ROOM_INVITATION_HANDOFF_TEXT_CODE_UNITS) {
    throw new RangeError('Room invitation handoff text exceeds its bound');
  }
  return serialized;
};

/** Strict, bounded parser for untrusted foreground clipboard text. */
export const parseRoomInvitationHandoffText = (
  text: unknown
): RoomInvitationHandoffTextParseResult => {
  if (typeof text !== 'string') return { ok: false, reason: 'invalid_type' };
  if (text.length > MAX_ROOM_INVITATION_HANDOFF_TEXT_CODE_UNITS) {
    return { ok: false, reason: 'text_too_large' };
  }
  if (!text.startsWith(ROOM_INVITATION_HANDOFF_TEXT_PREFIX)) {
    return { ok: false, reason: 'invalid_prefix' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(ROOM_INVITATION_HANDOFF_TEXT_PREFIX.length));
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const parsed = v.safeParse(RoomInvitationHandoffSchema, raw);
  if (!parsed.success) return { ok: false, reason: 'invalid_handoff' };
  return serializeRoomInvitationHandoffText(parsed.output) === text
    ? { ok: true, value: parsed.output }
    : { ok: false, reason: 'invalid_handoff' };
};

/**
 * An invitation as a link (ADR-020, 2026-10-29): the same envelope, carried
 * in the URL's fragment, which a browser never sends to a server or puts in
 * a Referer. The app reads it on load and clears it from the address bar at
 * once; the claim inside stays one-use and short-lived.
 */
export const ROOM_INVITATION_LINK_KEY = 'invite';
/**
 * The envelope's bound as base64url: at most three UTF-8 bytes a code unit,
 * four characters for every three bytes.
 */
export const MAX_ROOM_INVITATION_LINK_PAYLOAD_LENGTH =
  MAX_ROOM_INVITATION_HANDOFF_TEXT_CODE_UNITS * 4;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
};

const fromBase64Url = (payload: string): Uint8Array | undefined => {
  try {
    const binary = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
};

/** The fragment (without its `#`) of an invitation link. */
export const serializeRoomInvitationLinkFragment = (
  value: RoomInvitationHandoff
): string =>
  `${ROOM_INVITATION_LINK_KEY}=${toBase64Url(
    new TextEncoder().encode(serializeRoomInvitationHandoffText(value))
  )}`;

/**
 * Strict, bounded parser for a link's fragment (with or without its `#`):
 * exactly `invite=<base64url>`, decoding to a valid envelope.
 */
export const parseRoomInvitationLinkFragment = (
  fragment: unknown
): RoomInvitationHandoffTextParseResult => {
  if (typeof fragment !== 'string') {
    return { ok: false, reason: 'invalid_type' };
  }
  const bare = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const prefix = `${ROOM_INVITATION_LINK_KEY}=`;
  if (!bare.startsWith(prefix)) return { ok: false, reason: 'invalid_prefix' };
  const payload = bare.slice(prefix.length);
  if (payload.length > MAX_ROOM_INVITATION_LINK_PAYLOAD_LENGTH) {
    return { ok: false, reason: 'text_too_large' };
  }
  if (!BASE64URL_PATTERN.test(payload)) {
    return { ok: false, reason: 'invalid_handoff' };
  }
  const bytes = fromBase64Url(payload);
  if (!bytes) return { ok: false, reason: 'invalid_handoff' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: 'invalid_handoff' };
  }
  const parsed = parseRoomInvitationHandoffText(text);
  if (!parsed.ok) return parsed;
  // One spelling per invitation, as the envelope has.
  return serializeRoomInvitationLinkFragment(parsed.value) === bare
    ? parsed
    : { ok: false, reason: 'invalid_handoff' };
};

/**
 * An invitation however it was passed on: the envelope, a link to it, or a
 * link's fragment, with the white space a chat app may add round it.
 */
export const parseRoomInvitationText = (
  text: unknown
): RoomInvitationHandoffTextParseResult => {
  if (typeof text !== 'string') return { ok: false, reason: 'invalid_type' };
  // A link is its fragment and an origin and path of a sensible length.
  if (text.length > MAX_ROOM_INVITATION_LINK_PAYLOAD_LENGTH + 2_048) {
    return { ok: false, reason: 'text_too_large' };
  }
  const trimmed = text.trim();
  if (trimmed.startsWith(ROOM_INVITATION_HANDOFF_TEXT_PREFIX)) {
    return parseRoomInvitationHandoffText(trimmed);
  }
  const hash = trimmed.indexOf('#');
  return parseRoomInvitationLinkFragment(
    hash === -1 ? trimmed : trimmed.slice(hash + 1)
  );
};
