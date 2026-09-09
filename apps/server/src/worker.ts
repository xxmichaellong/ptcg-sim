import { DurableObject } from 'cloudflare:workers';
import {
  DEFAULT_ADMISSION_TICKET_POLICY,
  DEFAULT_AUTHORITY_POLICY,
  RoomAuthorityCoordinator,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import {
  PROTOCOL_VERSION,
  type RoomCreationRequest,
  type RoomCreationResponse,
} from '@ptcgsim/protocol';

import { handleAdmissionTicketRequest } from './admission-ticket-http.js';
import {
  browserJsonResponse as json,
  isSameOriginBrowserRequest,
} from './browser-json-http.js';
import { WebCryptoAuthoritySource } from './authority-crypto.js';
import { initializeNewRoom } from './create-room.js';
import {
  DurableRoomSnapshotStore,
  RoomAlreadyInitializedError,
} from './durable-storage.js';
import { isRoomAlreadyInitialized } from './room-initialization.js';
import { consumeRoomCreationRateLimit } from './request-rate-limit.js';
import { handleRoomCreationRequest } from './room-creation-http.js';
import { handleRoomInvitationRequest } from './room-invitation-http.js';
import { DurableRoomRateLimiter } from './room-rate-limit.js';
import { handleServerHealthRequest } from './server-health.js';
import { activeSocketCountExcluding } from './socket-telemetry.js';
import {
  ConsoleServerTelemetrySink,
  StructuredServerTelemetry,
  nextTelemetryId,
  type ServerHttpRoute,
  type ServerTelemetryPort,
} from './server-telemetry.js';
import {
  RoomSessionHub,
  type AcceptedCommandPerformanceObservation,
  type RuntimeConnection,
} from './session-hub.js';

interface Env {
  readonly BUILD_ID: string;
  readonly PTCG_ROOM: DurableObjectNamespace<PtcgRoom>;
  readonly ROOM_CREATION_RATE_LIMITER: RateLimit;
}

interface SocketAttachment {
  readonly connectionId: string;
  readonly sessionId?: string;
  readonly authorityVersion: number;
  /** Absolute wall-clock deadline for an upgraded socket to complete Hello. */
  readonly admissionExpiresAt?: number;
}

type InitializedRoom = RoomCreationResponse;

interface RoomRuntime {
  readonly coordinator: RoomAuthorityCoordinator;
  readonly hub: RoomSessionHub;
}

const activeSessionCount = (snapshot: RoomAuthoritySnapshot): number =>
  Object.values(snapshot.sessions).filter((session) => session.active).length;

const validAdmissionDeadline = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const liveAdmissionDeadline = (value: unknown, now: number): value is number =>
  validAdmissionDeadline(value) &&
  value > now &&
  value - now <= DEFAULT_ADMISSION_TICKET_POLICY.lifetimeMs;

const telemetrySink = new ConsoleServerTelemetrySink();
const createTelemetry = (
  source: 'edge' | 'room',
  buildId: string
): StructuredServerTelemetry =>
  new StructuredServerTelemetry(
    source,
    buildId,
    telemetrySink,
    Date.now,
    nextTelemetryId
  );

const observeHttp = async (
  telemetry: ServerTelemetryPort,
  route: ServerHttpRoute,
  operation: () => Response | Promise<Response>
): Promise<Response> => {
  const startedAt = performance.now();
  try {
    const response = await operation();
    telemetry.httpRequest({
      route,
      status: response.status,
      durationMs: performance.now() - startedAt,
    });
    return response;
  } catch (error) {
    telemetry.httpRequest({
      route,
      status: 500,
      durationMs: performance.now() - startedAt,
    });
    throw error;
  }
};

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode = (): string => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length])
    .join('');
};

const roomCodeFromPath = (pathname: string): string | undefined => {
  const match = /^\/v2\/rooms\/([A-HJ-NP-Z2-9]{12})\/connect$/u.exec(pathname);
  return match?.[1];
};

const admissionRoomCodeFromPath = (pathname: string): string | undefined => {
  const match = /^\/v2\/rooms\/([A-HJ-NP-Z2-9]{12})\/admission-tickets$/u.exec(
    pathname
  );
  return match?.[1];
};

const invitationRoomCodeFromPath = (pathname: string): string | undefined => {
  const match = /^\/v2\/rooms\/([A-HJ-NP-Z2-9]{12})\/invitations$/u.exec(
    pathname
  );
  return match?.[1];
};

