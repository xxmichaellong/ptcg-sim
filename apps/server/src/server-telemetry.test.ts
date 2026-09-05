import { describe, expect, it, vi } from 'vitest';

import {
  StructuredServerTelemetry,
  type ServerTelemetryEvent,
  type ServerTelemetryLevel,
  type ServerTelemetrySink,
} from './server-telemetry.js';

class CollectingSink implements ServerTelemetrySink {
  readonly entries: Array<{
    readonly level: ServerTelemetryLevel;
    readonly event: ServerTelemetryEvent;
  }> = [];

  emit(level: ServerTelemetryLevel, event: ServerTelemetryEvent): void {
    this.entries.push({ level, event });
  }
}

const fixture = (buildId = 'build-abc.123') => {
  const sink = new CollectingSink();
  let id = 0;
  const telemetry = new StructuredServerTelemetry(
    'room',
    buildId,
    sink,
    () => 50_000,
    () => `opaque-event-${++id}`
  );
  return { sink, telemetry };
};

describe('structured server telemetry', () => {
  it('emits versioned operational facts without caller extras or credentials', () => {
    const { sink, telemetry } = fixture();
    const credential = 'seat-capability-never-logged-0000000001';
    const input = {
      operation: 'ticket_issue' as const,
      requestedRole: 'player' as const,
      outcome: 'rejected' as const,
      reason: 'invalid_capability',
      authorityVersion: 7,
      durationMs: 4.1256,
      capability: credential,
      displayName: 'Private display name',
    };

    telemetry.roomAdmission(input);

    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toMatchObject({
      level: 'warn',
      event: {
        schema: 'ptcgsim-server-telemetry-v2',
        timestampMs: 50_000,
        eventId: 'opaque-event-2',
        source: 'room',
        sourceInstanceId: 'opaque-event-1',
        buildId: 'build-abc.123',
        protocolVersion: 2,
        authoritySchemaVersion: 6,
        matchStateSchemaVersion: 2,
        kind: 'room_admission',
        operation: 'ticket_issue',
        requestedRole: 'player',
        outcome: 'rejected',
        reason: 'invalid_capability',
        authorityVersion: 7,
        durationMs: 4.126,
      },
    });
    const serialized = JSON.stringify(sink.entries);
    expect(serialized).not.toContain(credential);
    expect(serialized).not.toContain('Private display name');
    expect(Object.isFrozen(sink.entries[0]?.event)).toBe(true);
  });

  it('normalizes untrusted labels and numeric measurements to bounded values', () => {
    const { sink, telemetry } = fixture('unsafe\nbuild-token');

    telemetry.roomCommand({
      commandType: 'FlipCoin\nsecret' as 'Unknown',
      outcome: 'failed',
      reason: 'raw internal exception with a credential',
      startRevision: -1,
      endRevision: Number.MAX_SAFE_INTEGER,
      requestBytes: Number.POSITIVE_INFINITY,
      publicationBytes: 2_000_000_000,
      deliveryCount: Number.NaN,
      phases: {
        authorityProcessingMs: 1.23456,
        projectionMs: -1,
        persistenceMs: Number.POSITIVE_INFINITY,
        publicationSerializationMs: 2.34567,
        socketSendMs: 3.45678,
      },
      durationMs: -10,
    });

    expect(sink.entries[0]).toMatchObject({
      level: 'error',
      event: {
        buildId: 'invalid-build',
        commandType: 'Unknown',
        reason: 'unknown',
        startRevision: 0,
        endRevision: 1_000_000_000,
        requestBytes: 0,
        publicationBytes: 1_000_000_000,
        deliveryCount: 0,
        phases: {
          authorityProcessingMs: 1.235,
          projectionMs: 0,
          persistenceMs: 0,
          publicationSerializationMs: 2.346,
          socketSendMs: 3.457,
        },
        durationMs: 0,
      },
    });
    expect(JSON.stringify(sink.entries)).not.toContain('credential');
  });

  it('derives bounded HTTP and rate-limit outcomes from operational values', () => {
    const { sink, telemetry } = fixture();

    telemetry.httpRequest({
      route: 'room_creation',
      status: 429,
      durationMs: 2.5,
    });
    telemetry.roomRateLimit({
      operation: 'admission_ticket',
      allowed: false,
      retryAfterSeconds: 61,
    });

    expect(sink.entries).toMatchObject([
      {
        level: 'warn',
        event: {
          kind: 'http_request',
          route: 'room_creation',
          outcome: 'rate_limited',
          status: 429,
          durationMs: 2.5,
        },
      },
      {
        level: 'warn',
        event: {
          kind: 'room_rate_limit',
          operation: 'admission_ticket',
          outcome: 'limited',
          retryAfterSeconds: 61,
        },
      },
    ]);
  });

  it('classifies a successful WebSocket upgrade as accepted', () => {
    const { sink, telemetry } = fixture();

    telemetry.httpRequest({
      route: 'socket_upgrade',
      status: 101,
      durationMs: 1.25,
    });

    expect(sink.entries).toMatchObject([
      {
        level: 'info',
        event: {
          kind: 'http_request',
          route: 'socket_upgrade',
          outcome: 'accepted',
          status: 101,
          durationMs: 1.25,
        },
      },
    ]);
  });

  it('isolates sink, clock, and identifier failures from application behavior', () => {
    const emit = vi.fn(() => {
      throw new Error('telemetry backend failed');
    });
    const telemetry = new StructuredServerTelemetry(
      'edge',
      'build',
      { emit },
      () => {
        throw new Error('clock failed');
      },
      () => {
        throw new Error('id source failed');
      }
    );

    expect(() =>
      telemetry.httpRequest({
        route: 'health',
        status: 200,
        durationMs: 1,
      })
    ).not.toThrow();
    expect(emit).not.toHaveBeenCalled();

    const sinkFailure = new StructuredServerTelemetry(
      'edge',
      'build',
      { emit },
      () => 1,
      () => 'opaque-identifier'
    );
    expect(() =>
      sinkFailure.failure({ subsystem: 'room_alarm', retryable: true })
    ).not.toThrow();
    expect(emit).toHaveBeenCalledOnce();
  });
});
