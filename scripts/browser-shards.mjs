import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Runs one CI shard of the Chromium browser suite, split by how long each
 * spec file took last (tests/browser/durations.json) rather than by test
 * count, which Playwright's own `--shard` uses. Each file goes, slowest
 * first, to the shard with the least time so far; a file with no recorded
 * time counts as the median one.
 *
 *   node scripts/browser-shards.mjs 2/8
 *
 * Refresh the times from a CI run's shard artifacts (`gh run download`)
 * with
 *
 *   node scripts/browser-shards.mjs record playwright-*\/test-results/results.json
 */

export const DURATIONS = 'tests/browser/durations.json';

const pnpm = (args, options) =>
  spawnSync('corepack', ['pnpm', ...args], options);

/** Each shard's files (sorted) and their recorded seconds. */
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

/** Seconds per spec file in Playwright JSON reports, each test's last try. */
export const recordedSeconds = (reports) => {
  const seconds = {};
  const walk = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1);
        if (last)
          seconds[spec.file] = (seconds[spec.file] ?? 0) + last.duration / 1000;
      }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const report of reports)
    for (const suite of report.suites ?? []) walk(suite);
  return Object.fromEntries(
    Object.entries(seconds)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, value]) => [file, Math.round(value)])
  );
};

const runShard = (which) => {
  const { index, count } = parseShard(which);
  const listing = pnpm(
    [
      'exec',
      'playwright',
      'test',
      '--list',
      '--project=chromium',
      '--reporter=json',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (listing.status !== 0) {
    process.stderr.write(listing.stderr);
    throw new Error('Listing the browser suite failed');
  }
  const { testDir, files } = listedFiles(JSON.parse(listing.stdout));
  const { seconds } = JSON.parse(readFileSync(DURATIONS, 'utf8'));
  const shard = planShards(files, count, seconds)[index];
  process.stderr.write(
    `Shard ${index + 1}/${count}: ${shard.files.length} files, about ${Math.round(shard.seconds / 60)} min\n`
  );
  const run = pnpm(
    [
      'exec',
      'playwright',
      'test',
      '--project=chromium',
      ...shard.files.map((file) =>
        relative(process.cwd(), join(testDir, file))
      ),
    ],
    { stdio: 'inherit' }
  );
  process.exitCode = run.status ?? 1;
};

const record = (paths) => {
  const reports = paths.map((path) => JSON.parse(readFileSync(path, 'utf8')));
  const seconds = Object.fromEntries(
    Object.entries(recordedSeconds(reports)).filter(([file]) =>
      existsSync(join('tests/browser', file))
    )
  );
  writeFileSync(DURATIONS, `${JSON.stringify({ seconds }, null, 2)}\n`);
  process.stderr.write(`${Object.keys(seconds).length} files recorded\n`);
};

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    if (command === 'record') record(rest);
    else runShard(command);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
