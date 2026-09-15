import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { asMatchId, asPlayerId } from '../packages/game-core/src/index.js';
import {
  LEGACY_CONVERSION_REPORT_FORMAT,
  LEGACY_CONVERSION_TARGET_SERIALIZATION,
  MAX_LEGACY_CONVERSION_SOURCE_BYTES,
  convertLegacyExportBytes,
  parseLegacyExportJson,
  type LegacyConversionReport,
} from '../packages/legacy-import/src/index.js';

export const LEGACY_IMPORT_CORPUS_REPORT_FORMAT =
  'ptcgsim-legacy-import-corpus-report-v1' as const;
export const LEGACY_IMPORT_CORPUS_TARGET_PROFILE =
  'ptcgsim-anonymous-legacy-corpus-target-v1' as const;
export const MAX_LEGACY_IMPORT_CORPUS_CASES = 1_000;
export const MAX_LEGACY_IMPORT_CORPUS_TOTAL_BYTES = 256 * 1024 * 1024;
export const MAX_LEGACY_IMPORT_CORPUS_BASELINE_BYTES = 8 * 1024 * 1024;

interface LegacyImportCorpusLimits {
  readonly maxCases: number;
  readonly maxSourceBytes: number;
  readonly maxTotalBytes: number;
}

interface LegacyImportCorpusCount {
  readonly code: string;
  readonly count: number;
}

interface LegacyImportCorpusReasonCount {
  readonly reason: string;
  readonly count: number;
}

interface LegacyImportCorpusActionCount {
  readonly action: string;
  readonly count: number;
}

type LegacyImportCorpusIssue = Omit<
  LegacyConversionReport['issues'][number],
  'message'
>;

interface LegacyImportCorpusCase {
  /** Exact source digest; source paths and contents are deliberately absent. */
  readonly caseId: `sha256:${string}`;
  readonly status: LegacyConversionReport['status'];
  readonly sourceByteLength: number;
  readonly target: LegacyConversionReport['target'];
  readonly summary: LegacyConversionReport['summary'];
  readonly actions: readonly LegacyImportCorpusActionCount[];
  readonly warnings: readonly LegacyImportCorpusCount[];
  readonly droppedPresentationFields: readonly LegacyImportCorpusReasonCount[];
  readonly issues: readonly LegacyImportCorpusIssue[];
}

interface LegacyImportCorpusVersionCount {
  readonly version: string;
  readonly count: number;
}

export interface LegacyImportCorpusReport {
  readonly format: typeof LEGACY_IMPORT_CORPUS_REPORT_FORMAT;
  readonly conversionReportFormat: typeof LEGACY_CONVERSION_REPORT_FORMAT;
  readonly targetProfile: typeof LEGACY_IMPORT_CORPUS_TARGET_PROFILE;
  readonly targetSerialization: typeof LEGACY_CONVERSION_TARGET_SERIALIZATION;
  readonly limits: LegacyImportCorpusLimits;
  readonly summary: {
    readonly caseCount: number;
    readonly convertedCaseCount: number;
    readonly rejectedCaseCount: number;
    readonly sourceByteCount: number;
    readonly knownSourceActionCount: number;
    readonly convertedRecordCount: number;
    readonly batchCount: number;
    readonly eventCount: number;
    readonly zeroBatchRecordCount: number;
    readonly sourceVersions: readonly LegacyImportCorpusVersionCount[];
    readonly actionCounts: readonly LegacyImportCorpusActionCount[];
    readonly warningCounts: readonly LegacyImportCorpusCount[];
    readonly droppedPresentationFieldCounts: readonly LegacyImportCorpusReasonCount[];
    readonly issueCounts: readonly LegacyImportCorpusCount[];
  };
  readonly cases: readonly LegacyImportCorpusCase[];
}

export interface LegacyImportCorpusOptions {
  readonly maxCases?: number;
  readonly maxTotalBytes?: number;
}

interface LegacyImportCorpusArguments {
  readonly input: string;
  readonly expect?: string;
}

const ANONYMOUS_TARGET = Object.freeze({
  matchId: asMatchId('legacy-corpus-match'),
  selfSeat: Object.freeze({
    playerId: asPlayerId('legacy-corpus-self'),
    displayName: 'Self',
  }),
  opponentSeat: Object.freeze({
    playerId: asPlayerId('legacy-corpus-opponent'),
    displayName: 'Opponent',
  }),
});

const positiveSafeInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
};

