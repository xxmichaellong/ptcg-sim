import {
  ANALYTICS_ABSENT,
  ANALYTICS_LAYOUT,
  analyticsColumn,
  type AnalyticsKind,
} from '@ptcgsim/protocol';

import { countryName, milliseconds, timeSpent, words } from '../format.js';
import { num, str, type Row, type Rows } from './common.js';

/**
 * Raw event rows (`SELECT timestamp, index1 AS kind, blob1.., double1..`)
 * read back through the analytics layout, and told as one line each for
 * the Live and Errors feeds.
 */

export type EventTone = 'neutral' | 'good' | 'warning' | 'critical';

export interface FeedEvent {
  readonly at: number;
  readonly kind: AnalyticsKind;
  readonly tone: EventTone;
  /** What happened, in a few words. */
  readonly title: string;
  /** Where and how: country, device, build, timing. */
  readonly detail: string;
  readonly fields: Readonly<Record<string, string | number>>;
}

const isKind = (value: string): value is AnalyticsKind => value in ANALYTICS_LAYOUT;

/** A row's fields by name, through the layout. */
export const eventFields = (
  kind: AnalyticsKind,
  row: Row
): Readonly<Record<string, string | number>> => {
  const layout = ANALYTICS_LAYOUT[kind];
  const names: readonly string[] = [
    'kind',
    'build',
    'country',
    'colo',
    'weight',
    ...layout.blobs,
    ...layout.doubles,
  ];
  const fields: Record<string, string | number> = {};
  for (const name of names) {
    const column = analyticsColumn(kind, name as never);
    fields[name] = column.startsWith('blob') ? str(row[column]) : num(row[column]);
  }
  return fields;
};

const value = (fields: Readonly<Record<string, string | number>>, name: string): number | null => {
  const raw = fields[name];
  return typeof raw === 'number' && raw !== ANALYTICS_ABSENT && raw >= 0 ? raw : null;
};
const text = (fields: Readonly<Record<string, string | number>>, name: string): string => {
  const raw = fields[name];
  return typeof raw === 'string' ? raw : '';
};

const join = (...parts: readonly (string | false | null | undefined)[]): string =>
  parts.filter((part): part is string => Boolean(part)).join(' · ');

const where = (fields: Readonly<Record<string, string | number>>): string | undefined => {
  const country = text(fields, 'country');
  return country ? countryName(country) : undefined;
};

const ADMISSION_TITLES: Readonly<Record<string, string>> = {
  hello_ticket: 'joined a room',
  hello_resume: 'came back to a room',
  code_join: 'joined by room code',
  room_open: 'Solo table opened to an opponent',
  invitation_issue: 'Invite link made',
  ticket_issue: 'Seat ticket',
  session_leave: 'left a room',
};

/** Close codes a reader would recognise, by name. */
export const CLOSE_CODES: Readonly<Record<number, string>> = {
  1000: 'Closed normally',
  1001: 'Page left',
  1005: 'Closed without a code',
  1006: 'Connection dropped',
  1008: 'Refused by policy',
  1009: 'Message too big',
  1011: 'Server error',
  1012: 'Server restarting',
  4404: 'Room deleted',
};

