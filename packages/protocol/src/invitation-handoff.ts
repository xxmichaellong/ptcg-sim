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
