import { valueFormat } from '../charts/scale.js';
import { Sparkline } from '../charts/small.js';
import { count, milliseconds, percent, shortDate } from '../format.js';
import type { Headline } from '../shape/common.js';
import type { Release, Series, Unit } from '../shape/overview.js';
import { DataTable, DeltaChip, Info } from './parts.js';

/** A chart's numbers, a row a day (the chart's table view). */
export const SeriesTable = ({
  labels,
  series,
  unit,
  formatLabel = (label: string) => shortDate(label, true),
}: {
  readonly labels: readonly string[];
  readonly series: readonly Series[];
  readonly unit: Unit;
  readonly formatLabel?: (label: string) => string;
}) => {
  const format = valueFormat(unit);
  const rows = labels.map((label, index) => ({ label, index })).reverse();
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.label}
      columns={[
        { heading: 'Day', align: 'left', cell: (row) => formatLabel(row.label) },
        ...series.map((item) => ({
          heading: item.label,
          cell: (row: { index: number }) => format(item.values[row.index] ?? null),
        })),
      ]}
    />
  );
};

export interface Tile {
  readonly id: string;
  readonly label: string;
  readonly info: string;
  readonly unit: Unit;
  readonly headline: Headline;
  readonly trend: readonly (number | null)[];
  readonly unavailable?: string;
}

const tileValue = (unit: Unit, value: number | null): string =>
  unit === 'ms' ? milliseconds(value) : unit === 'percent' ? percent(value) : count(value);

/** The headline strip: each tile's last-seven-days figure, its change, its trend. */
export const PulseStrip = ({ tiles, days }: { readonly tiles: readonly Tile[]; readonly days: number }) => (
  <div className="pulse">
    {tiles.map((tile) => (
      <div key={tile.id} className="tile">
        <div className="tile__label">
          {tile.label}
          <Info text={tile.info} />
        </div>
        {tile.unavailable ? (
          <>
            <div className="tile__value tile__value--none">—</div>
            <div className="tile__foot">{tile.unavailable}</div>
          </>
        ) : (
          <>
            <div className="tile__value">
              {tileValue(tile.unit, tile.headline.value)}
              <span className="tile__note">7-day avg</span>
            </div>
            <div>
              <DeltaChip {...tile.headline} />
              <span className="delta-note">vs prior 7d</span>
            </div>
            <Sparkline
              values={tile.trend.slice(0, -1)}
              label={`${tile.label}: ${tileValue(tile.unit, tile.headline.value)} a day over the last seven days; trend over ${String(days)} days`}
            />
            <div className="tile__foot">Last {days} days, through yesterday</div>
          </>
        )}
      </div>
    ))}
  </div>
);

/** Releases inside a range, as markers on its daily charts. */
export const releaseMarkers = (
  releases: readonly Release[],
  days: readonly string[]
): readonly { readonly index: number; readonly label: string }[] =>
  releases.flatMap((release) => {
    const index = days.indexOf(new Date(release.at).toISOString().slice(0, 10));
    return index >= 0
      ? [
          {
            index,
            label: `Deployed ${new Date(release.at).toISOString().slice(11, 16)} UTC`,
          },
        ]
      : [];
  });
