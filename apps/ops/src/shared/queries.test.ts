import { ANALYTICS_LAYOUT } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import {
  isoDate,
  seriesStart,
  sqlTime,
  startOfUtcDay,
  VIEW_IDS,
  viewQueries,
  type SourceQuery,
} from './queries.js';
import { RANGE_DAYS, SITE, SITE_ENVIRONMENTS } from './site.js';

const config = { accountId: 'account-0000', zoneId: 'zone-0000' };
const NOW = Date.parse('2026-11-11T15:30:00Z');

const all = () =>
  VIEW_IDS.flatMap((view) =>
    SITE_ENVIRONMENTS.flatMap((env) =>
      RANGE_DAYS.map((days) => ({
        view,
        env,
        days,
        queries: viewQueries({ view, env, days, now: NOW }, config),
      }))
    )
  );

describe('view queries', () => {
  it('reads each environment from its own dataset only', () => {
    for (const { env, view, queries } of all()) {
      for (const [name, query] of Object.entries(queries)) {
        if (query.kind !== 'ae') continue;
        const tables = [...query.sql.matchAll(/\bFROM\s+(\w+)/gu)].map(
          (match) => match[1]
        );
        expect(tables, `${view}/${name}`).toHaveLength(1);
        // The Live view also counts the other dataset's rows for the shared
        // allowance; the Budget view counts both.
        if (
          name === 'otherEventsToday' ||
          name === 'previewEvents' ||
          name === 'betaEvents'
        )
          continue;
        expect(tables[0], `${view}/${name}`).toBe(SITE[env].dataset);
      }
    }
  });

  it('names only columns Analytics Engine has, and no more than the layout fills', () => {
    const maxBlob =
      4 +
      Math.max(
        ...Object.values(ANALYTICS_LAYOUT).map((layout) => layout.blobs.length)
      );
    const maxDouble =
      1 +
      Math.max(
        ...Object.values(ANALYTICS_LAYOUT).map(
          (layout) => layout.doubles.length
        )
      );
    for (const { view, queries } of all()) {
      for (const [name, query] of Object.entries(queries)) {
        if (query.kind !== 'ae') continue;
        for (const [, kind, index] of query.sql.matchAll(
          /\b(blob|double)(\d+)\b/gu
        )) {
          expect(Number(index), `${view}/${name}`).toBeLessThanOrEqual(
            kind === 'blob' ? maxBlob : maxDouble
          );
          expect(Number(index), `${view}/${name}`).toBeGreaterThanOrEqual(1);
        }
        // Every count stands on the sample interval, never on raw rows,
        // except the dataset's own row counts and the latest events listed.
        const listed = /^SELECT timestamp,/u.test(query.sql);
        if (!/count\(\)/u.test(query.sql) && !listed)
          expect(query.sql, `${view}/${name}`).toMatch(/_sample_interval/u);
        // Bounded in time: a lower time bound on every read.
        expect(query.sql, `${view}/${name}`).toMatch(
          /timestamp >= toDateTime\('\d{4}-\d\d-\d\d \d\d:\d\d:\d\d'\)/u
        );
        expect(query.sql, `${view}/${name}`).not.toMatch(/;/u);
      }
    }
  });

  it("types every branch as Analytics Engine's strict SQL requires", () => {
    // Found against the real API: both branches of `if` must be one type
    // (a double column or a weighted move needs 0.0, not 0), a condition
    // can't be a bare 1, and a list compared with a double needs decimals.
    for (const { view, queries } of all()) {
      for (const [name, query] of Object.entries(queries)) {
        if (query.kind !== 'ae') continue;
        expect(query.sql, `${view}/${name}`).not.toMatch(/\bif\(1,/u);
        expect(query.sql, `${view}/${name}`).not.toMatch(/double\d+, 0\)/u);
        expect(query.sql, `${view}/${name}`).not.toMatch(/NOT IN \(\d+[,)]/u);
        expect(query.sql, `${view}/${name}`).not.toMatch(
          /_sample_interval \* double1, 0\)/u
        );
      }
    }
  });

  it("keeps GraphQL's windows within its 31 days and its lookback", () => {
    for (const { view, days, queries } of all()) {
      for (const [name, query] of Object.entries(queries)) {
        if (query.kind !== 'graphql') continue;
        const variables = query.variables as Record<string, unknown>;
        expect(variables.accountTag).toBe(config.accountId);
        for (const key of Object.keys(variables).filter((key) =>
          /^from\d*$/u.test(key)
        )) {
          const suffix = key.slice(4);
          const from = Date.parse(String(variables[key]));
          const to = Date.parse(String(variables[`to${suffix}`]));
          expect(to - from, `${view}/${name} ${key}`).toBeLessThanOrEqual(
            31 * 86_400_000
          );
          expect(NOW - from, `${view}/${name} ${key}`).toBeLessThanOrEqual(
            91 * 86_400_000
          );
          expect(to, `${view}/${name}`).toBeLessThanOrEqual(NOW);
        }
        void days;
      }
    }
  });

  it('covers the whole range, and the week before for the headline', () => {
    expect(isoDate(seriesStart(NOW, 7))).toBe('2026-10-29');
    expect(isoDate(seriesStart(NOW, 30))).toBe('2026-10-13');
    expect(isoDate(seriesStart(NOW, 90))).toBe('2026-08-14');
    const overview = viewQueries(
      { view: 'overview', env: 'beta', days: 90, now: NOW },
      config
    );
    const worker = overview.worker as Extract<SourceQuery, { kind: 'graphql' }>;
    const windows = Object.keys(worker.variables).filter((key) =>
      /^from\d+$/u.test(key)
    );
    expect(windows).toHaveLength(3);
    expect(worker.variables.from0).toBe('2026-08-14');
    expect(worker.variables.to2).toBe('2026-11-11');
  });

  it('asks the zone only about the beta, the host it serves', () => {
    expect(
      viewQueries({ view: 'overview', env: 'beta', days: 30, now: NOW }, config)
        .zone
    ).toBeDefined();
    expect(
      viewQueries(
        { view: 'overview', env: 'preview', days: 30, now: NOW },
        config
      ).zone
    ).toBeUndefined();
  });

  it('writes moments as Analytics Engine reads them', () => {
    expect(sqlTime(Date.parse('2026-01-02T03:04:05.678Z'))).toBe(
      '2026-01-02 03:04:05'
    );
    expect(isoDate(startOfUtcDay(NOW))).toBe('2026-11-11');
    expect(startOfUtcDay(NOW) % 86_400_000).toBe(0);
  });
});
