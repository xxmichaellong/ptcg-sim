import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createReplayHistory,
  createRoomAdmissionState,
  emptyProjectionIdentityState,
  issueRoomAdmissionTicket,
  issueRoomCodeInvitation,
  redeemRoomAdmissionTicket,
  type RoomAuthoritySnapshot,
  type RoomInvitationCrypto,
} from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import {
  handleRoomCodeJoinRequest,
  joinRoomByAlias,
  ROOM_ALIAS_LEASE_MS,
  randomRoomAlias,
  RoomAliasCustody,
  RoomAliasDirectoryRecord,
  type RoomAliasRecord,
} from './room-alias.js';

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');
const ROOM = 'ABCDEFGHJKLM';

const digest = (capability: string): string => {
  let value = 2_166_136_261;
  for (const character of capability) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  return value.toString(16).padStart(8, '0').repeat(8);
};

const createCrypto = (): RoomInvitationCrypto => {
  let counter = 0;
  const next = (kind: string) =>
    `${kind}-capability-${String(++counter).padStart(24, '0')}`;
  return {
    digestCapability: async (capability) => digest(capability),
    equalDigest: (left, right) => left === right,
    nextSessionId: () => `session-${String(++counter).padStart(24, '0')}`,
    nextResumeCapability: () => next('resume'),
    nextAdmissionTicket: () => next('ticket'),
    nextRoomInvitation: () => next('invitation'),
  };
};

const baseSnapshot = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('alias-room'), [
    { playerId: p1, displayName: 'Player 1', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Player 2', cardBackUrl: '/red.png' },
  ]);
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'multiplayer',
    state,
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    sessions: {},
    admission: createRoomAdmissionState({
      playerSeatLimit: 2,
      playerIds: [p1, p2],
      seatCapabilityDigests: {
        [p1]: digest('host-seat-capability-00000000000001'),
        [p2]: digest('guest-seat-capability-0000000000002'),
      },
      spectatorCapabilityDigest: digest('spectator-capability-000000000003'),
    }),
  };
};

/** A room with its guest seated and one spectator, each by a code. */
const seatedRoom = async () => {
  const crypto = createCrypto();
  const deps = {
    crypto,
    persistence: { commitAdmission: async () => undefined },
    opaqueIds: { nextOpaqueId: (kind: 'card' | 'definition') => `o-${kind}` },
  };
  let snapshot = baseSnapshot();
  const admit = async (role: 'player' | 'spectator', name: string) => {
    const invited = await issueRoomCodeInvitation(
      snapshot,
      { requestedRole: role },
      1,
      deps
    );
    if (!invited.accepted) throw new Error(invited.code);
    const ticket = await issueRoomAdmissionTicket(
      invited.snapshot,
      {
        capability: invited.invitation,
        displayName: name,
        requestedRole: role,
      },
      2,
      deps
    );
    if (!ticket.accepted) throw new Error(ticket.code);
    const redeemed = await redeemRoomAdmissionTicket(
      ticket.snapshot,
      {
        admissionTicket: ticket.admissionTicket,
        resumeCapability: ticket.resumeCapability,
        displayName: name,
        requestedRole: role,
      },
      3,
      deps
    );
    if (!redeemed.accepted) throw new Error(redeemed.code);
    snapshot = redeemed.snapshot;
    return ticket.resumeCapability;
  };
  const guest = await admit('player', 'Red');
  const watcher = await admit('spectator', 'Grey');
  return { snapshot, guest, watcher, crypto };
};

const memoryRecord = () => {
  let value: RoomAliasRecord | undefined;
  return new RoomAliasDirectoryRecord({
    get: async () => value,
    put: async (record) => {
      value = record;
    },
    delete: async () => {
      value = undefined;
    },
  });
};