const limitsFor = (
  options: LegacyImportCorpusOptions = {}
): LegacyImportCorpusLimits => ({
  maxCases: positiveSafeInteger(
    options.maxCases ?? MAX_LEGACY_IMPORT_CORPUS_CASES,
    'maxCases'
  ),
  maxSourceBytes: MAX_LEGACY_CONVERSION_SOURCE_BYTES,
  maxTotalBytes: positiveSafeInteger(
    options.maxTotalBytes ?? MAX_LEGACY_IMPORT_CORPUS_TOTAL_BYTES,
    'maxTotalBytes'
  ),
});

const increment = (
  counts: Map<string, number>,
  value: string,
  amount = 1
): void => {
  counts.set(value, (counts.get(value) ?? 0) + amount);
};

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedCounts = (
  counts: ReadonlyMap<string, number>
): readonly LegacyImportCorpusCount[] =>
  [...counts]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([code, count]) => ({ code, count }));

const sortedReasonCounts = (
  counts: ReadonlyMap<string, number>
): readonly LegacyImportCorpusReasonCount[] =>
  [...counts]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([reason, count]) => ({ reason, count }));

const sortedActionCounts = (
  counts: ReadonlyMap<string, number>
): readonly LegacyImportCorpusActionCount[] =>
  [...counts]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([action, count]) => ({ action, count }));

const sourceActionCounts = (
  source: Uint8Array
): readonly LegacyImportCorpusActionCount[] => {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    return [];
  }
  const parsed = parseLegacyExportJson(decoded);
  if (!parsed.ok) return [];
  const counts = new Map<string, number>();
  for (const action of parsed.value.actions) increment(counts, action.action);
  return sortedActionCounts(counts);
};

const corpusCase = (
  report: LegacyConversionReport,
  actions: readonly LegacyImportCorpusActionCount[]
): LegacyImportCorpusCase => {
  if (report.source.sha256 === null) {
    throw new Error('Corpus source exceeds the per-file conversion boundary');
  }
  const droppedCounts = new Map<string, number>();
  for (const field of report.droppedPresentationFields) {
    increment(droppedCounts, field.reason);
  }
  const countedActions = actions.reduce(
    (total, action) => total + action.count,
    0
  );
  if (countedActions !== (report.summary.sourceActionCount ?? 0)) {
    throw new Error('Corpus action inventory disagrees with conversion report');
  }
  return {
    caseId: report.source.sha256,
    status: report.status,
    sourceByteLength: report.source.byteLength,
    target: report.target,
    summary: report.summary,
    actions,
    warnings: report.warnings
      .map(({ code, count }) => ({ code, count }))
      .sort((left, right) => compareStrings(left.code, right.code)),
    droppedPresentationFields: sortedReasonCounts(droppedCounts),
    issues: report.issues.map(
      ({ stage, code, recordIndex, path }): LegacyImportCorpusIssue => ({
        stage,
        code,
        recordIndex,
        path,
      })
    ),
  };
};

