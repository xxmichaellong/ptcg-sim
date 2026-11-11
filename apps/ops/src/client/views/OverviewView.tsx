import { Columns } from '../charts/Columns.js';
import { Legend, RankedBars, SegmentedBar, Empty } from '../charts/small.js';
import { TrendChart } from '../charts/TrendChart.js';
import { SERIES_COLORS } from '../charts/scale.js';
import {
  bytes,
  count,
  decimal,
  fullCount,
  milliseconds,
  percent,
  shortDate,
  words,
} from '../format.js';
import type { DimensionRow, OverviewModel, Series, Unit } from '../shape/overview.js';
import { PulseStrip, releaseMarkers, SeriesTable } from '../ui/blocks.js';
import { Card, DataTable, Fig, Figure, firstProblem, Section, Status } from '../ui/parts.js';

/**
 * The Overview: one environment over the range, top to bottom from who
 * plays to what goes wrong. Every chart has its table; every figure says
 * what it counts.
 */

const SECTIONS = [
  ['players', 'Players'],
  ['games', 'Games'],
  ['speed', 'Speed'],
  ['reliability', 'Reliability'],
  ['traffic', 'Traffic'],
  ['releases', 'Releases'],
] as const;

const hasData = (series: readonly Series[]): boolean =>
  series.some((item) => item.values.some((value) => value !== null && value > 0));

const dimensionRows = (rows: readonly DimensionRow[]) =>
  rows.map((row) => ({
    key: row.key || '(none)',
    label: row.label,
    value: row.views,
    share: row.share,
    extra: row.table75 === null ? undefined : milliseconds(row.table75),
  }));

const DailyChart = ({
  days,
  series,
  unit,
  kind,
  label,
  markers,
  height = 220,
  emptyText = 'Nothing counted in this range yet',
  colors,
}: {
  readonly days: readonly string[];
  readonly series: readonly Series[];
  readonly unit: Unit;
  readonly kind: 'columns' | 'lines' | 'area';
  readonly label: string;
  readonly markers: readonly { readonly index: number; readonly label: string }[];
  readonly height?: number;
  readonly emptyText?: string;
  readonly colors?: readonly string[];
}) => {
  if (!hasData(series)) return <Empty height={height}>{emptyText}</Empty>;
  // A line through today's partial count would dive at the end: lines stop
  // at yesterday, and columns show today as an outline.
  const lines = kind !== 'columns';
  const shownDays = lines ? days.slice(0, -1) : days;
  const colored = series.map((item, index) => ({
    ...item,
    values: lines ? item.values.slice(0, -1) : item.values,
    color: colors?.[index] ?? SERIES_COLORS[index] ?? SERIES_COLORS[0],
  }));
  const shownMarkers = markers.filter((marker) => marker.index < shownDays.length);
  return (
    <>
      <Legend items={colored} line={kind !== 'columns'} />
      {kind === 'columns' ? (
        <Columns
          labels={days}
          series={colored}
          unit={unit}
          height={height}
          formatLabel={(day) => shortDate(day)}
          tooltipTitle={(day) => shortDate(day, true)}
          partialLast
          markers={markers}
          label={label}
        />
      ) : (
        <TrendChart
          labels={shownDays}
          series={colored}
          unit={unit}
          height={height}
          area={kind === 'area'}
          formatLabel={(day) => shortDate(day)}
          tooltipTitle={(day) => shortDate(day, true)}
          markers={shownMarkers}
          label={label}
        />
      )}
    </>
  );
};

