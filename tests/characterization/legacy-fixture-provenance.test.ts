import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtureRoot = 'tests/legacy-fixtures';

interface ProvenanceEntry {
  readonly path: string;
  readonly encoding?: string;
  readonly sha256: string;
}

interface ProvenanceClaim {
  readonly claim: string;
  readonly sources: readonly string[];
}

interface Fixture {
  readonly provenance?: readonly ProvenanceEntry[];
  readonly provenanceClaims?: readonly ProvenanceClaim[];
  /** Digests of other fixtures this one was derived from. */
  readonly dependencies?: readonly ProvenanceEntry[];
}

const fixtureFiles = async (): Promise<readonly string[]> => {
  const found: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(`${repositoryRoot}${relative}`, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(next);
      } else if (entry.name.endsWith('.json')) {
        found.push(next);
      }
    }
  };
  await walk(fixtureRoot);
  return found.sort();
};

const digestOf = async (entry: ProvenanceEntry): Promise<string> => {
  const source = await readFile(`${repositoryRoot}${entry.path}`);
  // Text sources are hashed with newlines normalised so a checkout on another
  // platform does not read as tampering.
  const input =
    entry.encoding === 'utf8'
      ? source.toString('utf8').replaceAll('\r\n', '\n')
      : source;
  return createHash('sha256').update(input).digest('hex');
};

/**
 * Every legacy fixture claims, by digest, the v1 sources it was recorded from.
 * That claim is what lets a recorded number be trusted at all: if the client
 * changes and a fixture still describes the old behaviour, every gate over it
 * goes on passing while describing something that no longer exists.
 *
 * The individual browser specs already check their own fixture's digests, but
 * they do it from inside the Playwright lane even though nothing here needs a
 * browser -- and a fixture whose spec simply forgets is checked by nobody. This
 * covers all of them in the fast lane, and fails if one stops being covered.
 */
describe('legacy fixture provenance', () => {
  it('records provenance for every recorded renderer fixture', async () => {
    const files = await fixtureFiles();
    expect(files.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const file of files) {
      // `saves/` holds exported v1 action logs -- sample input played back
      // through the runtime, not a recording that describes how the client
      // behaves. There is no source for such a file to claim authorship of.
      if (!file.startsWith(`${fixtureRoot}/renderer/`)) continue;
      const fixture = JSON.parse(
        await readFile(`${repositoryRoot}${file}`, 'utf8')
      ) as Fixture;
      if (!fixture.provenance || fixture.provenance.length === 0) {
        missing.push(file);
      }
    }
    expect(missing, 'fixtures with no provenance record').toEqual([]);
  });

  it('matches every claimed digest against the checked-in source', async () => {
    const files = await fixtureFiles();
    const mismatches: string[] = [];
    for (const file of files) {
      const fixture = JSON.parse(
        await readFile(`${repositoryRoot}${file}`, 'utf8')
      ) as Fixture;
      for (const entry of fixture.provenance ?? []) {
        const actual = await digestOf(entry).catch(
          (error: unknown) => `unreadable: ${String(error)}`
        );
        if (actual !== entry.sha256) {
          mismatches.push(`${file} -> ${entry.path}`);
        }
      }
    }
    expect(mismatches, 'fixtures describing a source that has changed').toEqual(
      []
    );
  });

  /**
   * A fixture derived from another pins that one by digest too. Those entries
   * are always text, and they point at fixtures rather than client sources, so
   * a stale one means a fixture is describing a baseline that has since moved.
   */
  it('matches every claimed dependency digest against the checked-in fixture', async () => {
    const files = await fixtureFiles();
    const mismatches: string[] = [];
    let checked = 0;
    for (const file of files) {
      const fixture = JSON.parse(
        await readFile(`${repositoryRoot}${file}`, 'utf8')
      ) as Fixture;
      for (const entry of fixture.dependencies ?? []) {
        checked += 1;
        const actual = await digestOf({ ...entry, encoding: 'utf8' }).catch(
          (error: unknown) => `unreadable: ${String(error)}`
        );
        if (actual !== entry.sha256) {
          mismatches.push(`${file} -> ${entry.path}`);
        }
      }
    }
    expect(mismatches, 'fixtures deriving from a baseline that moved').toEqual(
      []
    );
    // Guards against the loop silently covering nothing if the field is renamed.
    expect(checked, 'dependency entries checked').toBeGreaterThan(0);
  });

  it('keeps each fixture claim set and digest set in agreement', async () => {
    const files = await fixtureFiles();
    const problems: string[] = [];
    for (const file of files) {
      const fixture = JSON.parse(
        await readFile(`${repositoryRoot}${file}`, 'utf8')
      ) as Fixture;
      const paths = (fixture.provenance ?? []).map((entry) => entry.path);
      if (new Set(paths).size !== paths.length) {
        problems.push(`${file}: duplicate provenance paths`);
      }
      // A fixture that names sources in its claims but never digests them is
      // asserting authorship it has not evidenced.
      const claimed = new Set(
        (fixture.provenanceClaims ?? []).flatMap((claim) => claim.sources)
      );
      for (const source of claimed) {
        if (!paths.includes(source)) {
          problems.push(`${file}: claims ${source} without a digest`);
        }
      }
      for (const claim of fixture.provenanceClaims ?? []) {
        if (claim.sources.length === 0) {
          problems.push(`${file}: claim "${claim.claim}" cites no source`);
        }
      }
    }
    expect(problems, 'provenance claim problems').toEqual([]);
  });
});
