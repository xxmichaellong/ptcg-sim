import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Decides which CI jobs a change needs, from the files it touches:
 *
 *   browser   anything but documentation: the browser suites run.
 *   evidence  board code (renderers, the table, motion, the session shell)
 *             or the CI setup itself: the long evidence specs run too (the
 *             Solo churn soak and the renderer comparison; see
 *             scripts/browser-shards.mjs).
 *
 * A pull request push is compared with the head it replaced, so a long-lived
 * branch pays for what changed now, not for everything since main -- but
 * only once CI has passed on that head: a run cancelled by this push, or
 * one that failed, vouches for nothing. When there is nothing to compare
 * with (a new pull request, a manual run, a force push, a head CI hasn't
 * passed), everything runs.
 *
 *   BEFORE=<sha> AFTER=<sha> GITHUB_REPOSITORY=<owner/repo> GH_TOKEN=<token> \
 *     node scripts/ci-changes.mjs >> "$GITHUB_OUTPUT"
 */

const DOCUMENTATION = [/^docs\//u, /\.md$/u, /^LICENSE/u];

const EVIDENCE = [
  /^packages\/renderer-(contract|dom|pixi)\//u,
  /^apps\/web\/src\/(board|motion|session|presentation|design)\//u,
  /^tests\/browser\/(remote-room-solo-renderer-churn|renderer-spike)\.spec\.ts$/u,
  /^tests\/browser\/support\//u,
  /^playwright\.config\.ts$/u,
  /^\.github\/workflows\//u,
  /^scripts\/(browser-shards|ci-changes|report-flaky)\.mjs$/u,
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/u,
];

/** What a set of changed files needs; null files means "unknown": all. */
export const jobsFor = (files) => {
  if (files === null) return { browser: true, evidence: true };
  const code = files.filter(
    (file) => !DOCUMENTATION.some((pattern) => pattern.test(file))
  );
  return {
    browser: code.length > 0,
    evidence: code.some((file) =>
      EVIDENCE.some((pattern) => pattern.test(file))
    ),
  };
};

const NO_COMMIT = /^0+$/u;

/** The files changed from `before` to `after`, or null when unknown. */
export const changedFiles = (before, after, git = execFileSync) => {
  if (!before || !after || NO_COMMIT.test(before)) return null;
  try {
    return git('git', ['diff', '--name-only', before, after], {
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
};

/**
 * Whether this workflow passed on a commit: only then may a later push
 * skip what that run checked.
 */
export const ciPassedOn = (sha, repository, run = execFileSync) => {
  if (!sha || !repository || NO_COMMIT.test(sha)) return false;
  try {
    const conclusions = JSON.parse(
      run(
        'gh',
        [
          'api',
          `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=20`,
          '--jq',
          '[.workflow_runs[].conclusion]',
        ],
        { encoding: 'utf8' }
      )
    );
    return Array.isArray(conclusions) && conclusions.includes('success');
  } catch {
    return false;
  }
};

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const { BEFORE, AFTER, GITHUB_REPOSITORY } = process.env;
  const vouched = ciPassedOn(BEFORE, GITHUB_REPOSITORY);
  const files = vouched ? changedFiles(BEFORE, AFTER) : null;
  const jobs = jobsFor(files);
  process.stderr.write(
    files === null
      ? 'No earlier head that passed CI to compare with: everything runs.\n'
      : `${files.length} files changed: browser=${jobs.browser}, evidence=${jobs.evidence}\n`
  );
  process.stdout.write(`browser=${jobs.browser}\nevidence=${jobs.evidence}\n`);
}
