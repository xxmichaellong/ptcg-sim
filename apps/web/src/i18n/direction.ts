import { textDirection } from './locales.js';
import { useLingui } from './react.js';

/**
 * Which way the page's language is written (`<html dir>`), for a component
 * that has to know: one that places something by hand, or that sets the
 * direction again under the table, which stays left to right (ADR-034).
 * Re-renders when the language changes.
 */
export const usePageDirection = (): 'ltr' | 'rtl' =>
  textDirection(useLingui().i18n.locale);
