import { DurableObject } from 'cloudflare:workers';
import {
  DEFAULT_AUTHORITY_POLICY,
  RoomAuthorityCoordinator,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { PROTOCOL_VERSION } from '@ptcgsim/protocol';

import {
  handleAdmissionTicketRequest,
  isSameOriginBrowserRequest,
} from './admission-ticket-http.js';
import { WebCryptoAuthoritySource } from './authority-crypto.js';
import { initializeNewRoom, type NewRoomCredentials } from './create-room.js';
import { DurableRoomSnapshotStore } from './durable-storage.js';
import { RoomSessionHub, type RuntimeConnection } from './session-hub.js';

interface Env {
  readonly BUILD_ID: string;
  readonly PTCG_ROOM: DurableObjectNamespace<PtcgRoom>;
}

interface SocketAttachment {
  readonly connectionId: string;
  readonly sessionId?: string;
  readonly authorityVersion: number;
}

interface InitializedRoom {
  readonly roomCode: string;
  readonly credentials: NewRoomCredentials;
}

interface RoomRuntime {
  readonly coordinator: RoomAuthorityCoordinator;
  readonly hub: RoomSessionHub;
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode = (): string => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length])
    .join('');
};

const roomCodeFromPath = (pathname: string): string | undefined => {
  const match = /^\/v2\/rooms\/([A-Z2-9]{12})\/connect$/u.exec(pathname);
  return match?.[1];
};

const admissionRoomCodeFromPath = (pathname: string): string | undefined => {
  const match = /^\/v2\/rooms\/([A-Z2-9]{12})\/admission-tickets$/u.exec(
    pathname
  );
  return match?.[1];
};

export class PtcgRoom extends DurableObject<Env> {
  private readonly cryptoSource = new WebCryptoAuthoritySource();
  private readonly store: DurableRoomSnapshotStore;
  private runtimePromise: Promise<RoomRuntime | undefined>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new DurableRoomSnapshotStore(ctx.storage);
    this.runtimePromise = this.restoreRuntime();
  }

  async initialize(roomCodeValue: string): Promise<InitializedRoom> {
    const existing = await this.store.load();
    if (existing) throw new Error('Room already initialized');
    const created = await initializeNewRoom(
      {
        matchId: roomCodeValue,
        playerOneCardBackUrl: '/v2/assets/cardback.png',
        playerTwoCardBackUrl: '/v2/assets/cardback.png',
        spectatorsAllowed: true,
      },
      this.store,
      this.cryptoSource
    );
    this.runtimePromise = Promise.resolve(this.createRuntime(created.snapshot));
    return { roomCode: roomCodeValue, credentials: created.credentials };
  }

  override async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    if (admissionRoomCodeFromPath(requestUrl.pathname)) {
      const runtime = await this.runtimePromise;
      if (!runtime)
        return new Response('Room not initialized', { status: 404 });
      return handleAdmissionTicketRequest(request, (input) =>
        runtime.hub.issueAdmissionTicket(input)
      );
    }
    if (requestUrl.search || !isSameOriginBrowserRequest(request)) {
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    const runtime = await this.runtimePromise;
    if (!runtime) return new Response('Room not initialized', { status: 404 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: SocketAttachment = {
      connectionId: this.cryptoSource.nextSessionId(),
      authorityVersion: runtime.coordinator.currentSnapshot().authorityVersion,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
    runtime.hub.restoreBinding(
      this.connection(server, attachment.connectionId)
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer
  ) {
    if (typeof message !== 'string') {
      socket.send(
        JSON.stringify({
          type: 'ServerNotice',
          protocolVersion: PROTOCOL_VERSION,
          code: 'invalid_message',
          message: 'Binary messages are not supported',
          retryable: false,
        })
      );
      return;
    }
    const runtime = await this.runtimePromise;
    if (!runtime) {
      socket.close(4404, 'Room not initialized');
      return;
    }
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.connectionId) {
      socket.close(4400, 'Missing connection attachment');
      return;
    }
    await runtime.hub.handleFrame(
      this.connection(socket, attachment.connectionId),
      message
    );
    const binding = runtime.hub.bindingForConnection(attachment.connectionId);
    socket.serializeAttachment({
      connectionId: attachment.connectionId,
      ...binding,
    } satisfies SocketAttachment);
  }

  override async webSocketClose(socket: WebSocket) {
    this.disconnectSocket(socket);
  }

  override async webSocketError(socket: WebSocket) {
    this.disconnectSocket(socket);
  }

  private disconnectSocket(socket: WebSocket): void {
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.connectionId) return;
    void this.runtimePromise.then((runtime) =>
      runtime?.hub.disconnect(attachment.connectionId)
    );
  }

  private connection(socket: WebSocket, id: string): RuntimeConnection {
    return {
      id,
      send: (frame) => socket.send(frame),
      close: (code, reason) => socket.close(code, reason),
    };
  }

  private createRuntime(snapshot: RoomAuthoritySnapshot): RoomRuntime {
    const coordinator = new RoomAuthorityCoordinator(snapshot, this.store, {
      commandContext: this.cryptoSource,
      opaqueIds: this.cryptoSource,
      policy: DEFAULT_AUTHORITY_POLICY,
    });
    return {
      coordinator,
      hub: new RoomSessionHub(coordinator, this.env.BUILD_ID, {
        store: this.store,
        admission: {
          crypto: this.cryptoSource,
          opaqueIds: this.cryptoSource,
          persistence: this.store,
          now: Date.now,
        },
      }),
    };
  }

  private async restoreRuntime(): Promise<RoomRuntime | undefined> {
    const snapshot = await this.store.load();
    if (!snapshot) return undefined;
    const runtime = this.createRuntime(snapshot);
    const sockets = this.ctx
      .getWebSockets()
      .map((socket) => ({
        socket,
        attachment: socket.deserializeAttachment() as SocketAttachment | null,
      }))
      .filter(
        (entry): entry is { socket: WebSocket; attachment: SocketAttachment } =>
          Boolean(entry.attachment?.connectionId)
      )
      .sort(
        (left, right) =>
          left.attachment.authorityVersion - right.attachment.authorityVersion
      );
    for (const { socket, attachment } of sockets) {
      runtime.hub.restoreBinding(
        this.connection(socket, attachment.connectionId),
        attachment.sessionId
      );
    }
    return runtime;
  }
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/v2/rooms') {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = roomCode();
        const stub = env.PTCG_ROOM.getByName(code);
        try {
          const initialized = await stub.initialize(code);
          return Response.json(initialized, {
            status: 201,
            headers: {
              'Cache-Control': 'no-store, max-age=0',
              'Referrer-Policy': 'no-referrer',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes('already initialized')
          ) {
            continue;
          }
          throw error;
        }
      }
      return Response.json({ error: 'room_code_exhausted' }, { status: 503 });
    }
    const code = roomCodeFromPath(url.pathname);
    if (request.method === 'GET' && code) {
      return env.PTCG_ROOM.getByName(code).fetch(request);
    }
    const admissionCode = admissionRoomCodeFromPath(url.pathname);
    if (request.method === 'POST' && admissionCode) {
      return env.PTCG_ROOM.getByName(admissionCode).fetch(request);
    }
    return new Response('Not Found', { status: 404 });
  },
};

export default worker;
