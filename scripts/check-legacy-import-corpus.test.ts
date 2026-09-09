import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { promisify } from 'node:util';

import {
  LEGACY_IMPORT_CORPUS_REPORT_FORMAT,
  assertLegacyImportCorpusBaseline,
  assertLegacyImportCorpusBaselineOutsideInput,
  assertLegacyImportCorpusPrivateLocation,
  buildLegacyImportCorpusReport,
  parseLegacyImportCorpusArguments,
  readLegacyImportCorpusBaseline,
  runLegacyImportCorpusDirectory,
  serializeLegacyImportCorpusReport,
  type LegacyImportCorpusReport,
} from './check-legacy-import-corpus.js';

const encoder = new TextEncoder();
const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true }))
  );
});

const temporaryDirectory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), 'ptcgsim-legacy-corpus-'));
  temporaryDirectories.push(path);
  return path;
};

const action = (name: string, parameters: unknown[] = []) => ({
  user: 'self',
  emit: true,
  action: name,
  parameters,
});

const payload = (...actions: unknown[]) => [
  { version: '1.5.1' },
  action('loadDeckData', [
    [
      [
        '1',
        'Private Secret Card',
        'Pokémon',
        'https://private.example/secret-card.png',
      ],
    ],
  ]),
  { ...action('loadDeckData', ['']), user: 'opp' },
  ...actions,
];

