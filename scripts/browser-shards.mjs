import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Splits the Chromium browser suite across CI runners by how long each spec
 * file takes. Playwright's own `--shard` counts tests, and this suite's
 * ~150 quick legacy oracle tests sort before its slow live-table specs, so
 * count-based shards run anywhere from 1 to 10 minutes. Here each file goes,
 * slowest first, to the shard with the least time so far; a file with no
 * recorded time counts as the median one.
 *
 *   playwright test --list --project=chromium --reporter=json \
 *     | node scripts/browser-shards.mjs 2/4
 *
 * prints shard 2's spec files, one per line. The recorded times
 * (tests/browser/durations.json) only steer the balance: every file the
 * listing has runs on exactly one shard.
 *
 * The evidence specs (EVIDENCE_SPECS: the Solo churn soak and the renderer
 * comparison, a third of the suite's time) are left out of the shards and
 * run in their own CI job, only when board code changed;
 *
 *   playwright test --list --project=chromium --reporter=json \
 *     | node scripts/browser-shards.mjs evidence
 *
 * prints them.
 */

export const DURATIONS = 'tests/browser/durations.json';

/** Long evidence runs, kept off the per-push shards (see the CI workflow). */
export const EVIDENCE_SPECS = Object.freeze([
  'remote-room-solo-renderer-churn.spec.ts',
  'renderer-spike.spec.ts',
]);

/** Whether a listed spec file is one of the evidence specs. */
export const isEvidenceSpec = (file) =>
  EVIDENCE_SPECS.includes(file.split('/').at(-1));

/** Each shard's files (sorted) and their recorded seconds, slowest first in. */
export const planShards = (files, count, seconds) => {
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`Shard count must be a positive integer, not ${count}`);
  if (files.length < count)
    throw new Error(`${files.length} spec files cannot fill ${count} shards`);
  const known = files
    .map((file) => seconds[file])
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const fallback = known.length > 0 ? known[Math.floor(known.length / 2)] : 1;
  const time = (file) => seconds[file] ?? fallback;
  const shards = Array.from({ length: count }, () => ({
    seconds: 0,
    files: [],
  }));
  const slowestFirst = [...files].sort(
    (left, right) => time(right) - time(left) || left.localeCompare(right)
  );
  for (const file of slowestFirst) {
    const lightest = shards.reduce((best, shard) =>
      shard.seconds < best.seconds ? shard : best
    );
    lightest.files.push(file);
    lightest.seconds += time(file);
  }
  for (const shard of shards) shard.files.sort();
  return shards;
};

/** `2/4` as { index: 1, count: 4 }. */
export const parseShard = (value) => {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? '');
  const current = match ? Number(match[1]) : NaN;
  const count = match ? Number(match[2]) : NaN;
  if (!(current >= 1 && current <= count))
    throw new Error(`Expected a shard like 2/4, not ${value}`);
  return { index: current - 1, count };
};

/** The spec files of a `playwright test --list --reporter=json` report. */
export const listedFiles = (report) => {
  const testDir = report.config?.projects?.[0]?.testDir;
  if (typeof testDir !== 'string')
    throw new Error('The listing names no project test directory');
  return {
    testDir,
    files: [...new Set(report.suites.map((suite) => suite.file))].sort(),
  };
};

/** Prints this run's shard (`2/8`) of the non-evidence spec files. */
const printShard = (testDir, files, which) => {
  const { index, count } = parseShard(which);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { seconds } = JSON.parse(
    readFileSync(join(repoRoot, DURATIONS), 'utf8')
  );
  const shard = planShards(
    files.filter((file) => !isEvidenceSpec(file)),
    count,
    seconds
  )[index];
  process.stderr.write(
    `Shard ${index + 1}/${count}: ${shard.files.length} files, about ${Math.round(shard.seconds / 60)} min\n`
  );
  for (const file of shard.files)
    process.stdout.write(`${relative(process.cwd(), join(testDir, file))}\n`);
};

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    const { testDir, files } = listedFiles(JSON.parse(readFileSync(0, 'utf8')));
    if (process.argv[2] === 'evidence') {
      for (const file of files.filter(isEvidenceSpec))
        process.stdout.write(
          `${relative(process.cwd(), join(testDir, file))}\n`
        );
    } else {
      printShard(testDir, files, process.argv[2]);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
