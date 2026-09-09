import {
  MATCH_STATE_SCHEMA_VERSION,
  stableSerialize,
  type EventBatch,
  type MatchId,
  type MatchSeatInput,
  type MatchState,
} from '@ptcgsim/game-core';

import {
  buildLegacyV1Candidate,
  type LegacyV1CandidateIssueCode,
} from './convert-candidate.js';
import {
  MAX_LEGACY_EXPORT_CODE_UNITS,
  parseLegacyExportJson,
  type LegacyExportParseIssue,
  type LegacyExportParseIssueCode,
  type LegacyExportVersion,
  type LegacySynchronizedActionName,
  type ParsedLegacyExport,
} from './parse-export.js';

export const LEGACY_CONVERSION_REPORT_FORMAT =
  'ptcgsim-legacy-conversion-report-v1' as const;
export const LEGACY_CONVERSION_TARGET_SERIALIZATION =
  'ptcgsim-match-state-stable-json-v1' as const;
const LEGACY_IMPORT_CANONICAL_CARD_BACK_URL = '/v2/assets/cardback.png';
/**
 * The byte-oriented transaction is intentionally no larger than the existing
 * parser's code-unit limit. This keeps multi-byte input from widening the
 * upload boundary before a route-level quota is designed.
 */
export const MAX_LEGACY_CONVERSION_SOURCE_BYTES = MAX_LEGACY_EXPORT_CODE_UNITS;

export interface LegacyConversionTarget {
  readonly matchId: MatchId;
  readonly selfSeat: Pick<MatchSeatInput, 'playerId' | 'displayName'>;
  readonly opponentSeat: Pick<MatchSeatInput, 'playerId' | 'displayName'>;
}

export interface LegacyConversionAppliedRecord {
  readonly recordIndex: number;
  readonly action: LegacySynchronizedActionName;
  readonly batches: readonly EventBatch[];
}

export type LegacyConversionSha256 = `sha256:${string}`;

export interface LegacyConversionSourceIdentity {
  readonly byteLength: number;
  readonly encoding: 'UTF-8';
  /** Null only when the source exceeds the pre-hash byte limit. */
  readonly sha256: LegacyConversionSha256 | null;
}

export interface LegacyConversionTargetIdentity {
  readonly byteLength: number;
  readonly serialization: typeof LEGACY_CONVERSION_TARGET_SERIALIZATION;
  readonly matchStateSchemaVersion: typeof MATCH_STATE_SCHEMA_VERSION;
  readonly sha256: LegacyConversionSha256;
}

export type LegacyConversionIssueCode =
  | 'source.invalid_utf8'
  | 'source.payload_too_large'
  | `parse.${LegacyExportParseIssueCode}`
  | `convert.${LegacyV1CandidateIssueCode}`;

export interface LegacyConversionIssue {
  readonly stage: 'source' | 'parse' | 'convert';
  readonly code: LegacyConversionIssueCode;
  readonly recordIndex: number | null;
  readonly path: string;
  readonly message: string;
}

export type LegacyDroppedPresentationFieldReason =
  | 'initiator_was_presentation_only'
  | 'message_flag_was_presentation_only'
  | 'target_relationship_was_validation_only'
  | 'custom_card_back_url_was_normalized';

export interface LegacyDroppedPresentationField {
  readonly recordIndex: number;
  readonly path: string;
  readonly reason: LegacyDroppedPresentationFieldReason;
}

export type LegacyConversionWarningCode =
  | 'legacy_transport_metadata_not_persisted'
  | 'presentation_fields_not_persisted'
  | 'custom_card_back_urls_normalized';

export interface LegacyConversionWarning {
  readonly code: LegacyConversionWarningCode;
  readonly count: number;
  readonly message: string;
}

export interface LegacyConversionSummary {
  readonly sourceVersion: LegacyExportVersion | null;
  readonly sourceActionCount: number | null;
  readonly convertedRecordCount: number;
  readonly batchCount: number;
  readonly eventCount: number;
  readonly zeroBatchRecordCount: number;
}

export interface LegacyConversionReport {
  readonly format: typeof LEGACY_CONVERSION_REPORT_FORMAT;
  readonly status: 'converted' | 'rejected';
  readonly source: LegacyConversionSourceIdentity;
  readonly target: LegacyConversionTargetIdentity | null;
  readonly summary: LegacyConversionSummary;
  readonly warnings: readonly LegacyConversionWarning[];
  readonly droppedPresentationFields: readonly LegacyDroppedPresentationField[];
  readonly issues: readonly LegacyConversionIssue[];
}

