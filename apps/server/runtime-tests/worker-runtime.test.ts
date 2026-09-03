import { env, exports } from 'cloudflare:workers';
import {
  PROTOCOL_VERSION,
  parseRoomAdmissionTicketResponse,
  parseRoomCreationResponse,
  parseServerFrame,
  type RoomAdmissionTicketResponse,
  type RoomCreationResponse,
  type ServerMessage,
} from '@ptcgsim/protocol';
import type { RoomAuthoritySnapshot } from '@ptcgsim/room-authority';
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTHORITY_SNAPSHOT_STORAGE_KEY,
  DurableRoomSnapshotStore,
  ROOM_LIFECYCLE_STORAGE_KEY,
} from '../src/durable-storage.js';

const ORIGIN = 'https://play.example';
const openSockets = new Set<WebSocket>();

interface StoredAuthorityEnvelope {
  readonly format: string;
  readonly snapshot: RoomAuthoritySnapshot;
}

interface StoredLifecycle {
  readonly format: string;
  readonly state: 'unclaimed' | 'claimed' | 'expiring';
  readonly createdAt: number;
  readonly unclaimedExpiresAt?: number;
  readonly claimedAtAuthorityVersion?: number;
}

interface SocketAttachment {
  readonly connectionId: string;
  readonly sessionId?: string;
  readonly authorityVersion: number;
}

type Welcome = Extract<ServerMessage, { readonly type: 'Welcome' }>;

const createRoom = async () => {
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}/v2/rooms`, {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '192.0.2.10',
        'Content-Type': 'application/json',
        Origin: ORIGIN,
      },
      body: '{}',
    })
  );
  expect(response.status).toBe(201);
  const parsed = parseRoomCreationResponse(await response.json());
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

const roomStub = (created: RoomCreationResponse) =>
  env.PTCG_ROOM.getByName(created.roomCode);

const issuePlayerTicket = async (
  created: RoomCreationResponse,
  seat: 'one' | 'two' = 'one',
  displayName = 'Runtime Player'
) => {
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}/v2/rooms/${created.roomCode}/admission-tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
      },
      body: JSON.stringify({
        capability:
          seat === 'one'
            ? created.credentials.playerOneSeatCapability
            : created.credentials.playerTwoSeatCapability,
        displayName,
        requestedRole: 'player',
      }),
    })
  );
  expect(response.status).toBe(201);
  const parsed = parseRoomAdmissionTicketResponse(await response.json());
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

const helloFrame = (
  created: RoomCreationResponse,
  ticket: RoomAdmissionTicketResponse,
  displayName = 'Runtime Player'
): string =>
  JSON.stringify({
    type: 'Hello',
    protocolVersion: PROTOCOL_VERSION,
    buildId: 'local-development',
    roomCode: created.roomCode,
    displayName,
    requestedRole: 'player',
    admissionTicket: ticket.admissionTicket,
  });

const flipCommandFrame = (welcome: Welcome, commandId: string): string =>
  JSON.stringify({
    type: 'Command',
    protocolVersion: PROTOCOL_VERSION,
    sessionId: welcome.sessionId,
    clientSequence: welcome.nextClientSequence,
    commandId,
    lastSeenRevision: welcome.snapshot.revision,
    command: { type: 'FlipCoin' },
  });

const connect = async (created: RoomCreationResponse): Promise<WebSocket> => {
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}/v2/rooms/${created.roomCode}/connect`, {
      headers: { Origin: ORIGIN, Upgrade: 'websocket' },
    })
  );
  expect(response.status).toBe(101);
  if (!response.webSocket)
    throw new Error('WebSocket upgrade was not returned');
  response.webSocket.accept();
  openSockets.add(response.webSocket);
  return response.webSocket;
};

