import type { Icon } from '@phosphor-icons/react';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { useId, type ReactNode, type Ref } from 'react';

import './settings-list.css';

/**
 * Settings' list vocabulary (ADR-045), after Magic Garden's system menu:
 * rows grouped on cards, each with a coloured icon tile, its words, and at
 * its end a value and a chevron (a page), an arrow (outside), a switch or
 * a check. Groups may have a heading above and a note below their card.
 */

/** The icon tiles' colours, fixed in both themes as app icons are. */
export type SettingsTone =
  | 'blue'
  | 'brown'
  | 'cyan'
  | 'gold'
  | 'green'
  | 'indigo'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'slate'
  | 'teal';

/** A row's icon: a glyph on a small coloured tile. */
export const SettingsIcon = ({
  icon: Glyph,
  tone,
}: {
  readonly icon: Icon;
  readonly tone: SettingsTone;
}) => (
  <span className="settings-icon" data-tone={tone} aria-hidden="true">
    <Glyph weight="fill" />
  </span>
);

/** A card of rows, its heading above it and its note below. */
export const SettingsGroup = ({
  heading,
  footer,
  id,
  children,
}: {
  readonly heading?: ReactNode;
  readonly footer?: ReactNode;
  readonly id?: string;
  readonly children: ReactNode;
}) => {
  const headingId = useId();
  return (
    <section
      className="settings-group"
      {...(heading ? { 'aria-labelledby': headingId } : {})}
      {...(id ? { id } : {})}
    >
      {heading ? (
        <h3 id={headingId} className="settings-group__heading">
          {heading}
        </h3>
      ) : null}
      <div className="settings-group__card">{children}</div>
      {footer ? <p className="settings-group__footer">{footer}</p> : null}
    </section>
  );
};

/** A row's words: its label, and a line under it. */
const RowText = ({
  label,
  subtitle,
  lang,
}: {
  readonly label: ReactNode;
  readonly subtitle?: ReactNode;
  readonly lang?: string | undefined;
}) => (
  <span className="settings-row__text">
    <span className="settings-row__label" {...(lang ? { lang } : {})}>
      {label}
    </span>
    {subtitle ? (
      <span className="settings-row__subtitle">{subtitle}</span>
    ) : null}
  </span>
);

/**
 * A row that does something when pressed: opens a page (chevron), a page
 * elsewhere (arrow), or acts (no mark).
 */
export const SettingsLinkRow = ({
  id,
  icon,
  tone,
  label,
  subtitle,
  value,
  valueLang,
  trailing = 'chevron',
  accent = false,
  danger = false,
  disabled = false,
  buttonRef,
  onClick,
}: {
  readonly id?: string;
  readonly icon?: Icon;
  readonly tone?: SettingsTone;
  readonly label: ReactNode;
  readonly subtitle?: ReactNode;
  /** What it is set to, before the chevron ("English"). */
  readonly value?: ReactNode;
  readonly valueLang?: string | undefined;
  readonly trailing?: 'chevron' | 'external' | 'none';
  /** An action rather than a place: its label in the accent colour. */
  readonly accent?: boolean;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly onClick: () => void;
}) => (
  <button
    ref={buttonRef}
    type="button"
    className="settings-row"
    data-kind="link"
    data-icon={icon ? 'true' : undefined}
    data-accent={accent ? 'true' : undefined}
    data-danger={danger ? 'true' : undefined}
    disabled={disabled}
    {...(id ? { id } : {})}
    onClick={onClick}
  >
    {icon ? <SettingsIcon icon={icon} tone={tone ?? 'slate'} /> : null}
    <RowText label={label} subtitle={subtitle} />
    {value !== undefined && value !== null && value !== '' ? (
      <span
        className="settings-row__value"
        {...(valueLang ? { lang: valueLang } : {})}
      >
        {value}
      </span>
    ) : null}
    {trailing === 'chevron' ? (
      <CaretRightIcon
        // Points the way the page will slide in: left, right to left.
        className="settings-row__mark ds-mirror-rtl"
        aria-hidden="true"
        weight="bold"
      />
    ) : trailing === 'external' ? (
      <ArrowSquareOutIcon
        className="settings-row__mark"
        aria-hidden="true"
        weight="bold"
      />
    ) : null}
  </button>
);

/** A setting that is on or off: the whole row turns its switch. */
export const SettingsSwitchRow = ({
  id,
  icon,
  tone,
  label,
  subtitle,
  checked,
  disabled = false,
  onChange,
}: {
  readonly id: string;
  readonly icon?: Icon;
  readonly tone?: SettingsTone;
  readonly label: ReactNode;
  readonly subtitle?: ReactNode;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) => (
  <label
    className="settings-row"
    data-kind="switch"
    data-icon={icon ? 'true' : undefined}
    data-disabled={disabled ? 'true' : undefined}
    htmlFor={id}
  >
    {icon ? <SettingsIcon icon={icon} tone={tone ?? 'slate'} /> : null}
    <RowText label={label} subtitle={subtitle} />
    <input
      className="ds-switch"
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  </label>
);

export interface SettingsChoice<Value extends string> {
  readonly value: Value;
  /** The radio's id, for labels and tests. */
  readonly id: string;
  readonly label: ReactNode;
  readonly subtitle?: ReactNode;
  /** The language the label is written in (a language named in itself). */
  readonly lang?: string;
}

/**
 * One of several, as a card of rows: the chosen one checked. Each row is
 * a radio, so arrow keys move through them.
 */
export const SettingsChoiceGroup = <Value extends string>({
  name,
  legend,
  heading,
  footer,
  choices,
  value,
  onChange,
}: {
  readonly name: string;
  /** Read out for the choices; shown only where `heading` is not. */
  readonly legend: string;
  readonly heading?: ReactNode;
  readonly footer?: ReactNode;
  readonly choices: readonly SettingsChoice<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}) => (
  <SettingsGroup heading={heading} footer={footer}>
    <fieldset className="settings-choices">
      <legend className="ds-visually-hidden">{legend}</legend>
      {choices.map((choice) => (
        <label
          key={choice.value}
          className="settings-row"
          data-kind="choice"
          htmlFor={choice.id}
        >
          <input
            className="settings-row__radio"
            type="radio"
            id={choice.id}
            name={name}
            value={choice.value}
            checked={choice.value === value}
            onChange={() => onChange(choice.value)}
          />
          <RowText
            label={choice.label}
            subtitle={choice.subtitle}
            lang={choice.lang}
          />
          <CheckIcon
            className="settings-row__check"
            aria-hidden="true"
            weight="bold"
          />
        </label>
      ))}
    </fieldset>
  </SettingsGroup>
);

/**
 * A row holding a control of its own: a segmented choice, a slider, the
 * table's swatches.
 */
export const SettingsBlock = ({
  children,
  id,
}: {
  readonly children: ReactNode;
  readonly id?: string;
}) => (
  <div className="settings-row" data-kind="block" {...(id ? { id } : {})}>
    {children}
  </div>
);

/** The page's foot: a few quiet links, centred, or a way out. */
export const SettingsFooter = ({
  children,
}: {
  readonly children: ReactNode;
}) => <footer className="settings-footer">{children}</footer>;
