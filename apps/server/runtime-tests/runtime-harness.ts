import { env, exports } from 'cloudflare:workers';
import {
  PROTOCOL_VERSION,
  parseRoomAdmissionTicketResponse,
  parseRoomCreationResponse,
  parseServerFrame,
  type RoomAdmissionTicketResponse,
  type RoomCreationResponse,
  type ServerMessage,
  type WireGameCommand,
} from '@ptcgsim/protocol';
import type { RoomAuthoritySnapshot } from '@ptcgsim/room-authority';
import { runInDurableObject } from 'cloudflare:test';

import {
  AUTHORITY_SNAPSHOT_STORAGE_KEY,
  ROOM_LIFECYCLE_STORAGE_KEY,
} from '../src/durable-storage.js';
import { JOURNAL_RETENTION_STORAGE_KEY } from '../src/journal-retention.js';
import { ROOM_RATE_LIMIT_STORAGE_KEY } from '../src/room-rate-limit.js';

export const RUNTIME_ORIGIN = 'https://play.example';

interface StoredAuthorityEnvelope {
  readonly format: string;
  readonly snapshot: RoomAuthoritySnapshot;
}

export interface StoredLifecycle {
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

export type RuntimeWelcome = Extract<
  ServerMessage,
  { readonly type: 'Welcome' }
>;

export interface RuntimeAdmissionIdentity {
  readonly displayName: string;
  readonly requestedRole: 'player' | 'spectator';
}

export interface RuntimeServerFrame {
  readonly raw: string;
  readonly bytes: number;
  readonly message: ServerMessage;
}

const responseError = async (
  operation: string,
  response: Response
): Promise<Error> =>
  new Error(
    `${operation} returned ${response.status}: ${await response.text()}`
  );

export const createRoom = async (): Promise<RoomCreationResponse> => {
  const response = await exports.default.fetch(
    new Request(`${RUNTIME_ORIGIN}/v2/rooms`, {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '192.0.2.10',
        'Content-Type': 'application/json',
        Origin: RUNTIME_ORIGIN,
      },
      body: '{}',
    })
  );
  if (response.status !== 201)
    throw await responseError('create room', response);
  const parsed = parseRoomCreationResponse(await response.json());
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

export const roomStub = (created: RoomCreationResponse) =>
  env.PTCG_ROOM.getByName(created.roomCode);

export const issueAdmissionTicket = async (
  created: RoomCreationResponse,
  capability: string,
  identity: RuntimeAdmissionIdentity
): Promise<RoomAdmissionTicketResponse> => {
  const response = await exports.default.fetch(
    new Request(
      `${RUNTIME_ORIGIN}/v2/rooms/${created.roomCode}/admission-tickets`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: RUNTIME_ORIGIN,
        },
        body: JSON.stringify({ capability, ...identity }),
      }
    )
  );
  if (response.status !== 201) {
    throw await responseError('issue admission ticket', response);
  }
  const parsed = parseRoomAdmissionTicketResponse(await response.json());
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

export const issuePlayerTicket = (
  created: RoomCreationResponse,
  seat: 'one' | 'two' = 'one',
  displayName = 'Runtime Player'
): Promise<RoomAdmissionTicketResponse> =>
  issueAdmissionTicket(
    created,
    seat === 'one'
      ? created.credentials.playerOneSeatCapability
      : created.credentials.playerTwoSeatCapability,
    { displayName, requestedRole: 'player' }
  );

export const admissionHelloFrame = (
  created: RoomCreationResponse,
  ticket: RoomAdmissionTicketResponse,
  identity: RuntimeAdmissionIdentity
): string =>
  JSON.stringify({
    type: 'Hello',
    protocolVersion: PROTOCOL_VERSION,
    buildId: 'local-development',
    roomCode: created.roomCode,
    ...identity,
    admissionTicket: ticket.admissionTicket,
  });

export const helloFrame = (
  created: RoomCreationResponse,
  ticket: RoomAdmissionTicketResponse,
  displayName = 'Runtime Player'
): string =>
  admissionHelloFrame(created, ticket, {
    displayName,
    requestedRole: 'player',
  });

export const commandFrame = (
  welcome: RuntimeWelcome,
  clientSequence: number,
  lastSeenRevision: number,
  commandId: string,
  command: WireGameCommand
): string =>
  JSON.stringify({
    type: 'Command',
    protocolVersion: PROTOCOL_VERSION,
    sessionId: welcome.sessionId,
    clientSequence,
    commandId,
    lastSeenRevision,
    command,
  });

