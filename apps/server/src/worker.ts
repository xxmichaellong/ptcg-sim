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
import { createContinuationCryptographyFromConfiguration } from './continuation-configuration.js';
import { handleContinuationCreationRequest } from './continuation-creation-http.js';
import {
  coordinateContinuationCreation,
  type ContinuationCreationCoordinationResult,
} from './continuation-create.js';
import {
  DurableContinuationCustody,
  createContinuationSaveId,
  expireContinuationCustody,
  type ContinuationCreationReceipt,
  type ReservedContinuationCreationResult,
} from './continuation-custody.js';
import { prepareContinuationFork } from './continuation-fork.js';
import { continuationHttpMode } from './continuation-http-activation.js';
import { readContinuationQuotaConfiguration } from './continuation-quota-configuration.js';
import {
  DurableContinuationQuotaShard,
  continuationQuotaShardName,
  expireContinuationQuotaLeases,
  type ContinuationQuotaLeaseReservation,
} from './continuation-quota.js';
import { authenticateContinuationRequester } from './continuation-request-auth.js';
import {
  coordinateContinuationRestore,
  type ContinuationRestoreTargetAcknowledgement,
} from './continuation-restore.js';
import { handleContinuationRestoreRequest } from './continuation-restore-http.js';
import { handleContinuationRevocationRequest } from './continuation-revocation-http.js';
import {
  readContinuationRevocationRpcInput,
  readContinuationSaveCreationRpcInput,
  readContinuationSaveRecoveryRpcInput,
  readContinuationQuotaReservationRpcInput,
  readContinuationRestoreRpcInput,
  readContinuationSourceCreationRpcInput,
  type ContinuationRestoreRpcResult,
} from './continuation-rpc.js';
import { DurableRoomContinuationSource } from './continuation-source.js';
import {
  initializeContinuationTarget,
  validateContinuationTargetPlan,
} from './continuation-target.js';
import { initializeNewRoom } from './create-room.js';
import {
  DurableRoomSnapshotStore,
  RoomAlreadyInitializedError,
} from './durable-storage.js';
import { isRoomAlreadyInitialized } from './room-initialization.js';
import {
  consumeContinuationCreationRateLimit,
  consumeContinuationRestoreRateLimit,
  consumeContinuationRevocationRateLimit,
  consumeRoomCreationRateLimit,
} from './request-rate-limit.js';
import { handleRoomCreationRequest } from './room-creation-http.js';
import { handleRoomInvitationRequest } from './room-invitation-http.js';
import { DurableRoomRateLimiter } from './room-rate-limit.js';
import { handleServerHealthRequest } from './server-health.js';
import { activeSocketCountExcluding } from './socket-telemetry.js';
import {
  ConsoleServerTelemetrySink,
  StructuredServerTelemetry,
  nextTelemetryId,
  type ContinuationLifecycleOperation,
  type ContinuationLifecycleOutcome,
  type ServerHttpRoute,
  type ServerTelemetrySource,
  type ServerTelemetryPort,
} from './server-telemetry.js';
import {
  RoomSessionHub,
  type AcceptedCommandPerformanceObservation,
  type RuntimeConnection,
} from './session-hub.js';

interface Env {
  readonly BUILD_ID: string;
  /** Secret binding, deliberately absent from checked-in production config. */
  readonly CONTINUATION_KEYRING?: string;
  /** Operator policy binding, deliberately absent from production defaults. */
  readonly CONTINUATION_QUOTA_CONFIGURATION?: string;
  /** Exact default-off edge activation token, absent from production config. */
  readonly CONTINUATION_HTTP_ACTIVATION?: string;
  readonly PTCG_CONTINUATION: DurableObjectNamespace<PtcgContinuation>;
  readonly PTCG_CONTINUATION_QUOTA: DurableObjectNamespace<PtcgContinuationQuota>;
  readonly PTCG_ROOM: DurableObjectNamespace<PtcgRoom>;
  readonly CONTINUATION_CREATION_RATE_LIMITER: RateLimit;
  readonly CONTINUATION_RESTORE_RATE_LIMITER: RateLimit;
  readonly CONTINUATION_REVOCATION_RATE_LIMITER: RateLimit;
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
  source: ServerTelemetrySource,
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

const continuationCreationRoomCodeFromPath = (
  pathname: string
): string | undefined => {
  const match = /^\/v2\/rooms\/([A-HJ-NP-Z2-9]{12})\/continuations$/u.exec(
    pathname
  );
  return match?.[1];
};

const continuationRestoreSaveIdFromPath = (
  pathname: string
): string | undefined => {
  const match = /^\/v2\/continuations\/([A-Za-z0-9_-]{22})\/restore$/u.exec(
    pathname
  );
  return match?.[1];
};

const continuationRevocationSaveIdFromPath = (
  pathname: string
): string | undefined => {
  const match = /^\/v2\/continuations\/([A-Za-z0-9_-]{22})$/u.exec(pathname);
  return match?.[1];
};

/**
 * Dedicated long-lived custody namespace. Only the gated restore and
 * revocation edge routes may select it; every operation still crosses a
 * typed internal Durable Object RPC. The rollout gate can retain revocation
 * while create/restore are draining; open remains closed. Create is reachable
 * only through the source room's private RPC.
 */
export class PtcgContinuation extends DurableObject<Env> {
  private readonly authoritySource = new WebCryptoAuthoritySource();
  private readonly telemetry: StructuredServerTelemetry;
  private custodyPromise: Promise<DurableContinuationCustody> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.telemetry = createTelemetry('continuation', env.BUILD_ID);
  }

