import { useId, type ReactNode } from 'react';

import './form-controls.css';

/**
 * The settings vocabulary: a titled section, a segmented choice, a switch
 * row and a range row. Every settings surface uses these, so they look,
 * read and respond to touch the same way everywhere.
 */

export const SettingsSection = ({
  title,
  description,
  children,
  id,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly id?: string;
}) => {
  const headingId = useId();
  return (
    <section
      className="ptcgsim-settings-section"
      aria-labelledby={headingId}
      {...(id ? { id } : {})}
    >
      <h3 id={headingId} className="ptcgsim-settings-section__title">
        {title}
      </h3>
      {description ? (
        <p className="ptcgsim-settings-section__description">{description}</p>
      ) : null}
      <div className="ptcgsim-settings-section__body">{children}</div>
    </section>
  );
};

export interface SegmentedChoice<Value extends string> {
  readonly value: Value;
  /** The radio's id, for labels and tests. */
  readonly id: string;
  readonly label: string;
}

/** A row of radio buttons drawn as one control. */
export const SegmentedControl = <Value extends string>({
  name,
  legend,
  choices,
  value,
  onChange,
  children,
}: {
  readonly name: string;
  readonly legend: string;
  readonly choices: readonly SegmentedChoice<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  /** Notes or follow-up controls under the choice. */
  readonly children?: ReactNode;
}) => (
  <fieldset className="ptcgsim-form-group">
    <legend className="ptcgsim-form-label">{legend}</legend>
    <div className="ptcgsim-segmented-control">
      {choices.map((choice) => (
        <span key={choice.value} className="ptcgsim-segmented-control__option">
          <input
            type="radio"
            id={choice.id}
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <label htmlFor={choice.id}>{choice.label}</label>
        </span>
      ))}
    </div>
    {children}
  </fieldset>
);

/** One on/off choice with its label (and an optional hint) beside it. */
export const SwitchRow = ({
  id,
  label,
  checked,
  onChange,
  hint,
  disabled = false,
}: {
  readonly id: string;
  readonly label: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly hint?: ReactNode;
  readonly disabled?: boolean;
}) => (
  <div className="ptcgsim-switch-row">
    <input
      className="ds-switch"
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
    <label htmlFor={id}>
      {label}
      {hint ? <span className="ptcgsim-form-hint">{hint}</span> : null}
    </label>
  </div>
);

/** A labelled slider with its current value read out beside the label. */
export const RangeRow = ({
  id,
  label,
  valueText,
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled = false,
  ariaValueText,
  ends,
}: {
  readonly id: string;
  readonly label: string;
  /** What the value means, e.g. "12°" or "Mine 55%". */
  readonly valueText: string;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly disabled?: boolean;
  readonly ariaValueText?: string;
  /** Labels under the two ends of the track. */
  readonly ends?: readonly [ReactNode, ReactNode];
}) => (
  <div className="ptcgsim-form-group">
    <label className="ptcgsim-range-row" htmlFor={id}>
      <span className="ptcgsim-range-row__label">{label}</span>
      <output htmlFor={id}>{valueText}</output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        {...(ariaValueText ? { 'aria-valuetext': ariaValueText } : {})}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
    {ends ? (
      <div className="ptcgsim-range-row__ends" aria-hidden="true">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    ) : null}
  </div>
);

/** A row that opens something else: a sheet, a list, a page. */
export const LinkRow = ({
  id,
  icon,
  title,
  description,
  trailing,
  onClick,
}: {
  readonly id?: string;
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onClick: () => void;
}) => (
  <button
    type="button"
    className="ptcgsim-link-row"
    {...(id ? { id } : {})}
    onClick={onClick}
  >
    {icon ? <span className="ptcgsim-link-row__icon">{icon}</span> : null}
    <span className="ptcgsim-link-row__text">
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
    </span>
    {trailing ? (
      <span className="ptcgsim-link-row__trailing">{trailing}</span>
    ) : null}
  </button>
);
