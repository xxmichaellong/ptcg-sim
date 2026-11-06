import { t } from '@lingui/core/macro';
import { LEGACY_DEFAULT_CARD_BACK_URL } from '@ptcgsim/game-core';
import { createElement } from 'react';

import { CardBackChooser } from '../card-backs/CardBackChooser.js';
import { RECENT_COIN_PREFERENCES } from '../card-backs/coin-preferences.js';
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

/** An outside image fetched through the app, or null. */
export type CardBackPictureFetch = (
  url: string,
  signal: AbortSignal
) => Promise<Blob | null>;

/** An image made a back of our own: its `img:` reference, or null. */
export type CardBackPictureSave = (
  picture: Blob,
  focus: CardBackCropFocus,
  signal: AbortSignal
) => Promise<string | null>;

export interface BrowserCardBackRequestOptions {
  readonly shape?: 'card' | 'coin';
  readonly signal?: AbortSignal;
  /** The back the seat wears now, shown first. */
  readonly current?: string;
  /** Backs the player's saved decks wear, offered again. */
  readonly worn?: readonly string[];
  /**
   * Takes a back the player deleted off the saved decks that wear it
   * (they wear Standard again); answers how to put it back on them.
   */
  readonly forgetWorn?: (back: string) => () => void;
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

const saveAsOwn =
  (shape: 'card' | 'coin'): CardBackPictureSave =>
  async (picture, focus, signal) => {
    const encoded = await encodeCardBackImage(picture, focus, shape);
    if (!encoded || signal.aborted) return null;
    return await uploadCardBackImage(encoded, { signal: patient(signal) });
  };

/**
 * Opens the card-back chooser (ADR-041 stage 2) and answers with the back
 * picked: a preset, a design, or an image already stored as our own --
 * an outside link is fetched through the app and saved before it is
 * offered, so no opponent ever loads its host. Cancel or an aborted
 * request changes nothing. A design or image chosen is kept to hand; one
 * deleted in the chooser leaves the recent backs and the saved decks.
 */
export const requestBrowserCardBack: BrowserCardBackRequest = async (
  options = {}
) => {
  if (options.signal?.aborted) return undefined;
  const open = options.open ?? openPanel;
  const store = options.preferences ?? preferences();
  const recentPreference =
    options.shape === 'coin'
      ? RECENT_COIN_PREFERENCES
      : RECENT_CARD_BACK_PREFERENCES;
  const recent = store.get(recentPreference).backs;
  const forget = (back: string): (() => void) => {
    const before = store.get(recentPreference).backs;
    store.set(recentPreference, {
      backs: before.filter((each) => each !== back),
    });
    const putBack = options.forgetWorn?.(back);
    return () => {
      store.set(recentPreference, { backs: before });
      putBack?.();
    };
  };

  let answer: string | null;
  try {
    answer = await open({
      title: options.shape === 'coin' ? t`Coin` : t`Card back`,
      className: 'card-back-chooser-dialog',
      content: (settle) =>
        createElement(CardBackChooser, {
          ...(options.shape ? { shape: options.shape } : {}),
          ...(options.current ? { current: options.current } : {}),
          worn: options.worn ?? [],
          recent,
          onChoose: settle,
          onCancel: () => settle(null),
          onForget: forget,
          fetchPicture: options.fetchPicture ?? fetchThroughApp,
          savePicture:
            options.savePicture ?? saveAsOwn(options.shape ?? 'card'),
        }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return undefined;
  }
  if (!answer || options.signal?.aborted) return undefined;
  store.set(recentPreference, {
    backs: withRecentCardBack(store.get(recentPreference).backs, answer),
  });
  return answer;
};
