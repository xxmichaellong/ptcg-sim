import { i18n as pageI18n, type I18n } from '@lingui/core';

import { textDirection } from '../i18n/locales.js';

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

/**
 * A name set apart from the sentence around it (Unicode's first-strong
 * isolate), so a Latin name in Arabic keeps its own order and does not
 * pull the words or punctuation beside it round.
 */
const isolated = (value: string): string => `\u2068${value}\u2069`;

type CompiledToken =
  string | readonly [name: string, type?: string, format?: unknown];

/**
 * The values a message chooses its words by (`select`, `plural`,
 * `selectordinal`) rather than prints: they must reach Lingui exactly as
 * given, or a choice matches nothing and falls to `other`. Read from the
 * message as the catalog holds it (compiled), or from its source text.
 */
const choiceNames = (
  message: PresentationMessage,
  i18n: I18n
): ReadonlySet<string> => {
  const names = new Set<string>();
  const held: unknown = i18n.messages[message.id] ?? message.message;
  if (typeof held === 'string') {
    for (const match of held.matchAll(
      /\{\s*([\w$]+)\s*,\s*(?:select|plural|selectordinal)\s*,/gu
    ))
      names.add(match[1]!);
    return names;
  }
  const walk = (tokens: unknown): void => {
    if (!Array.isArray(tokens)) return;
    for (const token of tokens as readonly CompiledToken[]) {
      if (typeof token === 'string') continue;
      const [name, type, format] = token;
      if (type === 'select' || type === 'plural' || type === 'selectordinal') {
        names.add(name);
        if (format && typeof format === 'object')
          for (const choice of Object.values(format)) walk(choice);
      }
    }
  };
  walk(held);
  return names;
};

/** The message in the page's language (or `i18n`'s). */
export const presentationText = (
  message: PresentationMessage,
  i18n: I18n = pageI18n
): string => {
  const { values } = message;
  if (!values) return i18n._(message);
  const rightToLeft = textDirection(i18n.locale) === 'rtl';
  const choices = rightToLeft ? choiceNames(message, i18n) : new Set();
  const worded: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(values)) {
    worded[name] =
      typeof value === 'object'
        ? presentationText(value, i18n)
        : rightToLeft && typeof value === 'string' && !choices.has(name)
          ? isolated(value)
          : value;
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
