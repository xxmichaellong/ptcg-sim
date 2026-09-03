import { MATCH_STATE_SCHEMA_VERSION } from '@ptcgsim/game-core';
import { PROTOCOL_VERSION, type WireGameCommand } from '@ptcgsim/protocol';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  type AuthorityRejectionCode,
} from '@ptcgsim/room-authority';

import type { RoomRateLimitedOperation } from './room-rate-limit.js';

export const SERVER_TELEMETRY_SCHEMA = 'ptcgsim-server-telemetry-v2';

export type ServerTelemetryLevel = 'info' | 'warn' | 'error';
export type ServerTelemetrySource = 'edge' | 'room';
export type ServerHttpRoute =
  | 'health'
  | 'room_creation'
  | 'room_invitation'
  | 'admission_ticket'
  | 'socket_upgrade'
  | 'not_found';
export type ServerHttpOutcome =
  'accepted' | 'rejected' | 'rate_limited' | 'not_found' | 'failed';
export type RoomLifecycleOutcome =
  'created' | 'restored' | 'expired' | 'alarm_rescheduled' | 'alarm_cancelled';
export type RoomAdmissionOperation =
  'invitation_issue' | 'ticket_issue' | 'hello_ticket' | 'hello_resume';
export type RoomAdmissionOutcome =
  'accepted' | 'rejected' | 'rate_limited' | 'failed';
export type RoomCommandOutcome =
  'accepted' | 'rejected' | 'duplicate' | 'failed';
export interface RoomCommandPhaseDurations {
  readonly authorityProcessingMs: number;
  readonly projectionMs: number;
  readonly persistenceMs: number;
  readonly publicationSerializationMs: number;
  readonly socketSendMs: number;
}
export type RoomSocketOutcome = 'upgraded' | 'restored' | 'closed' | 'error';
export type ServerFailureSubsystem =
  | 'room_initialization'
  | 'room_restoration'
  | 'room_alarm'
  | 'invitation_issue'
  | 'ticket_issue'
  | 'session_admission'
  | 'command_processing'
  | 'replay_projection'
  | 'socket_send'
  | 'socket_upgrade';

export type TelemetryReason =
  | AuthorityRejectionCode
  | 'none'
  | 'invalid_request'
  | 'invalid_capability'
  | 'seat_unavailable'
  | 'room_not_ready'
  | 'ticket_capacity'
  | 'invitation_capacity'
  | 'invalid_admission'
  | 'admission_required'
  | 'unknown';

interface ServerTelemetryBase {
  readonly schema: typeof SERVER_TELEMETRY_SCHEMA;
  readonly timestampMs: number;
  readonly eventId: string;
  readonly source: ServerTelemetrySource;
  readonly sourceInstanceId: string;
  readonly buildId: string;
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly authoritySchemaVersion: typeof AUTHORITY_SNAPSHOT_SCHEMA_VERSION;
  readonly matchStateSchemaVersion: typeof MATCH_STATE_SCHEMA_VERSION;
}

type ServerTelemetryDetail =
  | {
      readonly kind: 'http_request';
      readonly route: ServerHttpRoute;
      readonly outcome: ServerHttpOutcome;
      readonly status: number;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'room_lifecycle';
      readonly outcome: RoomLifecycleOutcome;
      readonly authorityVersion: number;
      readonly activeSessions: number;
      readonly activeSockets: number;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'room_rate_limit';
      readonly operation: RoomRateLimitedOperation;
      readonly outcome: 'allowed' | 'limited';
      readonly retryAfterSeconds: number;
    }
  | {
      readonly kind: 'room_admission';
      readonly operation: RoomAdmissionOperation;
      readonly requestedRole: 'player' | 'spectator';
      readonly outcome: RoomAdmissionOutcome;
      readonly reason: TelemetryReason;
      readonly authorityVersion: number;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'room_command';
      readonly commandType: string;
      readonly outcome: RoomCommandOutcome;
      readonly reason: TelemetryReason;
      readonly startRevision: number;
      readonly endRevision: number;
      readonly requestBytes: number;
      readonly publicationBytes: number;
      readonly deliveryCount: number;
      readonly phases: RoomCommandPhaseDurations;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'room_socket';
      readonly outcome: RoomSocketOutcome;
      readonly closeCode: number;
      readonly activeSockets: number;
    }
  | {
      readonly kind: 'server_failure';
      readonly subsystem: ServerFailureSubsystem;
      readonly retryable: boolean;
    };

export type ServerTelemetryEvent = ServerTelemetryBase & ServerTelemetryDetail;

export interface ServerTelemetrySink {
  readonly emit: (
    level: ServerTelemetryLevel,
    event: ServerTelemetryEvent
  ) => void;
}

