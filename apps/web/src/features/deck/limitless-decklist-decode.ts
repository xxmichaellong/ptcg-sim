import type { LegacyCardType } from '@ptcgsim/deck-core';

import {
  LimitlessDecklistError,
  type LimitlessDecklistCard,
  type LimitlessDecklistResponse,
  type ResolvedLimitlessDecklistLimits,
} from './limitless-decklist-contract.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalidResponse = (message: string): never => {
  throw new LimitlessDecklistError('invalid_response', message);
};

const optionalBoundedString = (
  value: unknown,
  label: string,
  maximumCodeUnits: number
): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string')
    return invalidResponse(`${label} must be a string or null.`);
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > maximumCodeUnits) {
    return invalidResponse(`${label} exceeds ${maximumCodeUnits} code units.`);
  }
  return normalized;
};

const decodeCardType = (value: unknown): LegacyCardType => {
  if (value === undefined || value === null || value === '') return 'Unknown';
  if (typeof value !== 'string' || value.length > 32) {
    return invalidResponse(
      'Limitless card_type must be a short string or null.'
    );
  }
  if (value === 'pokemon') return 'Pokémon';
  if (value === 'trainer') return 'Trainer';
  if (value === 'energy') return 'Energy';
  return 'Unknown';
};

const decodeCard = (value: unknown, index: number): LimitlessDecklistCard => {
  if (!isRecord(value))
    return invalidResponse(`Limitless cards[${index}] must be an object.`);
  const name = optionalBoundedString(
    value.name,
    `Limitless cards[${index}].name`,
    256
  );
  if (!name)
    return invalidResponse(`Limitless cards[${index}].name is required.`);
  const setCode = optionalBoundedString(
    value.set,
    `Limitless cards[${index}].set`,
    128
  );
  const number = optionalBoundedString(
    value.number,
    `Limitless cards[${index}].number`,
    128
  );
  const region = optionalBoundedString(
    value.region,
    `Limitless cards[${index}].region`,
    16
  );
  if (region !== undefined && region !== 'int' && region !== 'tpc') {
    return invalidResponse(
      `Limitless cards[${index}].region is not supported.`
    );
  }
  return Object.freeze({
    name,
    ...(setCode ? { setCode } : {}),
    ...(number ? { number } : {}),
    ...(region ? { region } : {}),
    cardType: decodeCardType(value.card_type),
  });
};

const optionalArray = (value: unknown, label: string): readonly unknown[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    return invalidResponse(`${label} must be an array.`);
  return value;
};

export const decodeLimitlessDecklistResponse = (
  value: unknown,
  limits: ResolvedLimitlessDecklistLimits
): LimitlessDecklistResponse => {
  if (!isRecord(value))
    return invalidResponse('Limitless response must be an object.');
  const cards = optionalArray(value.cards, 'Limitless cards');
  const errors = optionalArray(value.errors, 'Limitless errors');
  if (cards.length > limits.responseCards) {
    return invalidResponse(
      `Limitless returned more than ${limits.responseCards} cards.`
    );
  }
  if (errors.length > limits.responseErrors) {
    return invalidResponse(
      `Limitless returned more than ${limits.responseErrors} errors.`
    );
  }

  const decodedErrors = errors.map((error, index) => {
    if (typeof error !== 'string') {
      return invalidResponse(`Limitless errors[${index}] must be a string.`);
    }
    if (error.length > limits.errorCodeUnits) {
      return invalidResponse(
        `Limitless errors[${index}] exceeds ${limits.errorCodeUnits} code units.`
      );
    }
    return error;
  });

  return Object.freeze({
    cards: Object.freeze(cards.map(decodeCard)),
    errors: Object.freeze(decodedErrors),
  });
};
