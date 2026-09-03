import { PROTOCOL_VERSION } from '@ptcgsim/protocol';
import { evictDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  nextServerFrames,
  roomStub,
  runtimeEvidence,
  runtimeStorageEvidence,
  utf8Bytes,
} from './runtime-harness.js';
import {
  createRepresentativeRuntime,
  executeRuntimeCommand,
  type RepresentativeRuntime,
  type RuntimeCommandMeasurement,
} from './representative-runtime.js';

const REPORT_MARKER = 'PTCGSIM_PERFORMANCE_REPORT=';
const FLIP_COIN_SAMPLES = 24;
const HIBERNATION_WAKE_SAMPLES = 9;

interface Distribution {
  readonly samples: number;
  readonly minimumMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maximumMs: number;
}

const rounded = (value: number): number => Math.round(value * 1_000) / 1_000;

const percentile = (sorted: readonly number[], fraction: number): number => {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index]!;
};

const distribution = (values: readonly number[]): Distribution => {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Performance distributions require finite samples');
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    minimumMs: rounded(sorted[0]!),
    p50Ms: rounded(percentile(sorted, 0.5)),
    p95Ms: rounded(percentile(sorted, 0.95)),
    p99Ms: rounded(percentile(sorted, 0.99)),
    maximumMs: rounded(sorted.at(-1)!),
  };
};

const payloadObservation = (measurement: RuntimeCommandMeasurement) => ({
  label: measurement.label,
  commandType: measurement.commandType,
  requestBytes: measurement.requestBytes,
  requestCodeUnits: measurement.requestCodeUnits,
  resultBytes: measurement.resultBytes,
  publicationBytesByRecipient: measurement.publicationBytesByRecipient,
  aggregatePublicationBytes: measurement.aggregatePublicationBytes,
  maximumFrameBytes: measurement.maximumFrameBytes,
  maximumFrameCodeUnits: measurement.maximumFrameCodeUnits,
  deliveredFrameCount: measurement.deliveredFrameCount,
  revision: measurement.revision,
});

let runtime: RepresentativeRuntime | undefined;

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  runtime?.dispose();
  runtime = undefined;
});

