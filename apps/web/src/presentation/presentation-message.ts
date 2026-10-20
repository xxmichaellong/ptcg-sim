import { i18n as pageI18n, type I18n } from '@lingui/core';

/**
 * A line the table says (a Log line, an announcement), kept as a Lingui
 * message and its values rather than as finished text, so it is worded in
 * whatever language the page is in when it is shown (ADR-034). Names and
 * chat are values, never translated; a value may itself be a message (the
 * word for a hidden card), worded the same way.
 */
export interface PresentationMessage {
  readonly id: string;
  /** The English, absent from production builds (the catalog has it). */
  readonly message?: string;
  readonly comment?: string;
  readonly values?: Readonly<Record<string, PresentationValue>>;
}

export type PresentationValue = string | number | PresentationMessage;

/** The message in the page's language (or `i18n`'s). */
export const presentationText = (
  message: PresentationMessage,
  i18n: I18n = pageI18n
): string => {
  const { values } = message;
  if (!values) return i18n._(message);
  const worded: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(values)) {
    worded[name] =
      typeof value === 'object' ? presentationText(value, i18n) : value;
  }
  return i18n._({ ...message, values: worded });
};

const sameValue = (
  left: PresentationValue | undefined,
  right: PresentationValue | undefined
): boolean =>
  typeof left === 'object' && typeof right === 'object'
    ? samePresentationMessage(left, right)
    : left === right;

/**
 * The same line, whatever the language: the same message with the same
 * values. A production descriptor carries only its id, so the English is
 * never compared.
 */
export const samePresentationMessage = (
  left: PresentationMessage,
  right: PresentationMessage
): boolean => {
  if (left === right) return true;
  if (left.id !== right.id) return false;
  const leftValues = left.values ?? {};
  const rightValues = right.values ?? {};
  const names = Object.keys(leftValues);
  return (
    names.length === Object.keys(rightValues).length &&
    names.every((name) => sameValue(leftValues[name], rightValues[name]))
  );
};
