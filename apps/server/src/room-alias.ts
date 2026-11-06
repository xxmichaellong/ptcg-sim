import {
  parseRoomAliasRequest,
  parseRoomCodeJoinRequest,
  ROOM_ALIAS_ALPHABET,
  ROOM_ALIAS_GENERATED_LENGTH,
  type RoomAliasRequest,
  type RoomCodeJoinRequest,
} from '@ptcgsim/protocol';
import {
  validateAuthoritySnapshot,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

import {
  browserJsonResponse as json,
  isIdentityJsonRequest,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from './browser-json-http.js';
import type { BoundedRoomCodeAdmissionResult } from './session-hub.js';

/**
 * Rooms by their public code (ADR-047). A room opened to others is given a
 * short code -- four characters, or one its host chooses -- that anyone may
 * type to join it. The code is an alias: each one is its own small record
 * (a Durable Object named by the code) pointing at the room's twelve
 * character code, held on a lease the room renews while it is in use, so a
 * room left alone gives its code back.
 */

/** How long a code stays a room's without the room renewing it. */
export const ROOM_ALIAS_LEASE_MS = 12 * 60 * 60_000;

export interface RoomAliasRecord {
  readonly roomCode: string;
  readonly leaseUntil: number;
}

/** The record's storage: one value, under one key. */
export interface RoomAliasRecordStorage {
  readonly get: () => Promise<RoomAliasRecord | undefined>;
  readonly put: (record: RoomAliasRecord) => Promise<void>;
  readonly delete: () => Promise<void>;
}

const liveRecord = (
  record: RoomAliasRecord | undefined,
  now: number
): RoomAliasRecord | undefined =>
  record && record.leaseUntil > now ? record : undefined;

/** One code's record: whose it is, while its lease lasts. */
export class RoomAliasDirectoryRecord {
  constructor(private readonly storage: RoomAliasRecordStorage) {}

  /**
   * Takes the code for `roomCode`, or renews it for the room that holds
   * it: false while another room holds it.
   */
  async claim(roomCode: string, now: number): Promise<boolean> {
    const held = liveRecord(await this.storage.get(), now);
    if (held && held.roomCode !== roomCode) return false;
    await this.storage.put({ roomCode, leaseUntil: now + ROOM_ALIAS_LEASE_MS });
    return true;
  }

  /** The room the code stands for now, if any. */
  async resolve(now: number): Promise<string | null> {
    return liveRecord(await this.storage.get(), now)?.roomCode ?? null;
  }

  /** Gives the code back, if `roomCode` holds it. */
  async release(roomCode: string): Promise<void> {
    const record = await this.storage.get();
    if (record?.roomCode === roomCode) await this.storage.delete();
  }
}

/** A code made at random from the alias alphabet. */
export const randomRoomAlias = (
  length: number = ROOM_ALIAS_GENERATED_LENGTH,
  randomBytes: (count: number) => Uint8Array = (count) =>
    crypto.getRandomValues(new Uint8Array(count))
): string =>
  [...randomBytes(length)]
    .map((value) => ROOM_ALIAS_ALPHABET[value % ROOM_ALIAS_ALPHABET.length])
    .join('');

export interface RoomSessionAuthenticationSource {
  readonly digestCapability: (value: string) => Promise<string>;
  readonly equalDigest: (left: string, right: string) => boolean;
}

/** Who a resume bearer belongs to in this room, if anyone live. */
export const authenticateRoomSession = async (
  snapshot: RoomAuthoritySnapshot,
  resumeCapability: string,
  source: RoomSessionAuthenticationSource
): Promise<
  | {
      readonly sessionId: string;
      readonly host: boolean;
      readonly player: boolean;
    }
  | undefined
> => {
  validateAuthoritySnapshot(snapshot);
  const supplied = await source.digestCapability(resumeCapability);
  const matches = Object.values(snapshot.sessions).filter(
    (session) =>
      session.active &&
      typeof session.resumeCapabilityDigest === 'string' &&
      source.equalDigest(session.resumeCapabilityDigest, supplied)
  );
  if (matches.length !== 1) return undefined;
  const session = matches[0]!;
  const player = session.viewer.kind === 'player';
  return {
    sessionId: session.id,
    player,
    host:
      session.viewer.kind === 'player' &&
      session.viewer.playerId === snapshot.state.playerOrder[0],
  };
};

/** What a room needs to keep its own code (the Durable Object, or tests). */
export interface RoomAliasCustodyDependencies {
  readonly roomCode: string;
  readonly snapshot: () => RoomAuthoritySnapshot | undefined;
  readonly authentication: RoomSessionAuthenticationSource;
  /** The room's own memory of its code. */
  readonly stored: {
    readonly get: () => Promise<string | undefined>;
    readonly put: (alias: string) => Promise<void>;
  };
  /** The directory's record for a code. */
  readonly directory: (alias: string) => {
    readonly claim: (roomCode: string, now: number) => Promise<boolean>;
    readonly release: (roomCode: string) => Promise<void>;
  };
  readonly now: () => number;
  readonly randomAlias?: (length: number) => string;
}

export type RoomAliasCustodyResult =
  | { readonly ok: true; readonly code: string; readonly canChange: boolean }
  | {
      readonly ok: false;
      readonly error:
        | 'room_not_ready'
        | 'not_in_room'
        | 'not_host'
        | 'code_taken'
        | 'no_code';
    };

/** Codes tried at random before a longer one is tried. */
const RANDOM_ATTEMPTS = 12;

/**
 * A room's own code (ADR-047): read by anyone in the room, made for a
 * player when it has none (or its lease lapsed and another room took it),
 * and chosen by the host. One request at a time, so a change and a renewal
 * never cross.
 */
export class RoomAliasCustody {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly dependencies: RoomAliasCustodyDependencies) {}

  respond(request: RoomAliasRequest): Promise<RoomAliasCustodyResult> {
    const run = this.tail.then(() => this.answer(request));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async answer(
    request: RoomAliasRequest
  ): Promise<RoomAliasCustodyResult> {
    const deps = this.dependencies;
    const snapshot = deps.snapshot();
    if (!snapshot || snapshot.mode !== 'multiplayer') {
      return { ok: false, error: 'room_not_ready' };
    }
    const asker = await authenticateRoomSession(
      snapshot,
      request.resumeToken,
      deps.authentication
    );
    if (!asker) return { ok: false, error: 'not_in_room' };
    const now = deps.now();
    const current = await deps.stored.get();
    if (request.code !== undefined && request.code !== current) {
      if (!asker.host) return { ok: false, error: 'not_host' };
      if (!(await deps.directory(request.code).claim(deps.roomCode, now))) {
        return { ok: false, error: 'code_taken' };
      }
      await deps.stored.put(request.code);
      if (current) await deps.directory(current).release(deps.roomCode);
      return { ok: true, code: request.code, canChange: true };
    }
    // Kept: renewed. Lapsed and taken by another room, or never made: a
    // player is given a new one; someone watching is told there is none.
    if (current && (await deps.directory(current).claim(deps.roomCode, now))) {
      return { ok: true, code: current, canChange: asker.host };
    }
    if (!asker.player) return { ok: false, error: 'no_code' };
    const made = await this.allocate(now);
    await deps.stored.put(made);
    return { ok: true, code: made, canChange: asker.host };
  }

  private async allocate(now: number): Promise<string> {
    const deps = this.dependencies;
    const random = deps.randomAlias ?? ((length) => randomRoomAlias(length));
    for (const length of [4, 5, 6]) {
      for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt += 1) {
        const candidate = random(length);
        if (await deps.directory(candidate).claim(deps.roomCode, now)) {
          return candidate;
        }
      }
    }
    throw new Error('room_alias_exhausted');
  }
}

const MAX_ROOM_ALIAS_REQUEST_BYTES = 1_024;

/** The same strict browser-only JSON exchange as an admission ticket. */
const readStrictJson = async (
  request: Request,
  maximumBytes: number
): Promise<{ readonly body: unknown } | { readonly response: Response }> => {
  if (request.method !== 'POST') {
    return {
      response: json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' }),
    };
  }
  if (new URL(request.url).search) {
    return { response: json({ error: 'invalid_request' }, 400) };
  }
  if (!isSameOriginBrowserRequest(request)) {
    return { response: json({ error: 'forbidden_origin' }, 403) };
  }
  if (!isIdentityJsonRequest(request)) {
    return { response: json({ error: 'unsupported_media_type' }, 415) };
  }
  try {
    return { body: await readBoundedJsonRequest(request, maximumBytes) };
  } catch (error) {
    return {
      response: json(
        {
          error:
            error instanceof RangeError ? 'request_too_large' : 'invalid_json',
        },
        error instanceof RangeError ? 413 : 400
      ),
    };
  }
};

/** POST /v2/rooms/:room/code: the room's public code, or a new one. */
export const handleRoomAliasRequest = async (
  request: Request,
  respond: (input: RoomAliasRequest) => Promise<RoomAliasCustodyResult>
): Promise<Response> => {
  const read = await readStrictJson(request, MAX_ROOM_ALIAS_REQUEST_BYTES);
  if ('response' in read) return read.response;
  const parsed = parseRoomAliasRequest(read.body);
  if (!parsed.ok) return json({ error: 'invalid_request' }, 400);
  try {
    const result = await respond(parsed.value);
    if (result.ok) {
      return json({ code: result.code, canChange: result.canChange }, 200);
    }
    switch (result.error) {
      case 'room_not_ready':
        return json({ error: 'room_not_ready' }, 409);
      case 'not_in_room':
        return json({ error: 'not_in_room' }, 403);
      case 'not_host':
        return json({ error: 'not_host' }, 403);
      case 'code_taken':
        return json({ error: 'code_taken' }, 409);
      case 'no_code':
        return json({ error: 'no_code' }, 404);
    }
  } catch {
    return json({ error: 'internal_retryable' }, 503, { 'Retry-After': '1' });
  }
};

/** Looks a code up and admits by it, in the room it names. */
export type RoomCodeJoiner = (request: RoomCodeJoinRequest) => Promise<
  | { readonly found: false }
  | {
      readonly found: true;
      readonly roomCode: string;
      readonly result: BoundedRoomCodeAdmissionResult;
    }
>;

/** POST /v2/join: a room by its public code, to play or to watch. */
export const handleRoomCodeJoinRequest = async (
  request: Request,
  join: RoomCodeJoiner,
  rateLimit: () => Promise<{
    readonly allowed: boolean;
    readonly retryAfterSeconds: number;
  }>
): Promise<Response> => {
  const read = await readStrictJson(request, MAX_ROOM_ALIAS_REQUEST_BYTES);
  if ('response' in read) return read.response;
  const parsed = parseRoomCodeJoinRequest(read.body);
  if (!parsed.ok) return json({ error: 'invalid_request' }, 400);
  try {
    // Spent before the code is looked up: four characters must not be
    // guessed through quickly.
    const decision = await rateLimit();
    if (!decision.allowed) {
      return json({ error: 'rate_limited' }, 429, {
        'Retry-After': String(decision.retryAfterSeconds),
      });
    }
    const joined = await join(parsed.value);
    if (!joined.found) return json({ error: 'room_not_found' }, 404);
    const result = joined.result;
    if (result.accepted) {
      return json(
        {
          roomCode: joined.roomCode,
          requestedRole: result.requestedRole,
          admissionTicket: result.admissionTicket,
          resumeToken: result.resumeCapability,
          expiresAt: result.expiresAt,
        },
        201
      );
    }
    switch (result.code) {
      case 'seat_unavailable':
        return json({ error: 'seat_unavailable' }, 409);
      case 'room_not_ready':
        return json({ error: 'room_not_found' }, 404);
      case 'rate_limited':
        return json({ error: 'rate_limited' }, 429, {
          'Retry-After': String(result.retryAfterSeconds),
        });
      case 'invitation_capacity':
      case 'ticket_capacity':
        return json({ error: 'room_busy' }, 429, { 'Retry-After': '1' });
      case 'invalid_request':
      case 'invalid_capability':
        return json({ error: 'invalid_request' }, 400);
    }
  } catch {
    return json({ error: 'internal_retryable' }, 503, { 'Retry-After': '1' });
  }
};
