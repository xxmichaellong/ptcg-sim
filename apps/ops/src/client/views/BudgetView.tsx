import { Columns } from '../charts/Columns.js';
import { Empty } from '../charts/small.js';
import { bytes, count, fullCount, gbSeconds, percent, shortDate, usd } from '../format.js';
import type { UsageModel, UsageShare } from '../shape/usage.js';
import { PAID_PLAN } from '../../shared/limits.js';
import { SeriesTable } from '../ui/blocks.js';
import { Card, DataTable, Fig, Figure, firstProblem, Section, Status, type Column } from '../ui/parts.js';
import type { Problem } from '../shape/overview.js';
import { Meter, limitValue } from './LiveView.js';

/**
 * Budget: the account's free allowances, today and each day of the range
 * against its line, who spent them, and what Workers Paid would cost for
 * the same use.
 */

const shareColumns: readonly Column<UsageShare>[] = [
  { heading: 'Worker requests', cell: (row) => fullCount(row.workerRequests) },
  { heading: 'Room requests', cell: (row) => fullCount(row.objectRequests) },
  { heading: 'Room time', cell: (row) => gbSeconds(row.gbSeconds) },
  { heading: 'Rows read', cell: (row) => fullCount(row.rowsRead) },
  { heading: 'Rows written', cell: (row) => fullCount(row.rowsWritten) },
];