const nextServerMessages = (
  socket: WebSocket,
  count: number
): Promise<readonly ServerMessage[]> =>
  new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        socket.removeEventListener('message', onMessage);
        reject(new Error('Expected a text WebSocket frame'));
        return;
      }
      const parsed = parseServerFrame(event.data);
      if (!parsed.ok) {
        socket.removeEventListener('message', onMessage);
        reject(new Error(`Invalid server frame: ${parsed.reason}`));
        return;
      }
      messages.push(parsed.value);
      if (messages.length === count) {
        socket.removeEventListener('message', onMessage);
        resolve(messages);
      }
    };
    socket.addEventListener('message', onMessage);
  });

const nextServerMessage = async (socket: WebSocket): Promise<ServerMessage> =>
  (await nextServerMessages(socket, 1))[0]!;

const runtimeEvidence = (created: RoomCreationResponse) =>
  runInDurableObject(roomStub(created), async (_instance, state) => {
    const envelope = await state.storage.get<StoredAuthorityEnvelope>(
      AUTHORITY_SNAPSHOT_STORAGE_KEY
    );
    const lifecycle = await state.storage.get<StoredLifecycle>(
      ROOM_LIFECYCLE_STORAGE_KEY
    );
    return {
      alarm: await state.storage.getAlarm(),
      attachment: state
        .getWebSockets()
        .map((socket) => socket.deserializeAttachment() as SocketAttachment)[0],
      lifecycle,
      snapshot: envelope?.snapshot,
      socketCount: state.getWebSockets().length,
    };
  });

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const socket of openSockets) socket.close(1000, 'Test complete');
  openSockets.clear();
});

