import type { ReactNode } from 'react';

import { percent } from '../format.js';
import { SERIES_COLORS, useWidth } from './scale.js';

/** A stat tile's trend: one line, no axes, the last point marked. */
export const Sparkline = ({
  values,
  height = 34,
  color = 'var(--series-1)',
  label,
}: {
  readonly values: readonly (number | null)[];
  readonly height?: number;
  readonly color?: string;
  readonly label: string;
}) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const present = values.filter((value): value is number => value !== null);
  const minimum = Math.min(...present);
  const maximum = Math.max(...present);
  const span = maximum - minimum || 1;
  const x = (index: number) => 3 + (values.length <= 1 ? 0 : (index / (values.length - 1)) * (width - 6));
  const y = (value: number) => 3 + (height - 6) * (1 - (value - minimum) / span);
  let d = '';
  let open = false;
  values.forEach((value, index) => {
    if (value === null) {
      open = false;
      return;
    }
    d += `${open ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    open = true;
  });
  const lastIndex = values.length - 1;
  const last = values[lastIndex];
  return (
    <div ref={ref} style={{ height, marginTop: 8 }} role="img" aria-label={label}>
      {width > 0 && present.length > 1 && (
        <svg width={width} height={height} aria-hidden="true">
          <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
          {last !== null && last !== undefined && (
            <circle cx={x(lastIndex)} cy={y(last)} r={3} fill="var(--card)" stroke={color} strokeWidth={1.6} />
          )}
        </svg>
      )}
    </div>
  );
};

export interface RankedRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly share?: number;
  /** A second measure for the row (time to table, say). */
  readonly extra?: string;
}

/** Parts compared: one bar each, largest first, one hue. */
export const RankedBars = ({
  rows,
  format,
  valueHeading,
  extraHeading,
  color = SERIES_COLORS[0],
  labelHeading = '',
  limit = 8,
}: {
  readonly rows: readonly RankedRow[];
  readonly format: (value: number) => string;
  readonly valueHeading: string;
  readonly extraHeading?: string;
  readonly color?: string;
  readonly labelHeading?: string;
  readonly limit?: number;
}) => {
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit);
  const other = rest.reduce((total, row) => total + row.value, 0);
  const all: readonly RankedRow[] =
    other > 0
      ? [
          ...shown,
          {
            key: '__other',
            label: `Other (${String(rest.length)})`,
            value: other,
            share: rest.reduce((total, row) => total + (row.share ?? 0), 0),
          },
        ]
      : shown;
  const maximum = Math.max(1, ...all.map((row) => row.value));
  return (
    <div className={`ranked${extraHeading ? ' ranked--extra' : ''}`}>
      <div className="ranked__head">
        <span>{labelHeading}</span>
        <span />
        <span>{valueHeading}</span>
        <span>Share</span>
        {extraHeading && <span>{extraHeading}</span>}
      </div>
      {all.map((row) => (
        <div key={row.key} className="ranked__row">
          <span className="ranked__label" title={row.label}>
            {row.label}
          </span>
          <span className="ranked__track" aria-hidden="true">
            <i
              className="ranked__bar"
              style={{
                width: `${String((row.value / maximum) * 100)}%`,
                background: row.key === '__other' ? 'var(--deemph)' : color,
              }}
            />
          </span>
          <span className="ranked__num">{format(row.value)}</span>
          <span className="ranked__share">{row.share === undefined ? '' : percent(row.share)}</span>
          {extraHeading && <span className="ranked__extra">{row.extra ?? '—'}</span>}
        </div>
      ))}
    </div>
  );
};

/** One whole in parts, at a glance (at most six). */
export const SegmentedBar = ({
  parts,
  tall = false,
}: {
  readonly parts: readonly { readonly key: string; readonly label: string; readonly value: number }[];
  readonly tall?: boolean;
}) => {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (total <= 0) return null;
  return (
    <>
      <div
        className={`segbar${tall ? ' segbar--tall' : ''}`}
        role="img"
        aria-label={parts.map((part) => `${part.label} ${percent(part.value / total)}`).join(', ')}
      >
        {parts.map((part, index) =>
          part.value > 0 ? (
            <i
              key={part.key}
              title={`${part.label}: ${percent(part.value / total)}`}
              style={{ flex: part.value, background: SERIES_COLORS[index] ?? 'var(--deemph)' }}
            >
              {tall && part.value / total > 0.12 ? percent(part.value / total) : null}
            </i>
          ) : null
        )}
      </div>
      <div className="legend">
        {parts.map((part, index) => (
          <span key={part.key}>
            <i style={{ background: SERIES_COLORS[index] ?? 'var(--deemph)' }} />
            {part.label}
          </span>
        ))}
      </div>
    </>
  );
};

export const Legend = ({
  items,
  line = false,
}: {
  readonly items: readonly { readonly id: string; readonly label: string; readonly color?: string }[];
  readonly line?: boolean;
}) =>
  items.length < 2 ? null : (
    <div className="legend">
      {items.map((item, index) => (
        <span key={item.id}>
          <i
            className={line ? 'legend__line' : undefined}
            style={{ background: item.color ?? SERIES_COLORS[index] ?? SERIES_COLORS[0] }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );

export const Empty = ({ height, children }: { readonly height: number; readonly children: ReactNode }) => (
  <div className="empty" style={{ height }}>
    <div>{children}</div>
  </div>
);
