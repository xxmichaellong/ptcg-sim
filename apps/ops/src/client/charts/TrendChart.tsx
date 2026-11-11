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
 * A measure over time: up to four lines, or one line with its area washed.
 * The pointer (or the arrow keys) picks a day; a hairline marks it and one
 * tooltip lists every series there. A partial last point (today so far) is
 * drawn hollow. A limit is a solid hairline with its name; releases are
 * small ticks on the axis.
 */

export interface TrendSeries {
  readonly id: string;
  readonly label: string;
  readonly values: readonly (number | null)[];
  /** A slot of the categorical palette, or a role color (context gray). */
  readonly color?: string;
  /** Context lines are thinner and quieter than the series the chart is about. */
  readonly context?: boolean;
}

export interface TrendChartProps {
  readonly labels: readonly string[];
  readonly series: readonly TrendSeries[];
  readonly unit: Unit;
  readonly height?: number;
  readonly formatLabel?: (label: string) => string;
  readonly tooltipTitle?: (label: string, index: number) => string;
  /** The last point is still filling in (today). */
  readonly partialLast?: boolean;
  readonly area?: boolean;
  readonly limit?: { readonly value: number; readonly label: string };
  readonly markers?: readonly { readonly index: number; readonly label: string }[];
  readonly label: string;
}

const MARGIN = { top: 10, right: 14, bottom: 24, left: 46 };

const path = (
  points: readonly (readonly [number, number] | null)[]
): string => {
  let d = '';
  let open = false;
  for (const point of points) {
    if (!point) {
      open = false;
      continue;
    }
    d += `${open ? 'L' : 'M'}${point[0].toFixed(1)},${point[1].toFixed(1)}`;
    open = true;
  }
  return d;
};

export const TrendChart = ({
  labels,
  series,
  unit,
  height = 200,
  formatLabel = (label) => label,
  tooltipTitle,
  partialLast = false,
  area = false,
  limit,
  markers = [],
  label,
}: TrendChartProps) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | undefined>();
  const tipId = useId();
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(10, height - MARGIN.top - MARGIN.bottom);
  const values = series.flatMap((item) => item.values.filter((value): value is number => value !== null));
  const maximum = Math.max(0, ...values, limit?.value ?? 0);
  const { ticks, top } = niceTicks(maximum);
  const format = axisFormat(unit, top);
  const tooltipValue = valueFormat(unit);
  const x = (index: number) =>
    MARGIN.left + (labels.length <= 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
  const y = (value: number) => MARGIN.top + plotHeight - (top > 0 ? (value / top) * plotHeight : 0);
  const colored = series.map((item, index) => ({
    ...item,
    color: item.color ?? SERIES_COLORS[index] ?? SERIES_COLORS[0],
  }));
  const xTicks = tickIndexes(labels.length, plotWidth, 64);
  const last = labels.length - 1;

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setActive(nearestIndex(event.clientX - box.left, MARGIN.left, plotWidth, labels.length));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setActive((current) => {
        const start = current ?? last;
        return Math.min(last, Math.max(0, start + (event.key === 'ArrowLeft' ? -1 : 1)));
      });
    } else if (event.key === 'Escape') setActive(undefined);
  };

  const tipLeft = active === undefined ? 0 : x(active);
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
            <text key={index} x={x(index)} y={height - 6} textAnchor="middle">
              {formatLabel(labels[index] ?? '')}
            </text>
          ))}
          {markers.map((marker) => (
            <g key={`${String(marker.index)}-${marker.label}`}>
              <line
                x1={x(marker.index)}
                x2={x(marker.index)}
                y1={MARGIN.top + plotHeight - 6}
                y2={MARGIN.top + plotHeight + 4}
                stroke="var(--dimmed)"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </g>
          ))}
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
          {area &&
            colored.slice(0, 1).map((item) => {
              const points = item.values.map((value, index) =>
                value === null ? null : ([x(index), y(value)] as const)
              );
              const present = points.filter((point): point is readonly [number, number] => point !== null);
              if (present.length < 2) return null;
              const first = present[0]!;
              const end = present.at(-1)!;
              return (
                <path
                  key={`${item.id}-area`}
                  d={`${path(points)}L${end[0].toFixed(1)},${y(0).toFixed(1)}L${first[0].toFixed(1)},${y(0).toFixed(1)}Z`}
                  fill={item.color}
                  opacity={0.1}
                />
              );
            })}
          {colored.map((item) => {
            const points = item.values.map((value, index) =>
              value === null ? null : ([x(index), y(value)] as const)
            );
            const settled = partialLast ? points.slice(0, -1) : points;
            const tail = partialLast ? points.slice(-2) : [];
            // The latest measured point: hours still to come are null.
            const lastPoint = [...points].reverse().find((point) => point !== null);
            return (
              <g key={item.id}>
                <path
                  d={path(settled)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.context ? 1.5 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={item.context ? 0.75 : 1}
                />
                {tail.length === 2 && tail[0] && tail[1] && (
                  <path
                    d={path(tail)}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={item.context ? 1.5 : 2}
                    strokeLinecap="round"
                    opacity={0.4}
                  />
                )}
                {lastPoint && !item.context && (
                  <circle
                    cx={lastPoint[0]}
                    cy={lastPoint[1]}
                    r={4}
                    fill={partialLast ? 'var(--card)' : item.color}
                    stroke={partialLast ? item.color : 'var(--card)'}
                    strokeWidth={2}
                  />
                )}
              </g>
            );
          })}
          {active !== undefined && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={MARGIN.top}
                y2={MARGIN.top + plotHeight}
                stroke="var(--dimmed)"
                strokeWidth={1}
              />
              {colored.map((item) => {
                const value = item.values[active];
                return value === null || value === undefined ? null : (
                  <circle
                    key={item.id}
                    cx={x(active)}
                    cy={y(value)}
                    r={4}
                    fill={item.color}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                );
              })}
            </g>
          )}
        </svg>
      )}
      {active !== undefined && (
        <div
          id={tipId}
          className="chart-tip"
          role="tooltip"
          style={{
            top: MARGIN.top,
            ...(flip ? { right: width - tipLeft + 12 } : { left: tipLeft + 12 }),
          }}
        >
          <div className="chart-tip__title">
            {tooltipTitle ? tooltipTitle(labels[active] ?? '', active) : formatLabel(labels[active] ?? '')}
            {partialLast && active === last ? ' (so far)' : ''}
          </div>
          {colored.map((item) => (
            <div key={item.id} className="chart-tip__row">
              <i className="chart-tip__key" style={{ background: item.color }} />
              <b>{tooltipValue(item.values[active] ?? null)}</b>
              <span>{item.label}</span>
            </div>
          ))}
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