export interface ServerTelemetryPort {
  readonly httpRequest: (input: {
    readonly route: ServerHttpRoute;
    readonly status: number;
    readonly durationMs: number;
  }) => void;
  readonly roomLifecycle: (input: {
    readonly outcome: RoomLifecycleOutcome;
    readonly authorityVersion: number;
    readonly activeSessions: number;
    readonly activeSockets: number;
    readonly durationMs: number;
  }) => void;
  readonly roomRateLimit: (input: {
    readonly operation: RoomRateLimitedOperation;
    readonly allowed: boolean;
    readonly retryAfterSeconds?: number;
  }) => void;
  readonly roomAdmission: (input: {
    readonly operation: RoomAdmissionOperation;
    readonly requestedRole: 'player' | 'spectator';
    readonly outcome: RoomAdmissionOutcome;
    readonly reason?: string;
    readonly authorityVersion: number;
    readonly durationMs: number;
  }) => void;
  readonly roomCommand: (input: {
    readonly commandType: WireGameCommand['type'] | 'Unknown';
    readonly outcome: RoomCommandOutcome;
    readonly reason?: string;
    readonly startRevision: number;
    readonly endRevision: number;
    readonly requestBytes: number;
    readonly publicationBytes: number;
    readonly deliveryCount: number;
    readonly phases?: Partial<RoomCommandPhaseDurations>;
    readonly durationMs: number;
  }) => void;
  readonly roomSocket: (input: {
    readonly outcome: RoomSocketOutcome;
    readonly closeCode?: number;
    readonly activeSockets: number;
  }) => void;
  readonly failure: (input: {
    readonly subsystem: ServerFailureSubsystem;
    readonly retryable: boolean;
  }) => void;
}

const TELEMETRY_REASONS = new Set<TelemetryReason>([
  'invalid_message',
  'invalid_sequence',
  'unauthorized',
  'stale_reference',
  'precondition_failed',
  'rate_limited',
  'room_not_ready',
  'room_full',
  'session_superseded',
  'internal_retryable',
  'none',
  'invalid_request',
  'invalid_capability',
  'seat_unavailable',
  'ticket_capacity',
  'invitation_capacity',
  'invalid_admission',
  'admission_required',
  'unknown',
]);

export const safeTelemetryReason = (value?: string): TelemetryReason =>
  value === undefined
    ? 'none'
    : TELEMETRY_REASONS.has(value as TelemetryReason)
      ? (value as TelemetryReason)
      : 'unknown';

export const safeTelemetryBuildId = (value: string): string =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) ? value : 'invalid-build';

const safeOpaqueId = (value: string): string =>
  /^[A-Za-z0-9_-]{8,128}$/u.test(value) ? value : 'invalid-correlation';

const safeCount = (value: number): number =>
  Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, 1_000_000_000)
    : 0;

const safeDuration = (value: number): number =>
  Number.isFinite(value) && value >= 0
    ? Math.min(Math.round(value * 1_000) / 1_000, 86_400_000)
    : 0;

const safeCommandPhases = (
  value?: Partial<RoomCommandPhaseDurations>
): RoomCommandPhaseDurations => ({
  authorityProcessingMs: safeDuration(value?.authorityProcessingMs ?? 0),
  projectionMs: safeDuration(value?.projectionMs ?? 0),
  persistenceMs: safeDuration(value?.persistenceMs ?? 0),
  publicationSerializationMs: safeDuration(
    value?.publicationSerializationMs ?? 0
  ),
  socketSendMs: safeDuration(value?.socketSendMs ?? 0),
});

const safeStatus = (value: number): number =>
  Number.isSafeInteger(value) && value >= 100 && value <= 599 ? value : 500;

const safeCloseCode = (value?: number): number =>
  value && Number.isSafeInteger(value) && value >= 1000 && value <= 4999
    ? value
    : 1006;

const httpOutcome = (status: number): ServerHttpOutcome => {
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'failed';
  if (status >= 200 && status < 400) return 'accepted';
  return 'rejected';
};

const levelForOutcome = (
  outcome: ServerHttpOutcome | RoomAdmissionOutcome | RoomCommandOutcome
): ServerTelemetryLevel =>
  outcome === 'failed'
    ? 'error'
    : outcome === 'rejected' || outcome === 'rate_limited'
      ? 'warn'
      : 'info';

export class ConsoleServerTelemetrySink implements ServerTelemetrySink {
  emit(level: ServerTelemetryLevel, event: ServerTelemetryEvent): void {
    console[level](event);
  }
}

export class StructuredServerTelemetry implements ServerTelemetryPort {
  private readonly buildId: string;
  private readonly sourceInstanceId: string;

