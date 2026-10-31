import assert from 'node:assert/strict';
import test from 'node:test';

import { flakyTests } from './report-flaky.mjs';

test('finds the tests that passed only on their retry, with where and why', () => {
  const report = {
    suites: [
      {
        file: 'board.spec.ts',
        title: 'board.spec.ts',
        specs: [
          {
            file: 'board.spec.ts',
            line: 12,
            title: 'steady',
            tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
          },
        ],
        suites: [
          {
            title: 'flat table',
            specs: [
              {
                file: 'board.spec.ts',
                line: 40,
                title: 'drags',
                tests: [
                  {
                    status: 'flaky',
                    results: [
                      {
                        status: 'failed',
                        error: { message: 'Timed out\nmore detail' },
                      },
                      { status: 'passed' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  assert.deepEqual(flakyTests(report), [
    {
      file: 'board.spec.ts',
      line: 40,
      title: 'flat table › drags',
      error: 'Timed out',
    },
  ]);
  assert.deepEqual(flakyTests({ suites: [] }), []);
});
