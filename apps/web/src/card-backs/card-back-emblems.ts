import {
  CARD_BACK_BALLS,
  CARD_BACK_ENERGY,
  CARD_BACK_POKEMON_COUNT,
  canonicalCardBackEmblem,
  type CardBackEmblem,
} from '@ptcgsim/game-core';

/**
 * The sleeve designer's emblems (ADR-041 §6): real Pokémon iconography --
 * every Pokémon's official artwork (PokeAPI), the Poké Balls' Dream World
 * art (PokeAPI) and the TCG's Energy symbols -- as WebP files in one folder
 * named by its contents, cached for a year (`public/_headers`). An emblem a
 * design shows is fetched once and kept as a data URL, so the design's SVG,
 * drawn in each viewer's browser, can carry it (an SVG drawn as an image
 * loads nothing of its own).
 */

/** The emblems' folder, named by its contents. */
export const CARD_BACK_EMBLEM_SET = '5a1d681715';
const EMBLEM_PATH = `/v2/assets/emblems/${CARD_BACK_EMBLEM_SET}/`;

/** The picker's sheet of every Pokémon: 56px cells, 32 a row, in order. */
export const POKEMON_SHEET = {
  url: `${EMBLEM_PATH}pokemon-sheet.webp`,
  cell: 56,
  columns: 32,
  rows: Math.ceil(CARD_BACK_POKEMON_COUNT / 32),
} as const;

export type EmblemCategory = 'pokemon' | 'balls' | 'energy';

/** Every emblem of a category, in the designer's order. */
export const emblemsOf = (category: EmblemCategory): readonly string[] => {
  switch (category) {
    case 'pokemon':
      return Array.from(
        { length: CARD_BACK_POKEMON_COUNT },
        (_, index) => `pokemon-${String(index + 1)}`
      );
    case 'balls':
      return CARD_BACK_BALLS.map((ball) => `ball-${ball}`);
    case 'energy':
      return CARD_BACK_ENERGY.map((energy) => `energy-${energy}`);
  }
};

/** Which category an emblem is in. */
export const emblemCategory = (emblem: CardBackEmblem): EmblemCategory => {
  const real = canonicalCardBackEmblem(emblem);
  return real.startsWith('ball-')
    ? 'balls'
    : real.startsWith('energy-')
      ? 'energy'
      : 'pokemon';
};

/** A Pokémon emblem's National Pokédex number, or undefined. */
export const emblemPokemonNumber = (
  emblem: CardBackEmblem
): number | undefined => {
  const match = /^pokemon-(\d+)$/u.exec(emblem);
  return match ? Number(match[1]) : undefined;
};

/** An emblem's image file; none for `none`. */
export const emblemFile = (emblem: CardBackEmblem): string | undefined => {
  const real = canonicalCardBackEmblem(emblem);
  return real === 'none' ? undefined : `${EMBLEM_PATH}${real}.webp`;
};

// ---- The emblems a design shows, kept as data URLs ----------------------

const loaded = new Map<string, string>();
const loading = new Map<string, Promise<void>>();
/** When each emblem last failed to load: asked again a minute after. */
const failed = new Map<string, number>();
const listeners = new Set<() => void>();
const RETRY_MS = 60_000;
let version = 0;

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('unreadable emblem'));
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
    reader.readAsDataURL(blob);
  });

const load = (file: string): void => {
  if (loading.has(file) || typeof globalThis.fetch !== 'function') return;
  const last = failed.get(file);
  if (last !== undefined && Date.now() - last < RETRY_MS) return;
  // Kept as on its way before it starts, so a fetch that fails at once
  // still clears it.
  const fetchEmblem = async (): Promise<void> => {
    try {
      const response = await globalThis.fetch(file);
      if (!response.ok) throw new Error(`emblem ${String(response.status)}`);
      loaded.set(file, await readAsDataUrl(await response.blob()));
      failed.delete(file);
      version += 1;
      for (const listener of listeners) listener();
    } catch {
      failed.set(file, Date.now());
    } finally {
      loading.delete(file);
    }
  };
  loading.set(file, Promise.resolve().then(fetchEmblem));
};

/**
 * An emblem as a data URL to draw now, or undefined while it is fetched
 * (asked for here; `subscribeEmblems` says when it has come).
 */
export const emblemImage = (emblem: CardBackEmblem): string | undefined => {
  const file = emblemFile(emblem);
  if (!file) return undefined;
  const image = loaded.get(file);
  if (image === undefined) load(file);
  return image;
};

/** Tells `listener` each time an emblem asked for has come. */
export const subscribeEmblems = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Counts the emblems come so far: a snapshot for useSyncExternalStore. */
export const emblemsVersion = (): number => version;

/** Tests: waits for every emblem on its way to come or fail. */
export const settleEmblemsForTests = async (): Promise<void> => {
  await Promise.all(loading.values());
};

/** Tests: forgets every emblem kept, and every listener. */
export const resetEmblemsForTests = (): void => {
  loaded.clear();
  loading.clear();
  failed.clear();
  listeners.clear();
  version = 0;
};

// ---- Names, for the picker and its search --------------------------------

type NameTable = Readonly<Record<string, readonly (string | 0)[]>>;
let names: Promise<NameTable> | undefined;

/**
 * Every Pokémon's name, in the page's language where PokeAPI has it (else
 * English): loaded with the designer, not the table.
 */
export const pokemonNames = async (
  language: string
): Promise<readonly string[]> => {
  names ??= import('./card-back-pokemon-names.json').then(
    (module) => module.default as unknown as NameTable
  );
  const table = await names;
  const english = table.en as readonly string[];
  const base = language.toLowerCase().split('-')[0] ?? 'en';
  const own = table[base];
  return own
    ? english.map((name, index) => {
        const local = own[index];
        return typeof local === 'string' && local ? local : name;
      })
    : english;
};