export class PtcgRoom extends DurableObject<Env> {
  private readonly cryptoSource = new WebCryptoAuthoritySource();
  private readonly store: DurableRoomSnapshotStore;
  private readonly rateLimits: DurableRoomRateLimiter;
  private readonly telemetry: StructuredServerTelemetry;
  private socketAlarmTail: Promise<void> = Promise.resolve();
  private runtimePromise: Promise<RoomRuntime | undefined>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new DurableRoomSnapshotStore(ctx.storage);
    this.rateLimits = new DurableRoomRateLimiter(ctx.storage);
    this.telemetry = createTelemetry('room', env.BUILD_ID);
    this.runtimePromise = this.restoreRuntime();
  }

  async initialize(
    roomCodeValue: string,
    mode: RoomCreationRequest['mode']
  ): Promise<InitializedRoom> {
    const existing = await this.store.load();
    if (existing) throw new RoomAlreadyInitializedError();
    const startedAt = performance.now();
    let created;
    try {
      created = await initializeNewRoom(
        {
          matchId: roomCodeValue,
          mode,
          playerOneCardBackUrl: '/v2/assets/cardback.png',
          playerTwoCardBackUrl: '/v2/assets/cardback.png',
          spectatorsAllowed: true,
        },
        this.store,
        this.cryptoSource,
        Date.now()
      );
    } catch (error) {
      this.telemetry.failure({
        subsystem: 'room_initialization',
        retryable: true,
      });
      throw error;
    }
    this.runtimePromise = Promise.resolve(this.createRuntime(created.snapshot));
    this.telemetry.roomLifecycle({
      outcome: 'created',
      authorityVersion: created.snapshot.authorityVersion,
      activeSessions: 0,
      activeSockets: 0,
      durationMs: performance.now() - startedAt,
    });
    if (mode === 'solo') {
      return {
        mode,
        roomCode: roomCodeValue,
        credentials: {
          playerOneSeatCapability: created.credentials.playerOneSeatCapability,
          ...(created.credentials.spectatorCapability
            ? {
                spectatorCapability: created.credentials.spectatorCapability,
              }
            : {}),
        },
      };
    }
    return { mode, roomCode: roomCodeValue, credentials: created.credentials };
  }

  override async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    if (invitationRoomCodeFromPath(requestUrl.pathname)) {
      return observeHttp(this.telemetry, 'room_invitation', async () => {
        const runtime = await this.runtimePromise;
        if (!runtime)
          return new Response('Room not initialized', { status: 404 });
        return handleRoomInvitationRequest(request, (input) =>
          runtime.hub.issueInvitation(input)
        );
      });
    }
    if (admissionRoomCodeFromPath(requestUrl.pathname)) {
      return observeHttp(this.telemetry, 'admission_ticket', async () => {
        const runtime = await this.runtimePromise;
        if (!runtime)
          return new Response('Room not initialized', { status: 404 });
        return handleAdmissionTicketRequest(request, (input) =>
          runtime.hub.issueAdmissionTicket(input)
        );
      });
    }
    return observeHttp(this.telemetry, 'socket_upgrade', async () => {
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
      if (!runtime)
        return new Response('Room not initialized', { status: 404 });
      let rateLimit;
      try {
        rateLimit = await runtime.hub.reserveSocketUpgrade();
      } catch {
        this.telemetry.failure({
          subsystem: 'socket_upgrade',
          retryable: true,
        });
        return json({ error: 'internal_retryable' }, 503, {
          'Retry-After': '1',
        });
      }
      if (!rateLimit.allowed) {
        return json({ error: 'rate_limited' }, 429, {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const admissionExpiresAt =
        Date.now() + DEFAULT_ADMISSION_TICKET_POLICY.lifetimeMs;
      const attachment: SocketAttachment = {
        connectionId: this.cryptoSource.nextSessionId(),
        authorityVersion:
          runtime.coordinator.currentSnapshot().authorityVersion,
        admissionExpiresAt,
      };
      await this.coordinateSocketAlarm(() =>
        this.ensureAlarmNoLaterThan(admissionExpiresAt)
      );
      server.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(server);
      runtime.hub.restoreBinding(
        this.connection(server, attachment.connectionId)
      );
      this.telemetry.roomSocket({
        outcome: 'upgraded',
        activeSockets: this.ctx.getWebSockets().length,
      });
      return new Response(null, { status: 101, webSocket: client });
    });
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
    if (
      !attachment.sessionId &&
      !liveAdmissionDeadline(attachment.admissionExpiresAt, Date.now())
    ) {
      await runtime.hub.disconnect(attachment.connectionId);
      socket.close(4408, 'Admission timed out');
      return;
    }
    if (
      attachment.sessionId &&
      !runtime.coordinator.currentSnapshot().sessions[attachment.sessionId]
        ?.active
    ) {
      await runtime.hub.disconnect(attachment.connectionId);
      socket.close(4409, 'Session is no longer active');
      return;
    }
    await runtime.hub.handleFrame(
      this.connection(socket, attachment.connectionId),
      message
    );
    const binding = runtime.hub.bindingForConnection(attachment.connectionId);
    socket.serializeAttachment(
      binding.sessionId
        ? ({
            connectionId: attachment.connectionId,
            ...binding,
          } satisfies SocketAttachment)
        : ({
            ...attachment,
            authorityVersion: binding.authorityVersion,
          } satisfies SocketAttachment)
    );
    if (binding.sessionId) {
      await this.coordinateSocketAlarm(() =>
        this.reconcileClaimedSocketAdmissionAlarm(Date.now(), runtime)
      );
    }
  }

  override async webSocketClose(
    socket: WebSocket,
    code: number
  ): Promise<void> {
    this.disconnectSocket(socket);
    this.telemetry.roomSocket({
      outcome: 'closed',
      closeCode: code,
      activeSockets: activeSocketCountExcluding(
        this.ctx.getWebSockets(),
        socket
      ),
    });
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    this.disconnectSocket(socket);
    this.telemetry.roomSocket({
      outcome: 'error',
      activeSockets: activeSocketCountExcluding(
        this.ctx.getWebSockets(),
        socket
      ),
    });
  }

  override async alarm(): Promise<void> {
    await this.coordinateSocketAlarm(() => this.handleAlarm());
  }

  private async handleAlarm(): Promise<void> {
    const startedAt = performance.now();
    const runtime = await this.runtimePromise;
    const now = Date.now();
    const nextSocketAdmission = await this.expireSocketAdmissions(now, runtime);
    let result;
    try {
      result = await this.store.expireUnclaimedRoom(now);
    } catch (error) {
      this.telemetry.failure({ subsystem: 'room_alarm', retryable: true });
      throw error;
    }
    if (result !== 'expired' && nextSocketAdmission !== undefined) {
      await this.ensureAlarmNoLaterThan(nextSocketAdmission);
    }
    if (result === 'scheduled' || result === 'claimed') {
      this.telemetry.roomLifecycle({
        outcome:
          result === 'scheduled' ? 'alarm_rescheduled' : 'alarm_cancelled',
        authorityVersion:
          runtime?.coordinator.currentSnapshot().authorityVersion ?? 0,
        activeSessions: runtime
          ? activeSessionCount(runtime.coordinator.currentSnapshot())
          : 0,
        activeSockets: this.ctx.getWebSockets().length,
        durationMs: performance.now() - startedAt,
      });
    }
    if (result !== 'expired') return;
    this.runtimePromise = Promise.resolve(undefined);
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(4404, 'Room expired before admission');
    }
    this.telemetry.roomLifecycle({
      outcome: 'expired',
      authorityVersion:
        runtime?.coordinator.currentSnapshot().authorityVersion ?? 0,
      activeSessions: 0,
      activeSockets: 0,
      durationMs: performance.now() - startedAt,
    });
  }

  async recentAcceptedCommandPerformance(): Promise<
    readonly AcceptedCommandPerformanceObservation[]
  > {
    const runtime = await this.runtimePromise;
    return runtime?.hub.recentAcceptedCommandPerformance() ?? [];
  }

  private disconnectSocket(socket: WebSocket): void {
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.connectionId) return;
    void this.runtimePromise.then((runtime) =>
      runtime?.hub.disconnect(attachment.connectionId)
    );
  }

  private coordinateSocketAlarm<Value>(
    operation: () => Promise<Value>
  ): Promise<Value> {
    const run = this.socketAlarmTail.then(operation);
    this.socketAlarmTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async ensureAlarmNoLaterThan(deadline: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || deadline < current) {
      await this.ctx.storage.setAlarm(deadline);
    }
  }

  private async expireSocketAdmissions(
    now: number,
    runtime: RoomRuntime | undefined
  ): Promise<number | undefined> {
    let nextDeadline: number | undefined;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment =
        socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment?.connectionId || attachment.sessionId) continue;
      const deadline = attachment.admissionExpiresAt;
      if (!liveAdmissionDeadline(deadline, now)) {
        await runtime?.hub.disconnect(attachment.connectionId);
        socket.close(4408, 'Admission timed out');
        continue;
      }
      nextDeadline =
        nextDeadline === undefined
          ? deadline
          : Math.min(nextDeadline, deadline);
    }
    return nextDeadline;
  }

  private async reconcileClaimedSocketAdmissionAlarm(
    now: number,
    runtime: RoomRuntime
  ): Promise<void> {
    const nextDeadline = await this.expireSocketAdmissions(now, runtime);
    if (nextDeadline === undefined) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(nextDeadline);
    }
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
      monotonicNow: () => performance.now(),
    });
    return {
      coordinator,
      hub: new RoomSessionHub(coordinator, this.env.BUILD_ID, {
        store: this.store,
        rateLimits: this.rateLimits,
        telemetry: this.telemetry,
        monotonicNow: () => performance.now(),
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
    const startedAt = performance.now();
    let snapshot;
    try {
      snapshot = await this.store.load();
    } catch (error) {
      this.telemetry.failure({
        subsystem: 'room_restoration',
        retryable: true,
      });
      throw error;
    }
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
    const now = Date.now();
    let nextSocketAdmission: number | undefined;
    const restoredSockets: typeof sockets = [];
    for (const { socket, attachment } of sockets) {
      if (
        attachment.sessionId &&
        !snapshot.sessions[attachment.sessionId]?.active
      ) {
        socket.close(4409, 'Session is no longer active');
        continue;
      }
      if (
        !attachment.sessionId &&
        !liveAdmissionDeadline(attachment.admissionExpiresAt, now)
      ) {
        socket.close(4408, 'Admission timed out');
        continue;
      }
      if (!attachment.sessionId) {
        nextSocketAdmission =
          nextSocketAdmission === undefined
            ? attachment.admissionExpiresAt
            : Math.min(nextSocketAdmission, attachment.admissionExpiresAt!);
      }
      runtime.hub.restoreBinding(
        this.connection(socket, attachment.connectionId),
        attachment.sessionId
      );
      restoredSockets.push({ socket, attachment });
    }
    if (Object.keys(snapshot.sessions).length > 0) {
      if (nextSocketAdmission === undefined) {
        await this.ctx.storage.deleteAlarm();
      } else {
        await this.ctx.storage.setAlarm(nextSocketAdmission);
      }
    } else {
      const lifecycle = await this.store.expireUnclaimedRoom(now);
      if (lifecycle === 'expired') {
        for (const { socket } of restoredSockets) {
          socket.close(4404, 'Room expired before admission');
        }
        this.telemetry.roomLifecycle({
          outcome: 'expired',
          authorityVersion: snapshot.authorityVersion,
          activeSessions: 0,
          activeSockets: 0,
          durationMs: performance.now() - startedAt,
        });
        return undefined;
      }
      if (nextSocketAdmission !== undefined) {
        await this.ensureAlarmNoLaterThan(nextSocketAdmission);
      }
    }
    this.telemetry.roomLifecycle({
      outcome: 'restored',
      authorityVersion: snapshot.authorityVersion,
      activeSessions: activeSessionCount(snapshot),
      activeSockets: restoredSockets.length,
      durationMs: performance.now() - startedAt,
    });
    if (restoredSockets.length > 0) {
      this.telemetry.roomSocket({
        outcome: 'restored',
        activeSockets: restoredSockets.length,
      });
    }
    return runtime;
  }
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const telemetry = createTelemetry('edge', env.BUILD_ID);
    if (url.pathname === '/v2/health') {
      return observeHttp(telemetry, 'health', () =>
        handleServerHealthRequest(request, env.BUILD_ID)
      );
    }
    if (url.pathname === '/v2/rooms') {
      return observeHttp(telemetry, 'room_creation', () =>
        handleRoomCreationRequest(
          request,
          async ({ mode }) => {
            for (let attempt = 0; attempt < 8; attempt += 1) {
              const code = roomCode();
              const stub = env.PTCG_ROOM.getByName(code);
              try {
                return await stub.initialize(code, mode);
              } catch (error) {
                if (isRoomAlreadyInitialized(error)) continue;
                throw error;
              }
            }
            throw new Error('room_code_exhausted');
          },
          () =>
            consumeRoomCreationRateLimit(
              request,
              env.ROOM_CREATION_RATE_LIMITER
            )
        )
      );
    }
    const code = roomCodeFromPath(url.pathname);
    if (request.method === 'GET' && code) {
      return env.PTCG_ROOM.getByName(code).fetch(request);
    }
    const admissionCode = admissionRoomCodeFromPath(url.pathname);
    if (admissionCode) {
      return env.PTCG_ROOM.getByName(admissionCode).fetch(request);
    }
    const invitationCode = invitationRoomCodeFromPath(url.pathname);
    if (invitationCode) {
      return env.PTCG_ROOM.getByName(invitationCode).fetch(request);
    }
    return observeHttp(
      telemetry,
      'not_found',
      () => new Response('Not Found', { status: 404 })
    );
  },
};

export default worker;
