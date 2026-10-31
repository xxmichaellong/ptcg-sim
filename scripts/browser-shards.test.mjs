import assert from 'node:assert/strict';
import test from 'node:test';

import { listedFiles, parseShard, planShards } from './browser-shards.mjs';

test('balances shards by recorded time, slowest file first, onto shard 1', () => {
  const seconds = { 'soak.spec.ts': 540, 'a.spec.ts': 200, 'b.spec.ts': 180 };
  const files = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'soak.spec.ts'];
  const shards = planShards(files, 2, seconds);
  assert.deepEqual(shards[0].files, ['soak.spec.ts']);
  // c has no recorded time and counts as the median (200s).
  assert.deepEqual(shards[1].files, ['a.spec.ts', 'b.spec.ts', 'c.spec.ts']);
  assert.deepEqual(
    shards.map((shard) => shard.seconds),
    [540, 580]
  );
});

test('runs every listed file exactly once, whatever the times', () => {
  const files = Array.from({ length: 23 }, (_, index) => `f${index}.spec.ts`);
  const seconds = Object.fromEntries(
    files.slice(0, 15).map((file, index) => [file, (index * 37) % 90])
  );
  const shards = planShards(files, 4, seconds);
  assert.deepEqual(
    shards.flatMap((shard) => shard.files).sort(),
    [...files].sort()
  );
  assert.ok(shards.every((shard) => shard.files.length > 0));
});

test('refuses a shard that would be empty, which would run the whole suite', () => {
  assert.throws(() => planShards(['a.spec.ts'], 2, {}), /cannot fill 2 shards/);
});

test('reads a shard and the files of a Playwright listing', () => {
  assert.deepEqual(parseShard('2/4'), { index: 1, count: 4 });
  assert.throws(() => parseShard('5/4'), /like 2\/4/);
  assert.throws(() => parseShard('0/4'), /like 2\/4/);
  assert.deepEqual(
    listedFiles({
      config: { projects: [{ testDir: '/repo/tests/browser' }] },
      suites: [{ file: 'b.spec.ts' }, { file: 'a.spec.ts' }],
    }),
    { testDir: '/repo/tests/browser', files: ['a.spec.ts', 'b.spec.ts'] }
  );
});
