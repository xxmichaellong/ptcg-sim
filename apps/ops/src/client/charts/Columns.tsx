import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';

import type { Unit } from '../shape/overview.js';
import {
  axisFormat,
  nearestIndex,
  niceTicks,
  SERIES_COLORS,
  tickIndexes,
  useWidth,
  valueFormat,
} from './scale.js';

/**
 * A count a day, stacked by kind: thin columns (24px at most) on one
 * baseline, a 2px gap between parts, the top rounded. Today's column is
 * still filling, so it is drawn as an outline. Each column is its own hit
 * target: its tooltip lists every part and the total.
 */

export interface ColumnSeries {
  readonly id: string;
  readonly label: string;
  readonly values: readonly (number | null)[];
  readonly color?: string;
}

export interface ColumnsProps {
  readonly labels: readonly string[];
  readonly series: readonly ColumnSeries[];
  readonly unit: Unit;
  readonly height?: number;
  readonly formatLabel?: (label: string) => string;
  readonly tooltipTitle?: (label: string, index: number) => string;
  readonly partialLast?: boolean;
  readonly limit?: { readonly value: number; readonly label: string };
  readonly markers?: readonly { readonly index: number; readonly label: string }[];
  readonly label: string;
}

const MARGIN = { top: 10, right: 14, bottom: 24, left: 46 };
const GAP = 2;

/** A column part: square at the bottom, rounded on top when it is the top. */
const segment = (x: number, y: number, width: number, height: number, round: boolean): string => {
  if (height <= 0) return '';
  const r = round ? Math.min(4, width / 2, height) : 0;
  return `M${x},${y + height}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + width - r}${r ? `Q${x + width},${y} ${x + width},${y + r}` : ''}V${y + height}Z`;
};

export const Columns = ({
  labels,
  series,
  unit,
  height = 200,
  formatLabel = (label) => label,
  tooltipTitle,
  partialLast = false,
  limit,
  markers = [],
  label,
}: ColumnsProps) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | undefined>();
  const tipId = useId();
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(10, height - MARGIN.top - MARGIN.bottom);
  const totals = labels.map((_, index) =>
    series.reduce((total, item) => total + (item.values[index] ?? 0), 0)
  );
  const { ticks, top } = niceTicks(Math.max(0, ...totals, limit?.value ?? 0));
  const format = axisFormat(unit, top);
  const tooltipValue = valueFormat(unit);
  const band = labels.length > 0 ? plotWidth / labels.length : plotWidth;
  const barWidth = Math.max(2, Math.min(24, band * 0.62));
  const y = (value: number) => MARGIN.top + plotHeight - (top > 0 ? (value / top) * plotHeight : 0);
  const centre = (index: number) => MARGIN.left + band * index + band / 2;
  const colored = series.map((item, index) => ({
    ...item,
    color: item.color ?? SERIES_COLORS[index] ?? SERIES_COLORS[0],
  }));
  const last = labels.length - 1;
  const xTicks = tickIndexes(labels.length, plotWidth, 64);

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setActive(nearestIndex(event.clientX - box.left, MARGIN.left, plotWidth, labels.length, true));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setActive((current) => Math.min(last, Math.max(0, (current ?? last) + (event.key === 'ArrowLeft' ? -1 : 1))));
    } else if (event.key === 'Escape') setActive(undefined);
  };
  const tipLeft = active === undefined ? 0 : centre(active);
  const flip = tipLeft > width * 0.62;

  return (
    <div
      ref={ref}
      className="chart"
      style={{ height }}
      tabIndex={0}
      role="img"
      aria-label={label}
      aria-describedby={active !== undefined ? tipId : undefined}
      onKeyDown={keys}
      onBlur={() => setActive(undefined)}
    >
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(undefined)}
          aria-hidden="true"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? 'var(--axis)' : 'var(--grid)'}
                strokeWidth={1}
              />
              <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {format(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((index) => (
            <text key={index} x={centre(index)} y={height - 6} textAnchor="middle">
              {formatLabel(labels[index] ?? '')}
            </text>
          ))}
          {active !== undefined && (
            <rect
              x={MARGIN.left + band * active}
              y={MARGIN.top}
              width={band}
              height={plotHeight}
              fill="var(--neutral-wash)"
              rx={4}
            />
          )}
          {labels.map((day, index) => {
            const partial = partialLast && index === last;
            let base = 0;
            const parts = colored
              .map((item) => ({ item, value: item.values[index] ?? 0 }))
              .filter((part) => part.value > 0);
            const topIndex = parts.length - 1;
            return (
              <g key={day}>
                {parts.map((part, partIndex) => {
                  const bottom = y(base);
                  base += part.value;
                  const upper = y(base);
                  const height = Math.max(0, bottom - upper - (partIndex > 0 ? GAP : 0));
                  const x = centre(index) - barWidth / 2;
                  return (
                    <path
                      key={part.item.id}
                      d={segment(x, upper, barWidth, height, partIndex === topIndex)}
                      fill={partial ? 'none' : part.item.color}
                      stroke={partial ? part.item.color : 'none'}
                      strokeWidth={partial ? 1.5 : 0}
                      opacity={active !== undefined && active !== index ? 0.55 : 1}
                    />
                  );
                })}
              </g>
            );
          })}
          {limit && limit.value <= top && (
            <g>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={y(limit.value)}
                y2={y(limit.value)}
                stroke="var(--critical)"
                strokeWidth={1}
              />
              <text
                x={MARGIN.left + plotWidth}
                y={y(limit.value) - 5}
                textAnchor="end"
                style={{ fill: 'var(--critical-ink)' }}
              >
                {limit.label}
              </text>
            </g>
          )}
          {markers.map((marker) => (
            <line
              key={`${String(marker.index)}-${marker.label}`}
              x1={centre(marker.index)}
              x2={centre(marker.index)}
              y1={MARGIN.top + plotHeight + 2}
              y2={MARGIN.top + plotHeight + 7}
              stroke="var(--dimmed)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          ))}
        </svg>
      )}
      {active !== undefined && (
        <div
          id={tipId}
          className="chart-tip"
          role="tooltip"
          style={{ top: MARGIN.top, ...(flip ? { right: width - tipLeft + band / 2 + 6 } : { left: tipLeft + band / 2 + 6 }) }}
        >
          <div className="chart-tip__title">
            {tooltipTitle ? tooltipTitle(labels[active] ?? '', active) : formatLabel(labels[active] ?? '')}
            {partialLast && active === last ? ' (so far)' : ''}
          </div>
          {[...colored].reverse().map((item) => (
            <div key={item.id} className="chart-tip__row">
              <i className="chart-tip__key chart-tip__key--box" style={{ background: item.color }} />
              <b>{tooltipValue(item.values[active] ?? 0)}</b>
              <span>{item.label}</span>
            </div>
          ))}
          {colored.length > 1 && (
            <div className="chart-tip__row chart-tip__total">
              <i />
              <b>{tooltipValue(totals[active] ?? 0)}</b>
              <span>Total</span>
            </div>
          )}
          {markers
            .filter((marker) => marker.index === active)
            .map((marker) => (
              <div key={marker.label} className="chart-tip__title chart-tip__total">
                {marker.label}
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
