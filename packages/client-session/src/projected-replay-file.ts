import {
  asPlayerId,
  asViewCardId,
  asViewDefinitionId,
  stableSerialize,
} from '@ptcgsim/game-core';
import {
  MAX_REPLAY_FRAMES,
  MAX_SERVER_FRAME_CODE_UNITS,
  PROTOCOL_VERSION,
  hydrateMatchViewState,
  parseServerFrame,
} from '@ptcgsim/protocol';

import type { ProjectedReplayArtifact } from './model.js';
import { assertProjectedReplayArtifact } from './replay-playback.js';

export const PROJECTED_REPLAY_FILE_FORMAT =
  'ptcgsim-perspective-replay' as const;
export const PROJECTED_REPLAY_FILE_VERSION = 1 as const;
/** Pinned file-v1 protocol marker; never retarget this when the live wire moves. */
const PROJECTED_REPLAY_FILE_PROTOCOL_VERSION = 2 as const;
/**
 * One bounded start frame, every bounded replay frame, one completion frame,
 * and their small file envelope. Serialization is canonical/minified so this
 * remains a meaningful pre-parse bound for untrusted imports.
 */
export const MAX_PROJECTED_REPLAY_FILE_CODE_UNITS =
  MAX_SERVER_FRAME_CODE_UNITS * (MAX_REPLAY_FRAMES + 2);

interface ProjectedReplayFilePrivacy {
  readonly kind: 'viewer-projection';
  readonly viewer: ProjectedReplayArtifact['viewer'];
  readonly canonicalState: false;
  readonly resumable: false;
}

interface ProjectedReplayFilePayloadV1 {
  readonly format: typeof PROJECTED_REPLAY_FILE_FORMAT;
  readonly formatVersion: typeof PROJECTED_REPLAY_FILE_VERSION;
  readonly protocolVersion: typeof PROJECTED_REPLAY_FILE_PROTOCOL_VERSION;
  readonly privacy: ProjectedReplayFilePrivacy;
  readonly replay: ProjectedReplayArtifact;
}

type ProjectedReplayFileProblem =
  | 'crypto_unavailable'
  | 'file_too_large'
  | 'integrity_mismatch'
  | 'invalid_artifact'
  | 'invalid_envelope'
  | 'invalid_json'
  | 'unsupported_version';

export class InvalidProjectedReplayFileError extends Error {
  constructor(
    readonly problem: ProjectedReplayFileProblem,
    message: string
  ) {
    super(message);
    this.name = 'InvalidProjectedReplayFileError';
  }
}

const sha256Hex = async (contents: string): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new InvalidProjectedReplayFileError(
      'crypto_unavailable',
      'SHA-256 is unavailable in this environment'
    );
  }
  let digest: ArrayBuffer;
  try {
    digest = await subtle.digest('SHA-256', new TextEncoder().encode(contents));
  } catch {
    throw new InvalidProjectedReplayFileError(
      'crypto_unavailable',
      'SHA-256 failed in this environment'
    );
  }
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean => {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
};

type ReplayViewerLike =
  | { readonly kind: 'spectator' }
  | { readonly kind: 'player'; readonly playerId: string };

const sameViewer = (left: ReplayViewerLike, right: ReplayViewerLike): boolean =>
  left.kind === right.kind &&
  (left.kind === 'spectator' ||
    (right.kind === 'player' && left.playerId === right.playerId));

const isExactViewer = (
  value: Record<string, unknown>
): value is ReplayViewerLike =>
  value.kind === 'spectator'
    ? hasExactKeys(value, ['kind'])
    : value.kind === 'player' &&
      hasExactKeys(value, ['kind', 'playerId']) &&
      typeof value.playerId === 'string' &&
      value.playerId.length >= 1 &&
      value.playerId.length <= 128;

const integrityEquals = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const invalidEnvelope = (message: string): never => {
  throw new InvalidProjectedReplayFileError('invalid_envelope', message);
};

