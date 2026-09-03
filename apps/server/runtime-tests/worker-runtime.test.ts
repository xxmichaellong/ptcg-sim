import { env, exports } from 'cloudflare:workers';
import {
  PROTOCOL_VERSION,
  parseRoomAdmissionTicketResponse,
  parseRoomCreationResponse,
  parseServerFrame,
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

const issuePlayerTicket = async (created: RoomCreationResponse) => {
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}/v2/rooms/${created.roomCode}/admission-tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
      },
      body: JSON.stringify({
        capability: created.credentials.playerOneSeatCapability,
        displayName: 'Runtime Player',
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

    socket.send(
      JSON.stringify({
        type: 'Hello',
        protocolVersion: PROTOCOL_VERSION,
        buildId: 'local-development',
        roomCode: created.roomCode,
        displayName: 'Runtime Player',
        requestedRole: 'player',
        admissionTicket: ticket.admissionTicket,
      })
    );
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
    socket.send(
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: welcome.sessionId,
        clientSequence: welcome.nextClientSequence,
        commandId: 'runtime-post-hibernation-flip',
        lastSeenRevision: welcome.snapshot.revision,
        command: { type: 'FlipCoin' },
      })
    );
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
});
