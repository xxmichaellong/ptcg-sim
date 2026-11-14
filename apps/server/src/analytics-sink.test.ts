import {
  ANALYTICS_MOVE_SAMPLE,
  type AnalyticsDataPoint,
} from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  AnalyticsTelemetrySink,
  analyticsPointForEvent,
  requestOrigin,
} from './analytics-sink.js';
import {
  StructuredServerTelemetry,
  type ServerTelemetryEvent,
  type ServerTelemetrySink,
} from './server-telemetry.js';

/** The events a telemetry port publishes, captured. */
const capture = () => {
  const events: ServerTelemetryEvent[] = [];
  const sink: ServerTelemetrySink = {
    emit: (_level, event) => events.push(event),
  };
  let id = 0;
  const telemetry = new StructuredServerTelemetry(
    'room',
    'beta-abc',
    sink,
    () => 1_700_000_000_000,
    () => `event-id-${String((id += 1)).padStart(4, '0')}`
  );
  return { events, telemetry };
};

const only = <T>(values: readonly T[]): T => {
  expect(values).toHaveLength(1);
  return values[0] as T;
};

describe('analyticsPointForEvent', () => {
  it('keeps a request with its route, outcome, time and status', () => {
    const { events, telemetry } = capture();
    telemetry.httpRequest({ route: 'room_creation', status: 201, durationMs: 12.5 });
    const point = analyticsPointForEvent(only(events), {
      country: 'JP',
      colo: 'NRT',
    });
    expect(point).toEqual<AnalyticsDataPoint>({
      indexes: ['http'],
      blobs: ['http', 'beta-abc', 'JP', 'NRT', 'room_creation', 'accepted'],
      doubles: [1, 12.5, 201],
    });
  });

  it('keeps a room made or deleted with its mode, but not its alarms', () => {
    const { events, telemetry } = capture();
    telemetry.roomLifecycle({
      outcome: 'expired',
      mode: 'solo',
      authorityVersion: 412,
      activeSessions: 0,
      activeSockets: 0,
      durationMs: 3,
    });
    telemetry.roomLifecycle({
      outcome: 'alarm_rescheduled',
      authorityVersion: 1,
      activeSessions: 1,
      activeSockets: 1,
      durationMs: 1,
    });
    const [expired, alarm] = events;
    expect(analyticsPointForEvent(expired!)).toEqual({
      indexes: ['room'],
      blobs: ['room', 'beta-abc', '', '', 'expired', 'solo'],
      doubles: [1, 3, 412, 0, 0],
    });
    expect(analyticsPointForEvent(alarm!)).toBeUndefined();
  });

  it('writes one accepted move in the sample, weighted, and every refusal', () => {
    const { events, telemetry } = capture();
    const move = (outcome: 'accepted' | 'rejected') =>
      telemetry.roomCommand({
        commandType: 'FlipCoin',
        outcome,
        ...(outcome === 'rejected' ? { reason: 'stale_reference' } : {}),
        startRevision: 4,
        endRevision: 5,
        requestBytes: 300,
        publicationBytes: 2_000,
        deliveryCount: 2,
        phases: {
          authorityProcessingMs: 1,
          projectionMs: 2,
          persistenceMs: 3,
          publicationSerializationMs: 0.5,
          socketSendMs: 0.25,
        },
        durationMs: 7,
      });
    move('accepted');
    move('rejected');
    const [accepted, rejected] = events;
    expect(analyticsPointForEvent(accepted!, {}, () => 0.9)).toBeUndefined();
    expect(analyticsPointForEvent(accepted!, {}, () => 0.1)).toEqual({
      indexes: ['move'],
      blobs: ['move', 'beta-abc', '', '', 'FlipCoin', 'accepted', 'none'],
      doubles: [ANALYTICS_MOVE_SAMPLE, 7, 1, 2, 3, 0.5, 0.25, 300, 2_000, 2],
    });
    expect(analyticsPointForEvent(rejected!, {}, () => 0.9)?.blobs).toEqual([
      'move',
      'beta-abc',
      '',
      '',
      'FlipCoin',
      'rejected',
      'stale_reference',
    ]);
    expect(analyticsPointForEvent(rejected!, {}, () => 0.9)?.doubles[0]).toBe(1);
  });

  it('keeps sockets, admissions, saves and failures, and only limits that bit', () => {
    const { events, telemetry } = capture();
    telemetry.roomSocket({ outcome: 'closed', closeCode: 1006, activeSockets: 1 });
    telemetry.roomAdmission({
      operation: 'code_join',
      requestedRole: 'spectator',
      outcome: 'accepted',
      authorityVersion: 20,
      durationMs: 4,
    });
    telemetry.continuationLifecycle({ operation: 'create', outcome: 'accepted', durationMs: 9 });
    telemetry.failure({ subsystem: 'socket_send', retryable: true });
    telemetry.roomRateLimit({ operation: 'admission_ticket', allowed: true });
    telemetry.roomRateLimit({
      operation: 'admission_ticket',
      allowed: false,
      retryAfterSeconds: 60,
    });
    const points = events.map((event) => analyticsPointForEvent(event));
    expect(points.map((point) => point?.indexes[0])).toEqual([
      'socket',
      'admission',
      'save',
      'failure',
      undefined,
      'limited',
    ]);
    expect(points[0]?.doubles).toEqual([1, 1006, 1]);
    expect(points[1]?.blobs.slice(4)).toEqual([
      'code_join',
      'accepted',
      'none',
      'spectator',
    ]);
    expect(points[3]?.blobs.slice(4)).toEqual(['socket_send', 'room']);
    expect(points[3]?.doubles).toEqual([1, 1]);
    expect(points[5]?.doubles).toEqual([1, 60]);
  });

  it("leaves a page's report request to the report's own row", () => {
    const { events, telemetry } = capture();
    telemetry.httpRequest({ route: 'page_report', status: 204, durationMs: 1 });
    expect(analyticsPointForEvent(only(events))).toBeUndefined();
  });
});

describe('AnalyticsTelemetrySink', () => {
  it('logs every event and writes its row, and never throws for the dataset', () => {
    const logged = vi.fn();
    const writeDataPoint = vi.fn(() => {
      throw new Error('refused');
    });
    let id = 0;
    const telemetry = new StructuredServerTelemetry(
      'edge',
      'b',
      new AnalyticsTelemetrySink({ emit: logged }, { writeDataPoint }, { country: 'DE' }),
      () => 1,
      () => `event-id-${String((id += 1)).padStart(4, '0')}`
    );
    expect(() =>
      telemetry.httpRequest({ route: 'health', status: 200, durationMs: 1 })
    ).not.toThrow();
    expect(logged).toHaveBeenCalledOnce();
    expect(writeDataPoint).toHaveBeenCalledOnce();
  });

  it('only logs without a dataset', () => {
    const logged = vi.fn();
    new AnalyticsTelemetrySink({ emit: logged }, undefined).emit('info', {
      kind: 'server_failure',
    } as ServerTelemetryEvent);
    expect(logged).toHaveBeenCalledOnce();
  });
});

describe('requestOrigin', () => {
  it('takes a well-formed country and data center, and nothing else', () => {
    const withCf = (cf: unknown) =>
      Object.assign(new Request('https://x.example/'), { cf }) as Request;
    expect(requestOrigin(withCf({ country: 'GB', colo: 'LHR' }))).toEqual({
      country: 'GB',
      colo: 'LHR',
    });
    expect(requestOrigin(withCf({ country: 'T1', colo: 'nope' }))).toEqual({});
    expect(requestOrigin(new Request('https://x.example/'))).toEqual({});
  });
});