export const describeEvent = (row: Row): FeedEvent | undefined => {
  const kind = str(row.kind) || str(row.blob1);
  if (!isKind(kind)) return undefined;
  const fields = eventFields(kind, row);
  const at = Date.parse(`${str(row.timestamp).replace(' ', 'T')}Z`);
  const build = text(fields, 'build');
  switch (kind) {
    case 'page': {
      const errors = value(fields, 'errors') ?? 0;
      const first = text(fields, 'visit') === 'first';
      const tableMs = value(fields, 'tableMs');
      const visible = value(fields, 'visibleMs');
      return {
        at,
        kind,
        tone: errors > 0 ? 'warning' : first ? 'good' : 'neutral',
        title:
          errors > 0
            ? `Script error: ${text(fields, 'error') || 'unknown'}`
            : first
              ? 'A new player arrived'
              : 'A player visited',
        detail: join(
          where(fields),
          [text(fields, 'device'), text(fields, 'browser')].filter(Boolean).join(', '),
          text(fields, 'referrer') ? `from ${text(fields, 'referrer')}` : undefined,
          tableMs !== null ? `table in ${milliseconds(tableMs)}` : undefined,
          visible !== null && visible > 0 ? `stayed ${timeSpent(visible)}` : undefined
        ),
        fields,
      };
    }
    case 'room': {
      const outcome = text(fields, 'outcome');
      const mode = text(fields, 'mode');
      const moves = value(fields, 'authorityVersion');
      return {
        at,
        kind,
        tone: outcome === 'created' ? 'good' : 'neutral',
        title:
          outcome === 'created'
            ? `${mode === 'multiplayer' ? 'Online' : mode === 'solo' ? 'Solo' : 'A'} game started`
            : outcome === 'expired'
              ? `${mode === 'multiplayer' ? 'Online' : mode === 'solo' ? 'Solo' : 'A'} room deleted after a day unused`
              : `Room ${words(outcome).toLowerCase()}`,
        detail: join(
          outcome === 'expired' && moves !== null ? `${String(moves)} moves` : undefined,
          build
        ),
        fields,
      };
    }
    case 'admission': {
      const operation = text(fields, 'operation');
      const outcome = text(fields, 'outcome');
      const role = text(fields, 'role');
      const accepted = outcome === 'accepted';
      const who = role === 'spectator' ? 'A spectator' : 'A player';
      const title = ADMISSION_TITLES[operation] ?? words(operation);
      return {
        at,
        kind,
        tone: accepted ? 'neutral' : outcome === 'failed' ? 'critical' : 'warning',
        title: accepted
          ? /^[a-z]/u.test(title)
            ? `${who} ${title}`
            : title
          : `${words(operation)} ${outcome === 'rate_limited' ? 'rate-limited' : outcome}: ${words(text(fields, 'reason')).toLowerCase()}`,
        detail: join(build),
        fields,
      };
    }
    case 'failure':
      return {
        at,
        kind,
        tone: 'critical',
        title: `Server failure: ${words(text(fields, 'subsystem')).toLowerCase()}`,
        detail: join(
          text(fields, 'source') && `in ${text(fields, 'source').replace(/_/gu, ' ')}`,
          value(fields, 'retryable') === 1 ? 'retryable' : 'not retryable',
          build
        ),
        fields,
      };
    case 'http': {
      const status = value(fields, 'status');
      return {
        at,
        kind,
        tone: status !== null && status >= 500 ? 'critical' : 'warning',
        title: `${String(status ?? '?')} on ${words(text(fields, 'route')).toLowerCase()}`,
        detail: join(where(fields), milliseconds(value(fields, 'durationMs')), build),
        fields,
      };
    }
    case 'move': {
      const outcome = text(fields, 'outcome');
      return {
        at,
        kind,
        tone: outcome === 'failed' ? 'critical' : 'warning',
        title: `Move ${outcome}: ${text(fields, 'commandType')}`,
        detail: join(words(text(fields, 'reason')), build),
        fields,
      };
    }
    case 'limited':
      return {
        at,
        kind,
        tone: 'warning',
        title: `Rate-limited: ${words(text(fields, 'operation')).toLowerCase()}`,
        detail: join(`retry in ${String(value(fields, 'retryAfterSeconds') ?? '?')} s`, build),
        fields,
      };
    case 'socket': {
      const code = value(fields, 'closeCode');
      return {
        at,
        kind,
        tone: code === 1006 ? 'warning' : 'neutral',
        title: code !== null ? (CLOSE_CODES[code] ?? `Closed (${String(code)})`) : 'Connection',
        detail: join(build),
        fields,
      };
    }
    case 'save':
      return {
        at,
        kind,
        tone: text(fields, 'outcome') === 'failed' ? 'critical' : 'neutral',
        title: `Save ${words(text(fields, 'operation')).toLowerCase()}: ${text(fields, 'outcome')}`,
        detail: join(build),
        fields,
      };
  }
};

export const feedOf = (rows: Rows | undefined): readonly FeedEvent[] =>
  (rows ?? [])
    .map(describeEvent)
    .filter((event): event is FeedEvent => event !== undefined && Number.isFinite(event.at));
