import { stableSerialize } from '@ptcgsim/game-core';
import {
  PROTOCOL_VERSION,
  hydrateMatchViewState,
  type SerializedMatchViewState,
} from '@ptcgsim/protocol';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import type { ProjectedReplayArtifact } from './model.js';
import {
  InvalidProjectedReplayFileError,
  MAX_PROJECTED_REPLAY_FILE_BYTES,
  MAX_PROJECTED_REPLAY_FILE_CODE_UNITS,
  PROJECTED_REPLAY_FILE_FORMAT,
  PROJECTED_REPLAY_FILE_VERSION,
  parseProjectedReplayFile,
  parseProjectedReplayFileBytes,
  serializeProjectedReplayFile,
} from './projected-replay-file.js';
import { ReplayPlaybackController } from './replay-playback.js';

const view = (revision: number): SerializedMatchViewState => ({
  matchId: 'perspective-file-match',
  revision,
  lifecycle: 'playing',
  viewer: { kind: 'player', playerId: 'blue' },
  playerOrder: ['blue', 'red'],
  players: {
    blue: {
      id: 'blue',
      displayName: 'Blue',
      cardBackUrl: '/v2/assets/cardback.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
    red: {
      id: 'red',
      displayName: 'Red',
      cardBackUrl: '/v2/assets/cardback.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
  },
  definitions: {},
  zones: {},
  boards: {
    blue: { activeStackId: null, benchStackIds: [] },
    red: { activeStackId: null, benchStackIds: [] },
  },
  stacks: {},
  workAreas: {
    blue: { inspection: null, attachmentResolution: null },
    red: { inspection: null, attachmentResolution: null },
  },
  privateInspections: [],
  turn: { number: revision, currentPlayerId: 'blue' },
});

const artifact = (): ProjectedReplayArtifact => ({
  replayId: 'perspective-replay-file-1',
  viewer: hydrateMatchViewState(view(0)).viewer,
  startRevision: 0,
  endRevision: 1,
  truncated: false,
  frames: [
    {
      snapshot: hydrateMatchViewState(view(0)),
      presentationEvents: [],
    },
    {
      snapshot: hydrateMatchViewState(view(1)),
      presentationEvents: [
        {
          type: 'CoinFlipped',
          revision: 1,
          playerId: 'blue',
          result: 'heads',
        },
      ],
    },
  ],
});

const errorProblem = async (operation: Promise<unknown>) => {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidProjectedReplayFileError);
    return (error as InvalidProjectedReplayFileError).problem;
  }
  throw new Error('Expected projected replay file rejection');
};