export const OverviewView = ({ model, rangeDays }: { readonly model: OverviewModel; readonly rangeDays: number }) => {
  const { days, problems } = model;
  const markers = releaseMarkers(model.releases, days);
  const pageProblem = firstProblem(problems, 'pagesDaily');
  const players = model.players.totals;
  const games = model.games.totals;
  const reliability = model.reliability.totals;
  const vitalsProblem = firstProblem(problems, 'speedDaily');

  return (
    <>
      <nav className="jump" aria-label="Sections">
        {SECTIONS.filter(([id]) => id !== 'traffic' || model.traffic).map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
      <PulseStrip tiles={model.pulse} days={rangeDays} />

      <Section id="players" title="Players" question="How many people play, where they come from, and whether they come back.">
        <Card
          span={8}
          title="Daily players"
          subtitle="Browsers that opened the site each UTC day, and how many were there for the first time"
          problem={pageProblem}
          figure={<Figure value={count(model.pulse[0]?.headline.value ?? null)} label="a day, last 7 days" delta={model.pulse[0]?.headline} />}
          table={<SeriesTable labels={days} series={model.players.daily.series} unit="count" />}
        >
          <DailyChart days={days} series={model.players.daily.series} unit="count" kind="lines" label="Daily players and new players" markers={markers} />
        </Card>
        <Card span={4} title="In this range" subtitle={`The last ${String(rangeDays)} days`} problem={pageProblem}>
          <div className="figures">
            <Fig value={count(players.players)} label="Player days" info="Each player counted once a day, summed over the range." />
            <Fig value={count(players.newPlayers)} label="New players" />
            <Fig value={percent(players.returningShare)} label="Returning" info="Player days from browsers that had visited before." />
            <Fig value={count(players.weeklyPlayers)} label="Players a week" info="First visits each ISO week, averaged over the range's weeks." />
            <Fig value={players.minutesPerPlayer === null ? '—' : `${decimal(players.minutesPerPlayer)} min`} label="On screen per player a day" />
            <Fig value={decimal(players.movesPerPlayer)} label="Moves per player a day" />
            <Fig value={count(players.views)} label="Page loads" />
            <Fig value={percent(players.onlineShare)} label="Time on online tables" info="Share of reports sent from an online table rather than a Solo one." />
          </div>
        </Card>
        <Card span={4} title="Where they come from" subtitle="The site that sent each visit" problem={firstProblem(problems, 'byReferrer')}>
          <RankedBars rows={dimensionRows(model.dimensions.referrer)} format={count} valueHeading="Visits" />
        </Card>
        <Card span={4} title="How visits start" subtitle="What the page was opened with" problem={firstProblem(problems, 'byLanding')}>
          <RankedBars rows={dimensionRows(model.dimensions.landing)} format={count} valueHeading="Visits" />
        </Card>
        <Card span={4} title="Countries" subtitle="With how long most loads took there" problem={firstProblem(problems, 'byCountry')}>
          <RankedBars rows={dimensionRows(model.dimensions.country)} format={count} valueHeading="Visits" extraHeading="Table p75" />
        </Card>
        <Card span={3} title="Devices" problem={firstProblem(problems, 'byDevice')}>
          <SegmentedBar parts={model.dimensions.device.map((row) => ({ key: row.key, label: row.label, value: row.views }))} />
          <RankedBars rows={dimensionRows(model.dimensions.device)} format={count} valueHeading="Visits" />
        </Card>
        <Card span={3} title="Browsers" problem={firstProblem(problems, 'byBrowser')}>
          <RankedBars rows={dimensionRows(model.dimensions.browser)} format={count} valueHeading="Visits" limit={6} />
        </Card>
        <Card span={3} title="Systems" problem={firstProblem(problems, 'byOs')}>
          <RankedBars rows={dimensionRows(model.dimensions.os)} format={count} valueHeading="Visits" limit={6} />
        </Card>
        <Card span={3} title="Languages" subtitle="The interface's language" problem={firstProblem(problems, 'byLanguage')}>
          <RankedBars rows={dimensionRows(model.dimensions.language)} format={count} valueHeading="Visits" limit={6} />
        </Card>
      </Section>

      <Section id="games" title="Games" question="How much is played, Solo and online.">
        <Card
          span={8}
          title="Games started"
          subtitle="Rooms made each day"
          problem={firstProblem(problems, 'roomsDaily')}
          figure={<Figure value={count(model.pulse[2]?.headline.value ?? null)} label="a day, last 7 days" delta={model.pulse[2]?.headline} />}
          table={<SeriesTable labels={days} series={model.games.started.series} unit="count" />}
        >
          <DailyChart days={days} series={model.games.started.series} unit="count" kind="columns" label="Games started per day, Solo and online" markers={markers} />
        </Card>
        <Card span={4} title="Play" subtitle={`The last ${String(rangeDays)} days`} problem={firstProblem(problems, 'roomsDaily', 'admissionsDaily')}>
          <div className="figures">
            <Fig value={count(games.solo)} label="Solo games" />
            <Fig value={count(games.online)} label="Online rooms" />
            <Fig value={count(games.openedOnline)} label="Solo tables opened online" info="A Solo game opened to an opponent in place (Play online)." />
            <Fig value={count(games.codeJoins)} label="Joins by room code" />
            <Fig value={count(games.invites)} label="Invite links made" />
            <Fig value={count(games.spectators)} label="Spectators let in" />
          </div>
          {model.games.sizes.length > 0 && (
            <>
              <div className="card__sub" style={{ marginTop: 16, marginBottom: 6 }}>
                Moves in a game, from rooms deleted after a day unused
              </div>
              <DataTable
                rows={model.games.sizes}
                rowKey={(row) => row.mode}
                columns={[
                  { heading: 'Room', align: 'left', cell: (row) => (row.mode === 'multiplayer' ? 'Online' : row.mode === 'solo' ? 'Solo' : words(row.mode)) },
                  { heading: 'Rooms', cell: (row) => fullCount(row.rooms) },
                  { heading: 'Median', cell: (row) => fullCount(row.median) },
                  { heading: '90th pct', cell: (row) => fullCount(row.p90) },
                  { heading: 'Unplayed', cell: (row) => percent(row.untouchedShare) },
                ]}
              />
            </>
          )}
        </Card>
        <Card
          span={6}
          title="Moves"
          subtitle="Moves the rooms accepted each day"
          problem={firstProblem(problems, 'movesDaily')}
          figure={<Figure value={count(model.pulse[3]?.headline.value ?? null)} label="a day, last 7 days" delta={model.pulse[3]?.headline} />}
          table={<SeriesTable labels={days} series={model.games.moves.series} unit="count" />}
        >
          <DailyChart days={days} series={model.games.moves.series} unit="count" kind="columns" label="Moves per day" markers={markers} height={200} />
        </Card>
        <Card
          span={6}
          title="Joins"
          subtitle="Players and spectators let into a room each day"
          problem={firstProblem(problems, 'admissionsDaily')}
          table={<SeriesTable labels={days} series={model.games.joins.series} unit="count" />}
        >
          <DailyChart days={days} series={model.games.joins.series} unit="count" kind="lines" label="Joins per day by role" markers={markers} height={200} />
        </Card>
      </Section>

      <Section id="speed" title="Speed" question="How fast it is for players: loading, moving and answering.">
        <Card
          span={8}
          title="Time to table"
          subtitle="From asking for the page until the table is seen"
          info="Measured by each page, from the request to the loading screen lifting off a ready table. Pages opened in a background tab aren’t counted."
          problem={vitalsProblem}
          figure={<Figure value={milliseconds(model.pulse[4]?.headline.value ?? null)} label="75th percentile, last 7 days" delta={model.pulse[4]?.headline} />}
          table={<SeriesTable labels={days} series={model.speed.table.series} unit="ms" />}
        >
          <DailyChart days={days} series={model.speed.table.series} unit="ms" kind="lines" label="Time to table: median, 75th and 95th percentile per day" markers={markers} />
        </Card>
        <Card span={4} title="Page experience" subtitle="75th percentile, last 7 complete days" problem={vitalsProblem}>
          <DataTable
            rows={model.speed.vitals}
            rowKey={(row) => row.id}
            columns={[
              { heading: 'Measure', align: 'left', cell: (row) => row.label },
              { heading: 'p75', cell: (row) => (row.unit === 'ms' ? milliseconds(row.value) : row.value === null ? '—' : String(Math.round(row.value * 1000) / 1000)) },
              { heading: 'Rating', cell: (row) => <Status rating={row.rating} /> },
            ]}
          />
          <div className="card__foot">Thresholds are Google’s Core Web Vitals; time to table is good under 3 s, poor past 6 s.</div>
        </Card>
        <Card
          span={6}
          title="Round trips"
          subtitle="A move until the room answered, and a heartbeat, as players saw them"
          info="Each page reports the median and slowest of its own round trips; this is the median page's median, and the 90th percentile page's."
          problem={vitalsProblem}
          table={<SeriesTable labels={days} series={model.speed.roundTrip.series} unit="ms" />}
        >
          <DailyChart days={days} series={model.speed.roundTrip.series} unit="ms" kind="lines" label="Move and heartbeat round trips per day" markers={markers} height={200} />
        </Card>
        <Card
          span={6}
          title="Server time per move"
          subtitle="From a move arriving at the room until every player was sent the result"
          problem={firstProblem(problems, 'movesDaily')}
          table={<SeriesTable labels={days} series={model.speed.server.series} unit="ms" />}
        >
          <DailyChart days={days} series={model.speed.server.series} unit="ms" kind="lines" label="Server time per move per day" markers={markers} height={200} />
        </Card>
        <Card span={12} title="Where a move's time goes" subtitle="Average server time per accepted move, by step and by kind of move" problem={firstProblem(problems, 'moveTypes')}>
          {model.speed.phases.some((phase) => phase.ms > 0) ? (
            <SegmentedBar tall parts={model.speed.phases.map((phase) => ({ key: phase.id, label: `${phase.label} ${milliseconds(phase.ms)}`, value: phase.ms }))} />
          ) : null}
          <DataTable
            rows={model.speed.types}
            rowKey={(row) => row.type}
            columns={[
              { heading: 'Move', align: 'left', cell: (row) => row.type },
              { heading: 'Moves', cell: (row) => fullCount(row.moves) },
              { heading: 'Median', cell: (row) => milliseconds(row.server50) },
              { heading: '95th pct', cell: (row) => milliseconds(row.server95) },
              { heading: 'Sent to players', cell: (row) => bytes(row.publicationBytes) },
            ]}
          />
        </Card>
        <Card span={12} title="Requests by route" subtitle="What the Worker answered itself, how fast, and how often it said no" problem={firstProblem(problems, 'httpRoutes')}>
          <DataTable
            rows={model.speed.routes}
            rowKey={(row) => row.route}
            columns={[
              { heading: 'Route', align: 'left', cell: (row) => words(row.route) },
              { heading: 'Requests', cell: (row) => fullCount(row.requests) },
              { heading: 'Median', cell: (row) => milliseconds(row.p50) },
              { heading: '95th pct', cell: (row) => milliseconds(row.p95) },
              { heading: 'Failed (5xx)', cell: (row) => fullCount(row.failed) },
              { heading: 'Refused (4xx)', cell: (row) => fullCount(row.refused) },
              { heading: 'Rate-limited', cell: (row) => fullCount(row.limited) },
            ]}
          />
        </Card>
      </Section>

      <Section id="reliability" title="Reliability" question="What went wrong, and how often players felt it.">
        <Card
          span={8}
          title="Trouble a day"
          subtitle="Errors pages caught, faults the server caught, failed requests and moves"
          problem={firstProblem(problems, 'troubleDaily')}
          table={<SeriesTable labels={days} series={model.reliability.daily.series} unit="count" />}
        >
          <DailyChart
            days={days}
            series={model.reliability.daily.series}
            unit="count"
            kind="columns"
            label="Errors and failures per day"
            markers={markers}
            emptyText="Nothing went wrong in this range"
          />
        </Card>
        <Card span={4} title="How players felt it" subtitle={`The last ${String(rangeDays)} days`} problem={firstProblem(problems, 'troubleDaily', 'pagesDaily')}>
          <div className="figures">
            <Fig value={percent(reliability.visitsWithErrors)} label="Visits with a script error" />
            <Fig value={percent(reliability.droppedShare)} label="Connections dropped" info="Room connections that ended abnormally (not a page closed or left)." />
            <Fig value={decimal(reliability.reconnectsPerVisit)} label="Reconnects per visit" />
            <Fig value={percent(reliability.rejectedShare)} label="Moves refused" info="Moves the room turned away: a stale view or a rule. The page retries or undoes them." />
            <Fig value={count(reliability.limited)} label="Rate-limited" />
            <Fig value={count(reliability.workerExceptions)} label="Worker exceptions" info="Requests where the Worker itself threw or ran out of CPU, from Cloudflare's count." />
          </div>
          <div className="card__foot">
            <a href="?view=errors">See every error →</a>
          </div>
        </Card>
      </Section>

      {model.traffic && (
        <Section id="traffic" title="Traffic" question="What Cloudflare saw at beta.ptcgsim.online: every request, from before the site counted its own.">
          <Card
            span={8}
            title="Visits a day"
            subtitle="Cloudflare's count of visits (page loads from elsewhere) to the beta's address"
            problem={firstProblem(problems, 'zone')}
            table={<SeriesTable labels={model.traffic.daily.days} series={model.traffic.daily.series} unit="count" />}
          >
            <DailyChart days={model.traffic.daily.days} series={model.traffic.daily.series} unit="count" kind="area" label="Visits per day to the beta" markers={markers} />
          </Card>
          <Card span={4} title="Requests" subtitle="Last 30 days at most" problem={firstProblem(problems, 'zone')}>
            <div className="figures">
              <Fig value={count(model.traffic.totals.requests)} label="Requests" />
              <Fig value={count(model.traffic.totals.visits)} label="Visits" />
              <Fig value={bytes(model.traffic.totals.bytes)} label="Sent" />
            </div>
            <div style={{ marginTop: 14 }}>
              <DataTable
                rows={model.traffic.statuses.slice(0, 8)}
                rowKey={(row) => String(row.status)}
                columns={[
                  { heading: 'Status', align: 'left', cell: (row) => String(row.status) },
                  { heading: 'Requests', cell: (row) => fullCount(row.requests) },
                  {
                    heading: 'Share',
                    cell: (row) =>
                      percent(row.requests / Math.max(1, model.traffic?.statuses.reduce((total, item) => total + item.requests, 0) ?? 1)),
                  },
                ]}
              />
            </div>
          </Card>
          <Card span={4} title="Countries" subtitle="By visits" problem={firstProblem(problems, 'zone')}>
            <RankedBars rows={dimensionRows(model.traffic.countries)} format={count} valueHeading="Visits" />
          </Card>
          <Card span={4} title="Devices" subtitle="By visits" problem={firstProblem(problems, 'zone')}>
            <RankedBars rows={dimensionRows(model.traffic.devices)} format={count} valueHeading="Visits" />
          </Card>
          <Card span={4} title="Browsers" subtitle="By visits" problem={firstProblem(problems, 'zone')}>
            <RankedBars rows={dimensionRows(model.traffic.browsers)} format={count} valueHeading="Visits" />
          </Card>
        </Section>
      )}

      <Section id="releases" title="Releases" question="When the Worker changed: ticks under the daily charts mark these days.">
        <Card
          span={8}
          title="Worker requests"
          subtitle="Every request the Worker ran for, and those that ended in an exception (Cloudflare's count)"
          problem={firstProblem(problems, 'worker')}
          table={<SeriesTable labels={days} series={model.worker.series} unit="count" />}
        >
          <DailyChart days={days} series={model.worker.series} unit="count" kind="lines" label="Worker requests and exceptions per day" markers={markers} height={200} colors={['var(--series-1)', 'var(--series-8)']} />
        </Card>
        <Card span={4} title="Deployments" subtitle="Newest first" problem={firstProblem(problems, 'deployments')}>
          <DataTable
            rows={model.releases.slice(0, 10)}
            rowKey={(row) => row.id}
            empty="No deployments in this range"
            columns={[
              { heading: 'When (UTC)', align: 'left', cell: (row) => `${shortDate(new Date(row.at).toISOString(), true)}, ${new Date(row.at).toISOString().slice(11, 16)}` },
              { heading: 'Deployment', cell: (row) => <code>{row.id.slice(0, 8)}</code> },
            ]}
          />
        </Card>
      </Section>
      <p className="card__foot" style={{ marginTop: 24 }}>
        Players and speed come from each page’s own report, sent when it is put away; games, moves and errors from the server’s events. Lines run through yesterday; today’s column is outlined while it fills. Times are UTC.
      </p>
    </>
  );
};