const parseArtifact = (value: unknown): ProjectedReplayArtifact => {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        'replayId',
        'viewer',
        'startRevision',
        'endRevision',
        'truncated',
        'frames',
      ],
      ['localDisclosureDefinitions']
    ) ||
    !Array.isArray(value.frames) ||
    value.frames.length < 1 ||
    value.frames.length > MAX_REPLAY_FRAMES
  ) {
    return invalidEnvelope('Replay artifact envelope is invalid');
  }

  const started = parseServerFrame(
    JSON.stringify({
      type: 'ReplayStarted',
      protocolVersion: PROTOCOL_VERSION,
      replayId: value.replayId,
      viewer: value.viewer,
      startRevision: value.startRevision,
      endRevision: value.endRevision,
      truncated: value.truncated,
      frameCount: value.frames.length,
      ...(value.localDisclosureDefinitions !== undefined
        ? { localDisclosureDefinitions: value.localDisclosureDefinitions }
        : {}),
    })
  );
  if (!started.ok || started.value.type !== 'ReplayStarted') {
    return invalidEnvelope('Replay start metadata is invalid');
  }

  const frames: ProjectedReplayArtifact['frames'][number][] = [];
  for (const [index, frame] of value.frames.entries()) {
    if (
      !isRecord(frame) ||
      !hasExactKeys(
        frame,
        ['snapshot', 'presentationEvents'],
        ['localDisclosure']
      )
    ) {
      return invalidEnvelope(`Replay frame ${index} envelope is invalid`);
    }
    const parsed = parseServerFrame(
      JSON.stringify({
        type: 'ReplayFrame',
        protocolVersion: PROTOCOL_VERSION,
        replayId: started.value.replayId,
        index,
        snapshot: frame.snapshot,
        ...(frame.localDisclosure !== undefined
          ? { localDisclosure: frame.localDisclosure }
          : {}),
        presentationEvents: frame.presentationEvents,
      })
    );
    if (!parsed.ok || parsed.value.type !== 'ReplayFrame') {
      return invalidEnvelope(`Replay frame ${index} is invalid`);
    }
    frames.push({
      snapshot: hydrateMatchViewState(parsed.value.snapshot),
      ...(parsed.value.localDisclosure
        ? {
            localDisclosure: {
              zoneIds: [...parsed.value.localDisclosure.zoneIds],
              cards: parsed.value.localDisclosure.cards.map((card) => ({
                ...card,
                id: asViewCardId(card.id),
                definitionId: asViewDefinitionId(card.definitionId),
                ownerId: asPlayerId(card.ownerId),
              })),
            },
          }
        : {}),
      presentationEvents: parsed.value.presentationEvents ?? [],
    });
  }

  const artifact: ProjectedReplayArtifact = {
    replayId: started.value.replayId,
    viewer: frames[0]!.snapshot.viewer,
    startRevision: started.value.startRevision,
    endRevision: started.value.endRevision,
    truncated: started.value.truncated,
    ...(started.value.localDisclosureDefinitions
      ? {
          localDisclosureDefinitions:
            started.value.localDisclosureDefinitions.map((definition) => ({
              ...definition,
              id: asViewDefinitionId(definition.id),
            })),
        }
      : {}),
    frames,
  };
  try {
    if (!sameViewer(started.value.viewer, artifact.viewer)) {
      throw new Error('Replay metadata names another viewer perspective');
    }
    assertProjectedReplayArtifact(artifact);
  } catch (error) {
    throw new InvalidProjectedReplayFileError(
      'invalid_artifact',
      error instanceof Error
        ? error.message
        : 'Projected replay semantics are invalid'
    );
  }
  return artifact;
};

const payloadFor = (
  artifact: ProjectedReplayArtifact
): ProjectedReplayFilePayloadV1 => ({
  format: PROJECTED_REPLAY_FILE_FORMAT,
  formatVersion: PROJECTED_REPLAY_FILE_VERSION,
  protocolVersion: PROJECTED_REPLAY_FILE_PROTOCOL_VERSION,
  privacy: {
    kind: 'viewer-projection',
    viewer: artifact.viewer,
    canonicalState: false,
    resumable: false,
  },
  replay: artifact,
});

