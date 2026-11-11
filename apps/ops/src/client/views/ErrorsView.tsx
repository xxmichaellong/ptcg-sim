import { Columns } from '../charts/Columns.js';
import { Empty, Legend } from '../charts/small.js';
import { ago, dateTime, fullCount, shortDate, words } from '../format.js';
import type { CountRow, ErrorsModel } from '../shape/errors.js';
import { PulseStrip, releaseMarkers, SeriesTable } from '../ui/blocks.js';
import { Card, DataTable, firstProblem, Section, type Column } from '../ui/parts.js';
import { Feed } from './LiveView.js';

/**
 * Errors: everything that went wrong in the range, most common first, with
 * when it started and stopped and whom it hit.
 */


const counted = (headings: readonly string[], now: number): readonly Column<CountRow>[] => [
  ...headings.map((heading, index) => ({
    heading,
    align: 'left' as const,
    wrap: index === 0,
    cell: (row: CountRow) => {
      const cell = row.cells[index] ?? '';
      return /^[a-z_]+$/u.test(cell) ? words(cell) : cell;
    },
  })),
  { heading: 'Count', cell: (row) => fullCount(row.n) },
  { heading: 'Last seen', cell: (row) => (row.last === undefined || !Number.isFinite(row.last) ? '—' : <span title={`${dateTime(row.last)} UTC`}>{ago(row.last, now)}</span>) },
];

export const ErrorsView = ({
  model,
  rangeDays,
  now,
}: {
  readonly model: ErrorsModel;
  readonly rangeDays: number;
  readonly now: number;
}) => {
  const { problems } = model;
  const days = model.daily.days;
  const markers = releaseMarkers(model.releases, days);
  const series = model.daily.series;
  const anything = series.some((item) => item.values.some((value) => (value ?? 0) > 0));
  return (
    <>
      <PulseStrip tiles={model.tiles} days={rangeDays} />
      <Section id="trend" title="Over time" question="Each day's errors and failures. Ticks under the chart are deployments.">
        <Card
          span={12}
          title="Trouble a day"
          problem={firstProblem(problems, 'troubleDaily')}
          table={<SeriesTable labels={days} series={model.daily.series} unit="count" />}
        >
          {anything ? (
            <>
              <Legend items={series} />
              <Columns
                labels={days}
                series={series}
                unit="count"
                height={220}
                formatLabel={(day) => shortDate(day)}
                tooltipTitle={(day) => shortDate(day, true)}
                partialLast
                markers={markers}
                label="Errors and failures per day"
              />
            </>
          ) : (
            <Empty height={220}>Nothing went wrong in this range</Empty>
          )}
        </Card>
      </Section>

      <Section id="pages" title="On players' pages" question="Script errors the pages caught, grouped by message. Most reports first.">
        <Card span={12} title="Error messages" subtitle="Numbers and addresses are folded out so copies of one fault group together" problem={firstProblem(problems, 'signatures')}>
          <DataTable
            rows={model.signatures}
            rowKey={(row) => row.error}
            empty="No script errors in this range"
            columns={[
              { heading: 'Message', align: 'left', wrap: true, cell: (row) => <code>{row.error}</code> },
              { heading: 'Visits', cell: (row) => fullCount(row.reports) },
              { heading: 'Errors', cell: (row) => fullCount(row.errors) },
              { heading: 'First seen', cell: (row) => <span title={`${dateTime(row.first)} UTC`}>{ago(row.first, now)}</span> },
              { heading: 'Last seen', cell: (row) => <span title={`${dateTime(row.last)} UTC`}>{ago(row.last, now)}</span> },
              {
                heading: 'Browsers',
                align: 'left',
                cell: (row) => (
                  <span className="chips">
                    {[...row.browsers, ...row.systems].map((name) => (
                      <span key={name} className="chip">
                        {name}
                      </span>
                    ))}
                  </span>
                ),
              },
              { heading: 'Builds', align: 'left', cell: (row) => row.builds.join(', ') },
            ]}
          />
        </Card>
      </Section>

      <Section id="server" title="On the server" question="Faults the server caught, requests it failed, and what it turned away.">
        <Card span={6} title="Server failures" subtitle="Where in the server it went wrong" problem={firstProblem(problems, 'failures')}>
          <DataTable rows={model.failures} rowKey={(row) => row.key} empty="No server failures" columns={counted(['Where', 'In', 'Retryable', 'Builds'], now)} />
        </Card>
        <Card span={6} title="Worker exceptions" subtitle="Cloudflare's own count of requests that didn't finish cleanly" problem={firstProblem(problems, 'worker')}>
          <DataTable rows={model.workerStatuses} rowKey={(row) => row.key} empty="None" columns={counted(['What', 'Status'], now).slice(0, 3)} />
        </Card>
        <Card span={6} title="Requests answered with an error" subtitle="4xx and 5xx, by route" problem={firstProblem(problems, 'httpErrors')}>
          <DataTable rows={model.httpErrors} rowKey={(row) => row.key} empty="No error answers" columns={counted(['Route', 'Status'], now)} />
        </Card>
        <Card span={6} title="Moves refused or failed" subtitle="Refusals are a stale view or a rule; failures are faults" problem={firstProblem(problems, 'moveRefusals')}>
          <DataTable rows={model.moveRefusals} rowKey={(row) => row.key} empty="None" columns={counted(['Move', 'Outcome', 'Why'], now)} />
        </Card>
        <Card span={6} title="Joins turned away" problem={firstProblem(problems, 'admissionRefusals')}>
          <DataTable rows={model.admissionRefusals} rowKey={(row) => row.key} empty="None" columns={counted(['What', 'Outcome', 'Why', 'Role'], now)} />
        </Card>
        <Card span={6} title="How connections ended" subtitle="By close code; dropped connections are 1006" problem={firstProblem(problems, 'socketCloses')}>
          <DataTable rows={model.closes} rowKey={(row) => row.key} empty="None" columns={counted(['How', 'Code', 'Outcome'], now).slice(0, 4)} />
        </Card>
        <Card span={6} title="Rate limits" subtitle="Requests turned away for coming too often" problem={firstProblem(problems, 'limited')}>
          <DataTable rows={model.limited} rowKey={(row) => row.key} empty="None" columns={counted(['What'], now)} />
        </Card>
        <Card span={6} title="Latest" subtitle="The most recent problems, newest first" problem={firstProblem(problems, 'latest')}>
          <Feed events={model.latest} now={now} empty="Nothing went wrong in this range" />
        </Card>
      </Section>
    </>
  );
};
