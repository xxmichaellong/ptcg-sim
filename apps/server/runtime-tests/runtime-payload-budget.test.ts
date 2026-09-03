import {
  MAX_CLIENT_FRAME_CODE_UNITS,
  MAX_SERVER_FRAME_CODE_UNITS,
} from '@ptcgsim/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  runtimeEvidence,
  runtimeStorageEvidence,
  utf8Bytes,
} from './runtime-harness.js';
import {
  createRepresentativeRuntime,
  type RepresentativeRuntime,
} from './representative-runtime.js';

const PAYLOAD_BUDGETS = {
  aggregatePublicationBytes: 768 * 1024,
  durableStorageBytes: 2 * 1024 * 1024,
  maximumPublicationBytes: 256 * 1024,
  socketAttachmentBytes: 1_024,
  storageEntries: 32,
} as const;

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

describe('representative runtime payload budgets', () => {
  it('keeps 120-card state, fanout, attachments, and durable data bounded', async () => {
    runtime = await createRepresentativeRuntime();
    const evidence = await runtimeEvidence(runtime.created);
    const storage = await runtimeStorageEvidence(runtime.created);
    if (!evidence.snapshot)
      throw new Error('Runtime snapshot was not persisted');

    const inspectionCardCount = Object.values(
      evidence.snapshot.state.workAreas
    ).reduce(
      (total, areas) => total + (areas.inspection?.cardIds.length ?? 0),
      0
    );
    expect(Object.keys(evidence.snapshot.state.cards)).toHaveLength(120);
    expect(Object.keys(evidence.snapshot.state.definitions)).toHaveLength(120);
    expect(Object.keys(evidence.snapshot.sessions)).toHaveLength(3);
    expect(inspectionCardCount).toBe(94);
    expect(evidence.socketCount).toBe(3);

    const revision = evidence.snapshot.state.revision;
    expect(
      runtime.sessions.map((session) => session.snapshot.revision)
    ).toEqual([revision, revision, revision]);
    expect(runtime.fixtureCommands).toHaveLength(6);

    for (const measurement of runtime.fixtureCommands) {
      expect(measurement.deliveredFrameCount).toBe(4);
      expect(measurement.requestCodeUnits).toBeLessThanOrEqual(
        MAX_CLIENT_FRAME_CODE_UNITS
      );
      expect(measurement.maximumFrameCodeUnits).toBeLessThanOrEqual(
        MAX_SERVER_FRAME_CODE_UNITS
      );
      expect(measurement.maximumFrameBytes).toBeLessThanOrEqual(
        PAYLOAD_BUDGETS.maximumPublicationBytes
      );
      expect(measurement.aggregatePublicationBytes).toBeLessThanOrEqual(
        PAYLOAD_BUDGETS.aggregatePublicationBytes
      );
    }

    expect(storage.entryCount).toBeLessThanOrEqual(
      PAYLOAD_BUDGETS.storageEntries
    );
    expect(storage.serializedBytes).toBeLessThanOrEqual(
      PAYLOAD_BUDGETS.durableStorageBytes
    );
    expect(Object.keys(storage.categories).sort()).toEqual([
      'authority:admission:*',
      'authority:journal:*',
      'authority:snapshot',
      'room:lifecycle',
      'room:rate-limits',
    ]);
    expect(evidence.attachments).toHaveLength(3);
    for (const attachment of evidence.attachments) {
      expect(utf8Bytes(JSON.stringify(attachment))).toBeLessThanOrEqual(
        PAYLOAD_BUDGETS.socketAttachmentBytes
      );
    }
  });
});
