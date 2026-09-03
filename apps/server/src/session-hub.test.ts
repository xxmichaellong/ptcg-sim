import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_AUTHORITY_POLICY,
  RoomAuthorityCoordinator,
  createRoomAdmissionState,
  createReplayHistory,
  emptyProjectionIdentityState,
  type AuthoritySnapshotStore,
  type PersistedAdmissionTransaction,
  type PersistedAuthorityTransaction,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { PROTOCOL_VERSION, type ServerMessage } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import { WebCryptoAuthoritySource } from './authority-crypto.js';
import { RoomSessionHub, type RuntimeConnection } from './session-hub.js';

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');

const allowRoomOperations = {
  attempt: async () => ({ allowed: true, remaining: 1 }) as const,
};

class MemoryAuthorityStore implements AuthoritySnapshotStore {
  commandCommits: PersistedAuthorityTransaction[] = [];
  admissionCommits: PersistedAdmissionTransaction[] = [];
  failAdmissionAfterCommitOnce = false;

  constructor(public durable: RoomAuthoritySnapshot) {}

  async load() {
    return this.durable;
  }

  async commit(transaction: PersistedAuthorityTransaction) {
    expect(transaction.expectedAuthorityVersion).toBe(
      this.durable.authorityVersion
    );
    this.commandCommits.push(transaction);
    this.durable = transaction.snapshot;
  }

  async commitAdmission(transaction: PersistedAdmissionTransaction) {
    expect(transaction.expectedAuthorityVersion).toBe(
      this.durable.authorityVersion
    );
    this.admissionCommits.push(transaction);
    this.durable = transaction.snapshot;
    if (this.failAdmissionAfterCommitOnce) {
      this.failAdmissionAfterCommitOnce = false;
      throw new Error('simulated response-path failure');
    }
  }
}

const connection = (id: string) => {
  const messages: ServerMessage[] = [];
  const close = vi.fn();
  const value: RuntimeConnection = {
    id,
    send: (frame) => messages.push(JSON.parse(frame) as ServerMessage),
    close,
  };
  return { value, messages, close };
};

