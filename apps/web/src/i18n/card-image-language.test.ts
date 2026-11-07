// @vitest-environment happy-dom

import type { BoardScene, CardSceneNode } from '@ptcgsim/renderer-contract';
import { afterEach, describe, expect, it } from 'vitest';

import { PreferenceStore } from '../preferences/preference-store.js';
import {
  CARD_IMAGE_PREFERENCES,
  cardImageAddresses,
  cardImageLanguage,
  cardImageLanguageFor,
  forgetCardImageFailures,
  localizedCardImage,
  localizeSceneCardImages,
  watchCardImageFailures,
} from './card-image-language.js';
import { LANGUAGE_PREFERENCES } from './language-preference.js';

const EN = 'https://assets.tcgdex.net/en/sv/sv06/130/low.webp';
const FR = 'https://assets.tcgdex.net/fr/sv/sv06/130/low.webp';
const OLD_EN = 'https://assets.tcgdex.net/en/dp/dp1/1/low.webp';
const OLD_FR = 'https://assets.tcgdex.net/fr/dp/dp1/1/low.webp';

afterEach(() => forgetCardImageFailures());

const store = () =>
  new PreferenceStore({ storage: null, window: null, writeDelayMs: 0 });

describe('the card image language', () => {
  it('follows the page while cards are printed in its language, else English, unless chosen', () => {
    expect(cardImageLanguageFor('app', 'fr')).toBe('fr');
    expect(cardImageLanguageFor('app', 'ja')).toBe('en');
    expect(cardImageLanguageFor('app', 'nl')).toBe('en');
    expect(cardImageLanguageFor('de', 'ja')).toBe('de');
    const preferences = store();
    preferences.set(LANGUAGE_PREFERENCES, { language: 'es' });
    expect(cardImageLanguage(preferences)).toBe('es');
    preferences.set(CARD_IMAGE_PREFERENCES, { cardImages: 'en' });
    expect(cardImageLanguage(preferences)).toBe('en');
  });

  it('reads back only a language cards are printed in', () => {
    expect(CARD_IMAGE_PREFERENCES.parse({ cardImages: 'it' })).toEqual({
      cardImages: 'it',
    });
    expect(CARD_IMAGE_PREFERENCES.parse({ cardImages: 'ja' })).toEqual({
      cardImages: 'app',
    });
    expect(CARD_IMAGE_PREFERENCES.parse(null)).toEqual({ cardImages: 'app' });
  });
});

describe('a card image in the player language', () => {
  it("asks for the translation, falling back to the deck's own scan until the translation fails", () => {
    expect(localizedCardImage(OLD_EN, 'fr')).toEqual({
      url: OLD_FR,
      fallbackUrl: OLD_EN,
    });
    const stop = watchCardImageFailures(document);
    const image = document.createElement('img');
    image.setAttribute('src', `${OLD_FR}?ptcgsim-retry=1`);
    document.body.append(image);
    image.dispatchEvent(new Event('error'));
    stop();
    image.remove();
    expect(localizedCardImage(OLD_EN, 'fr')).toEqual({ url: OLD_EN });
    // Other cards are still asked for in French.
    expect(localizedCardImage(EN, 'fr')).toEqual({ url: FR, fallbackUrl: EN });
  });

  it('tries each address once, keeping the last even when it failed', () => {
    const scan =
      'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_130_R_EN.png';
    const all = cardImageAddresses(EN, scan, 'fr');
    expect(all).toHaveLength(4);
    const stop = watchCardImageFailures(document);
    for (const url of all) {
      const image = document.createElement('img');
      image.setAttribute('src', url);
      document.body.append(image);
      image.dispatchEvent(new Event('error'));
      image.remove();
    }
    stop();
    expect(cardImageAddresses(EN, scan, 'fr')).toEqual([scan]);
  });

  it("paints the table's faces in it, leaving backs alone", () => {
    const card = (id: string, imageUrl: string, concealed = false) =>
      ({ id, imageUrl, concealed }) as unknown as CardSceneNode;
    const scene = {
      cards: [
        card('face', EN),
        card('back', '/v2/assets/cardback.png', true),
        card('upload', 'https://example.com/card.png'),
      ],
    } as unknown as BoardScene;
    const shown = localizeSceneCardImages(scene, 'fr');
    expect(shown.cards[0]).toMatchObject({
      imageUrl: FR,
      imageFallbackUrl: EN,
    });
    expect(shown.cards[1]).toBe(scene.cards[1]);
    expect(shown.cards[2]).toBe(scene.cards[2]);
    // English asks for nothing new: the same scene comes back.
    expect(localizeSceneCardImages(scene, 'en')).toBe(scene);
  });
});
