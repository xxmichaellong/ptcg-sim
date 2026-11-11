import { TrendChart } from '../charts/TrendChart.js';
import { Empty } from '../charts/small.js';
import { ago, count, dateTime, fullCount, gbSeconds, hourLabel, milliseconds, percent, usd } from '../format.js';
import type { FeedEvent } from '../shape/events.js';
import type { LiveModel } from '../shape/live.js';
import { limitShares, type LimitUse } from '../shape/usage.js';
import { Card, DataTable, DeltaChip, firstProblem, Section, Status } from '../ui/parts.js';

/**
 * Live: is each site up, how is today going against yesterday, how much of
 * the free plan's day is used, and what just happened. Refreshes itself.
 */

const STATE_COLOR = {
  up: 'var(--good)',
  degraded: 'var(--warning)',
  down: 'var(--critical)',
  unknown: 'var(--deemph)',
} as const;
const STATE_TEXT = { up: 'Up', degraded: 'Slow', down: 'Down', unknown: 'Unknown' } as const;
const TONE_COLOR = {
  neutral: 'var(--deemph)',
  good: 'var(--series-3)',
  warning: 'var(--warning)',
  critical: 'var(--critical)',
} as const;

export const limitValue = (limit: LimitUse, value: number): string =>
  limit.unit === 'gbSeconds' ? gbSeconds(value) : count(value);

/** A day's allowance: used so far, where today is heading, and the line. */
export const Meter = ({ limit }: { readonly limit: LimitUse }) => {
  const { today, projected } = limitShares(limit);
  const severity = projected >= 1 || today >= 0.8 ? 'poor' : projected >= 0.6 ? 'fair' : 'good';
  const fill = severity === 'poor' ? 'var(--critical)' : severity === 'fair' ? 'var(--warning)' : 'var(--series-1)';
  return (
    <div className="meter">
      <div className="meter__top">
        <span className="meter__label">{limit.label}</span>
        <span className="meter__value">
          {limitValue(limit, limit.today)} of {limitValue(limit, limit.daily)} · {percent(today)}
        </span>
      </div>
      <div
        className="meter__track"
        role="meter"
        aria-label={`${limit.label} today`}
        aria-valuemin={0}
        aria-valuemax={limit.daily}
        aria-valuenow={Math.round(limit.today)}
        aria-valuetext={`${percent(today)} used, heading for ${percent(projected)} by midnight UTC`}
      >
        <i className="meter__fill" style={{ width: `${String(Math.min(100, today * 100))}%`, background: fill }} />
        <i className="meter__projected" style={{ left: `calc(${String(Math.min(100, projected * 100))}% - 1px)` }} />
      </div>
      <div className="meter__note">
        <span>
          Heading for {percent(projected)} by 00:00 UTC
        </span>
        {severity !== 'good' ? (
          <Status rating={severity} text={severity === 'poor' ? 'Will run out' : 'Getting close'} />
        ) : (
          <span>{limit.yesterday > 0 ? `Yesterday ${percent(limit.yesterday / limit.daily)}` : ''}</span>
        )}
      </div>
    </div>
  );
};

export const Feed = ({ events, now, empty }: { readonly events: readonly FeedEvent[]; readonly now: number; readonly empty: string }) =>
  events.length === 0 ? (
    <Empty height={160}>{empty}</Empty>
  ) : (
    <div className="feed" role="list">
      {events.map((event, index) => (
        <div key={`${String(event.at)}-${String(index)}`} className="feed__item" role="listitem">
          <i className="feed__dot" style={{ background: TONE_COLOR[event.tone] }} aria-hidden="true" />
          <div>
            <div className="feed__title">{event.title}</div>
            {event.detail && <div className="feed__detail">{event.detail}</div>}
          </div>
          <time className="feed__time" dateTime={new Date(event.at).toISOString()} title={`${dateTime(event.at)} UTC`}>
            {ago(event.at, now)}
          </time>
        </div>
      ))}
    </div>
  );

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour));