describe('local workerd performance observation', () => {
  it('records representative payload, command, hibernation, and storage evidence', async () => {
    const fixtureStartedAt = performance.now();
    runtime = await createRepresentativeRuntime();
    const fixtureDurationMs = performance.now() - fixtureStartedAt;
    const actor = runtime.sessions[0]!;
    const fixtureEvidence = await runtimeEvidence(runtime.created);
    const fixtureStorage = await runtimeStorageEvidence(runtime.created);
    if (!fixtureEvidence.snapshot) {
      throw new Error('Representative fixture snapshot was not persisted');
    }
    const fixtureViewerDefinitionCounts = Object.fromEntries(
      runtime.sessions.map((session) => [
        session.label,
        Object.keys(session.snapshot.definitions).length,
      ])
    );

    const flipMeasurements: RuntimeCommandMeasurement[] = [];
    for (let index = 0; index < FLIP_COIN_SAMPLES; index += 1) {
      flipMeasurements.push(
        await executeRuntimeCommand(
          actor,
          runtime.sessions,
          `flip_coin_${String(index + 1).padStart(2, '0')}`,
          { type: 'FlipCoin' }
        )
      );
    }

    const wakeDurations: number[] = [];
    for (let index = 0; index < HIBERNATION_WAKE_SAMPLES; index += 1) {
      await evictDurableObject(roomStub(runtime.created));
      const pongPromise = nextServerFrames(actor.socket, 1);
      const frame = JSON.stringify({
        type: 'Ping',
        protocolVersion: PROTOCOL_VERSION,
        id: index + 1,
      });
      const startedAt = performance.now();
      actor.socket.send(frame);
      const pong = (await pongPromise)[0];
      wakeDurations.push(performance.now() - startedAt);
      if (!pong || pong.message.type !== 'Pong') {
        throw new Error('Hibernation wake did not return Pong');
      }
    }

    const finalEvidence = await runtimeEvidence(runtime.created);
    const finalStorage = await runtimeStorageEvidence(runtime.created);
    if (!finalEvidence.snapshot) {
      throw new Error('Measured runtime snapshot was not persisted');
    }
    const fixturePayloads = runtime.fixtureCommands.map(payloadObservation);
    const flipPayloads = flipMeasurements.map(payloadObservation);
    const allPayloads = [...fixturePayloads, ...flipPayloads];
    const attachmentBytes = fixtureEvidence.attachments.map((attachment) =>
      utf8Bytes(JSON.stringify(attachment))
    );
    const report = {
      schema: 'ptcgsim-runtime-performance-v1',
      scope: 'local-workerd-observation',
      environment: {
        buildId: 'local-development',
        compatibilityDate: '2026-08-31',
        runtime: '@cloudflare/vitest-plugin workerd pool',
      },
      fixture: {
        description:
          'two 60-card decks, two player sessions, one spectator, both players set up, and two 47-card public inspection work areas',
        canonicalCards: Object.keys(fixtureEvidence.snapshot.state.cards)
          .length,
        canonicalDefinitions: Object.keys(
          fixtureEvidence.snapshot.state.definitions
        ).length,
        authoritySessions: Object.keys(fixtureEvidence.snapshot.sessions)
          .length,
        activeSockets: fixtureEvidence.socketCount,
        fixtureDurationMs: rounded(fixtureDurationMs),
        finalRevision: fixtureEvidence.snapshot.state.revision,
        viewerDefinitionCounts: fixtureViewerDefinitionCounts,
      },
      payload: {
        fixtureCommands: fixturePayloads,
        flipCoin: {
          maximumRequestBytes: Math.max(
            ...flipPayloads.map((sample) => sample.requestBytes)
          ),
          maximumPublicationBytes: Math.max(
            ...flipPayloads.map((sample) => sample.maximumFrameBytes)
          ),
          maximumAggregatePublicationBytes: Math.max(
            ...flipPayloads.map((sample) => sample.aggregatePublicationBytes)
          ),
        },
        maximumFrameBytes: Math.max(
          ...allPayloads.map((sample) => sample.maximumFrameBytes)
        ),
        maximumAggregatePublicationBytes: Math.max(
          ...allPayloads.map((sample) => sample.aggregatePublicationBytes)
        ),
      },
      latency: {
        percentileMethod: 'nearest-rank',
        fixtureCommandToAllPublications: runtime.fixtureCommands.map(
          (sample) => ({
            label: sample.label,
            commandType: sample.commandType,
            durationMs: rounded(sample.durationMs),
          })
        ),
        flipCoinCommandToAllPublications: distribution(
          flipMeasurements.map((sample) => sample.durationMs)
        ),
        hibernationWakePingToPong: distribution(wakeDurations),
      },
      durableResources: {
        afterFixture: {
          storageEntryCount: fixtureStorage.entryCount,
          serializedStorageBytes: fixtureStorage.serializedBytes,
          storageByCategory: fixtureStorage.categories,
        },
        afterSamples: {
          storageEntryCount: finalStorage.entryCount,
          serializedStorageBytes: finalStorage.serializedBytes,
          storageByCategory: finalStorage.categories,
          finalRevision: finalEvidence.snapshot.state.revision,
        },
        alarmScheduled: finalStorage.alarm !== null,
        socketAttachmentBytes: attachmentBytes,
        maximumSocketAttachmentBytes: Math.max(...attachmentBytes),
      },
    } as const;

    expect(report.fixture.canonicalCards).toBe(120);
    expect(report.fixture.canonicalDefinitions).toBe(120);
    expect(report.fixture.authoritySessions).toBe(3);
    expect(report.fixture.activeSockets).toBe(3);
    expect(report.latency.flipCoinCommandToAllPublications.samples).toBe(
      FLIP_COIN_SAMPLES
    );
    expect(report.latency.hibernationWakePingToPong.samples).toBe(
      HIBERNATION_WAKE_SAMPLES
    );
    console.log(`${REPORT_MARKER}${JSON.stringify(report)}`);
  }, 120_000);
});
