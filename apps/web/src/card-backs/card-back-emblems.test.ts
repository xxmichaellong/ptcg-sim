// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CARD_BACK_EMBLEM_SET,
  emblemCategory,
  emblemFile,
  emblemImage,
  emblemsOf,
  emblemsVersion,
  pokemonNames,
  resetEmblemsForTests,
  settleEmblemsForTests as settle,
  subscribeEmblems,
} from './card-back-emblems.js';

afterEach(() => {
  resetEmblemsForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the sleeve emblems', () => {
  it('offers every Pokémon, the Poké Balls and the Energy types, each in its folder', () => {
    expect(emblemsOf('pokemon')).toHaveLength(1025);
    expect(emblemsOf('pokemon')[24]).toBe('pokemon-25');
    expect(emblemsOf('balls')).toContain('ball-master');
    expect(emblemsOf('energy')).toHaveLength(11);
    expect(emblemFile('pokemon-25')).toBe(
      `/v2/assets/emblems/${CARD_BACK_EMBLEM_SET}/pokemon-25.webp`
    );
    // The first designer's emblems draw as the real ones they meant.
    expect(emblemFile('moon')).toBe(
      `/v2/assets/emblems/${CARD_BACK_EMBLEM_SET}/energy-darkness.webp`
    );
    expect(emblemCategory('ball')).toBe('balls');
    expect(emblemCategory('star')).toBe('energy');
    expect(emblemFile('none')).toBeUndefined();
  });

  it('fetches an emblem once, keeps it as a data URL and says when it has come', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Blob(['webp'], { type: 'image/webp' }), {
          status: 200,
        })
    );
    vi.stubGlobal('fetch', fetch);
    const listener = vi.fn();
    subscribeEmblems(listener);
    expect(emblemImage('pokemon-25')).toBeUndefined();
    // Asked again while on its way: one fetch.
    expect(emblemImage('pokemon-25')).toBeUndefined();
    await settle();
    expect(fetch).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    expect(emblemsVersion()).toBe(1);
    expect(emblemImage('pokemon-25')).toMatch(/^data:image\/webp;base64,/u);
    expect(emblemImage('none')).toBeUndefined();
  });

  it('asks again for an emblem that failed only a minute later', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    emblemImage('energy-fire');
    await settle();
    emblemImage('energy-fire');
    await settle();
    expect(fetch).toHaveBeenCalledOnce();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    emblemImage('energy-fire');
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('names every Pokémon in the page’s language where it can, else in English', async () => {
    const english = await pokemonNames('en');
    expect(english).toHaveLength(1025);
    expect(english[24]).toBe('Pikachu');
    const french = await pokemonNames('fr');
    expect(french[0]).toBe('Bulbizarre');
    // A language without its own names (Polish) reads English.
    expect((await pokemonNames('pl'))[24]).toBe('Pikachu');
  });
});