  async createContinuation(
    value: unknown
  ): Promise<ReservedContinuationCreationResult | undefined> {
    return this.measureLifecycle(
      'create',
      async () => {
        const input = readContinuationSaveCreationRpcInput(
          value,
          this.ctx.id.name
        );
        if (!input) return undefined;
        return (await this.custody()).createReserved(input);
      },
      (result) =>
        result ? (result.created ? 'accepted' : 'recovered') : 'rejected'
    );
  }

  async recoverContinuation(
    value: unknown
  ): Promise<ContinuationCreationReceipt | undefined> {
    return this.measureLifecycle(
      'create',
      async () => {
        const input = readContinuationSaveRecoveryRpcInput(
          value,
          this.ctx.id.name
        );
        if (!input) return undefined;
        return (await this.custody()).recoverReservedCreation(input);
      },
      (result) => (result ? 'recovered' : 'rejected')
    );
  }

  async restore(value: unknown): Promise<ContinuationRestoreRpcResult> {
    return this.measureLifecycle(
      'restore',
      async () => {
        const input = readContinuationRestoreRpcInput(value, this.ctx.id.name);
        if (!input) return undefined;
        const custody = await this.custody();
        return coordinateContinuationRestore(input, {
          save: {
            reserveRestore: (reserveInput) =>
              custody.reserveRestore(reserveInput, async (checkpoint) => ({
                targetRoomCode: roomCode(),
                fork: await prepareContinuationFork(
                  checkpoint,
                  this.authoritySource,
                  reserveInput.reservedAt
                ),
              })),
            completeRestore: (completeInput) =>
              custody.completeRestore(completeInput),
          },
          target: {
            initializeRestoreTarget: (plan) =>
              this.env.PTCG_ROOM.getByName(
                plan.targetRoomCode
              ).initializeContinuation(plan),
          },
          clock: { now: Date.now },
        });
      },
      (result) => (result ? 'accepted' : 'rejected')
    );
  }

  async revoke(value: unknown): Promise<boolean | undefined> {
    return this.measureLifecycle(
      'revoke',
      async () => {
        const input = readContinuationRevocationRpcInput(
          value,
          this.ctx.id.name
        );
        if (!input) return undefined;
        return (await this.custody()).revoke(input.capability, Date.now());
      },
      (result) => (result ? 'accepted' : 'rejected')
    );
  }

  override async alarm(): Promise<void> {
    await this.measureLifecycle(
      'expire',
      () => expireContinuationCustody(this.ctx.storage, Date.now()),
      (result) => result
    );
  }

  private async measureLifecycle<Value>(
    operation: ContinuationLifecycleOperation,
    run: () => Promise<Value>,
    outcome: (value: Value) => ContinuationLifecycleOutcome
  ): Promise<Value> {
    const startedAt = performance.now();
    try {
      const result = await run();
      this.telemetry.continuationLifecycle({
        operation,
        outcome: outcome(result),
        durationMs: performance.now() - startedAt,
      });
      return result;
    } catch (error) {
      this.telemetry.continuationLifecycle({
        operation,
        outcome: 'failed',
        durationMs: performance.now() - startedAt,
      });
      throw error;
    }
  }

  private custody(): Promise<DurableContinuationCustody> {
    this.custodyPromise ??= createContinuationCryptographyFromConfiguration(
      this.env.CONTINUATION_KEYRING
    ).then(
      (cryptography) =>
        new DurableContinuationCustody(this.ctx.storage, cryptography)
    );
    return this.custodyPromise;
  }
}

/**
 * One fixed partition of the global continuation capacity. No edge route
 * selects this namespace, and alarms need no production configuration.
 */