describe('Cloudflare Worker runtime', () => {
  it('serves health metadata through the deployed entrypoint', async () => {
    const response = await exports.default.fetch(
      new Request('https://play.example/v2/health')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({
      status: 'ok',
      buildId: 'local-development',
      protocolVersion: 2,
      authoritySchemaVersion: 6,
      matchStateSchemaVersion: 2,
    });
  });

  it('creates a room through edge bindings and initializes its Durable Object', async () => {
    const created = await createRoom();
    const room = roomStub(created);
    const evidence = await runtimeEvidence(created);

    expect(room.id.toString()).toHaveLength(64);
    expect(created.credentials.playerOneSeatCapability).not.toBe(
      created.credentials.playerTwoSeatCapability
    );
    expect(evidence.snapshot?.state.matchId).toBe(created.roomCode);
    expect(evidence.lifecycle).toMatchObject({
      format: 'ptcgsim-room-lifecycle-v1',
      state: 'unclaimed',
    });
    expect(evidence.alarm).not.toBeNull();
    expect(evidence.alarm).toBeGreaterThan(Date.now());
  });

  it('reschedules an early alarm and deletes an expired unclaimed room', async () => {
    const created = await createRoom();
    const room = roomStub(created);
    const initial = await runtimeEvidence(created);

    expect(await runDurableObjectAlarm(room)).toBe(true);
    const rescheduled = await runtimeEvidence(created);
    expect(rescheduled.alarm).toBe(initial.alarm);

    await runInDurableObject(room, async (_instance, state) => {
      const now = Date.now();
      await state.storage.put(ROOM_LIFECYCLE_STORAGE_KEY, {
        format: 'ptcgsim-room-lifecycle-v1',
        state: 'unclaimed',
        createdAt: now - 60_000,
        unclaimedExpiresAt: now - 1,
      } satisfies StoredLifecycle);
      // Keep automatic local delivery from racing the explicit test helper.
      await state.storage.setAlarm(now + 60_000);
    });

    expect(await runDurableObjectAlarm(room)).toBe(true);
    const deleted = await runInDurableObject(
      room,
      async (_instance, state) => ({
        alarm: await state.storage.getAlarm(),
        entries: [...(await state.storage.list()).entries()],
      })
    );
    expect(deleted).toEqual({ alarm: null, entries: [] });

    const expiredConnect = await exports.default.fetch(
      new Request(`${ORIGIN}/v2/rooms/${created.roomCode}/connect`, {
        headers: { Origin: ORIGIN, Upgrade: 'websocket' },
      })
    );
    expect(expiredConnect.status).toBe(404);
  });

  it('claims atomically and resumes an admitted socket after real eviction', async () => {
    const created = await createRoom();
    const ticket = await issuePlayerTicket(created);
    const socket = await connect(created);
    const welcomePromise = nextServerMessage(socket);

    socket.send(helloFrame(created, ticket));
    const welcome = await welcomePromise;
    expect(welcome.type).toBe('Welcome');
    if (welcome.type !== 'Welcome') throw new Error('Expected Welcome');

    const beforeEviction = await runtimeEvidence(created);
    if (!beforeEviction.snapshot) throw new Error('Snapshot was not persisted');
    expect(beforeEviction.alarm).toBeNull();
    expect(beforeEviction.lifecycle).toMatchObject({
      format: 'ptcgsim-room-lifecycle-v1',
      state: 'claimed',
      claimedAtAuthorityVersion: beforeEviction.snapshot.authorityVersion,
    });
    expect(beforeEviction.socketCount).toBe(1);
    expect(beforeEviction.attachment).toMatchObject({
      sessionId: welcome.sessionId,
      authorityVersion: beforeEviction.snapshot.authorityVersion,
    });

    await evictDurableObject(roomStub(created));

    const pongPromise = nextServerMessage(socket);
    socket.send(
      JSON.stringify({
        type: 'Ping',
        protocolVersion: PROTOCOL_VERSION,
        id: 17,
      })
    );
    await expect(pongPromise).resolves.toMatchObject({
      type: 'Pong',
      id: 17,
    });

    const afterEviction = await runtimeEvidence(created);
    expect(afterEviction.snapshot).toEqual(beforeEviction.snapshot);
    expect(afterEviction.lifecycle).toEqual(beforeEviction.lifecycle);
    expect(afterEviction.alarm).toBeNull();
    expect(afterEviction.socketCount).toBe(1);
    expect(afterEviction.attachment).toEqual(beforeEviction.attachment);

    const commandMessagesPromise = nextServerMessages(socket, 2);
    socket.send(flipCommandFrame(welcome, 'runtime-post-hibernation-flip'));
    const commandMessages = await commandMessagesPromise;
    expect(commandMessages.map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(commandMessages[1]).toMatchObject({
      type: 'CommandResult',
      commandId: 'runtime-post-hibernation-flip',
      accepted: true,
      revision: welcome.snapshot.revision + 1,
    });

    const afterCommand = await runtimeEvidence(created);
    expect(afterCommand.snapshot?.state.revision).toBe(
      welcome.snapshot.revision + 1
    );
    expect(afterCommand.snapshot?.sessions[welcome.sessionId]).toMatchObject({
      active: true,
      nextClientSequence: welcome.nextClientSequence + 1,
      recentOutcomes: [
        {
          commandId: 'runtime-post-hibernation-flip',
          accepted: true,
        },
      ],
    });
  });

  it('keeps an admission ticket retryable when its durable claim fails', async () => {
    const created = await createRoom();
    const ticket = await issuePlayerTicket(created);
    const socket = await connect(created);
    const commitAdmission = vi
      .spyOn(DurableRoomSnapshotStore.prototype, 'commitAdmission')
      .mockRejectedValueOnce(new Error('injected durable admission failure'));

    const failedAdmissionPromise = nextServerMessage(socket);
    socket.send(helloFrame(created, ticket));
    await expect(failedAdmissionPromise).resolves.toMatchObject({
      type: 'ServerNotice',
      code: 'internal_retryable',
      retryable: true,
    });

    const afterFailure = await runtimeEvidence(created);
    expect(afterFailure.lifecycle).toMatchObject({ state: 'unclaimed' });
    expect(afterFailure.alarm).toBeGreaterThan(Date.now());
    expect(afterFailure.snapshot?.sessions).toEqual({});
    expect(
      Object.keys(afterFailure.snapshot?.admission?.tickets ?? {})
    ).toHaveLength(1);
    expect(afterFailure.attachment?.sessionId).toBeUndefined();

    const retriedAdmissionPromise = nextServerMessage(socket);
    socket.send(helloFrame(created, ticket));
    const retriedAdmission = await retriedAdmissionPromise;
    expect(retriedAdmission.type).toBe('Welcome');
    if (retriedAdmission.type !== 'Welcome') {
      throw new Error('Expected Welcome after retry');
    }

    const afterRetry = await runtimeEvidence(created);
    expect(afterRetry.lifecycle).toMatchObject({ state: 'claimed' });
    expect(afterRetry.alarm).toBeNull();
    expect(Object.keys(afterRetry.snapshot?.sessions ?? {})).toEqual([
      retriedAdmission.sessionId,
    ]);
    expect(afterRetry.snapshot?.admission?.tickets).toEqual({});
    expect(afterRetry.attachment?.sessionId).toBe(retriedAdmission.sessionId);
    expect(commitAdmission).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent admission around a failed command without phantom acknowledgement', async () => {
    const created = await createRoom();
    const firstTicket = await issuePlayerTicket(created);
    const firstSocket = await connect(created);
    const firstWelcomePromise = nextServerMessage(firstSocket);
    firstSocket.send(helloFrame(created, firstTicket));
    const firstWelcome = await firstWelcomePromise;
    expect(firstWelcome.type).toBe('Welcome');
    if (firstWelcome.type !== 'Welcome') throw new Error('Expected Welcome');

    const secondTicket = await issuePlayerTicket(
      created,
      'two',
      'Runtime Opponent'
    );
    const secondSocket = await connect(created);
    const commit = vi
      .spyOn(DurableRoomSnapshotStore.prototype, 'commit')
      .mockRejectedValueOnce(new Error('injected durable command failure'));
    const commandFrame = flipCommandFrame(
      firstWelcome,
      'runtime-concurrent-fault-flip'
    );
    const secondWelcomePromise = nextServerMessage(secondSocket);
    const failedCommandPromise = nextServerMessage(firstSocket);

    secondSocket.send(helloFrame(created, secondTicket, 'Runtime Opponent'));
    firstSocket.send(commandFrame);

    const [secondWelcome, failedCommand] = await Promise.all([
      secondWelcomePromise,
      failedCommandPromise,
    ]);
    expect(secondWelcome.type).toBe('Welcome');
    expect(failedCommand).toMatchObject({
      type: 'ServerNotice',
      code: 'internal_retryable',
      retryable: true,
    });

    const afterFailure = await runtimeEvidence(created);
    expect(afterFailure.snapshot?.state.revision).toBe(
      firstWelcome.snapshot.revision
    );
    expect(Object.keys(afterFailure.snapshot?.sessions ?? {})).toHaveLength(2);
    expect(
      afterFailure.snapshot?.sessions[firstWelcome.sessionId]
    ).toMatchObject({
      nextClientSequence: firstWelcome.nextClientSequence,
      recentOutcomes: [],
    });

    const retriedCommandPromise = nextServerMessages(firstSocket, 2);
    firstSocket.send(commandFrame);
    const retriedCommand = await retriedCommandPromise;
    expect(retriedCommand.map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(retriedCommand[1]).toMatchObject({
      type: 'CommandResult',
      commandId: 'runtime-concurrent-fault-flip',
      accepted: true,
      revision: firstWelcome.snapshot.revision + 1,
    });

    const committed = await runtimeEvidence(created);
    expect(committed.snapshot?.state.revision).toBe(
      firstWelcome.snapshot.revision + 1
    );
    expect(committed.snapshot?.sessions[firstWelcome.sessionId]).toMatchObject({
      nextClientSequence: firstWelcome.nextClientSequence + 1,
      recentOutcomes: [
        {
          commandId: 'runtime-concurrent-fault-flip',
          accepted: true,
          revision: firstWelcome.snapshot.revision + 1,
        },
      ],
    });
    expect(commit).toHaveBeenCalledTimes(2);

    await evictDurableObject(roomStub(created));
    const pongPromise = nextServerMessage(firstSocket);
    firstSocket.send(
      JSON.stringify({
        type: 'Ping',
        protocolVersion: PROTOCOL_VERSION,
        id: 29,
      })
    );
    await expect(pongPromise).resolves.toMatchObject({
      type: 'Pong',
      id: 29,
    });
    expect((await runtimeEvidence(created)).snapshot).toEqual(
      committed.snapshot
    );

    const duplicatePromise = nextServerMessages(firstSocket, 2);
    firstSocket.send(commandFrame);
    const duplicate = await duplicatePromise;
    expect(duplicate.map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(duplicate[1]).toMatchObject({
      type: 'CommandResult',
      commandId: 'runtime-concurrent-fault-flip',
      accepted: true,
      revision: firstWelcome.snapshot.revision + 1,
    });
    expect((await runtimeEvidence(created)).snapshot).toEqual(
      committed.snapshot
    );
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('deduplicates an ambiguously committed command before and after eviction', async () => {
    const created = await createRoom();
    const ticket = await issuePlayerTicket(created);
    const socket = await connect(created);
    const welcomePromise = nextServerMessage(socket);
    socket.send(helloFrame(created, ticket));
    const welcome = await welcomePromise;
    expect(welcome.type).toBe('Welcome');
    if (welcome.type !== 'Welcome') throw new Error('Expected Welcome');

    const originalCommit = DurableRoomSnapshotStore.prototype.commit;
    const commit = vi
      .spyOn(DurableRoomSnapshotStore.prototype, 'commit')
      .mockImplementationOnce(async function (
        this: DurableRoomSnapshotStore,
        transaction
      ) {
        await originalCommit.call(this, transaction);
        throw new Error('injected failure after durable commit');
      });
    const commandFrame = flipCommandFrame(
      welcome,
      'runtime-ambiguous-commit-flip'
    );
    const ambiguousResultPromise = nextServerMessage(socket);
    socket.send(commandFrame);
    await expect(ambiguousResultPromise).resolves.toMatchObject({
      type: 'ServerNotice',
      code: 'internal_retryable',
      retryable: true,
    });

    const committedWithoutAck = await runtimeEvidence(created);
    expect(committedWithoutAck.snapshot?.state.revision).toBe(
      welcome.snapshot.revision + 1
    );
    expect(
      committedWithoutAck.snapshot?.sessions[welcome.sessionId]
    ).toMatchObject({
      nextClientSequence: welcome.nextClientSequence + 1,
      recentOutcomes: [
        {
          commandId: 'runtime-ambiguous-commit-flip',
          accepted: true,
          revision: welcome.snapshot.revision + 1,
        },
      ],
    });
    expect(commit).toHaveBeenCalledTimes(1);

    const retryPromise = nextServerMessages(socket, 2);
    socket.send(commandFrame);
    const retry = await retryPromise;
    expect(retry.map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(retry[1]).toMatchObject({
      type: 'CommandResult',
      commandId: 'runtime-ambiguous-commit-flip',
      accepted: true,
      revision: welcome.snapshot.revision + 1,
    });
    expect((await runtimeEvidence(created)).snapshot).toEqual(
      committedWithoutAck.snapshot
    );
    expect(commit).toHaveBeenCalledTimes(1);

    await evictDurableObject(roomStub(created));
    const postEvictionRetryPromise = nextServerMessages(socket, 2);
    socket.send(commandFrame);
    const postEvictionRetry = await postEvictionRetryPromise;
    expect(postEvictionRetry.map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(postEvictionRetry[1]).toMatchObject({
      type: 'CommandResult',
      commandId: 'runtime-ambiguous-commit-flip',
      accepted: true,
      revision: welcome.snapshot.revision + 1,
    });
    expect((await runtimeEvidence(created)).snapshot).toEqual(
      committedWithoutAck.snapshot
    );
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
