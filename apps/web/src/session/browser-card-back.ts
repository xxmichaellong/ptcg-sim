import { t } from '@lingui/core/macro';
import { LEGACY_DEFAULT_CARD_BACK_URL } from '@ptcgsim/game-core';
import { createElement } from 'react';

import { CardBackChooser } from '../card-backs/CardBackChooser.js';
import {
  encodeCardBackImage,
  fetchImportedPicture,
  uploadCardBackImage,
  type CardBackCropFocus,
} from '../card-backs/card-back-import.js';
import {
  RECENT_CARD_BACK_PREFERENCES,
  withRecentCardBack,
} from '../card-backs/card-back-preferences.js';
import {
  preferences,
  type PreferenceStore,
} from '../preferences/preference-store.js';
import {
  openPanel,
  type PanelOptions,
  type PromptOptions,
} from '../ui/dialog-requests.js';

/** The standard back, as rooms and saves have always spelled it. */
export const DEFAULT_CARD_BACK_URL = LEGACY_DEFAULT_CARD_BACK_URL;

/** Asks for one line of text: the overlay prompt dialog by default. */
export type BrowserTextPrompt = (
  options: PromptOptions
) => Promise<string | null>;

/** An outside picture fetched through the app, or null. */
export type CardBackPictureFetch = (
  url: string,
  signal: AbortSignal
) => Promise<Blob | null>;

/** A picture made a back of our own: its `img:` reference, or null. */
export type CardBackPictureSave = (
  picture: Blob,
  focus: CardBackCropFocus,
  signal: AbortSignal
) => Promise<string | null>;

export interface BrowserCardBackRequestOptions {
  readonly signal?: AbortSignal;
  /** The back the seat wears now, shown first. */
  readonly current?: string;
  /** Backs the player's saved decks wear, offered again. */
  readonly worn?: readonly string[];
  /** Opens the chooser: the overlay panel by default. */
  readonly open?: (options: PanelOptions) => Promise<string | null>;
  readonly fetchPicture?: CardBackPictureFetch;
  readonly savePicture?: CardBackPictureSave;
  /** Where the player's recent backs are kept. */
  readonly preferences?: PreferenceStore;
}

export type BrowserCardBackRequest = (
  options?: BrowserCardBackRequestOptions
) => Promise<string | undefined>;

/** How long a fetch or an upload may take before it is a failure. */
const CARD_BACK_NETWORK_MS = 30_000;

/** The request's signal, or the network's patience, whichever ends first. */
const patient = (signal: AbortSignal): AbortSignal =>
  AbortSignal.any([signal, AbortSignal.timeout(CARD_BACK_NETWORK_MS)]);

const fetchThroughApp: CardBackPictureFetch = (url, signal) =>
  fetchImportedPicture(url, { signal: patient(signal) });

const saveAsOwn: CardBackPictureSave = async (picture, focus, signal) => {
  const encoded = await encodeCardBackImage(picture, focus);
  if (!encoded || signal.aborted) return null;
  return await uploadCardBackImage(encoded, { signal: patient(signal) });
};

/**
 * Opens the card-back chooser (ADR-041 stage 2) and answers with the back
 * picked: a preset, a design, or a picture already stored as our own --
 * an outside link is fetched through the app and saved before it is
 * offered, so no opponent ever loads its host. Cancel or an aborted
 * request changes nothing. A design or picture chosen is kept to hand.
 */
export const requestBrowserCardBack: BrowserCardBackRequest = async (
  options = {}
) => {
  if (options.signal?.aborted) return undefined;
  const open = options.open ?? openPanel;
  const store = options.preferences ?? preferences();
  const recent = store.get(RECENT_CARD_BACK_PREFERENCES).backs;

  let answer: string | null;
  try {
    answer = await open({
      title: t`Card back`,
      className: 'card-back-chooser-dialog',
      content: (settle) =>
        createElement(CardBackChooser, {
          ...(options.current ? { current: options.current } : {}),
          worn: options.worn ?? [],
          recent,
          onChoose: settle,
          onCancel: () => settle(null),
          fetchPicture: options.fetchPicture ?? fetchThroughApp,
          savePicture: options.savePicture ?? saveAsOwn,
        }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return undefined;
  }
  if (!answer || options.signal?.aborted) return undefined;
  store.set(RECENT_CARD_BACK_PREFERENCES, {
    backs: withRecentCardBack(
      store.get(RECENT_CARD_BACK_PREFERENCES).backs,
      answer
    ),
  });
  return answer;
};
