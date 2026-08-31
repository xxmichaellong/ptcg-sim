import * as v from 'valibot';
import type { MatchViewState } from '@ptcgsim/game-core';
import {
  MAX_CLIENT_FRAME_CODE_UNITS,
  MAX_SERVER_FRAME_CODE_UNITS,
} from './constants.js';
import {
  ClientMessageSchema,
  MatchViewStateSchema,
  ServerMessageSchema,
  type ClientMessage,
  type SerializedMatchViewState,
  type ServerMessage,
} from './schemas.js';

export type FrameParseResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | {
      readonly ok: false;
      readonly reason: 'frame_too_large' | 'invalid_json' | 'invalid_message';
      readonly issues?: readonly {
        readonly path: string;
        readonly message: string;
      }[];
    };

const issueSummary = (
  issues: readonly v.BaseIssue<unknown>[]
): readonly { path: string; message: string }[] =>
  issues.slice(0, 5).map((issue) => ({
    path:
      issue.path
        ?.map((item) => String(item.key))
        .filter(Boolean)
        .join('.') ?? '',
    message: issue.message.slice(0, 200),
  }));

const parseFrame = <Schema extends v.GenericSchema>(
  frame: string,
  maximumCodeUnits: number,
  schema: Schema
): FrameParseResult<v.InferOutput<Schema>> => {
  if (frame.length > maximumCodeUnits) {
    return { ok: false, reason: 'frame_too_large' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(frame);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const parsed = v.safeParse(schema, raw);
  return parsed.success
    ? { ok: true, value: parsed.output }
    : {
        ok: false,
        reason: 'invalid_message',
        issues: issueSummary(parsed.issues),
      };
};

export const parseClientFrame = (
  frame: string
): FrameParseResult<ClientMessage> =>
  parseFrame(frame, MAX_CLIENT_FRAME_CODE_UNITS, ClientMessageSchema);

export const parseServerFrame = (
  frame: string
): FrameParseResult<ServerMessage> =>
  parseFrame(frame, MAX_SERVER_FRAME_CODE_UNITS, ServerMessageSchema);

export const serializeMatchViewState = (
  value: unknown
): SerializedMatchViewState => v.parse(MatchViewStateSchema, value);

/**
 * Restores compile-time view-ID brands after a server frame has passed the
 * runtime schema. Brands have no wire representation, so this is intentionally
 * the only transport-to-client-view cast.
 */
export const hydrateMatchViewState = (
  value: SerializedMatchViewState
): MatchViewState => value as unknown as MatchViewState;