describe('room codes (ADR-047)', () => {
  it('holds a code for one room on a lease the room renews, and gives it back', async () => {
    const record = memoryRecord();
    expect(await record.claim(ROOM, 1_000)).toBe(true);
    expect(await record.resolve(1_001)).toBe(ROOM);
    // Another room can't take it while the lease lasts.
    expect(await record.claim('ZZZZZZZZZZZZ', 2_000)).toBe(false);
    // Renewed by its room.
    expect(await record.claim(ROOM, ROOM_ALIAS_LEASE_MS)).toBe(true);
    expect(await record.resolve(ROOM_ALIAS_LEASE_MS + 1_001)).toBe(ROOM);
    // Lapsed: nobody's, and free to take.
    expect(await record.resolve(3 * ROOM_ALIAS_LEASE_MS)).toBeNull();
    expect(await record.claim('ZZZZZZZZZZZZ', 3 * ROOM_ALIAS_LEASE_MS)).toBe(
      true
    );
    await record.release(ROOM);
    expect(await record.resolve(3 * ROOM_ALIAS_LEASE_MS + 1)).toBe(
      'ZZZZZZZZZZZZ'
    );
    await record.release('ZZZZZZZZZZZZ');
    expect(await record.resolve(3 * ROOM_ALIAS_LEASE_MS + 2)).toBeNull();
  });

  it('renews only a code its room still holds, never one given back', async () => {
    const record = memoryRecord();
    expect(await record.renew(ROOM, 1)).toBe(false);
    expect(await record.resolve(2)).toBeNull();
    await record.claim(ROOM, 10);
    expect(await record.renew(ROOM, ROOM_ALIAS_LEASE_MS)).toBe(true);
    expect(await record.resolve(ROOM_ALIAS_LEASE_MS + 11)).toBe(ROOM);
    expect(await record.renew('ZZZZZZZZZZZZ', ROOM_ALIAS_LEASE_MS)).toBe(false);
    await record.release(ROOM);
    expect(await record.renew(ROOM, ROOM_ALIAS_LEASE_MS + 1)).toBe(false);
    expect(await record.resolve(ROOM_ALIAS_LEASE_MS + 2)).toBeNull();
  });

  it('renews a code on a join, but not one its host changed while the join was under way', async () => {
    const records = new Map<string, ReturnType<typeof memoryRecord>>();
    const directory = (alias: string) => {
      let record = records.get(alias);
      if (!record) {
        record = memoryRecord();
        records.set(alias, record);
      }
      return record;
    };
    const admitted = {
      accepted: true,
      requestedRole: 'player',
      admissionTicket: 'ticket-capability-000000000000000001',
      resumeCapability: 'resume-capability-000000000000000002',
      expiresAt: 99,
    } as const;
    let now = 10;
    await directory('KEPT').claim(ROOM, now);
    const join = joinRoomByAlias({
      directory,
      join: async () => admitted,
      now: () => now,
    });
    // In use: a join late in the lease keeps the code the room's.
    now = ROOM_ALIAS_LEASE_MS;
    expect(
      await join({ code: 'KEPT', requestedRole: 'player', displayName: 'Red' })
    ).toEqual({ found: true, roomCode: ROOM, result: admitted });
    expect(await directory('KEPT').resolve(ROOM_ALIAS_LEASE_MS + 20)).toBe(
      ROOM
    );
    // The host changes the code while a join is under way: the old code is
    // given back, and the join doesn't take it again.
    await directory('GONE').claim(ROOM, now);
    const raced = joinRoomByAlias({
      directory,
      join: async () => {
        await directory('GONE').release(ROOM);
        return admitted;
      },
      now: () => now,
    });
    expect(
      await raced({ code: 'GONE', requestedRole: 'player', displayName: 'Red' })
    ).toEqual({ found: true, roomCode: ROOM, result: admitted });
    expect(await directory('GONE').resolve(now + 1)).toBeNull();
    // A code no room holds is not found, and nothing is joined.
    let joined = false;
    const unknown = joinRoomByAlias({
      directory,
      join: async () => {
        joined = true;
        return admitted;
      },
      now: () => now,
    });
    expect(
      await unknown({ code: 'NONE', requestedRole: 'player', displayName: 'X' })
    ).toEqual({ found: false });
    expect(joined).toBe(false);
  });

  it('makes codes of four from the alphabet without I, O, 0 or 1', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(randomRoomAlias()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/u);
    }
  });

  it("gives a room's players its code, the host the choice of another, and anyone watching only the one it has", async () => {
    const { snapshot, guest, watcher, crypto } = await seatedRoom();
    // The host: the first player's session, admitted by its own seat.
    const records = new Map<string, ReturnType<typeof memoryRecord>>();
    const directory = (alias: string) => {
      let record = records.get(alias);
      if (!record) {
        record = memoryRecord();
        records.set(alias, record);
      }
      return record;
    };
    let stored: string | undefined;
    const randoms = ['TAKN', 'QXP4', 'R7KM'];
    const custody = new RoomAliasCustody({
      roomCode: ROOM,
      snapshot: () => snapshot,
      authentication: crypto,
      stored: {
        get: async () => stored,
        put: async (alias) => {
          stored = alias;
        },
      },
      directory,
      now: () => 10_000,
      randomAlias: () => randoms.shift()!,
    });
    await directory('TAKN').claim('ANOTHERROOMX', 10_000);
    // Watching, before the room has a code: none to read, none made.
    expect(await custody.respond({ resumeToken: watcher })).toEqual({
      ok: false,
      error: 'no_code',
    });
    // A player: one is made (a taken one skipped), and kept.
    expect(await custody.respond({ resumeToken: guest })).toEqual({
      ok: true,
      code: 'QXP4',
      canChange: false,
    });
    expect(stored).toBe('QXP4');
    expect(await directory('QXP4').resolve(10_001)).toBe(ROOM);
    expect(await custody.respond({ resumeToken: watcher })).toEqual({
      ok: true,
      code: 'QXP4',
      canChange: false,
    });
    // Only the host chooses another.
    expect(await custody.respond({ resumeToken: guest, code: 'MYNE' })).toEqual(
      { ok: false, error: 'not_host' }
    );
    expect(
      await custody.respond({
        resumeToken: 'not-a-session-capability-00000000000',
      })
    ).toEqual({ ok: false, error: 'not_in_room' });
  });

  it('lets the host take a free code, refuses a taken one, and gives the old one back', async () => {
    const crypto = createCrypto();
    const deps = {
      crypto,
      persistence: { commitAdmission: async () => undefined },
      opaqueIds: { nextOpaqueId: (kind: 'card' | 'definition') => `o-${kind}` },
    };
    // The host seated by its own seat claim.
    const ticket = await issueRoomAdmissionTicket(
      baseSnapshot(),
      {
        capability: 'host-seat-capability-00000000000001',
        displayName: 'Blue',
        requestedRole: 'player',
      },
      1,
      deps
    );
    if (!ticket.accepted) throw new Error(ticket.code);
    const seated = await redeemRoomAdmissionTicket(
      ticket.snapshot,
      {
        admissionTicket: ticket.admissionTicket,
        resumeCapability: ticket.resumeCapability,
        displayName: 'Blue',
        requestedRole: 'player',
      },
      2,
      deps
    );
    if (!seated.accepted) throw new Error(seated.code);
    const host = ticket.resumeCapability;
    const records = new Map<string, ReturnType<typeof memoryRecord>>();
    const directory = (alias: string) => {
      let record = records.get(alias);
      if (!record) {
        record = memoryRecord();
        records.set(alias, record);
      }
      return record;
    };
    let stored: string | undefined = 'LDCD';
    await directory('LDCD').claim(ROOM, 5);
    await directory('BUSY').claim('ANOTHERROOMX', 5);
    const custody = new RoomAliasCustody({
      roomCode: ROOM,
      snapshot: () => seated.snapshot,
      authentication: crypto,
      stored: {
        get: async () => stored,
        put: async (alias) => {
          stored = alias;
        },
      },
      directory,
      now: () => 10,
    });
    expect(await custody.respond({ resumeToken: host })).toEqual({
      ok: true,
      code: 'LDCD',
      canChange: true,
    });
    expect(await custody.respond({ resumeToken: host, code: 'BUSY' })).toEqual({
      ok: false,
      error: 'code_taken',
    });
    expect(
      await custody.respond({ resumeToken: host, code: 'PKMNCLUB' })
    ).toEqual({ ok: true, code: 'PKMNCLUB', canChange: true });
    expect(stored).toBe('PKMNCLUB');
    expect(await directory('PKMNCLUB').resolve(11)).toBe(ROOM);
    // The old code is free again.
    expect(await directory('LDCD').resolve(11)).toBeNull();
  });

  it('makes whoever restored a saved game its host: theirs to change the code, not the first seat’s', async () => {
    const crypto = createCrypto();
    const deps = {
      crypto,
      persistence: { commitAdmission: async () => undefined },
      opaqueIds: { nextOpaqueId: (kind: 'card' | 'definition') => `o-${kind}` },
    };
    const seat = async (
      snapshot: RoomAuthoritySnapshot,
      capability: string,
      name: string
    ) => {
      const ticket = await issueRoomAdmissionTicket(
        snapshot,
        { capability, displayName: name, requestedRole: 'player' },
        1,
        deps
      );
      if (!ticket.accepted) throw new Error(ticket.code);
      const seated = await redeemRoomAdmissionTicket(
        ticket.snapshot,
        {
          admissionTicket: ticket.admissionTicket,
          resumeCapability: ticket.resumeCapability,
          displayName: name,
          requestedRole: 'player',
        },
        2,
        deps
      );
      if (!seated.accepted) throw new Error(seated.code);
      return { snapshot: seated.snapshot, resume: ticket.resumeCapability };
    };
    // The second player restored the game: their seat first, then the
    // first seat by the code.
    const restorer = await seat(
      baseSnapshot(),
      'guest-seat-capability-0000000000002',
      'Red'
    );
    const invited = await issueRoomCodeInvitation(
      restorer.snapshot,
      { requestedRole: 'player', hostPlayerId: p2 },
      3,
      deps
    );
    if (!invited.accepted) throw new Error(invited.code);
    const opponent = await seat(invited.snapshot, invited.invitation, 'Blue');
    let stored: string | undefined = 'OLDC';
    const records = new Map<string, ReturnType<typeof memoryRecord>>();
    const directory = (alias: string) => {
      let record = records.get(alias);
      if (!record) {
        record = memoryRecord();
        records.set(alias, record);
      }
      return record;
    };
    await directory('OLDC').claim(ROOM, 5);
    const custody = new RoomAliasCustody({
      roomCode: ROOM,
      snapshot: () => opponent.snapshot,
      authentication: crypto,
      stored: {
        get: async () => stored,
        put: async (alias) => {
          stored = alias;
        },
      },
      directory,
      now: () => 10,
      restoredBy: async () => p2,
    });
    expect(await custody.respond({ resumeToken: restorer.resume })).toEqual({
      ok: true,
      code: 'OLDC',
      canChange: true,
    });
    expect(
      await custody.respond({ resumeToken: opponent.resume, code: 'BLUE' })
    ).toEqual({ ok: false, error: 'not_host' });
    expect(
      await custody.respond({ resumeToken: restorer.resume, code: 'REDS' })
    ).toEqual({ ok: true, code: 'REDS', canChange: true });
  });

  it('answers a join by code: spent first, then the room, the code unknown, or the seat taken', async () => {
    const request = (body: unknown) =>
      new Request('https://ptcgsim.test/v2/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://ptcgsim.test',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: JSON.stringify(body),
      });
    const body = { code: 'QXP4', requestedRole: 'player', displayName: 'Red' };
    const allowed = async () => ({ allowed: true, retryAfterSeconds: 60 });
    // Refused by the edge budget before anything is looked up.
    let looked = false;
    const refused = await handleRoomCodeJoinRequest(
      request(body),
      async () => {
        looked = true;
        return { found: false };
      },
      async () => ({ allowed: false, retryAfterSeconds: 60 })
    );
    expect(refused.status).toBe(429);
    expect(looked).toBe(false);
    const unknown = await handleRoomCodeJoinRequest(
      request(body),
      async () => ({ found: false }),
      allowed
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'room_not_found' });
    const taken = await handleRoomCodeJoinRequest(
      request(body),
      async () => ({
        found: true,
        roomCode: ROOM,
        result: { accepted: false, code: 'seat_unavailable' },
      }),
      allowed
    );
    expect(taken.status).toBe(409);
    const admitted = await handleRoomCodeJoinRequest(
      request(body),
      async () => ({
        found: true,
        roomCode: ROOM,
        result: {
          accepted: true,
          requestedRole: 'player',
          admissionTicket: 'ticket-capability-000000000000000001',
          resumeCapability: 'resume-capability-000000000000000002',
          expiresAt: 99,
        },
      }),
      allowed
    );
    expect(admitted.status).toBe(201);
    expect(await admitted.json()).toEqual({
      roomCode: ROOM,
      requestedRole: 'player',
      admissionTicket: 'ticket-capability-000000000000000001',
      resumeToken: 'resume-capability-000000000000000002',
      expiresAt: 99,
    });
    // Not a code: refused before the budget is spent.
    const malformed = await handleRoomCodeJoinRequest(
      request({ ...body, code: 'O0I1' }),
      async () => ({ found: false }),
      allowed
    );
    expect(malformed.status).toBe(400);
  });
});