/** Produces deterministic, view-only bytes; it never accepts canonical state. */
export const serializeProjectedReplayFile = async (
  artifact: ProjectedReplayArtifact
): Promise<string> => {
  // Reparse through the closed wire schemas so runtime-only/unknown properties
  // cannot hitchhike into a file even if a caller defeats the TypeScript type.
  const payload = payloadFor(parseArtifact(artifact));
  const contents = stableSerialize({
    ...payload,
    integrity: {
      algorithm: 'SHA-256',
      digest: await sha256Hex(stableSerialize(payload)),
    },
  });
  if (contents.length > MAX_PROJECTED_REPLAY_FILE_CODE_UNITS) {
    throw new InvalidProjectedReplayFileError(
      'file_too_large',
      'Projected replay file exceeds its maximum size'
    );
  }
  return `${contents}\n`;
};

/**
 * Parses untrusted replay bytes into a validated, inert viewer projection.
 * Importing this artifact never creates a live or resumable session.
 */
export const parseProjectedReplayFile = async (
  contents: string
): Promise<ProjectedReplayArtifact> => {
  if (contents.length > MAX_PROJECTED_REPLAY_FILE_CODE_UNITS) {
    throw new InvalidProjectedReplayFileError(
      'file_too_large',
      'Projected replay file exceeds its maximum size'
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new InvalidProjectedReplayFileError(
      'invalid_json',
      'Projected replay file is not valid JSON'
    );
  }
  if (
    !isRecord(raw) ||
    !hasExactKeys(raw, [
      'format',
      'formatVersion',
      'protocolVersion',
      'privacy',
      'replay',
      'integrity',
    ])
  ) {
    return invalidEnvelope('Projected replay file envelope is invalid');
  }
  if (
    raw.format !== PROJECTED_REPLAY_FILE_FORMAT ||
    raw.formatVersion !== PROJECTED_REPLAY_FILE_VERSION ||
    raw.protocolVersion !== PROJECTED_REPLAY_FILE_PROTOCOL_VERSION
  ) {
    throw new InvalidProjectedReplayFileError(
      'unsupported_version',
      'Projected replay file version is not supported'
    );
  }
  if (
    !isRecord(raw.privacy) ||
    !hasExactKeys(raw.privacy, [
      'kind',
      'viewer',
      'canonicalState',
      'resumable',
    ]) ||
    raw.privacy.kind !== 'viewer-projection' ||
    raw.privacy.canonicalState !== false ||
    raw.privacy.resumable !== false ||
    !isRecord(raw.integrity) ||
    !hasExactKeys(raw.integrity, ['algorithm', 'digest']) ||
    raw.integrity.algorithm !== 'SHA-256' ||
    typeof raw.integrity.digest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(raw.integrity.digest)
  ) {
    return invalidEnvelope(
      'Projected replay privacy or integrity marker is invalid'
    );
  }

  const payload = {
    format: raw.format,
    formatVersion: raw.formatVersion,
    protocolVersion: raw.protocolVersion,
    privacy: raw.privacy,
    replay: raw.replay,
  };
  const actualDigest = await sha256Hex(stableSerialize(payload));
  if (!integrityEquals(raw.integrity.digest, actualDigest)) {
    throw new InvalidProjectedReplayFileError(
      'integrity_mismatch',
      'Projected replay file integrity check failed'
    );
  }

  const artifact = parseArtifact(raw.replay);
  const privacyViewer = raw.privacy.viewer;
  if (
    !isRecord(privacyViewer) ||
    !isExactViewer(privacyViewer) ||
    !sameViewer(privacyViewer, artifact.viewer)
  ) {
    return invalidEnvelope(
      'Projected replay privacy perspective is inconsistent'
    );
  }
  return artifact;
};