export const buildLegacyImportCorpusReport = async (
  sources: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  options: LegacyImportCorpusOptions = {}
): Promise<LegacyImportCorpusReport> => {
  const limits = limitsFor(options);
  const cases: LegacyImportCorpusCase[] = [];
  const sourceDigests = new Set<string>();
  let sourceByteCount = 0;

  for await (const source of sources) {
    if (cases.length >= limits.maxCases) {
      throw new Error(`Corpus cannot exceed ${limits.maxCases} JSON cases`);
    }
    const bytes = new Uint8Array(source);
    if (bytes.byteLength > limits.maxSourceBytes) {
      throw new Error('Corpus source exceeds the per-file conversion boundary');
    }
    sourceByteCount += bytes.byteLength;
    if (sourceByteCount > limits.maxTotalBytes) {
      throw new Error(
        `Corpus cannot exceed ${limits.maxTotalBytes} total source bytes`
      );
    }

    const result = await convertLegacyExportBytes(bytes, ANONYMOUS_TARGET);
    const convertedCase = corpusCase(result.report, sourceActionCounts(bytes));
    if (sourceDigests.has(convertedCase.caseId)) {
      throw new Error('Corpus contains duplicate exact source bytes');
    }
    sourceDigests.add(convertedCase.caseId);
    cases.push(convertedCase);
  }

  if (cases.length === 0) {
    throw new Error('Corpus contains no .json files');
  }
  cases.sort((left, right) => compareStrings(left.caseId, right.caseId));

  const sourceVersions = new Map<string, number>();
  const actionCounts = new Map<string, number>();
  const warningCounts = new Map<string, number>();
  const droppedFieldCounts = new Map<string, number>();
  const issueCounts = new Map<string, number>();
  for (const entry of cases) {
    increment(sourceVersions, entry.summary.sourceVersion ?? 'unknown');
    for (const action of entry.actions) {
      increment(actionCounts, action.action, action.count);
    }
    for (const warning of entry.warnings) {
      increment(warningCounts, warning.code, warning.count);
    }
    for (const field of entry.droppedPresentationFields) {
      increment(droppedFieldCounts, field.reason, field.count);
    }
    for (const issue of entry.issues) increment(issueCounts, issue.code);
  }

  return {
    format: LEGACY_IMPORT_CORPUS_REPORT_FORMAT,
    conversionReportFormat: LEGACY_CONVERSION_REPORT_FORMAT,
    targetProfile: LEGACY_IMPORT_CORPUS_TARGET_PROFILE,
    targetSerialization: LEGACY_CONVERSION_TARGET_SERIALIZATION,
    limits,
    summary: {
      caseCount: cases.length,
      convertedCaseCount: cases.filter((entry) => entry.status === 'converted')
        .length,
      rejectedCaseCount: cases.filter((entry) => entry.status === 'rejected')
        .length,
      sourceByteCount,
      knownSourceActionCount: cases.reduce(
        (total, entry) => total + (entry.summary.sourceActionCount ?? 0),
        0
      ),
      convertedRecordCount: cases.reduce(
        (total, entry) => total + entry.summary.convertedRecordCount,
        0
      ),
      batchCount: cases.reduce(
        (total, entry) => total + entry.summary.batchCount,
        0
      ),
      eventCount: cases.reduce(
        (total, entry) => total + entry.summary.eventCount,
        0
      ),
      zeroBatchRecordCount: cases.reduce(
        (total, entry) => total + entry.summary.zeroBatchRecordCount,
        0
      ),
      sourceVersions: sortedCounts(sourceVersions).map(({ code, count }) => ({
        version: code,
        count,
      })),
      actionCounts: sortedActionCounts(actionCounts),
      warningCounts: sortedCounts(warningCounts),
      droppedPresentationFieldCounts: sortedReasonCounts(droppedFieldCounts),
      issueCounts: sortedCounts(issueCounts),
    },
    cases,
  };
};

const discoverJsonFiles = async (
  directory: string,
  files: string[],
  maxCases: number
): Promise<void> => {
  const entries = [];
  for await (const entry of await opendir(directory)) entries.push(entry);
  entries.sort((left, right) => compareStrings(left.name, right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error('Corpus directories cannot contain symbolic links');
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await discoverJsonFiles(path, files, maxCases);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      if (files.length >= maxCases) {
        throw new Error(`Corpus cannot exceed ${maxCases} JSON cases`);
      }
      files.push(path);
    }
  }
};

const directorySources = async function* (
  directory: string,
  limits: LegacyImportCorpusLimits
): AsyncGenerator<Uint8Array> {
  const files: string[] = [];
  await discoverJsonFiles(directory, files, limits.maxCases);
  if (files.length === 0) throw new Error('Corpus contains no .json files');

  let totalBytes = 0;
  for (const path of files) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new Error('Corpus entries must be files');
      if (
        !Number.isSafeInteger(metadata.size) ||
        metadata.size > limits.maxSourceBytes
      ) {
        throw new Error(
          'Corpus source exceeds the per-file conversion boundary'
        );
      }
      totalBytes += metadata.size;
      if (totalBytes > limits.maxTotalBytes) {
        throw new Error(
          `Corpus cannot exceed ${limits.maxTotalBytes} total source bytes`
        );
      }
      const bytes = await handle.readFile();
      if (bytes.byteLength !== metadata.size) {
        throw new Error('Corpus source changed while it was being read');
      }
      yield bytes;
    } finally {
      await handle.close();
    }
  }
};

export const runLegacyImportCorpusDirectory = async (
  inputDirectory: string,
  options: LegacyImportCorpusOptions = {}
): Promise<LegacyImportCorpusReport> => {
  const directory = resolve(inputDirectory);
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink()) {
    throw new Error('Corpus input directory cannot be a symbolic link');
  }
  if (!metadata.isDirectory()) {
    throw new Error('Corpus input must be a directory');
  }
  const limits = limitsFor(options);
  return buildLegacyImportCorpusReport(
    directorySources(directory, limits),
    options
  );
};