export type LegacyConversionResult =
  | {
      readonly ok: true;
      readonly state: MatchState;
      readonly records: readonly LegacyConversionAppliedRecord[];
      readonly report: LegacyConversionReport & {
        readonly status: 'converted';
        readonly target: LegacyConversionTargetIdentity;
        readonly issues: readonly [];
      };
    }
  | {
      readonly ok: false;
      readonly report: LegacyConversionReport & {
        readonly status: 'rejected';
        readonly target: null;
      };
    };

const PRESENTATION_ONLY_INITIATOR_ACTIONS =
  new Set<LegacySynchronizedActionName>([
    'takeTurn',
    'draw',
    'discardAndDraw',
    'shuffleAndDraw',
    'shuffleBottomAndDraw',
    'moveCardBundle',
    'leaveAll',
    'discardAll',
    'lostZoneAll',
    'handAll',
    'shuffleAll',
    'shuffleBottom',
    'discardBoard',
    'handBoard',
    'shuffleBoard',
    'lostZoneBoard',
    'shuffleZone',
    'moveToDeckTop',
    'shuffleIntoDeck',
    'switchWithDeckTop',
    'shufflePrizesToDeckBottom',
    'useAbility',
    'changeType',
  ]);

const messageFlagIndex = (
  action: LegacySynchronizedActionName
): number | null => {
  switch (action) {
    case 'reset':
      return 2;
    case 'discardBoard':
    case 'handBoard':
    case 'shuffleBoard':
    case 'lostZoneBoard':
      return 1;
    case 'shuffleZone':
      return 3;
    default:
      return null;
  }
};

const droppedPresentationFields = (
  parsed: ParsedLegacyExport
): readonly LegacyDroppedPresentationField[] => {
  const dropped: LegacyDroppedPresentationField[] = [];
  for (
    let actionIndex = 0;
    actionIndex < parsed.actions.length;
    actionIndex += 1
  ) {
    const action = parsed.actions[actionIndex]!;
    const recordIndex = actionIndex + 1;
    if (PRESENTATION_ONLY_INITIATOR_ACTIONS.has(action.action)) {
      dropped.push({
        recordIndex,
        path: `$[${recordIndex}].parameters[0]`,
        reason: 'initiator_was_presentation_only',
      });
    }
    const messageIndex = messageFlagIndex(action.action);
    if (messageIndex !== null) {
      dropped.push({
        recordIndex,
        path: `$[${recordIndex}].parameters[${messageIndex}]`,
        reason: 'message_flag_was_presentation_only',
      });
    }
    if (action.action === 'viewDeck') {
      dropped.push({
        recordIndex,
        path: `$[${recordIndex}].parameters[4]`,
        reason: 'target_relationship_was_validation_only',
      });
    }
    if (action.action === 'changeCardBack') {
      dropped.push({
        recordIndex,
        path: `$[${recordIndex}].parameters[0]`,
        reason: 'custom_card_back_url_was_normalized',
      });
    }
  }
  return dropped;
};

const warningsFor = (
  actionCount: number,
  droppedFields: readonly LegacyDroppedPresentationField[]
): readonly LegacyConversionWarning[] => {
  const normalizedCardBackCount = droppedFields.filter(
    (field) => field.reason === 'custom_card_back_url_was_normalized'
  ).length;
  return [
    {
      code: 'legacy_transport_metadata_not_persisted',
      count: actionCount,
      message:
        'Validated V1 emit flags are transport metadata and are not persisted in canonical state.',
    },
    ...(droppedFields.length === 0
      ? []
      : [
          {
            code: 'presentation_fields_not_persisted' as const,
            count: droppedFields.length,
            message:
              'Validated V1-only presentation fields are listed separately and are not persisted in canonical state.',
          },
        ]),
    ...(normalizedCardBackCount === 0
      ? []
      : [
          {
            code: 'custom_card_back_urls_normalized' as const,
            count: normalizedCardBackCount,
            message:
              'Legacy custom card-back URLs were replaced by the approved canonical V2 card back.',
          },
        ]),
  ];
};

const emptySummary = (): LegacyConversionSummary => ({
  sourceVersion: null,
  sourceActionCount: null,
  convertedRecordCount: 0,
  batchCount: 0,
  eventCount: 0,
  zeroBatchRecordCount: 0,
});

const summaryFor = (
  parsed: ParsedLegacyExport,
  records: readonly LegacyConversionAppliedRecord[] = []
): LegacyConversionSummary => ({
  sourceVersion: parsed.version,
  sourceActionCount: parsed.actions.length,
  convertedRecordCount: records.length,
  batchCount: records.reduce(
    (total, record) => total + record.batches.length,
    0
  ),
  eventCount: records.reduce(
    (total, record) =>
      total +
      record.batches.reduce(
        (batchTotal, batch) => batchTotal + batch.events.length,
        0
      ),
    0
  ),
  zeroBatchRecordCount: records.filter((record) => record.batches.length === 0)
    .length,
});

