import * as v from 'valibot';

import {
  ContinuationHandoffSchema,
  type ContinuationHandoff,
} from './schemas.js';

export const CONTINUATION_HANDOFF_TEXT_PREFIX = 'PTCGSIM2-SAVE:';
export const MAX_CONTINUATION_HANDOFF_TEXT_CODE_UNITS = 1_024;

export type ContinuationHandoffTextParseResult =
  | { readonly ok: true; readonly value: ContinuationHandoff }
  | {
      readonly ok: false;
      readonly reason:
        | 'invalid_type'
        | 'text_too_large'
        | 'invalid_prefix'
        | 'invalid_json'
        | 'invalid_handoff';
    };

/** Serializes the expiring capability envelope; it never contains match state. */
export const serializeContinuationHandoffText = (
  value: ContinuationHandoff
): string => {
  const handoff = v.parse(ContinuationHandoffSchema, value);
  const serialized = `${CONTINUATION_HANDOFF_TEXT_PREFIX}${JSON.stringify(
    handoff
  )}`;
  if (serialized.length > MAX_CONTINUATION_HANDOFF_TEXT_CODE_UNITS) {
    throw new RangeError('Continuation handoff text exceeds its bound');
  }
  return serialized;
};

/** Strict, bounded, canonical parser for an untrusted saved-game file. */
export const parseContinuationHandoffText = (
  text: unknown
): ContinuationHandoffTextParseResult => {
  if (typeof text !== 'string') return { ok: false, reason: 'invalid_type' };
  if (text.length > MAX_CONTINUATION_HANDOFF_TEXT_CODE_UNITS) {
    return { ok: false, reason: 'text_too_large' };
  }
  if (!text.startsWith(CONTINUATION_HANDOFF_TEXT_PREFIX)) {
    return { ok: false, reason: 'invalid_prefix' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(CONTINUATION_HANDOFF_TEXT_PREFIX.length));
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const parsed = v.safeParse(ContinuationHandoffSchema, raw);
  if (!parsed.success) return { ok: false, reason: 'invalid_handoff' };
  return serializeContinuationHandoffText(parsed.output) === text
    ? { ok: true, value: parsed.output }
    : { ok: false, reason: 'invalid_handoff' };
};
