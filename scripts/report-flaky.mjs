import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Lists the tests that failed and then passed on CI's one retry, from
 * Playwright JSON reports, so a flaky test never hides behind a green run:
 * each becomes a warning on the run and a line in its summary.
 *
 *   node scripts/report-flaky.mjs playwright-report/results.json ...
 */

/** "file › title" of every flaky test in a Playwright JSON report. */
export const flakyTests = (report) => {
  const found = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== 'flaky') continue;
        const failure = (test.results ?? []).find(
          (result) => result.status !== 'passed'
        );
        found.push({
          file: spec.file ?? suite.file,
          line: spec.line,
          title: [...titles, spec.title].filter(Boolean).join(' › '),
          error: failure?.error?.message?.split('\n')[0] ?? '',
        });
      }
    }
    for (const child of suite.suites ?? [])
      walk(child, child.title ? [...titles, child.title] : titles);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return found;
};

const strip = (text) =>
  // eslint-disable-next-line no-control-regex
  text.replace(/\u001b\[[0-9;]*m/gu, '');

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const flaky = process.argv
    .slice(2)
    .filter((path) => existsSync(path))
    .flatMap((path) => flakyTests(JSON.parse(readFileSync(path, 'utf8'))));
  for (const test of flaky)
    process.stdout.write(
      `::warning file=tests/browser/${test.file},line=${test.line},title=Flaky test::${test.title} failed once, then passed on retry. ${strip(test.error)}\n`
    );
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary && flaky.length > 0) {
    const lines = [
      `### ${flaky.length} flaky test${flaky.length === 1 ? '' : 's'}`,
      '',
      'Failed once, then passed on the retry. Worth fixing:',
      '',
      ...flaky.map(
        (test) =>
          `- \`${test.file}:${test.line}\` ${test.title}${test.error ? ` — ${strip(test.error)}` : ''}`
      ),
      '',
    ];
    appendFileSync(summary, `${lines.join('\n')}\n`);
  }
}
