import { t } from '@lingui/core/macro';
import { LEGACY_DEFAULT_CARD_BACK_URL } from '@ptcgsim/game-core';
import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';

import { importCardBackFromUrl } from '../card-backs/card-back-import.js';
import { promptValue, type PromptOptions } from '../ui/dialog-requests.js';

/** What the dialog asks. `default` is typed as it is, in any language. */
export const cardBackPrompt = (): string =>
  t({
    message: "An image URL, or 'default'.",
    comment: "Keep 'default' in English: it is what the player types",
  });
export const invalidCardBackMessage = (): string => t`Enter a valid image URL.`;
/** The standard back, as rooms and saves have always spelled it. */
export const DEFAULT_CARD_BACK_URL = LEGACY_DEFAULT_CARD_BACK_URL;

/** Asks for one line of text: the overlay prompt dialog by default. */
export type BrowserTextPrompt = (
  options: PromptOptions
) => Promise<string | null>;

/**
 * Makes an outside picture a back of our own (ADR-041): its `img:`
 * reference, or null if it couldn't be fetched, read or stored.
 */
export type CardBackUrlImport = (
  url: string,
  signal: AbortSignal
) => Promise<string | null>;

export interface BrowserCardBackRequestOptions {
  readonly signal?: AbortSignal;
  readonly prompt?: BrowserTextPrompt;
  readonly importUrl?: CardBackUrlImport;
}

export type BrowserCardBackRequest = (
  options?: BrowserCardBackRequestOptions
) => Promise<string | undefined>;

/**
 * Asks for a card-back image and makes it ours before anything changes: the
 * picture is fetched once through the app, stored by its hash, and its
 * reference is what the table gets, so no opponent ever loads the address
 * (ADR-041; until the card-back chooser replaces this dialog). A URL that is
 * too long or can't be made a back keeps the dialog open with the source's
 * message; Cancel, an empty answer or an aborted request changes nothing.
 */
export const requestBrowserCardBack: BrowserCardBackRequest = async (
  options = {}
) => {
  if (options.signal?.aborted) return undefined;
  const ask = options.prompt ?? promptValue;
  const importUrl: CardBackUrlImport =
    options.importUrl ??
    ((url, signal) => importCardBackFromUrl(url, { signal }));
  // The back the last successful check made; the dialog accepts only then.
  let accepted: string | undefined;

  let answer: string | null;
  try {
    answer = await ask({
      title: t`Change card back`,
      body: cardBackPrompt(),
      label: t`Image URL`,
      placeholder: t({
        message: 'https://… or default',
        comment: "Keep 'default' in English: it is what the player types",
      }),
      submitLabel: t`Use image`,
      validate: async (value, { signal }) => {
        accepted = undefined;
        const normalized = value.trim();
        if (normalized === '') return null;
        if (normalized.length > MAX_IMAGE_URL_CODE_UNITS) {
          return invalidCardBackMessage();
        }
        if (normalized.toLowerCase() === 'default') {
          accepted = DEFAULT_CARD_BACK_URL;
          return null;
        }
        const ref = await importUrl(normalized, signal);
        if (signal.aborted) return null;
        if (!ref) return invalidCardBackMessage();
        accepted = ref;
        return null;
      },
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return undefined;
  }
  if (answer === null || options.signal?.aborted) return undefined;
  return accepted;
};