  constructor(
    private readonly source: ServerTelemetrySource,
    buildId: string,
    private readonly sink: ServerTelemetrySink,
    private readonly now: () => number,
    private readonly nextEventId: () => string
  ) {
    this.buildId = safeTelemetryBuildId(buildId);
    try {
      this.sourceInstanceId = safeOpaqueId(this.nextEventId());
    } catch {
      this.sourceInstanceId = 'invalid-correlation';
    }
  }

  httpRequest({
    route,
    status,
    durationMs,
  }: Parameters<ServerTelemetryPort['httpRequest']>[0]): void {
    const safeHttpStatus = safeStatus(status);
    const outcome = httpOutcome(safeHttpStatus);
    this.publish(levelForOutcome(outcome), {
      kind: 'http_request',
      route,
      outcome,
      status: safeHttpStatus,
      durationMs: safeDuration(durationMs),
    });
  }

  roomLifecycle({
    outcome,
    authorityVersion,
    activeSessions,
    activeSockets,
    durationMs,
  }: Parameters<ServerTelemetryPort['roomLifecycle']>[0]): void {
    this.publish('info', {
      kind: 'room_lifecycle',
      outcome,
      authorityVersion: safeCount(authorityVersion),
      activeSessions: safeCount(activeSessions),
      activeSockets: safeCount(activeSockets),
      durationMs: safeDuration(durationMs),
    });
  }

  roomRateLimit({
    operation,
    allowed,
    retryAfterSeconds,
  }: Parameters<ServerTelemetryPort['roomRateLimit']>[0]): void {
    this.publish(allowed ? 'info' : 'warn', {
      kind: 'room_rate_limit',
      operation,
      outcome: allowed ? 'allowed' : 'limited',
      retryAfterSeconds: allowed ? 0 : safeCount(retryAfterSeconds ?? 0),
    });
  }

  roomAdmission({
    operation,
    requestedRole,
    outcome,
    reason,
    authorityVersion,
    durationMs,
  }: Parameters<ServerTelemetryPort['roomAdmission']>[0]): void {
    this.publish(levelForOutcome(outcome), {
      kind: 'room_admission',
      operation,
      requestedRole,
      outcome,
      reason: safeTelemetryReason(reason),
      authorityVersion: safeCount(authorityVersion),
      durationMs: safeDuration(durationMs),
    });
  }

  roomCommand({
    commandType,
    outcome,
    reason,
    startRevision,
    endRevision,
    requestBytes,
    publicationBytes,
    deliveryCount,
    phases,
    durationMs,
  }: Parameters<ServerTelemetryPort['roomCommand']>[0]): void {
    this.publish(levelForOutcome(outcome), {
      kind: 'room_command',
      commandType: /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(commandType)
        ? commandType
        : 'Unknown',
      outcome,
      reason: safeTelemetryReason(reason),
      startRevision: safeCount(startRevision),
      endRevision: safeCount(endRevision),
      requestBytes: safeCount(requestBytes),
      publicationBytes: safeCount(publicationBytes),
      deliveryCount: safeCount(deliveryCount),
      phases: safeCommandPhases(phases),
      durationMs: safeDuration(durationMs),
    });
  }

  roomSocket({
    outcome,
    closeCode,
    activeSockets,
  }: Parameters<ServerTelemetryPort['roomSocket']>[0]): void {
    this.publish(outcome === 'error' ? 'error' : 'info', {
      kind: 'room_socket',
      outcome,
      closeCode: safeCloseCode(closeCode),
      activeSockets: safeCount(activeSockets),
    });
  }

  failure({
    subsystem,
    retryable,
  }: Parameters<ServerTelemetryPort['failure']>[0]): void {
    this.publish('error', {
      kind: 'server_failure',
      subsystem,
      retryable,
    });
  }

  private publish(
    level: ServerTelemetryLevel,
    detail: ServerTelemetryDetail
  ): void {
    try {
      const timestamp = this.now();
      const event = {
        schema: SERVER_TELEMETRY_SCHEMA,
        timestampMs:
          Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : 0,
        eventId: safeOpaqueId(this.nextEventId()),
        source: this.source,
        sourceInstanceId: this.sourceInstanceId,
        buildId: this.buildId,
        protocolVersion: PROTOCOL_VERSION,
        authoritySchemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
        matchStateSchemaVersion: MATCH_STATE_SCHEMA_VERSION,
        ...detail,
      } as ServerTelemetryEvent;
      this.sink.emit(level, Object.freeze(event));
    } catch {
      // Telemetry can never alter authority, persistence, or response behavior.
    }
  }
}

export const NOOP_SERVER_TELEMETRY: ServerTelemetryPort = {
  httpRequest: () => undefined,
  roomLifecycle: () => undefined,
  roomRateLimit: () => undefined,
  roomAdmission: () => undefined,
  roomCommand: () => undefined,
  roomSocket: () => undefined,
  failure: () => undefined,
};

export const nextTelemetryId = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