const recordIndexFromPath = (path: string): number | null => {
  const match = /^\$\[(\d+)\]/u.exec(path);
  return match ? Number(match[1]) : null;
};

const parseIssue = (issue: LegacyExportParseIssue): LegacyConversionIssue => ({
  stage: 'parse',
  code: `parse.${issue.code}`,
  recordIndex: recordIndexFromPath(issue.path),
  path: issue.path,
  message: issue.message,
});

const sha256 = async (bytes: Uint8Array): Promise<LegacyConversionSha256> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `sha256:${hex}`;
};

const rejected = (
  source: LegacyConversionSourceIdentity,
  issue: LegacyConversionIssue,
  parsed?: ParsedLegacyExport
): LegacyConversionResult => ({
  ok: false,
  report: {
    format: LEGACY_CONVERSION_REPORT_FORMAT,
    status: 'rejected',
    source,
    target: null,
    summary: parsed ? summaryFor(parsed) : emptySummary(),
    // A rejected transaction persists nothing, so it has diagnostics but no
    // dropped-field claims. Those are meaningful only for a saved target.
    warnings: [],
    droppedPresentationFields: [],
    issues: [issue],
  },
});

/**
 * Converts one exact byte artifact as an all-or-nothing transaction. The input
 * is copied before the first await so callers cannot mutate the bytes between
 * hashing and parsing. Successful target identity covers UTF-8 bytes of
 * `stableSerialize(state)` only; event records remain audit evidence and are
 * counted in the report without changing the saved-state identity.
 */
export const convertLegacyExportBytes = async (
  sourceBytes: Uint8Array,
  target: LegacyConversionTarget
): Promise<LegacyConversionResult> => {
  const bytes = new Uint8Array(sourceBytes);
  if (bytes.byteLength > MAX_LEGACY_CONVERSION_SOURCE_BYTES) {
    return rejected(
      { byteLength: bytes.byteLength, encoding: 'UTF-8', sha256: null },
      {
        stage: 'source',
        code: 'source.payload_too_large',
        recordIndex: null,
        path: '$',
        message: `Legacy export cannot exceed ${MAX_LEGACY_CONVERSION_SOURCE_BYTES} bytes`,
      }
    );
  }

  const transactionTarget: LegacyConversionTarget = {
    matchId: target.matchId,
    selfSeat: { ...target.selfSeat },
    opponentSeat: { ...target.opponentSeat },
  };
  const candidateTarget = {
    matchId: transactionTarget.matchId,
    selfSeat: {
      ...transactionTarget.selfSeat,
      cardBackUrl: LEGACY_IMPORT_CANONICAL_CARD_BACK_URL,
    },
    opponentSeat: {
      ...transactionTarget.opponentSeat,
      cardBackUrl: LEGACY_IMPORT_CANONICAL_CARD_BACK_URL,
    },
  };

  const sourceIdentity: LegacyConversionSourceIdentity = {
    byteLength: bytes.byteLength,
    encoding: 'UTF-8',
    sha256: await sha256(bytes),
  };
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return rejected(sourceIdentity, {
      stage: 'source',
      code: 'source.invalid_utf8',
      recordIndex: null,
      path: '$',
      message: 'Legacy export bytes must contain valid UTF-8',
    });
  }

  const parsed = parseLegacyExportJson(source);
  if (!parsed.ok) {
    return rejected(sourceIdentity, parseIssue(parsed.issues[0]!));
  }

  const candidate = buildLegacyV1Candidate(parsed.value, candidateTarget);
  if (!candidate.ok) {
    const issue = candidate.issues[0]!;
    return rejected(
      sourceIdentity,
      {
        stage: 'convert',
        code: `convert.${issue.code}`,
        recordIndex: issue.recordIndex,
        path: issue.path,
        message: issue.message,
      },
      parsed.value
    );
  }

  const records: readonly LegacyConversionAppliedRecord[] = candidate.records;
  const targetBytes = new TextEncoder().encode(
    stableSerialize(candidate.state)
  );
  const droppedFields = droppedPresentationFields(parsed.value);
  return {
    ok: true,
    state: candidate.state,
    records,
    report: {
      format: LEGACY_CONVERSION_REPORT_FORMAT,
      status: 'converted',
      source: sourceIdentity,
      target: {
        byteLength: targetBytes.byteLength,
        serialization: LEGACY_CONVERSION_TARGET_SERIALIZATION,
        matchStateSchemaVersion: MATCH_STATE_SCHEMA_VERSION,
        sha256: await sha256(targetBytes),
      },
      summary: summaryFor(parsed.value, records),
      warnings: warningsFor(parsed.value.actions.length, droppedFields),
      droppedPresentationFields: droppedFields,
      issues: [],
    },
  };
};
