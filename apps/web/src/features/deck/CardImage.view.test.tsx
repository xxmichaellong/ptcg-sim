// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CARD_IMAGE_PREFERENCES,
  forgetCardImageFailures,
} from '../../i18n/card-image-language.js';
import { preferences } from '../../preferences/preference-store.js';
import { CardImage, MISSING_CARD_IMAGE } from './CardImage.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TCGDEX = 'https://assets.tcgdex.net/en/sv/sv06/130/low.webp';
const SCAN =
  'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_130_R_EN.png';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  preferences().set(CARD_IMAGE_PREFERENCES, { cardImages: 'app' });
  forgetCardImageFailures();
});

const shown = () => document.querySelector('img')?.getAttribute('src');
const fail = async () =>
  act(async () => {
    document.querySelector('img')!.dispatchEvent(new Event('error'));
  });

describe('a card image', () => {
  it("is asked for in the player's card language, then each fallback in turn", async () => {
    preferences().set(CARD_IMAGE_PREFERENCES, { cardImages: 'de' });
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(<CardImage src={TCGDEX} fallback={SCAN} alt="" />)
    );
    expect(shown()).toBe('https://assets.tcgdex.net/de/sv/sv06/130/low.webp');
    await fail();
    expect(shown()).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/TWM/TWM_130_R_DE_LG.png'
    );
    await fail();
    expect(shown()).toBe(TCGDEX);
    await fail();
    expect(shown()).toBe(SCAN);
    // Nothing left to try: a blank card, not a broken image.
    await fail();
    expect(shown()).toBe(MISSING_CARD_IMAGE);
    expect(
      document.querySelector('img')!.hasAttribute('data-image-missing')
    ).toBe(true);
    // Another language asks again from the top.
    await act(async () =>
      preferences().set(CARD_IMAGE_PREFERENCES, { cardImages: 'en' })
    );
    expect(shown()).toBe(TCGDEX);
  });
});