const sha256Hex = async (contents: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(contents)
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

const resign = async (
  raw: Record<string, unknown> & { integrity: { digest: string } }
): Promise<void> => {
  const payload: Record<string, unknown> = { ...raw };
  delete payload.integrity;
  raw.integrity.digest = await sha256Hex(stableSerialize(payload));
};

describe('projected replay files', () => {
  it('keeps the checked-in file-v1 spectator artifact compatible and inert', async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL(
          '../test-fixtures/perspective-replay-v1-spectator.json',
          import.meta.url
        )
      )
    );
    const parsed = await parseProjectedReplayFileBytes(bytes);
    expect(parsed).toMatchObject({
      replayId: 'file-v1-golden-spectator',
      viewer: { kind: 'spectator' },
      startRevision: 0,
      endRevision: 0,
      frames: [{ snapshot: { matchId: 'fixture-match', revision: 0 } }],
    });
    const playback = new ReplayPlaybackController(parsed);
    expect(playback.getSnapshot()).toMatchObject({
      phase: 'ready',
      replayId: 'file-v1-golden-spectator',
      atStart: true,
      atEnd: true,
    });
    expect(playback.stepNext()).toBe(false);
    const serialized = new TextDecoder().decode(bytes);
    await expect(
      serializeProjectedReplayFile(parsed).then((contents) =>
        JSON.parse(contents)
      )
    ).resolves.toEqual(JSON.parse(serialized));
    for (const forbidden of [
      'resumeToken',
      'admissionTicket',
      'saveCapability',
      'canonicalState":true',
      'canonicalCardId',
      'canonicalDefinitionId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('round-trips deterministic viewer-only bytes with explicit privacy markers', async () => {
    const first = await serializeProjectedReplayFile(artifact());
    const second = await serializeProjectedReplayFile(artifact());
    expect(second).toBe(first);
    expect(first.endsWith('\n')).toBe(true);

    const raw = JSON.parse(first) as Record<string, unknown>;
    expect(raw).toMatchObject({
      format: PROJECTED_REPLAY_FILE_FORMAT,
      formatVersion: PROJECTED_REPLAY_FILE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      privacy: {
        kind: 'viewer-projection',
        viewer: { kind: 'player', playerId: 'blue' },
        canonicalState: false,
        resumable: false,
      },
      integrity: {
        algorithm: 'SHA-256',
        digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(first).not.toContain('resumeToken');
    expect(first).not.toContain('admissionTicket');
    expect(first).not.toContain('saveCapability');
    expect(first).not.toContain('canonicalState":true');

    const parsed = await parseProjectedReplayFile(first);
    expect(stableSerialize(parsed)).toBe(stableSerialize(artifact()));
    const parsedBytes = await parseProjectedReplayFileBytes(
      new TextEncoder().encode(first)
    );
    expect(stableSerialize(parsedBytes)).toBe(stableSerialize(artifact()));

    const runtimeExtended = artifact();
    Object.assign(runtimeExtended.frames[0]!.snapshot, {
      canonicalSecret: 'must-not-hitchhike',
      resumeToken: 'must-not-hitchhike-either',
    });
    const sanitized = await serializeProjectedReplayFile(runtimeExtended);
    expect(sanitized).not.toContain('must-not-hitchhike');
    expect(sanitized).not.toContain('resumeToken');
  });

  it('owns caller bytes before asynchronous validation and accepts exact UTF-8 Unicode', async () => {
    const original = artifact();
    const candidate: ProjectedReplayArtifact = {
      ...original,
      frames: original.frames.map((frame) => ({
        ...frame,
        snapshot: {
          ...frame.snapshot,
          players: {
            ...frame.snapshot.players,
            blue: {
              ...frame.snapshot.players.blue!,
              displayName: '青 💙',
            },
          },
        },
      })),
    };
    const encoded = await serializeProjectedReplayFile(candidate);
    const bytes = new TextEncoder().encode(encoded);
    const pending = parseProjectedReplayFileBytes(bytes);
    bytes.fill(0);

    const parsed = await pending;
    expect(parsed.replayId).toBe('perspective-replay-file-1');
    expect(parsed.frames[0]!.snapshot.players.blue?.displayName).toBe('青 💙');
    expect(parsed.frames[1]!.snapshot.players.blue?.displayName).toBe('青 💙');
  });

  it('rejects malformed UTF-8 and encoded overflow before integrity work', async () => {
    await expect(
      errorProblem(
        parseProjectedReplayFileBytes(
          new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d])
        )
      )
    ).resolves.toBe('invalid_utf8');

    const oversized = new Uint8Array(MAX_PROJECTED_REPLAY_FILE_BYTES + 1);
    await expect(
      errorProblem(parseProjectedReplayFileBytes(oversized))
    ).resolves.toBe('file_too_large');
    expect(MAX_PROJECTED_REPLAY_FILE_BYTES).toBe(
      MAX_PROJECTED_REPLAY_FILE_CODE_UNITS * 3
    );
    const threeByteCodeUnits = '\u0800'.repeat(1_024);
    expect(new TextEncoder().encode(threeByteCodeUnits).byteLength).toBe(
      threeByteCodeUnits.length * 3
    );
  });

  it('round-trips a spectator projection through the byte boundary', async () => {
    const candidate = artifact();
    const spectator: ProjectedReplayArtifact = {
      ...candidate,
      viewer: { kind: 'spectator' },
      frames: candidate.frames.map((frame) => ({
        ...frame,
        snapshot: {
          ...frame.snapshot,
          viewer: { kind: 'spectator' },
        },
      })),
    };
    const encoded = await serializeProjectedReplayFile(spectator);
    await expect(
      parseProjectedReplayFileBytes(new TextEncoder().encode(encoded))
    ).resolves.toEqual(spectator);
  });

  it('rejects corruption before installing the artifact', async () => {
    const encoded = await serializeProjectedReplayFile(artifact());
    const raw = JSON.parse(encoded) as {
      replay: { endRevision: number };
    };
    raw.replay.endRevision = 2;

    await expect(
      errorProblem(parseProjectedReplayFile(JSON.stringify(raw)))
    ).resolves.toBe('integrity_mismatch');
  });

  it('rejects semantically invalid replay data even with a matching digest adapter', async () => {
    const encoded = await serializeProjectedReplayFile(artifact());
    const raw = JSON.parse(encoded) as Record<string, unknown> & {
      replay: {
        viewer: unknown;
        endRevision: number;
        frames: Array<{ snapshot: { revision: number } }>;
      };
      integrity: { digest: string };
    };
    raw.replay.frames[1]!.snapshot.revision = 9;
    await resign(raw);

    await expect(
      errorProblem(parseProjectedReplayFile(JSON.stringify(raw)))
    ).resolves.toBe('invalid_artifact');

    raw.replay.frames[1]!.snapshot.revision = 1;
    raw.replay.viewer = { kind: 'spectator' };
    await resign(raw);
    await expect(
      errorProblem(parseProjectedReplayFile(JSON.stringify(raw)))
    ).resolves.toBe('invalid_artifact');
  });

  it('fails closed on unsupported, malformed, and oversized envelopes', async () => {
    const encoded = await serializeProjectedReplayFile(artifact());
    const unsupported = JSON.parse(encoded) as { formatVersion: number };
    unsupported.formatVersion = 99;
    await expect(
      errorProblem(parseProjectedReplayFile(JSON.stringify(unsupported)))
    ).resolves.toBe('unsupported_version');

    const extra = JSON.parse(encoded) as Record<string, unknown>;
    extra.resumeToken = 'must-not-be-accepted';
    await expect(
      errorProblem(parseProjectedReplayFile(JSON.stringify(extra)))
    ).resolves.toBe('invalid_envelope');

    await expect(errorProblem(parseProjectedReplayFile('{'))).resolves.toBe(
      'invalid_json'
    );
    await expect(
      errorProblem(
        parseProjectedReplayFile(
          ' '.repeat(MAX_PROJECTED_REPLAY_FILE_CODE_UNITS + 1)
        )
      )
    ).resolves.toBe('file_too_large');
  });
});
