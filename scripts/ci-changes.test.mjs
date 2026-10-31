import assert from 'node:assert/strict';
import test from 'node:test';

import { changedFiles, ciPassedOn, jobsFor } from './ci-changes.mjs';

test('documentation alone needs no browser run', () => {
  assert.deepEqual(jobsFor(['docs/v2-rebuild/ADR-030.md', 'README.md']), {
    browser: false,
    evidence: false,
  });
});

test('app code runs the browser suites, board code the evidence specs too', () => {
  assert.deepEqual(jobsFor(['apps/web/src/features/deck/Panel.tsx']), {
    browser: true,
    evidence: false,
  });
  assert.deepEqual(jobsFor(['packages/game-core/src/decide-command.ts']), {
    browser: true,
    evidence: false,
  });
  for (const file of [
    'packages/renderer-dom/src/BoardSurface.tsx',
    'apps/web/src/session/shell/dock-slide.ts',
    'tests/browser/remote-room-solo-renderer-churn.spec.ts',
    '.github/workflows/ci.yml',
    'pnpm-lock.yaml',
  ])
    assert.deepEqual(jobsFor([file]), { browser: true, evidence: true }, file);
});

test('with nothing to compare against, everything runs', () => {
  assert.deepEqual(jobsFor(null), { browser: true, evidence: true });
  assert.equal(changedFiles('', 'abc'), null);
  assert.equal(
    changedFiles('0000000000000000000000000000000000000000', 'abc'),
    null
  );
  const unknown = () => {
    throw new Error('bad object');
  };
  assert.equal(changedFiles('abc', 'def', unknown), null);
  assert.deepEqual(
    changedFiles('abc', 'def', () => 'a.ts\nb/c.md\n\n'),
    ['a.ts', 'b/c.md']
  );
});

test('only a head CI passed on vouches for what a later push skips', () => {
  const runs = (conclusions) => () => JSON.stringify(conclusions);
  assert.equal(ciPassedOn('abc', 'o/r', runs(['success'])), true);
  // Cancelled by the next push, failed, or still running: everything runs.
  assert.equal(ciPassedOn('abc', 'o/r', runs(['cancelled'])), false);
  assert.equal(ciPassedOn('abc', 'o/r', runs(['failure'])), false);
  assert.equal(ciPassedOn('abc', 'o/r', runs([null])), false);
  assert.equal(ciPassedOn('abc', 'o/r', runs([])), false);
  // A rerun that passed counts.
  assert.equal(ciPassedOn('abc', 'o/r', runs(['failure', 'success'])), true);
  // Nothing to ask, or no answer.
  assert.equal(ciPassedOn('', 'o/r', runs(['success'])), false);
  assert.equal(ciPassedOn('abc', '', runs(['success'])), false);
  assert.equal(
    ciPassedOn('abc', 'o/r', () => {
      throw new Error('no gh');
    }),
    false
  );
});