const isInside = (candidate: string, parent: string): boolean => {
  const child = relative(parent, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`));
};

export const assertLegacyImportCorpusPrivateLocation = (
  inputDirectory: string,
  repoRoot: string
): void => {
  const input = resolve(inputDirectory);
  const repository = resolve(repoRoot);
  const allowedPrivateRoot = join(
    repository,
    '.private',
    'legacy-import-corpus'
  );
  if (isInside(input, repository) && !isInside(input, allowedPrivateRoot)) {
    throw new Error(
      'In-repository corpus input must be under .private/legacy-import-corpus'
    );
  }
};

export const assertLegacyImportCorpusBaselineOutsideInput = (
  expectedReport: string,
  inputDirectory: string
): void => {
  if (isInside(resolve(expectedReport), resolve(inputDirectory))) {
    throw new Error(
      'Expected corpus report must be outside the input directory'
    );
  }
};

export const readLegacyImportCorpusBaseline = async (
  reportPath: string,
  maxBytes = MAX_LEGACY_IMPORT_CORPUS_BASELINE_BYTES
): Promise<string> => {
  positiveSafeInteger(maxBytes, 'maxBytes');
  const metadata = await lstat(resolve(reportPath));
  if (metadata.isSymbolicLink()) {
    throw new Error('Expected corpus report cannot be a symbolic link');
  }
  if (!metadata.isFile()) {
    throw new Error('Expected corpus report must be a file');
  }
  if (!Number.isSafeInteger(metadata.size) || metadata.size > maxBytes) {
    throw new Error(`Expected corpus report cannot exceed ${maxBytes} bytes`);
  }
  const handle = await open(
    resolve(reportPath),
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const bytes = await handle.readFile();
    if (bytes.byteLength !== metadata.size) {
      throw new Error('Expected corpus report changed while it was being read');
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('Expected corpus report must contain valid UTF-8');
    }
  } finally {
    await handle.close();
  }
};

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, child]) => [key, sortJson(child)])
  );
};

const canonicalJson = (value: unknown): string =>
  JSON.stringify(sortJson(value));

const reportDigest = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

export const assertLegacyImportCorpusBaseline = (
  actual: LegacyImportCorpusReport,
  expectedJson: string
): void => {
  let expected: unknown;
  try {
    expected = JSON.parse(expectedJson);
  } catch {
    throw new Error('Expected corpus report is not valid JSON');
  }
  if (
    typeof expected !== 'object' ||
    expected === null ||
    (expected as { format?: unknown }).format !==
      LEGACY_IMPORT_CORPUS_REPORT_FORMAT
  ) {
    throw new Error('Expected corpus report has the wrong format');
  }
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(
      `Legacy import corpus report drifted (expected ${reportDigest(expected)}, actual ${reportDigest(actual)})`
    );
  }
};

export const serializeLegacyImportCorpusReport = (
  report: LegacyImportCorpusReport
): string => `${JSON.stringify(report, null, 2)}\n`;

export const parseLegacyImportCorpusArguments = (
  arguments_: readonly string[]
): LegacyImportCorpusArguments => {
  let expect: string | undefined;
  let input: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--' && index === 0) {
      continue;
    } else if (argument === '--input') {
      if (input !== undefined) throw new Error('--input may be provided once');
      input = arguments_[index + 1];
      if (!input) throw new Error('--input requires a directory');
      index += 1;
    } else if (argument === '--expect') {
      if (expect !== undefined)
        throw new Error('--expect may be provided once');
      expect = arguments_[index + 1];
      if (!expect) throw new Error('--expect requires a report path');
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (input === undefined) throw new Error('--input is required');
  return { input, ...(expect === undefined ? {} : { expect }) };
};

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    const arguments_ = parseLegacyImportCorpusArguments(process.argv.slice(2));
    const repoRoot = resolve(
      fileURLToPath(new URL('.', import.meta.url)),
      '..'
    );
    const input = resolve(arguments_.input);
    assertLegacyImportCorpusPrivateLocation(input, repoRoot);
    if (arguments_.expect !== undefined) {
      assertLegacyImportCorpusBaselineOutsideInput(arguments_.expect, input);
    }
    const report = await runLegacyImportCorpusDirectory(input);
    if (arguments_.expect === undefined) {
      process.stdout.write(serializeLegacyImportCorpusReport(report));
    } else {
      assertLegacyImportCorpusBaseline(
        report,
        await readLegacyImportCorpusBaseline(arguments_.expect)
      );
    }
    if (report.summary.rejectedCaseCount > 0) {
      throw new Error(
        `Legacy import corpus contains ${report.summary.rejectedCaseCount} rejected case(s)`
      );
    }
    if (arguments_.expect !== undefined) {
      process.stdout.write(
        `Legacy import corpus report passed (${report.summary.caseCount} cases, ${report.summary.convertedCaseCount} converted).\n`
      );
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
