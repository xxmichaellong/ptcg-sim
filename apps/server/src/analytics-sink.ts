import {
  ANALYTICS_MOVE_SAMPLE,
  analyticsDataPoint,
  type AnalyticsDataPoint,
  type AnalyticsOrigin,
} from '@ptcgsim/protocol';

import type {
  ServerTelemetryEvent,
  ServerTelemetryLevel,
  ServerTelemetrySink,
} from './server-telemetry.js';

/**
 * The server's events, kept for the internal dashboard (ADR-054). Each
 * event the server logs also becomes a row in Workers Analytics Engine,
 * laid out by ANALYTICS_LAYOUT, except the room's bookkeeping (alarms
 * moved or cancelled) and requests let through a rate limit, which say
 * nothing a reader needs. Accepted moves are the bulk of a game's events,
 * so one in ANALYTICS_MOVE_SAMPLE is written, weighted to stand for the
 * others; a move turned away or failed is always written.
 *
 * Writing never waits and never throws: a dataset missing (tests, local
 * development) or refusing a row changes nothing the server does.
 */

/** The Workers Analytics Engine binding, as much of it as is used. */
export interface AnalyticsDataset {
  readonly writeDataPoint: (point: AnalyticsDataPoint) => void;
}

/** Where a visitor's request came from, as the edge saw it. */
export interface AnalyticsRequestOrigin {
  readonly country?: string;
  readonly colo?: string;
}

const COUNTRY = /^[A-Z]{2}$/u;
const COLO = /^[A-Z]{3}$/u;

/** The country and data center a request carries (`request.cf`), checked. */
export const requestOrigin = (request: Request): AnalyticsRequestOrigin => {
  const cf = (request as { cf?: Record<string, unknown> }).cf;
  const country = cf?.country;
  const colo = cf?.colo;
  return {
    ...(typeof country === 'string' && COUNTRY.test(country)
      ? { country }
      : {}),
    ...(typeof colo === 'string' && COLO.test(colo) ? { colo } : {}),
  };
};

/** The row an event becomes, or none. */
export const analyticsPointForEvent = (
  event: ServerTelemetryEvent,
  requestFrom: AnalyticsRequestOrigin = {},
  random: () => number = Math.random
): AnalyticsDataPoint | undefined => {
  const origin: AnalyticsOrigin = { build: event.buildId, ...requestFrom };
  switch (event.kind) {
    case 'http_request':
      // A page's report is its own row (page-report-http.ts).
      if (event.route === 'page_report') return undefined;
      return analyticsDataPoint('http', origin, {
        blobs: { route: event.route, outcome: event.outcome },
        doubles: { durationMs: event.durationMs, status: event.status },
      });
    case 'room_lifecycle':
      if (
        event.outcome === 'alarm_rescheduled' ||
        event.outcome === 'alarm_cancelled'
      )
        return undefined;
      return analyticsDataPoint('room', origin, {
        blobs: { outcome: event.outcome, ...(event.mode ? { mode: event.mode } : {}) },
        doubles: {
          durationMs: event.durationMs,
          authorityVersion: event.authorityVersion,
          activeSessions: event.activeSessions,
          activeSockets: event.activeSockets,
        },
      });
    case 'room_admission':
      return analyticsDataPoint('admission', origin, {
        blobs: {
          operation: event.operation,
          outcome: event.outcome,
          reason: event.reason,
          role: event.requestedRole,
        },
        doubles: {
          durationMs: event.durationMs,
          authorityVersion: event.authorityVersion,
        },
      });
    case 'room_command': {
      const sampled = event.outcome === 'accepted';
      if (sampled && random() * ANALYTICS_MOVE_SAMPLE >= 1) return undefined;
      return analyticsDataPoint(
        'move',
        origin,
        {
          blobs: {
            commandType: event.commandType,
            outcome: event.outcome,
            reason: event.reason,
          },
          doubles: {
            durationMs: event.durationMs,
            authorityMs: event.phases.authorityProcessingMs,
            projectionMs: event.phases.projectionMs,
            persistenceMs: event.phases.persistenceMs,
            serializationMs: event.phases.publicationSerializationMs,
            sendMs: event.phases.socketSendMs,
            requestBytes: event.requestBytes,
            publicationBytes: event.publicationBytes,
            deliveries: event.deliveryCount,
          },
        },
        sampled ? ANALYTICS_MOVE_SAMPLE : 1
      );
    }
    case 'room_socket':
      return analyticsDataPoint('socket', origin, {
        blobs: { outcome: event.outcome },
        doubles: {
          closeCode: event.closeCode,
          activeSockets: event.activeSockets,
        },
      });
    case 'room_rate_limit':
      if (event.outcome !== 'limited') return undefined;
      return analyticsDataPoint('limited', origin, {
        blobs: { operation: event.operation },
        doubles: { retryAfterSeconds: event.retryAfterSeconds },
      });
    case 'continuation_lifecycle':
      return analyticsDataPoint('save', origin, {
        blobs: { operation: event.operation, outcome: event.outcome },
        doubles: { durationMs: event.durationMs },
      });
    case 'server_failure':
      return analyticsDataPoint('failure', origin, {
        blobs: { subsystem: event.subsystem, source: event.source },
        doubles: { retryable: event.retryable ? 1 : 0 },
      });
  }
};

/** Logs each event, as before, and keeps its row. */
export class AnalyticsTelemetrySink implements ServerTelemetrySink {
  constructor(
    private readonly inner: ServerTelemetrySink,
    private readonly dataset: AnalyticsDataset | undefined,
    private readonly requestFrom: AnalyticsRequestOrigin = {},
    private readonly random: () => number = Math.random
  ) {}

  emit(level: ServerTelemetryLevel, event: ServerTelemetryEvent): void {
    this.inner.emit(level, event);
    if (!this.dataset) return;
    try {
      const point = analyticsPointForEvent(event, this.requestFrom, this.random);
      if (point) this.dataset.writeDataPoint(point);
    } catch {
      // The analytics never change what the server does.
    }
  }
}