export const BudgetView = ({
  model,
  rangeDays,
  problems,
}: {
  readonly model: UsageModel;
  readonly rangeDays: number;
  readonly problems: Readonly<Record<string, Problem>>;
}) => {
  const usageProblem = firstProblem(problems, 'usage');
  const tightest = model.tightest;
  const peak = (values: readonly number[], daily: number) =>
    Math.max(0, ...values.slice(0, -1)) / daily;
  return (
    <>
      {tightest && tightest.projected >= tightest.daily && (
        <div className="notice notice--critical" role="alert">
          <Status rating="poor" text="" />
          <span>
            At today’s pace, <b>{tightest.label.toLowerCase()}</b> runs out before 00:00 UTC (heading for{' '}
            {percent(tightest.projected / tightest.daily)}). {tightest.consequence}
          </span>
        </div>
      )}
      <Section id="today" title="Today" question="Each allowance used so far, and where today is heading at its pace (the tick).">
        <Card span={7} title="Daily allowances" subtitle="Workers Free, shared by every Worker in the account; resets at 00:00 UTC" problem={firstProblem(problems, 'usageToday')}>
          {model.limits.map((limit) => (
            <Meter key={limit.id} limit={limit} />
          ))}
        </Card>
        <Card span={5} title="What running out does" subtitle="Past a limit, that kind of operation fails until 00:00 UTC">
          <DataTable
            rows={model.limits}
            rowKey={(row) => row.id}
            columns={[
              { heading: 'Allowance', align: 'left', cell: (row) => row.label },
              { heading: 'A day', cell: (row) => limitValue(row, row.daily) },
              { heading: 'When it runs out', align: 'left', wrap: true, cell: (row) => row.consequence },
            ]}
          />
          <div className="figures" style={{ marginTop: 16 }}>
            <Fig
              value={model.storageBytes === null ? 'Not reported' : bytes(model.storageBytes)}
              label={`Stored, of ${bytes(model.storageLimit)}`}
              info="Durable Object storage, every object together. Rooms are deleted a day after their last use."
            />
            <Fig value={model.storageBytes === null ? '—' : percent(model.storageBytes / model.storageLimit)} label="Of the storage limit" />
          </div>
        </Card>
      </Section>

      <Section id="history" title="Each day" question={`The last ${String(rangeDays)} days against each allowance's line. Today's column is partial.`}>
        {model.limits.map((limit) => (
          <Card
            key={limit.id}
            span={6}
            title={limit.label}
            subtitle={`Highest day: ${percent(peak(limit.history, limit.daily))} of ${limitValue(limit, limit.daily)}`}
            problem={limit.id === 'analyticsEvents' ? firstProblem(problems, 'betaEvents') : usageProblem}
            table={
              <SeriesTable
                labels={model.days}
                series={[{ id: limit.id, label: limit.label, values: limit.history }]}
                unit="count"
              />
            }
          >
            {limit.history.some((value) => value > 0) ? (
              <Columns
                labels={model.days}
                series={[{ id: limit.id, label: limit.label, values: limit.history }]}
                unit="count"
                height={170}
                formatLabel={(day) => shortDate(day)}
                tooltipTitle={(day) => shortDate(day, true)}
                partialLast
                limit={
                  Math.max(...limit.history) >= limit.daily * 0.35
                    ? { value: limit.daily, label: `Free limit ${limitValue(limit, limit.daily)}` }
                    : undefined
                }
                label={`${limit.label} per day`}
              />
            ) : (
              <Empty height={170}>None used in this range</Empty>
            )}
          </Card>
        ))}
      </Section>

      <Section id="who" title="Who used it" question={`The last ${String(rangeDays)} days, by Worker and by kind of Durable Object.`}>
        <Card span={12} title="By Worker" subtitle="Every Worker in the account shares the allowances" problem={usageProblem}>
          <DataTable
            rows={model.byScript}
            rowKey={(row) => row.key}
            columns={[
              {
                heading: 'Worker',
                align: 'left',
                cell: (row) => (
                  <>
                    {row.label}
                    {row.label !== row.detail && <span className="chip" style={{ marginLeft: 6 }}>{row.detail}</span>}
                  </>
                ),
              },
              ...shareColumns,
            ]}
          />
        </Card>
        <Card span={12} title="By kind of Durable Object" subtitle="Rooms are most of it; the catalog, feeds and codes are small" problem={firstProblem(problems, 'usage', 'namespaces')}>
          <DataTable
            rows={model.byClass}
            rowKey={(row) => row.key}
            columns={[
              {
                heading: 'Object',
                align: 'left',
                cell: (row) => (
                  <>
                    {row.label}
                    <span className="chip" style={{ marginLeft: 6 }}>{row.detail}</span>
                  </>
                ),
              },
              ...shareColumns.slice(1),
            ]}
          />
        </Card>
      </Section>

      <Section id="paid" title="On Workers Paid" question="What a month of this use would cost on the $5 plan, and how much room it would give.">
        <Card
          span={5}
          title="A month at this pace"
          subtitle={model.paidDays > 0 ? `From the last ${String(model.paidDays)} complete days, scaled to a month` : 'Needs usage data'}
          problem={usageProblem}
          figure={<Figure value={usd(model.paid?.totalUsd ?? null)} label="a month" />}
        >
          {model.paid ? (
            <DataTable
              rows={[{ label: 'Base plan', usd: PAID_PLAN.baseUsd }, ...model.paid.overages]}
              rowKey={(row) => row.label}
              columns={[
                { heading: 'Charge', align: 'left', cell: (row) => row.label },
                { heading: 'A month', cell: (row) => usd(row.usd) },
              ]}
            />
          ) : (
            <Empty height={100}>No usage yet</Empty>
          )}
          <div className="card__foot">Workers Paid includes far more than this site uses; past the base price, only use beyond what’s included is charged.</div>
        </Card>
        <Card span={7} title="What the $5 includes" subtitle="Each month, before any charge (Cloudflare’s published prices)">
          <DataTable
            rows={[
              { label: 'Worker requests', included: count(PAID_PLAN.workerRequests.included), free: '100K a day' },
              { label: 'Room requests', included: count(PAID_PLAN.objectRequests.included), free: '100K a day' },
              { label: 'Room time', included: gbSeconds(PAID_PLAN.objectGbSeconds.included), free: '13K GB-s a day' },
              { label: 'Rows read', included: count(PAID_PLAN.rowsRead.included), free: '5M a day' },
              { label: 'Rows written', included: count(PAID_PLAN.rowsWritten.included), free: '100K a day' },
              { label: 'Storage', included: `${String(PAID_PLAN.storageGbMonth.included)} GB`, free: '5 GB' },
            ]}
            rowKey={(row) => row.label}
            columns={[
              { heading: 'Allowance', align: 'left', cell: (row) => row.label },
              { heading: 'Paid, a month', cell: (row) => row.included },
              { heading: 'Free', cell: (row) => row.free },
            ]}
          />
          <div className="card__foot">On Workers Paid nothing stops at a daily limit: the site keeps working and the extra is billed.</div>
        </Card>
      </Section>
    </>
  );
};