export const LiveView = ({ model }: { readonly model: LiveModel }) => {
  const { problems } = model;
  const tightest = model.usage.tightest;
  return (
    <>
      <div className="health" role="list" aria-label="Health">
        {model.health.map((site) => (
          <div key={site.name} className="health__item" role="listitem">
            <div className="health__name">{site.name}</div>
            <div className="health__state">
              <i className="health__dot" style={{ background: STATE_COLOR[site.state] }} aria-hidden="true" />
              {STATE_TEXT[site.state]}
              {site.ms !== null && <span className="tile__note">{milliseconds(site.ms)}</span>}
            </div>
            <div className="health__meta">
              {site.note ?? (site.status ? `HTTP ${String(site.status)}` : '')}
              {site.build ? ` · ${site.build}` : ''}
            </div>
          </div>
        ))}
        <div className="health__item" role="listitem">
          <div className="health__name">Free plan today</div>
          <div className="health__state">
            {tightest ? (
              <>
                <i
                  className="health__dot"
                  style={{
                    background:
                      tightest.projected >= tightest.daily
                        ? 'var(--critical)'
                        : tightest.projected >= tightest.daily * 0.6
                          ? 'var(--warning)'
                          : 'var(--good)',
                  }}
                  aria-hidden="true"
                />
                {percent(tightest.today / tightest.daily)}
                <span className="tile__note">{tightest.label.toLowerCase()}</span>
              </>
            ) : (
              '—'
            )}
          </div>
          <div className="health__meta">
            {tightest ? `Heading for ${percent(tightest.projected / tightest.daily)} by 00:00 UTC` : 'No usage data'}
          </div>
        </div>
      </div>

      <Section id="today" title="Today so far" question="Since 00:00 UTC, against yesterday up to the same time.">
        <Card span={12} title="Today" subtitle={`As of ${dateTime(model.asOf)} UTC`} problem={firstProblem(problems, 'hourly')}>
          <div className="figures figures--row">
            {model.today.map((figure) => {
              const delta = figure.yesterdayByNow > 0 ? (figure.today - figure.yesterdayByNow) / figure.yesterdayByNow : null;
              return (
                <div key={figure.id}>
                  <div className="fig__value">{count(figure.today)}</div>
                  <div className="fig__label">{figure.label}</div>
                  <div style={{ marginTop: 4 }}>
                    <DeltaChip delta={delta} kind="relative" good={figure.good} />
                    <span className="delta-note">vs {count(Math.round(figure.yesterdayByNow))} by now yesterday</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        {model.hourly.map((metric) => (
          <Card
            key={metric.id}
            span={6}
            title={`${metric.label} by the hour`}
            subtitle="Today against yesterday (gray)"
            problem={firstProblem(problems, 'hourly')}
            table={
              <DataTable
                rows={HOURS.map((hour, index) => ({ hour, index }))}
                rowKey={(row) => row.hour}
                columns={[
                  { heading: 'Hour (UTC)', align: 'left', cell: (row) => hourLabel(Number(row.hour) * 3_600_000) },
                  { heading: 'Today', cell: (row) => fullCount(metric.today[row.index] ?? null) },
                  { heading: 'Yesterday', cell: (row) => fullCount(metric.yesterday[row.index] ?? 0) },
                ]}
              />
            }
          >
            <div className="legend">
              <span>
                <i className="legend__line" style={{ background: metric.id === 'errors' ? 'var(--series-8)' : 'var(--series-1)' }} />
                Today
              </span>
              <span>
                <i className="legend__line" style={{ background: 'var(--deemph)' }} />
                Yesterday
              </span>
            </div>
            <TrendChart
              labels={HOURS}
              series={[
                { id: 'yesterday', label: 'Yesterday', values: metric.yesterday, color: 'var(--deemph)', context: true },
                { id: 'today', label: 'Today', values: metric.today, color: metric.id === 'errors' ? 'var(--series-8)' : 'var(--series-1)' },
              ]}
              unit="count"
              height={170}
              formatLabel={(hour) => `${hour.padStart(2, '0')}:00`}
              tooltipTitle={(hour) => `${hour.padStart(2, '0')}:00 UTC`}
              partialLast={false}
              label={`${metric.label} by the hour, today against yesterday`}
            />
          </Card>
        ))}
      </Section>

      <Section id="plan" title="Free plan today" question="Each daily allowance, used so far and where today is heading (the tick). Resets at 00:00 UTC.">
        <Card span={7} title="Allowances" subtitle="Shared by every Worker in the account" problem={firstProblem(problems, 'usageToday')}>
          {model.usage.limits.map((limit) => (
            <Meter key={limit.id} limit={limit} />
          ))}
        </Card>
        <Card span={5} title="What just happened" subtitle="The last day's events, newest first" problem={firstProblem(problems, 'latest')}>
          <Feed events={model.feed} now={model.asOf} empty="No events in the last day" />
        </Card>
      </Section>

      {model.releases.length > 0 && (
        <p className="card__foot" style={{ marginTop: 24 }}>
          Last deployed {ago(model.releases[0]?.at ?? 0, model.asOf)} ({dateTime(model.releases[0]?.at ?? 0)} UTC).
          {model.usage.paid ? ` On Workers Paid this month would cost about ${usd(model.usage.paid.totalUsd)}.` : ''}
        </p>
      )}
    </>
  );
};