export class PtcgContinuationQuota extends DurableObject<Env> {
  private readonly identity = new WebCryptoAuthoritySource();

  async reserveContinuation(
    value: unknown
  ): Promise<ContinuationQuotaLeaseReservation | undefined> {
    const input = readContinuationQuotaReservationRpcInput(value);
    if (!input) return undefined;
    const configuration = readContinuationQuotaConfiguration(
      this.env.CONTINUATION_QUOTA_CONFIGURATION
    );
    const expectedShard = await continuationQuotaShardName(
      input.sourceRoomCode,
      configuration.shardCount,
      this.identity
    );
    if (expectedShard !== this.ctx.id.name) return undefined;
    const quota = new DurableContinuationQuotaShard(
      this.ctx.storage,
      this.identity,
      configuration.shardPolicy
    );
    return quota.reserve(input);
  }

  override async alarm(): Promise<void> {
    await expireContinuationQuotaLeases(this.ctx.storage, Date.now());
  }
}

export class PtcgRoom extends DurableObject<Env> {
  private readonly cryptoSource = new WebCryptoAuthoritySource();
  private readonly store: DurableRoomSnapshotStore;
  private readonly rateLimits: DurableRoomRateLimiter;
  private readonly continuationSource: DurableRoomContinuationSource;
  private readonly telemetry: StructuredServerTelemetry;
  private socketAlarmTail: Promise<void> = Promise.resolve();
  private runtimePromise: Promise<RoomRuntime | undefined>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new DurableRoomSnapshotStore(ctx.storage);
    this.rateLimits = new DurableRoomRateLimiter(ctx.storage);
    this.continuationSource = new DurableRoomContinuationSource(ctx.storage, {
      digestCapability: (value) => this.cryptoSource.digestCapability(value),
      nextSaveId: createContinuationSaveId,
    });
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

  async initializeContinuation(
    plan: unknown
  ): Promise<ContinuationRestoreTargetAcknowledgement | undefined> {
    let validated;
    try {
      validated = await validateContinuationTargetPlan(plan, this.cryptoSource);
    } catch {
      return undefined;
    }
    if (validated.targetRoomCode !== this.ctx.id.name) return undefined;
    const result = await initializeContinuationTarget(
      validated,
      this.store,
      this.cryptoSource,
      validated.targetRoomCode
    );
    const snapshot = await this.store.load();
    if (!snapshot) {
      throw new Error('Continuation target initialization was not recoverable');
    }
    this.runtimePromise = Promise.resolve(this.createRuntime(snapshot));
    return result;
  }

