/**
 * How the dashboard writes numbers, times and dates: compact where a value
 * stands alone, in full in tables, always UTC (the day the site's limits
 * and reports use).
 */

const compactFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const fullFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const DASH = '—';

/** 1,234 below ten thousand, else 12.3K / 4.5M. */
export const count = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return Math.abs(value) < 10_000 ? fullFormat.format(value) : compactFormat.format(value);
};

/** Always in full: table cells. */
export const fullCount = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? DASH : fullFormat.format(value);

/** 0.4 / 12.5 (for averages like moves per player). */
export const decimal = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? DASH
    : Math.abs(value) < 10
      ? twoDecimals.format(value)
      : oneDecimal.format(value);

/** 0.62 → 62%, 0.004 → 0.4%. */
export const percent = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const scaled = value * 100;
  if (scaled !== 0 && Math.abs(scaled) < 0.1) return '<0.1%';
  return `${Math.abs(scaled) < 10 ? oneDecimal.format(scaled) : fullFormat.format(scaled)}%`;
};

/** 840 ms, 2.4 s, 3m 05s. */
export const milliseconds = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  if (value < 1) return `${twoDecimals.format(value)} ms`;
  if (value < 1_000) return `${fullFormat.format(value)} ms`;
  if (value < 60_000) return `${oneDecimal.format(value / 1_000)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1_000);
  return `${String(minutes)}m ${String(seconds).padStart(2, '0')}s`;
};

/** Minutes for time spent: 24 min, 1.5 h. */
export const timeSpent = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return DASH;
  const minutes = ms / 60_000;
  if (minutes < 1) return `${fullFormat.format(ms / 1_000)} s`;
  if (minutes < 90) return `${fullFormat.format(minutes)} min`;
  return `${oneDecimal.format(minutes / 60)} h`;
};

export const bytes = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let scaled = value;
  let unit = 0;
  while (Math.abs(scaled) >= 1_000 && unit < units.length - 1) {
    scaled /= 1_000;
    unit += 1;
  }
  return `${unit === 0 ? fullFormat.format(scaled) : oneDecimal.format(scaled)} ${units[unit] ?? 'B'}`;
};

export const usd = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? DASH : money.format(value);

/** GB-s of Durable Object time. */
export const gbSeconds = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? DASH : `${count(value)} GB-s`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `2026-11-10` → `Nov 10` (with the weekday: `Tue, Nov 10`). */
export const shortDate = (day: string, weekday = false): string => {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  const text = `${MONTHS[date.getUTCMonth()] ?? ''} ${String(date.getUTCDate())}`;
  return weekday ? `${WEEKDAYS[date.getUTCDay()] ?? ''}, ${text}` : text;
};

/** An hour of the UTC day: `14:00`. */
export const hourLabel = (ms: number): string =>
  `${String(new Date(ms).getUTCHours()).padStart(2, '0')}:00`;

/** A moment in UTC: `Nov 10, 14:32`. */
export const dateTime = (ms: number): string => {
  const date = new Date(ms);
  return `${shortDate(date.toISOString())}, ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
};

/** `just now`, `5m ago`, `3h ago`, `2d ago`. */
export const ago = (ms: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - ms) / 1_000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${String(hours)}h ago`;
  return `${String(Math.round(hours / 24))}d ago`;
};

/** Analytics Engine's `YYYY-MM-DD HH:MM:SS` (UTC) as milliseconds. */
export const parseSqlTime = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  return Date.parse(`${value.replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/u.test(value) ? '' : 'Z'}`);
};

const REGIONS = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return undefined;
  }
})();
const LANGUAGES = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    return undefined;
  }
})();

/** `FR` → `France`; unknown codes as they are. */
export const countryName = (code: string): string => {
  if (!code || code === 'T1' || code === 'XX') return 'Unknown';
  try {
    return REGIONS?.of(code) ?? code;
  } catch {
    return code;
  }
};

export const languageName = (code: string): string => {
  if (!code || code === 'und') return 'Unknown';
  try {
    return LANGUAGES?.of(code) ?? code;
  } catch {
    return code;
  }
};

/** Words for a snake_case code: `room_code_join` → `Room code join`. */
export const words = (code: string): string => {
  if (!code) return DASH;
  const text = code.replace(/_/gu, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
