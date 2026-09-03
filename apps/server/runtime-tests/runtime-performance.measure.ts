import { PROTOCOL_VERSION } from '@ptcgsim/protocol';
import { evictDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_AUTHORITY_JOURNAL_ENTRIES } from '../src/journal-retention.js';
import type { AcceptedCommandPerformanceObservation } from '../src/session-hub.js';
import {
  nextServerFrames,
  roomStub,
  runtimeCommandPerformanceEvidence,
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
const JOURNAL_PLATEAU_ADVANCE_COMMANDS = 32;

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

const phaseSamplesFor = (
  measurements: readonly RuntimeCommandMeasurement[],
  observations: readonly AcceptedCommandPerformanceObservation[]
): readonly AcceptedCommandPerformanceObservation[] => {
  const byRevision = new Map(
    observations.map((observation) => [observation.endRevision, observation])
  );
  return measurements.map((measurement) => {
    const observation = byRevision.get(measurement.revision);
    if (!observation) {
      throw new Error(
        `Missing room-command phase telemetry for revision ${measurement.revision}`
      );
    }
    return observation;
  });
};

const phaseDistributions = (
  samples: readonly AcceptedCommandPerformanceObservation[]
) => ({
  total: distribution(samples.map((sample) => sample.totalMs)),
  authorityProcessing: distribution(
    samples.map((sample) => sample.phases.authorityProcessingMs)
  ),
  projection: distribution(samples.map((sample) => sample.phases.projectionMs)),
  persistence: distribution(
    samples.map((sample) => sample.phases.persistenceMs)
  ),
  publicationSerialization: distribution(
    samples.map((sample) => sample.phases.publicationSerializationMs)
  ),
  socketSend: distribution(samples.map((sample) => sample.phases.socketSendMs)),
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

    const afterLatencySamplesStorage = await runtimeStorageEvidence(
      runtime.created
    );
    const actorOutcomesAfterSamples = actor.nextClientSequence - 1;
    const commandsToFillOutcomeWindow =
      MAX_AUTHORITY_JOURNAL_ENTRIES - actorOutcomesAfterSamples;
    const journalFillMeasurements: RuntimeCommandMeasurement[] = [];
    for (let index = 0; index < commandsToFillOutcomeWindow; index += 1) {
      journalFillMeasurements.push(
        await executeRuntimeCommand(
          actor,
          runtime.sessions,
          `journal_fill_${String(index + 1).padStart(3, '0')}`,
          { type: 'FlipCoin' }
        )
      );
    }
    const atRetentionBoundaryStorage = await runtimeStorageEvidence(
      runtime.created
    );
    const retentionBoundaryRevision = actor.snapshot.revision;
    const plateauMeasurements: RuntimeCommandMeasurement[] = [];
    for (let index = 0; index < JOURNAL_PLATEAU_ADVANCE_COMMANDS; index += 1) {
      plateauMeasurements.push(
        await executeRuntimeCommand(
          actor,
          runtime.sessions,
          `journal_plateau_${String(index + 1).padStart(3, '0')}`,
          { type: 'FlipCoin' }
        )
      );
    }
    const afterPlateauAdvanceStorage = await runtimeStorageEvidence(
      runtime.created
    );
    const plateauPhaseEvidence = await runtimeCommandPerformanceEvidence(
      runtime.created
    );
    const plateauAdvanceRevision = actor.snapshot.revision;

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

    await evictDurableObject(roomStub(runtime.created));
    const postHibernationCommand = await executeRuntimeCommand(
      actor,
      runtime.sessions,
      'post_hibernation_plateau',
      { type: 'FlipCoin' }
    );
    const postHibernationPhaseEvidence =
      await runtimeCommandPerformanceEvidence(runtime.created);

    const finalEvidence = await runtimeEvidence(runtime.created);
    const finalStorage = await runtimeStorageEvidence(runtime.created);
    if (!finalEvidence.snapshot) {
      throw new Error('Measured runtime snapshot was not persisted');
    }
    const fixturePayloads = runtime.fixtureCommands.map(payloadObservation);
    const flipPayloads = flipMeasurements.map(payloadObservation);
    const postHibernationPayload = payloadObservation(postHibernationCommand);
    const plateauPhaseSamples = phaseSamplesFor(
      plateauMeasurements,
      plateauPhaseEvidence
    );
    const [postHibernationPhases] = phaseSamplesFor(
      [postHibernationCommand],
      postHibernationPhaseEvidence
    );
    if (!postHibernationPhases) {
      throw new Error('Missing post-hibernation command phase telemetry');
    }
    const allPayloads = [
      ...fixturePayloads,
      ...flipPayloads,
      postHibernationPayload,
    ];
    const attachmentBytes = fixtureEvidence.attachments.map((attachment) =>
      utf8Bytes(JSON.stringify(attachment))
    );
    const report = {
      schema: 'ptcgsim-runtime-performance-v2',
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
        postHibernationCommand: postHibernationPayload,
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
        journalFillTailCommandToAllPublications: distribution(
          journalFillMeasurements
            .slice(-FLIP_COIN_SAMPLES)
            .map((sample) => sample.durationMs)
        ),
        journalPlateauCommandToAllPublications: distribution(
          plateauMeasurements.map((sample) => sample.durationMs)
        ),
        journalPlateauServerPhases: phaseDistributions(plateauPhaseSamples),
        postHibernationCommandToAllPublicationsMs: rounded(
          postHibernationCommand.durationMs
        ),
        postHibernationServerPhases: postHibernationPhases,
        hibernationWakePingToPong: distribution(wakeDurations),
      },
      durableResources: {
        afterFixture: {
          storageEntryCount: fixtureStorage.entryCount,
          serializedStorageBytes: fixtureStorage.serializedBytes,
          storageByCategory: fixtureStorage.categories,
        },
        afterLatencySamples: {
          storageEntryCount: afterLatencySamplesStorage.entryCount,
          serializedStorageBytes: afterLatencySamplesStorage.serializedBytes,
          storageByCategory: afterLatencySamplesStorage.categories,
        },
        atRetentionBoundary: {
          storageEntryCount: atRetentionBoundaryStorage.entryCount,
          serializedStorageBytes: atRetentionBoundaryStorage.serializedBytes,
          storageByCategory: atRetentionBoundaryStorage.categories,
          finalRevision: retentionBoundaryRevision,
        },
        afterPlateauAdvance: {
          additionalCommands: JOURNAL_PLATEAU_ADVANCE_COMMANDS,
          storageEntryCount: afterPlateauAdvanceStorage.entryCount,
          serializedStorageBytes: afterPlateauAdvanceStorage.serializedBytes,
          storageByCategory: afterPlateauAdvanceStorage.categories,
          finalRevision: plateauAdvanceRevision,
        },
        afterPostHibernationCommit: {
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
    expect(report.latency.journalPlateauServerPhases.total.samples).toBe(
      JOURNAL_PLATEAU_ADVANCE_COMMANDS
    );
    for (const sample of plateauPhaseSamples) {
      expect(
        sample.phases.authorityProcessingMs +
          sample.phases.projectionMs +
          sample.phases.persistenceMs +
          sample.phases.publicationSerializationMs +
          sample.phases.socketSendMs
      ).toBeLessThanOrEqual(sample.totalMs + 0.01);
    }
    expect(
      report.durableResources.atRetentionBoundary.storageByCategory[
        'authority:journal:*'
      ]?.count
    ).toBe(MAX_AUTHORITY_JOURNAL_ENTRIES);
    expect(
      report.durableResources.afterPlateauAdvance.storageByCategory[
        'authority:journal:*'
      ]?.count
    ).toBe(MAX_AUTHORITY_JOURNAL_ENTRIES);
    expect(
      report.durableResources.afterPostHibernationCommit.storageByCategory[
        'authority:journal:*'
      ]?.count
    ).toBe(MAX_AUTHORITY_JOURNAL_ENTRIES);
    expect(report.durableResources.afterPlateauAdvance.storageEntryCount).toBe(
      report.durableResources.atRetentionBoundary.storageEntryCount
    );
    expect(
      report.durableResources.afterPostHibernationCommit.storageEntryCount
    ).toBe(report.durableResources.atRetentionBoundary.storageEntryCount);
    expect(
      Math.abs(
        report.durableResources.afterPlateauAdvance.serializedStorageBytes -
          report.durableResources.atRetentionBoundary.serializedStorageBytes
      )
    ).toBeLessThanOrEqual(32 * 1024);
    console.log(`${REPORT_MARKER}${JSON.stringify(report)}`);
  }, 120_000);
});
