import { useEffect, useRef, useState, type RefObject } from 'react';

import type { Unit } from '../shape/overview.js';
import { bytes, count, decimal, milliseconds, percent } from '../format.js';

/** Round tick values from 0 (or the data's floor) to just past the top. */
export const niceTicks = (
  maximum: number,
  minimum = 0,
  target = 4
): { readonly ticks: readonly number[]; readonly top: number; readonly bottom: number } => {
  const span = Math.max(maximum - minimum, Number.EPSILON);
  if (!(maximum > minimum)) {
    const top = maximum > 0 ? maximum * 1.25 : 1;
    return { ticks: [minimum, top / 2, top].filter((tick, index, all) => all.indexOf(tick) === index), top, bottom: minimum };
  }
  const rough = span / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= rough) ?? 10) * power;
  const bottom = Math.floor(minimum / step) * step;
  const top = Math.ceil(maximum / step) * step;
  const ticks: number[] = [];
  for (let tick = bottom; tick <= top + step / 2; tick += step) ticks.push(Math.round(tick * 1e9) / 1e9);
  return { ticks, top, bottom };
};

/** Axis labels: compact, one style per axis. */
export const axisFormat = (unit: Unit, top: number) => (value: number): string => {
  switch (unit) {
    case 'ms':
      return value >= 1_000 ? `${String(Math.round((value / 1_000) * 10) / 10)}s` : `${String(Math.round(value))}ms`;
    case 'percent':
      return percent(value);
    case 'bytes':
      return bytes(value);
    case 'decimal':
    case 'unitless':
      return top < 1 ? String(Math.round(value * 1000) / 1000) : decimal(value);
    case 'count':
      return top >= 10_000 ? count(value) : String(Math.round(value * 100) / 100);
  }
};

/** Tooltip and table values: as precise as a reader wants. */
export const valueFormat = (unit: Unit) => (value: number | null): string => {
  if (value === null) return '—';
  switch (unit) {
    case 'ms':
      return milliseconds(value);
    case 'percent':
      return percent(value);
    case 'bytes':
      return bytes(value);
    case 'decimal':
      return decimal(value);
    case 'unitless':
      return String(Math.round(value * 1000) / 1000);
    case 'count':
      return count(value);
  }
};

/** The categorical slots, in their fixed order (never cycled). */
export const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const;

/** A container's width, followed as it changes. */
export const useWidth = <T extends HTMLElement>(): readonly [RefObject<T | null>, number] => {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
};

/** The index under a pointer, for a chart of `count` evenly spaced points. */
export const nearestIndex = (x: number, left: number, plotWidth: number, total: number, band = false): number => {
  if (total <= 1) return 0;
  const position = band
    ? Math.floor(((x - left) / plotWidth) * total)
    : Math.round(((x - left) / plotWidth) * (total - 1));
  return Math.min(total - 1, Math.max(0, position));
};

/** Which x-axis labels to print so they never collide. */
export const tickIndexes = (total: number, width: number, labelWidth = 56): readonly number[] => {
  if (total <= 0) return [];
  const fit = Math.max(2, Math.floor(width / labelWidth));
  if (total <= fit) return Array.from({ length: total }, (_, index) => index);
  const step = Math.ceil((total - 1) / (fit - 1));
  const indexes: number[] = [];
  for (let index = total - 1; index >= 0; index -= step) indexes.unshift(index);
  return indexes;
};
