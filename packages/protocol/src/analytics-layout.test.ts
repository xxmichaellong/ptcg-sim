import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_ABSENT,
  ANALYTICS_LAYOUT,
  analyticsColumn,
  analyticsDataPoint,
  type AnalyticsKind,
} from './analytics-layout.js';

describe('analytics layout', () => {
  it('fits every kind in an Analytics Engine row, each field once', () => {
    for (const [kind, layout] of Object.entries(ANALYTICS_LAYOUT)) {
      // Four common strings and one common number come first.
      expect(layout.blobs.length + 4, kind).toBeLessThanOrEqual(20);
      expect(layout.doubles.length + 1, kind).toBeLessThanOrEqual(20);
      const names = [...layout.blobs, ...layout.doubles];
      expect(new Set(names).size, kind).toBe(names.length);
      expect(names, kind).not.toEqual(
        expect.arrayContaining(['kind', 'build', 'country', 'colo', 'weight'])
      );
      // The index is the kind, under the limit of 96 bytes.
      expect(kind.length).toBeLessThan(96);
    }
  });

  it('names the column each field is in', () => {
    expect(analyticsColumn('http', 'kind')).toBe('blob1');
    expect(analyticsColumn('http', 'colo')).toBe('blob4');
    expect(analyticsColumn('http', 'route')).toBe('blob5');
    expect(analyticsColumn('http', 'weight')).toBe('double1');
    expect(analyticsColumn('http', 'status')).toBe('double3');
    expect(analyticsColumn('page', 'month')).toBe('blob18');
    expect(analyticsColumn('page', 'errors')).toBe('double17');
    expect(() =>
      analyticsColumn(
        'http',
        'nothing' as Parameters<typeof analyticsColumn<'http'>>[1]
      )
    ).toThrow();
  });

  it('places fields, blanks what is missing and marks unmeasured numbers', () => {
    expect(
      analyticsDataPoint(
        'socket',
        { build: 'b', country: 'NZ' },
        { blobs: { outcome: 'closed' }, doubles: { closeCode: 1001 } }
      )
    ).toEqual({
      indexes: ['socket'],
      blobs: ['socket', 'b', 'NZ', '', 'closed'],
      doubles: [1, 1001, ANALYTICS_ABSENT],
    });
    const long = analyticsDataPoint(
      'failure',
      { build: 'x'.repeat(500) },
      { blobs: {}, doubles: { retryable: Number.NaN } },
      3
    );
    expect(long.blobs[1]).toHaveLength(160);
    expect(long.doubles).toEqual([3, ANALYTICS_ABSENT]);
  });

  it('gives every kind a full row', () => {
    for (const kind of Object.keys(ANALYTICS_LAYOUT) as AnalyticsKind[]) {
      const point = analyticsDataPoint(
        kind,
        { build: 'b' },
        { blobs: {}, doubles: {} }
      );
      expect(point.blobs).toHaveLength(4 + ANALYTICS_LAYOUT[kind].blobs.length);
      expect(point.doubles).toHaveLength(
        1 + ANALYTICS_LAYOUT[kind].doubles.length
      );
    }
  });
});