describe('legacy import corpus evidence tool', () => {
  it('produces deterministic digest-keyed evidence without paths or contents', async () => {
    const directory = await temporaryDirectory();
    const nested = join(directory, 'private-player-folder');
    await mkdir(nested);
    const value = payload();
    await writeFile(
      join(directory, 'alice-full-name.json'),
      JSON.stringify(value)
    );
    await writeFile(
      join(nested, 'account-1234.json'),
      JSON.stringify(value, null, 2)
    );
    await writeFile(join(directory, 'notes.txt'), 'ignored private notes');

    const first = await runLegacyImportCorpusDirectory(directory);
    const retry = await runLegacyImportCorpusDirectory(directory);
    const serialized = serializeLegacyImportCorpusReport(first);

    assert.deepEqual(first, retry);
    assert.equal(first.format, LEGACY_IMPORT_CORPUS_REPORT_FORMAT);
    assert.equal(first.summary.caseCount, 2);
    assert.equal(first.summary.convertedCaseCount, 2);
    assert.equal(first.summary.rejectedCaseCount, 0);
    assert.deepEqual(first.summary.sourceVersions, [
      { version: '1.5.1', count: 2 },
    ]);
    assert.deepEqual(first.summary.actionCounts, [
      { action: 'loadDeckData', count: 4 },
    ]);
    assert.deepEqual(
      first.cases.map((entry) => entry.caseId),
      [...first.cases.map((entry) => entry.caseId)].sort()
    );
    assert.equal(new Set(first.cases.map((entry) => entry.caseId)).size, 2);
    assert.equal(
      new Set(first.cases.map((entry) => entry.target?.sha256)).size,
      1
    );
    for (const secret of [
      'alice-full-name',
      'account-1234',
      'Private Secret Card',
      'private.example',
      'ignored private notes',
    ]) {
      assert.equal(serialized.includes(secret), false);
    }
  });

  it('retains safe issue coordinates but strips messages and source values', async () => {
    const unsupported = encoder.encode(
      JSON.stringify(
        payload(
          action('changeCardBack', [
            'https://private.example/very-secret-card-back.png',
          ])
        )
      )
    );
    const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0xfd]);
    const report = await buildLegacyImportCorpusReport([
      unsupported,
      invalidUtf8,
    ]);
    const serialized = serializeLegacyImportCorpusReport(report);

    assert.equal(report.summary.caseCount, 2);
    assert.equal(report.summary.convertedCaseCount, 0);
    assert.equal(report.summary.rejectedCaseCount, 2);
    assert.deepEqual(report.summary.issueCounts, [
      { code: 'convert.unsupported_action', count: 1 },
      { code: 'source.invalid_utf8', count: 1 },
    ]);
    const paths = report.cases
      .flatMap((entry) => entry.issues)
      .map((issue) => issue.path);
    assert.equal(paths.includes('$'), true);
    assert.equal(paths.includes('$[3].action'), true);
    assert.equal(serialized.includes('message'), false);
    assert.equal(serialized.includes('very-secret-card-back'), false);
    assert.equal(serialized.includes('Private Secret Card'), false);
  });

  it('refuses duplicate exact source artifacts so evidence cannot be inflated', async () => {
    const source = encoder.encode(JSON.stringify(payload()));
    await assert.rejects(
      buildLegacyImportCorpusReport([source, new Uint8Array(source)]),
      /duplicate exact source bytes/u
    );
  });

  it('enforces configurable case and total-byte bounds', async () => {
    const first = encoder.encode(JSON.stringify(payload()));
    const second = encoder.encode(JSON.stringify(payload(action('attack'))));

    await assert.rejects(
      buildLegacyImportCorpusReport([first, second], { maxCases: 1 }),
      /cannot exceed 1 JSON cases/u
    );
    await assert.rejects(
      buildLegacyImportCorpusReport([first], {
        maxTotalBytes: first.byteLength - 1,
      }),
      /total source bytes/u
    );
    await assert.rejects(
      buildLegacyImportCorpusReport([first], { maxCases: 0 }),
      /positive safe integer/u
    );
  });

  it('refuses symbolic links anywhere in a corpus tree', async () => {
    const directory = await temporaryDirectory();
    const external = join(await temporaryDirectory(), 'outside.json');
    await writeFile(external, JSON.stringify(payload()));
    await symlink(external, join(directory, 'linked-private-save.json'));

    await assert.rejects(
      runLegacyImportCorpusDirectory(directory),
      /cannot contain symbolic links/u
    );
  });

  it('requires an actual directory containing at least one JSON artifact', async () => {
    const directory = await temporaryDirectory();
    const file = join(directory, 'one.json');
    await writeFile(file, JSON.stringify(payload()));

    await assert.rejects(
      runLegacyImportCorpusDirectory(file),
      /must be a directory/u
    );
    await rm(file);
    await writeFile(join(directory, 'readme.txt'), 'not a case');
    await assert.rejects(
      runLegacyImportCorpusDirectory(directory),
      /contains no \.json files/u
    );
  });

  it('compares bounded semantic JSON baselines and reports only aggregate digests on drift', async () => {
    const report = await buildLegacyImportCorpusReport([
      encoder.encode(JSON.stringify(payload())),
    ]);
    const reordered = JSON.stringify({
      cases: report.cases,
      summary: report.summary,
      limits: report.limits,
      targetSerialization: report.targetSerialization,
      targetProfile: report.targetProfile,
      conversionReportFormat: report.conversionReportFormat,
      format: report.format,
    });

    assert.doesNotThrow(() =>
      assertLegacyImportCorpusBaseline(report, reordered)
    );
    const drifted = JSON.stringify({
      ...report,
      summary: { ...report.summary, caseCount: 2 },
    });
    assert.throws(
      () => assertLegacyImportCorpusBaseline(report, drifted),
      /drifted \(expected [0-9a-f]{64}, actual [0-9a-f]{64}\)/u
    );
    assert.throws(
      () => assertLegacyImportCorpusBaseline(report, '{}'),
      /wrong format/u
    );
    assert.throws(
      () => assertLegacyImportCorpusBaseline(report, '{'),
      /not valid JSON/u
    );

    const directory = await temporaryDirectory();
    const baseline = join(directory, 'baseline.json');
    await writeFile(baseline, reordered);
    assert.equal(await readLegacyImportCorpusBaseline(baseline), reordered);
    await assert.rejects(
      readLegacyImportCorpusBaseline(baseline, reordered.length - 1),
      /cannot exceed/u
    );
    const linked = join(directory, 'linked-baseline.json');
    await symlink(baseline, linked);
    await assert.rejects(
      readLegacyImportCorpusBaseline(linked),
      /cannot be a symbolic link/u
    );
  });

  it('requires explicit, non-duplicated CLI paths', () => {
    assert.deepEqual(
      parseLegacyImportCorpusArguments([
        '--input',
        '/private/corpus',
        '--expect',
        '/reviewed/report.json',
      ]),
      {
        input: '/private/corpus',
        expect: '/reviewed/report.json',
      }
    );
    assert.deepEqual(
      parseLegacyImportCorpusArguments(['--', '--input', '/private/corpus']),
      { input: '/private/corpus' }
    );
    assert.throws(
      () => parseLegacyImportCorpusArguments([]),
      /--input is required/u
    );
    assert.throws(
      () =>
        parseLegacyImportCorpusArguments(['--input', 'one', '--input', 'two']),
      /--input may be provided once/u
    );
    assert.throws(
      () => parseLegacyImportCorpusArguments(['--input', 'one', '--write']),
      /Unknown argument/u
    );
  });

  it('allows only ignored private in-repository input and external baselines', async () => {
    const repository = await temporaryDirectory();
    const outside = await temporaryDirectory();

    assert.doesNotThrow(() =>
      assertLegacyImportCorpusPrivateLocation(outside, repository)
    );
    assert.doesNotThrow(() =>
      assertLegacyImportCorpusPrivateLocation(
        join(repository, '.private', 'legacy-import-corpus', 'reviewed'),
        repository
      )
    );
    assert.throws(
      () =>
        assertLegacyImportCorpusPrivateLocation(
          join(repository, 'tests', 'raw-user-saves'),
          repository
        ),
      /must be under \.private\/legacy-import-corpus/u
    );
    assert.throws(
      () =>
        assertLegacyImportCorpusBaselineOutsideInput(
          join(outside, 'expected.json'),
          outside
        ),
      /must be outside the input directory/u
    );
  });

  it('runs the CLI without exposing private paths and verifies a reviewed baseline', async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, 'private-account-name.json'),
      JSON.stringify(payload())
    );
    const executable = resolve('node_modules/.bin/tsx');
    const script = resolve('scripts/check-legacy-import-corpus.ts');
    const generated = await execFileAsync(
      executable,
      [script, '--', '--input', directory],
      { encoding: 'utf8' }
    );

    assert.equal(generated.stderr, '');
    assert.equal(generated.stdout.includes('private-account-name'), false);
    const report = JSON.parse(generated.stdout) as LegacyImportCorpusReport;
    assert.equal(report.summary.convertedCaseCount, 1);

    const baselineDirectory = await temporaryDirectory();
    const baseline = join(baselineDirectory, 'approved-report.json');
    await writeFile(baseline, generated.stdout);
    const checked = await execFileAsync(
      executable,
      [script, '--input', directory, '--expect', baseline],
      { encoding: 'utf8' }
    );
    assert.equal(checked.stderr, '');
    assert.equal(
      checked.stdout,
      'Legacy import corpus report passed (1 cases, 1 converted).\n'
    );
  });
});