export const flipCommandFrame = (
  welcome: RuntimeWelcome,
  commandId: string
): string =>
  commandFrame(
    welcome,
    welcome.nextClientSequence,
    welcome.snapshot.revision,
    commandId,
    { type: 'FlipCoin' }
  );

export const connect = async (
  created: RoomCreationResponse
): Promise<WebSocket> => {
  const response = await exports.default.fetch(
    new Request(`${RUNTIME_ORIGIN}/v2/rooms/${created.roomCode}/connect`, {
      headers: { Origin: RUNTIME_ORIGIN, Upgrade: 'websocket' },
    })
  );
  if (response.status !== 101) throw await responseError('connect', response);
  if (!response.webSocket)
    throw new Error('WebSocket upgrade was not returned');
  response.webSocket.accept();
  return response.webSocket;
};

export const nextServerFrames = (
  socket: WebSocket,
  count: number
): Promise<readonly RuntimeServerFrame[]> =>
  new Promise((resolve, reject) => {
    const frames: RuntimeServerFrame[] = [];
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
      frames.push({
        raw: event.data,
        bytes: utf8Bytes(event.data),
        message: parsed.value,
      });
      if (frames.length === count) {
        socket.removeEventListener('message', onMessage);
        resolve(frames);
      }
    };
    socket.addEventListener('message', onMessage);
  });

export const nextServerMessages = async (
  socket: WebSocket,
  count: number
): Promise<readonly ServerMessage[]> =>
  (await nextServerFrames(socket, count)).map((frame) => frame.message);

export const nextServerMessage = async (
  socket: WebSocket
): Promise<ServerMessage> => (await nextServerMessages(socket, 1))[0]!;

export const runtimeEvidence = (created: RoomCreationResponse) =>
  runInDurableObject(roomStub(created), async (_instance, state) => {
    const envelope = await state.storage.get<StoredAuthorityEnvelope>(
      AUTHORITY_SNAPSHOT_STORAGE_KEY
    );
    const lifecycle = await state.storage.get<StoredLifecycle>(
      ROOM_LIFECYCLE_STORAGE_KEY
    );
    const attachments = state
      .getWebSockets()
      .map((socket) => socket.deserializeAttachment() as SocketAttachment);
    return {
      alarm: await state.storage.getAlarm(),
      attachment: attachments[0],
      attachments,
      lifecycle,
      snapshot: envelope?.snapshot,
      socketCount: state.getWebSockets().length,
    };
  });

export const utf8Bytes = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

const storageEntryCategory = (key: string): string => {
  if (key.startsWith('authority:admission:')) return 'authority:admission:*';
  if (key.startsWith('authority:journal:')) return 'authority:journal:*';
  if (key === JOURNAL_RETENTION_STORAGE_KEY) {
    return 'authority:journal-retention';
  }
  if (key === AUTHORITY_SNAPSHOT_STORAGE_KEY) return 'authority:snapshot';
  if (key === ROOM_LIFECYCLE_STORAGE_KEY) return 'room:lifecycle';
  if (key === ROOM_RATE_LIMIT_STORAGE_KEY) return 'room:rate-limits';
  return 'other';
};

export const runtimeStorageEvidence = (created: RoomCreationResponse) =>
  runInDurableObject(roomStub(created), async (_instance, state) => {
    const entries = [...(await state.storage.list()).entries()];
    const categories = new Map<string, { count: number; bytes: number }>();
    let serializedBytes = 0;
    for (const [key, value] of entries) {
      const serializedValue = JSON.stringify(value);
      if (serializedValue === undefined) {
        throw new Error(
          `Runtime storage entry ${key} is not JSON serializable`
        );
      }
      const bytes = utf8Bytes(key) + utf8Bytes(serializedValue);
      serializedBytes += bytes;
      const category = storageEntryCategory(key);
      const previous = categories.get(category) ?? { count: 0, bytes: 0 };
      categories.set(category, {
        count: previous.count + 1,
        bytes: previous.bytes + bytes,
      });
    }
    return {
      alarm: await state.storage.getAlarm(),
      entryCount: entries.length,
      serializedBytes,
      categories: Object.fromEntries(categories),
    };
  });

export const runtimeCommandPerformanceEvidence = (
  created: RoomCreationResponse
) =>
  runInDurableObject(roomStub(created), (instance) =>
    instance.recentAcceptedCommandPerformance()
  );
