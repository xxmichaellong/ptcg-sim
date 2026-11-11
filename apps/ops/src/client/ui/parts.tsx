import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { WarningOctagonIcon } from '@phosphor-icons/react/dist/csr/WarningOctagon';
import { useId, useState, type ReactNode } from 'react';

import { percent } from '../format.js';
import type { Headline } from '../shape/common.js';
import type { Problem, Rating } from '../shape/overview.js';

/** A hover-or-focus explanation beside a label. */
export const Info = ({ text }: { readonly text: string }) => {
  const id = useId();
  return (
    <button type="button" className="info" aria-describedby={id} aria-label="About this">
      i
      <span id={id} role="tooltip" className="info__bubble">
        {text}
      </span>
    </button>
  );
};

/** Change against the seven days before: arrow, sign and size, colored by whether it is good. */
export const DeltaChip = ({ delta, kind, good }: Pick<Headline, 'delta' | 'kind' | 'good'>) => {
  const flat = delta === null || Math.abs(delta) < (kind === 'points' ? 0.1 : 0.005);
  const better = delta !== null && (good === 'up' ? delta > 0 : delta < 0);
  const tone = flat ? 'flat' : better ? 'good' : 'bad';
  const size =
    delta === null
      ? '—'
      : kind === 'points'
        ? `${Math.abs(delta) < 10 ? Math.abs(delta).toFixed(1) : Math.round(Math.abs(delta)).toString()} pp`
        : percent(Math.abs(delta));
  return (
    <span className={`delta delta--${tone}`}>
      <svg viewBox="0 0 12 12" aria-hidden="true">
        {flat ? (
          <rect x="2.5" y="5.25" width="7" height="1.5" rx=".75" fill="currentColor" />
        ) : (
          <path d={delta > 0 ? 'M6 2.5 10 7.5H2Z' : 'M6 9.5 2 4.5h8Z'} fill="currentColor" />
        )}
      </svg>
      {flat || delta === null ? size : `${delta > 0 ? '+' : '−'}${size}`}
      <span className="sr-only">
        {flat ? ' about the same' : better ? ' (better)' : ' (worse)'}
      </span>
    </span>
  );
};

export interface CardProps {
  readonly id?: string;
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly info?: string;
  readonly figure?: ReactNode;
  readonly span?: 3 | 4 | 5 | 6 | 7 | 8 | 12;
  readonly footnote?: ReactNode;
  /** The chart's numbers as a table: the toggle shows it in its place. */
  readonly table?: ReactNode;
  readonly problem?: Problem;
  readonly children: ReactNode;
}

export const Card = ({ id, title, subtitle, info, figure, span = 12, footnote, table, problem, children }: CardProps) => {
  const [showTable, setShowTable] = useState(false);
  return (
    <section id={id} className={`card span-${String(span)}`} aria-label={title}>
      <div className="card__head">
        <div>
          <div className="card__title">
            {title}
            {info && <Info text={info} />}
          </div>
          {subtitle && <div className="card__sub">{subtitle}</div>}
        </div>
        <div className="card__actions">
          {problem ? null : figure}
          {table && !problem && (
            <button
              type="button"
              className="table-toggle"
              aria-pressed={showTable}
              onClick={() => setShowTable((shown) => !shown)}
            >
              {showTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </div>
      {problem ? <ProblemNote problem={problem} /> : showTable && table ? table : children}
      {footnote && <div className="card__foot">{footnote}</div>}
    </section>
  );
};

export const Section = ({
  id,
  title,
  question,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly children: ReactNode;
}) => (
  <section id={id} className="section" aria-labelledby={`${id}-title`}>
    <div className="section__head">
      <h2 id={`${id}-title`} className="section__title">
        {title}
      </h2>
      <div className="section__question">{question}</div>
    </div>
    <div className="grid">{children}</div>
  </section>
);

export const Figure = ({
  value,
  label,
  delta,
}: {
  readonly value: string;
  readonly label?: string;
  readonly delta?: Pick<Headline, 'delta' | 'kind' | 'good'>;
}) => (
  <div className="figure">
    <div className="figure__value">{value}</div>
    {label && <div className="figure__label">{label}</div>}
    {delta && (
      <div>
        <DeltaChip {...delta} />
      </div>
    )}
  </div>
);

/** A labelled number in a card's figures grid. */
export const Fig = ({
  value,
  label,
  note,
  info,
}: {
  readonly value: string;
  readonly label: string;
  readonly note?: string;
  readonly info?: string;
}) => (
  <div>
    <div className="fig__value">{value}</div>
    <div className="fig__label" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      {label}
      {info && <Info text={info} />}
    </div>
    {note && <div className="fig__note">{note}</div>}
  </div>
);

const RATING_TEXT: Readonly<Record<Rating, string>> = {
  good: 'Good',
  fair: 'Needs work',
  poor: 'Poor',
};

/** State shown with an icon and a word, never color alone. */
export const Status = ({ rating, text }: { readonly rating: Rating | null; readonly text?: string }) => {
  if (rating === null) return <span className="status status--muted">No data</span>;
  const Icon = rating === 'good' ? CheckCircleIcon : rating === 'fair' ? WarningIcon : WarningOctagonIcon;
  return (
    <span className={`status status--${rating}`}>
      <Icon weight="fill" aria-hidden="true" />
      {text ?? RATING_TEXT[rating]}
    </span>
  );
};

const PROBLEM_TEXT: Readonly<Record<Problem['reason'], string>> = {
  unconfigured: 'No API token yet',
  unauthorized: 'The API token can’t read this',
  failed: 'Cloudflare didn’t answer',
};

export const ProblemNote = ({ problem }: { readonly problem: Problem }) => (
  <div className="problem" role="note">
    <b>{PROBLEM_TEXT[problem.reason]}</b>
    <span>{problem.reason === 'failed' ? problem.message : 'See Setup for what it needs.'}</span>
  </div>
);

/** The first problem among a card's sources, if any. */
export const firstProblem = (
  problems: Readonly<Record<string, Problem>>,
  ...sources: readonly string[]
): Problem | undefined => {
  for (const source of sources) {
    const problem = problems[source];
    if (problem) return problem;
  }
  return undefined;
};

export const Segmented = <Value extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  readonly value: Value;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly onChange: (value: Value) => void;
  readonly label: string;
}) => (
  <div className="segmented" role="group" aria-label={label}>
    {options.map((option) => (
      <button
        key={String(option.value)}
        type="button"
        aria-pressed={option.value === value}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export interface Column<RowType> {
  readonly heading: string;
  readonly cell: (row: RowType) => ReactNode;
  readonly align?: 'left' | 'right';
  readonly wrap?: boolean;
}

export const DataTable = <RowType,>({
  rows,
  columns,
  rowKey,
  empty = 'Nothing in this range',
  caption,
}: {
  readonly rows: readonly RowType[];
  readonly columns: readonly Column<RowType>[];
  readonly rowKey: (row: RowType, index: number) => string;
  readonly empty?: string;
  readonly caption?: string;
}) =>
  rows.length === 0 ? (
    <div className="empty" style={{ height: 80 }}>
      {empty}
    </div>
  ) : (
    <div className="table-wrap">
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.heading} scope="col" className={column.align === 'left' ? 'left' : undefined}>
                {column.heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td
                  key={column.heading}
                  className={[column.align === 'left' ? 'left' : '', column.wrap ? 'wrap' : ''].join(' ').trim() || undefined}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
