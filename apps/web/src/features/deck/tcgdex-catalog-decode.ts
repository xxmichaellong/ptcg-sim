import type { DeckCard } from '@ptcgsim/deck-core';
import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';

import { TcgdexCatalogError } from './tcgdex-catalog-contract.js';

export interface TcgdexCardSummary {
  readonly id: string;
}

const TCGDEX_HIGH_IMAGE_SUFFIX = '/high.webp';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const optionalString = (
  value: unknown,
  maximumCodeUnits: number
): string | undefined =>
  typeof value === 'string' && value.length <= maximumCodeUnits
    ? value
    : undefined;

const requiredString = (
  value: unknown,
  maximumCodeUnits: number
): string | undefined => {
  const decoded = optionalString(value, maximumCodeUnits);
  return decoded ? decoded : undefined;
};

export const decodeTcgdexSummaries = (value: unknown): TcgdexCardSummary[] => {
  if (!Array.isArray(value)) {
    throw new TcgdexCatalogError(
      'invalid_response',
      'TCGdex card search did not return an array.'
    );
  }
  return value.map((summary, index) => {
    const id = isRecord(summary) ? requiredString(summary.id, 128) : undefined;
    if (!id) {
      throw new TcgdexCatalogError(
        'invalid_response',
        `TCGdex card summary ${index} has no valid id.`
      );
    }
    return { id };
  });
};

export const normalizeTcgdexCard = (value: unknown): DeckCard | undefined => {
  if (!isRecord(value)) return undefined;
  const id = requiredString(value.id, 128);
  const name = requiredString(value.name, 256);
  const imageBase = requiredString(
    value.image,
    MAX_IMAGE_URL_CODE_UNITS - TCGDEX_HIGH_IMAGE_SUFFIX.length
  );
  if (!id || !name || !imageBase) return undefined;

  const category = optionalString(value.category, 64) || 'Unknown';
  const set = isRecord(value.set) ? value.set : {};
  const image = `${imageBase}${TCGDEX_HIGH_IMAGE_SUFFIX}`;
  return {
    id,
    name,
    supertype: category.toLowerCase() === 'pokemon' ? 'Pokémon' : category,
    stage: optionalString(value.stage, 64) || '',
    number: optionalString(value.localId, 64) || '',
    set: {
      id: optionalString(set.id, 128) || '',
      name: optionalString(set.name, 256) || '',
      releaseDate: optionalString(set.releaseDate, 32) || '',
    },
    images: { small: image, large: image },
    image,
    rarity: optionalString(value.rarity, 128),
    _provider: 'tcgdex',
  };
};

export const decodeTcgdexSetReleaseDate = (value: unknown): string => {
  if (!isRecord(value)) return '';
  return optionalString(value.releaseDate, 32) || '';
};
