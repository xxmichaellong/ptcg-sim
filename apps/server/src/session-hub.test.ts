import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_AUTHORITY_POLICY,
  RoomAuthorityCoordinator,
  createRoomAdmissionState,
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

class MemoryAuthorityStore implements AuthoritySnapshotStore {
  commandCommits: PersistedAuthorityTransaction[] = [];
  admissionCommits: PersistedAdmissionTransaction[] = [];

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
  const initial: RoomAuthoritySnapshot = {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    state: createEmptyMatch(asMatchId('hub-room'), [
      { playerId: p1, displayName: 'Player 1', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Player 2', cardBackUrl: '/red.png' },
    ]),
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
  const hub = new RoomSessionHub(coordinator, 'server-build', {
    store,
    admission: { crypto, opaqueIds: crypto, persistence: store },
  });
  return { hub, store, seatToken };
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
  it('admits, resumes, and supersedes one controlling connection per session', async () => {
    const setup = await fixture();
    const first = connection('connection-one');
    await setup.hub.handleFrame(
      first.value,
      helloFrame({ admissionTicket: setup.seatToken })
    );
    const welcome = first.messages[0];
    expect(welcome).toMatchObject({ type: 'Welcome', role: 'player' });
    if (welcome?.type !== 'Welcome') throw new Error('missing welcome');

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
      'seat_claimed',
      'session_resumed',
    ]);
  });

  it('routes an accepted command publication before its result', async () => {
    const setup = await fixture();
    const client = connection('connection');
    await setup.hub.handleFrame(
      client.value,
      helloFrame({ admissionTicket: setup.seatToken })
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
      helloFrame({ admissionTicket: setup.seatToken })
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