const fixture = async () => {
  const crypto = new WebCryptoAuthoritySource();
  const seatToken = crypto.nextSeatCapability();
  const otherSeatToken = crypto.nextSeatCapability();
  const state = createEmptyMatch(asMatchId('hub-room'), [
    { playerId: p1, displayName: 'Player 1', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Player 2', cardBackUrl: '/red.png' },
  ]);
  const initial: RoomAuthoritySnapshot = {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'multiplayer',
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    sessions: {},
    admission: createRoomAdmissionState({
      playerIds: [p1, p2],
      seatCapabilityDigests: {
        [p1]: await crypto.digestCapability(seatToken),
        [p2]: await crypto.digestCapability(otherSeatToken),
      },
    }),
  };
  const store = new MemoryAuthorityStore(initial);
  const coordinator = new RoomAuthorityCoordinator(initial, store, {
    commandContext: crypto,
    opaqueIds: crypto,
    policy: DEFAULT_AUTHORITY_POLICY,
  });
  const rateLimits = {
    attempt: vi.fn(async () => ({ allowed: true, remaining: 1 }) as const),
  };
  const hub = new RoomSessionHub(coordinator, 'server-build', {
    store,
    rateLimits,
    admission: {
      crypto,
      opaqueIds: crypto,
      persistence: store,
      now: () => 10_000,
    },
  });
  const issued = await hub.issueAdmissionTicket({
    capability: seatToken,
    displayName: 'Blue',
    requestedRole: 'player',
  });
  if (!issued.accepted) throw new Error(issued.code);
  return {
    hub,
    store,
    admissionTicket: issued.admissionTicket,
    seatCapability: seatToken,
    otherSeatCapability: otherSeatToken,
    crypto,
    rateLimits,
  };
};

const helloFrame = (input: {
  readonly admissionTicket?: string;
  readonly resumeToken?: string;
}): string =>
  JSON.stringify({
    type: 'Hello',
    protocolVersion: PROTOCOL_VERSION,
    buildId: 'client-build',
    roomCode: 'ROOM',
    displayName: 'Blue',
    requestedRole: 'player',
    ...input,
  });

describe('serialized room session hub', () => {
  it('rejects over-budget operations before authority mutation', async () => {
    const setup = await fixture();
    setup.rateLimits.attempt.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 23,
    });

    await expect(
      setup.hub.issueInvitation({
        capability: setup.otherSeatCapability,
        requestedRole: 'player',
      })
    ).resolves.toMatchObject({
      accepted: false,
      code: 'rate_limited',
      retryAfterSeconds: 23,
      snapshot: { authorityVersion: 1 },
    });
    expect(setup.store.admissionCommits).toHaveLength(1);

    await expect(setup.hub.reserveSocketUpgrade()).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 23,
    });
    expect(setup.rateLimits.attempt.mock.calls.slice(-2)).toEqual([
      ['invitation', 10_000],
      ['socket_upgrade', 10_000],
    ]);
  });

  it('bounds repeated Hello attempts on an already-open socket', async () => {
    const setup = await fixture();
    setup.rateLimits.attempt.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 11,
    });
    const client = connection('over-budget-hello');

    await setup.hub.handleFrame(
      client.value,
      helloFrame({ admissionTicket: setup.admissionTicket })
    );

    expect(client.messages).toEqual([
      expect.objectContaining({
        type: 'ServerNotice',
        code: 'rate_limited',
        retryable: true,
      }),
    ]);
    expect(setup.store.admissionCommits).toHaveLength(1);
    expect(setup.rateLimits.attempt).toHaveBeenLastCalledWith(
      'session_hello',
      10_000
    );
  });

  it('reloads a ticket commit when persistence reports failure after durability', async () => {
    const setup = await fixture();
    setup.store.failAdmissionAfterCommitOnce = true;
    await expect(
      setup.hub.issueAdmissionTicket({
        capability: setup.seatCapability,
        displayName: 'Blue',
        requestedRole: 'player',
      })
    ).rejects.toThrow('simulated response-path failure');

    const recovered = await setup.hub.issueAdmissionTicket({
      capability: setup.seatCapability,
      displayName: 'Blue',
      requestedRole: 'player',
    });
    expect(recovered.accepted).toBe(true);
    expect(setup.store.durable.authorityVersion).toBe(3);
  });

  it('reloads and safely rotates an invitation committed before a failed response', async () => {
    const setup = await fixture();
    setup.store.failAdmissionAfterCommitOnce = true;
    await expect(
      setup.hub.issueInvitation({
        capability: setup.otherSeatCapability,
        requestedRole: 'player',
      })
    ).rejects.toThrow('simulated response-path failure');

    const lostDigest = setup.store.admissionCommits.at(-1);
    expect(lostDigest).toMatchObject({ kind: 'invitation_issued' });
    const recovered = await setup.hub.issueInvitation({
      capability: setup.otherSeatCapability,
      requestedRole: 'player',
    });
    expect(recovered.accepted).toBe(true);
    if (!recovered.accepted) return;
    expect(setup.store.durable.authorityVersion).toBe(3);
    expect(
      Object.keys(setup.store.durable.admission?.invitations ?? {})
    ).toEqual([await setup.crypto.digestCapability(recovered.invitation)]);
    expect(setup.store.admissionCommits.map((item) => item.kind)).toEqual([
      'ticket_issued',
      'invitation_issued',
      'invitation_issued',
    ]);
  });

  it('recovers a lost invitation-exchange response and admits the guest exactly once', async () => {
    const setup = await fixture();
    const invitation = await setup.hub.issueInvitation({
      capability: setup.otherSeatCapability,
      requestedRole: 'player',
    });
    if (!invitation.accepted) throw new Error(invitation.code);

    setup.store.failAdmissionAfterCommitOnce = true;
    await expect(
      setup.hub.issueAdmissionTicket({
        capability: invitation.invitation,
        displayName: 'Blue',
        requestedRole: 'player',
      })
    ).rejects.toThrow('simulated response-path failure');
    const lostTicket = setup.store.admissionCommits.at(-1);
    if (lostTicket?.kind !== 'ticket_issued') {
      throw new Error('missing lost ticket transaction');
    }

    const recovered = await setup.hub.issueAdmissionTicket({
      capability: invitation.invitation,
      displayName: 'Blue',
      requestedRole: 'player',
    });
    if (!recovered.accepted) throw new Error(recovered.code);
    const recoveredDigest = await setup.crypto.digestCapability(
      recovered.admissionTicket
    );
    expect(recoveredDigest).not.toBe(lostTicket.ticketDigest);
    expect(setup.store.durable.admission?.tickets).not.toHaveProperty(
      lostTicket.ticketDigest
    );

    const guest = connection('invited-guest');
    await setup.hub.handleFrame(
      guest.value,
      helloFrame({ admissionTicket: recovered.admissionTicket })
    );
    expect(guest.messages[0]).toMatchObject({
      type: 'Welcome',
      role: 'player',
    });
    expect(setup.store.durable.admission?.invitations).toEqual({});
    expect(setup.store.durable.admission?.tickets).not.toHaveProperty(
      recoveredDigest
    );
    expect(setup.store.durable.admission?.seats[p2]?.claimedSessionId).toBe(
      guest.messages[0]?.type === 'Welcome'
        ? guest.messages[0].sessionId
        : undefined
    );

    const replay = await setup.hub.issueAdmissionTicket({
      capability: invitation.invitation,
      displayName: 'Blue',
      requestedRole: 'player',
    });
    expect(replay).toMatchObject({
      accepted: false,
      code: 'invalid_capability',
    });
  });

  it('admits, resumes, and supersedes one controlling connection per session', async () => {
    const setup = await fixture();
    const first = connection('connection-one');
    await setup.hub.handleFrame(
      first.value,
      helloFrame({ admissionTicket: setup.admissionTicket })
    );
    const welcome = first.messages[0];
    expect(welcome).toMatchObject({ type: 'Welcome', role: 'player' });
    if (welcome?.type !== 'Welcome') throw new Error('missing welcome');

    const replay = connection('connection-ticket-replay');
    await setup.hub.handleFrame(
      replay.value,
      helloFrame({ admissionTicket: setup.admissionTicket })
    );
    expect(replay.messages[0]).toMatchObject({
      type: 'ServerNotice',
      code: 'invalid_capability',
      retryable: false,
    });

    const second = connection('connection-two');
    await setup.hub.handleFrame(
      second.value,
      helloFrame({ resumeToken: welcome.resumeToken })
    );

    expect(first.messages.at(-1)).toMatchObject({ type: 'SessionSuperseded' });
    expect(first.close).toHaveBeenCalledWith(4409, 'Session superseded');
    expect(second.messages[0]).toMatchObject({
      type: 'Welcome',
      sessionId: welcome.sessionId,
    });
    expect(setup.store.admissionCommits.map((item) => item.kind)).toEqual([
      'ticket_issued',
      'seat_claimed',
      'session_resumed',
    ]);
  });

  it('routes an accepted command publication before its result', async () => {
    const setup = await fixture();
    const client = connection('connection');
    await setup.hub.handleFrame(
      client.value,
      helloFrame({ admissionTicket: setup.admissionTicket })
    );
    const welcome = client.messages[0];
    if (welcome?.type !== 'Welcome') throw new Error('missing welcome');

    await setup.hub.handleFrame(
      client.value,
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: welcome.sessionId,
        clientSequence: 1,
        commandId: 'flip-command',
        lastSeenRevision: 0,
        command: { type: 'FlipCoin' },
      })
    );

    expect(client.messages.slice(1).map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(client.messages.at(-1)).toMatchObject({
      type: 'CommandResult',
      accepted: true,
      revision: 1,
    });
    expect(setup.store.commandCommits).toHaveLength(1);
  });

  it('streams only the requesting session perspective from retained history', async () => {
    const setup = await fixture();
    const client = connection('replay-connection');
    await setup.hub.handleFrame(
      client.value,
      helloFrame({ admissionTicket: setup.admissionTicket })
    );
    const welcome = client.messages[0];
    if (welcome?.type !== 'Welcome') throw new Error('missing welcome');
    await setup.hub.handleFrame(
      client.value,
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: welcome.sessionId,
        clientSequence: 1,
        commandId: 'replay-flip-command',
        lastSeenRevision: 0,
        command: { type: 'FlipCoin' },
      })
    );
    await setup.hub.handleFrame(
      client.value,
      JSON.stringify({
        type: 'RequestReplay',
        protocolVersion: PROTOCOL_VERSION,
      })
    );

    const replayMessages = client.messages.slice(3);
    expect(replayMessages.map((message) => message.type)).toEqual([
      'ReplayStarted',
      'ReplayFrame',
      'ReplayFrame',
      'ReplayCompleted',
    ]);
    expect(replayMessages[0]).toMatchObject({
      type: 'ReplayStarted',
      viewer: { kind: 'player', playerId: p1 },
      startRevision: 0,
      endRevision: 1,
      truncated: false,
      frameCount: 2,
    });
    expect(replayMessages[2]).toMatchObject({
      type: 'ReplayFrame',
      index: 1,
      snapshot: {
        revision: 1,
        viewer: { kind: 'player', playerId: p1 },
      },
      presentationEvents: [{ type: 'CoinFlipped', revision: 1, playerId: p1 }],
    });
  });

  it('restores a serialized session binding after hibernation', async () => {
    const setup = await fixture();
    const beforeSleep = connection('connection-before-sleep');
    await setup.hub.handleFrame(
      beforeSleep.value,
      helloFrame({ admissionTicket: setup.admissionTicket })
    );
    const welcome = beforeSleep.messages[0];
    if (welcome?.type !== 'Welcome') throw new Error('missing welcome');

    const restoredCoordinator = new RoomAuthorityCoordinator(
      setup.store.durable,
      setup.store,
      {
        commandContext: setup.crypto,
        opaqueIds: setup.crypto,
        policy: DEFAULT_AUTHORITY_POLICY,
      }
    );
    const restoredHub = new RoomSessionHub(
      restoredCoordinator,
      'server-build',
      {
        store: setup.store,
        rateLimits: allowRoomOperations,
        admission: {
          crypto: setup.crypto,
          opaqueIds: setup.crypto,
          persistence: setup.store,
          now: () => 10_001,
        },
      }
    );
    const afterWake = connection('connection-after-wake');
    restoredHub.restoreBinding(afterWake.value, welcome.sessionId);
    await restoredHub.handleFrame(
      afterWake.value,
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: welcome.sessionId,
        clientSequence: 1,
        commandId: 'post-hibernation-command',
        lastSeenRevision: 0,
        command: { type: 'FlipCoin' },
      })
    );

    expect(afterWake.messages.map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(setup.store.durable.state.revision).toBe(1);
  });

  it('rejects commands before Hello and session spoofing without mutation', async () => {
    const setup = await fixture();
    const client = connection('connection');
    const command = {
      type: 'Command',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 'spoofed-session',
      clientSequence: 1,
      commandId: 'spoofed-command',
      lastSeenRevision: 0,
      command: { type: 'FlipCoin' },
    };
    await setup.hub.handleFrame(client.value, JSON.stringify(command));
    expect(client.messages[0]).toMatchObject({
      type: 'ServerNotice',
      code: 'hello_required',
    });

    await setup.hub.handleFrame(
      client.value,
      helloFrame({ admissionTicket: setup.admissionTicket })
    );
    await setup.hub.handleFrame(client.value, JSON.stringify(command));
    expect(client.messages.at(-1)).toMatchObject({
      type: 'ServerNotice',
      code: 'invalid_session',
    });
    expect(setup.store.commandCommits).toHaveLength(0);
  });

  it('rejects malformed frames without reflecting their contents', async () => {
    const setup = await fixture();
    const client = connection('connection');
    const secret = 'private-deck-secret';
    await setup.hub.handleFrame(client.value, `{not-json:${secret}}`);

    expect(client.messages[0]).toMatchObject({
      type: 'ServerNotice',
      code: 'invalid_message',
    });
    expect(JSON.stringify(client.messages)).not.toContain(secret);
  });
});