  async createContinuation(
    value: unknown
  ): Promise<ContinuationCreationCoordinationResult | undefined> {
    const input = readContinuationSourceCreationRpcInput(value);
    if (!input) return undefined;
    const runtime = await this.runtimePromise;
    if (!runtime) return undefined;
    const sourceRoomCode = this.ctx.id.name;
    if (!sourceRoomCode) return undefined;
    const snapshot = runtime.coordinator.currentSnapshot();
    const requesterSessionId = await authenticateContinuationRequester(
      snapshot,
      input.resumeToken,
      this.cryptoSource
    );
    if (!requesterSessionId) return undefined;
    const result = await coordinateContinuationCreation(
      {
        operationId: input.operationId,
        requesterSessionId,
        sourceRoomCode,
        sourceBuild: this.env.BUILD_ID,
      },
      {
        source: {
          reserveCreation: (reserveInput) =>
            this.continuationSource.reserveCreation({
              ...reserveInput,
              snapshot,
            }),
          completeCreation: (completeInput) =>
            this.continuationSource.completeCreation({
              ...completeInput,
              snapshot: runtime.coordinator.currentSnapshot(),
            }),
        },
        quota: {
          reserve: async (quotaInput) => {
            const configuration = readContinuationQuotaConfiguration(
              this.env.CONTINUATION_QUOTA_CONFIGURATION
            );
            const quotaShard = await continuationQuotaShardName(
              sourceRoomCode,
              configuration.shardCount,
              this.cryptoSource
            );
            return this.env.PTCG_CONTINUATION_QUOTA.getByName(
              quotaShard
            ).reserveContinuation(quotaInput);
          },
        },
        saveForId: (saveId) => {
          const save = this.env.PTCG_CONTINUATION.getByName(saveId);
          return {
            createReserved: (createInput) =>
              save.createContinuation(createInput),
            recoverReserved: (recoverInput) =>
              save.recoverContinuation(recoverInput),
          };
        },
        clock: { now: Date.now },
      }
    );
    if (result?.state === 'rate_limited') {
      this.telemetry.roomRateLimit({
        operation: 'continuation_create',
        allowed: false,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    return result;
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
      (!runtime.coordinator.currentSnapshot().sessions[attachment.sessionId]
        ?.active ||
        runtime.coordinator.currentSnapshot().sessions[attachment.sessionId]
          ?.reconnectExpiresAt !== undefined)
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
    await this.disconnectSocket(socket);
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
    await this.disconnectSocket(socket);
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
    await runtime?.hub.expireDisconnectedSessions(now);
    const nextReconnect = runtime?.hub.nextReconnectExpiry();
    let result;
    try {
      result = await this.store.expireUnclaimedRoom(now);
    } catch (error) {
      this.telemetry.failure({ subsystem: 'room_alarm', retryable: true });
      throw error;
    }
    const nextDeadline = [nextSocketAdmission, nextReconnect].reduce<
      number | undefined
    >(
      (next, deadline) =>
        deadline === undefined
          ? next
          : next === undefined
            ? deadline
            : Math.min(next, deadline),
      undefined
    );
    if (result !== 'expired' && nextDeadline !== undefined) {
      await this.ensureAlarmNoLaterThan(nextDeadline);
    }
    if (result === 'scheduled' || result === 'claimed') {
      this.telemetry.roomLifecycle({
        outcome:
          result === 'scheduled' || nextDeadline !== undefined
            ? 'alarm_rescheduled'
            : 'alarm_cancelled',
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

  private async disconnectSocket(socket: WebSocket): Promise<void> {
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.connectionId) return;
    const runtime = await this.runtimePromise;
    await runtime?.hub.disconnect(attachment.connectionId);
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
    const nextReconnect = runtime.hub.nextReconnectExpiry();
    const earliest =
      nextDeadline === undefined
        ? nextReconnect
        : nextReconnect === undefined
          ? nextDeadline
          : Math.min(nextDeadline, nextReconnect);
    if (earliest === undefined) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(earliest);
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
        (!snapshot.sessions[attachment.sessionId]?.active ||
          snapshot.sessions[attachment.sessionId]?.reconnectExpiresAt !==
            undefined)
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
    const nextReconnect = await runtime.hub.reconcileDisconnectedBindings();
    const restoredSnapshot = runtime.coordinator.currentSnapshot();
    const nextDeadline =
      nextSocketAdmission === undefined
        ? nextReconnect
        : nextReconnect === undefined
          ? nextSocketAdmission
          : Math.min(nextSocketAdmission, nextReconnect);
    if (Object.keys(restoredSnapshot.sessions).length > 0) {
      if (nextDeadline === undefined) {
        await this.ctx.storage.deleteAlarm();
      } else {
        await this.ctx.storage.setAlarm(nextDeadline);
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
      authorityVersion: restoredSnapshot.authorityVersion,
      activeSessions: activeSessionCount(restoredSnapshot),
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
    const continuationMode = continuationHttpMode(
      env.CONTINUATION_HTTP_ACTIVATION
    );
    if (continuationMode === 'enabled') {
      const sourceRoomCode = continuationCreationRoomCodeFromPath(url.pathname);
      if (sourceRoomCode) {
        return observeHttp(telemetry, 'continuation_creation', () =>
          handleContinuationCreationRequest(
            request,
            (input) =>
              env.PTCG_ROOM.getByName(sourceRoomCode).createContinuation(input),
            () =>
              consumeContinuationCreationRateLimit(
                request,
                env.CONTINUATION_CREATION_RATE_LIMITER
              )
          )
        );
      }
      const saveId = continuationRestoreSaveIdFromPath(url.pathname);
      if (saveId) {
        return observeHttp(telemetry, 'continuation_restore', () =>
          handleContinuationRestoreRequest(
            request,
            saveId,
            (selectedSaveId, input) =>
              env.PTCG_CONTINUATION.getByName(selectedSaveId).restore(input),
            () =>
              consumeContinuationRestoreRateLimit(
                request,
                env.CONTINUATION_RESTORE_RATE_LIMITER
              )
          )
        );
      }
    }
    if (continuationMode === 'enabled' || continuationMode === 'draining') {
      const revocationSaveId = continuationRevocationSaveIdFromPath(
        url.pathname
      );
      if (revocationSaveId) {
        return observeHttp(telemetry, 'continuation_revocation', () =>
          handleContinuationRevocationRequest(
            request,
            revocationSaveId,
            (selectedSaveId, input) =>
              env.PTCG_CONTINUATION.getByName(selectedSaveId).revoke(input),
            () =>
              consumeContinuationRevocationRateLimit(
                request,
                env.CONTINUATION_REVOCATION_RATE_LIMITER
              )
          )
        );
      }
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
