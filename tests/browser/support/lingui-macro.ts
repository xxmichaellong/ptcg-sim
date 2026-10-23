/**
 * English stand-ins for Lingui's compile-time macros (`@lingui/core/macro`),
 * for the app code Playwright loads in Node: specs build board scenes and
 * layouts with `@ptcgsim/renderer-contract` to compare with the page. The app
 * and Vitest compile the real macros (ADR-034); Playwright cannot, so
 * tsconfig.playwright.json maps the macro module here, and these return the
 * English the compiled macros would.
 */

type Values = readonly unknown[];
type Descriptor = {
  readonly id?: string;
  readonly message?: string;
  readonly context?: string;
  readonly comment?: string;
};
type Input = TemplateStringsArray | Descriptor | string;

const isTemplate = (input: Input): input is TemplateStringsArray =>
  Array.isArray(input);

const english = (input: Input, values: Values): string => {
  if (typeof input === 'string') return input;
  if (isTemplate(input))
    return input.reduce(
      (text, literal, index) =>
        text + literal + (index < values.length ? String(values[index]) : ''),
      ''
    );
  return input.message ?? input.id ?? '';
};

/** Quotes what ICU would read as syntax, so a finished line survives `i18n._`. */
const quoted = (text: string): string =>
  text.replace(/'/gu, "''").replace(/[{}]/gu, (brace) => `'${brace}'`);

export const t = (input: Input, ...values: Values): string =>
  english(input, values);

export const msg = (input: Input, ...values: Values) => {
  const text = english(input, values);
  return { id: text, message: quoted(text) };
};

export const defineMessage = msg;

const choose = (
  key: string,
  value: number,
  cases: Readonly<Record<string, string>>
): string =>
  (cases[`=${value}`] ?? cases[key] ?? cases['other'] ?? '').replace(
    /#/gu,
    String(value)
  );

export const plural = (
  value: number,
  cases: Readonly<Record<string, string>>
): string => choose(new Intl.PluralRules('en').select(value), value, cases);

export const selectOrdinal = (
  value: number,
  cases: Readonly<Record<string, string>>
): string =>
  choose(
    new Intl.PluralRules('en', { type: 'ordinal' }).select(value),
    value,
    cases
  );

export const select = (
  value: string,
  cases: Readonly<Record<string, string>>
): string => cases[value] ?? cases['other'] ?? '';
