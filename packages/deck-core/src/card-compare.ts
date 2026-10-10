const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const isDatabaseCard = (card: unknown = {}): boolean =>
  isRecord(card) && hasOwn(card, 'id') && hasOwn(card, 'images');

export const isFormattedDeckCard = (card: unknown = {}): boolean =>
  isRecord(card) && hasOwn(card, 'image');

export type CardShape = 'DatabaseCard' | 'FormattedDeckCard' | 'Unknown';

export const determineCardType = (card: unknown = {}): CardShape => {
  if (isDatabaseCard(card)) return 'DatabaseCard';
  if (isFormattedDeckCard(card)) return 'FormattedDeckCard';
  return 'Unknown';
};

const isObject = (value: unknown): value is object =>
  value !== null && typeof value === 'object';

const beginComparison = (
  first: object,
  second: object,
  compared: WeakMap<object, WeakSet<object>>
): boolean => {
  const previousSeconds = compared.get(first);
  if (previousSeconds?.has(second)) return false;
  if (previousSeconds) previousSeconds.add(second);
  else compared.set(first, new WeakSet([second]));
  return true;
};

const equalArrays = (
  first: readonly unknown[],
  second: readonly unknown[],
  compared: WeakMap<object, WeakSet<object>>
): boolean => {
  if (first.length !== second.length) return false;
  if (!beginComparison(first, second, compared)) return true;

  for (let index = 0; index < first.length; index += 1) {
    const firstItem = first[index];
    const secondItem = second[index];
    if (isRecord(firstItem) && isRecord(secondItem)) {
      if (!equalRecords(firstItem, secondItem, compared)) return false;
    } else if (Array.isArray(firstItem) && Array.isArray(secondItem)) {
      if (!equalArrays(firstItem, secondItem, compared)) return false;
    } else if (firstItem !== secondItem) {
      return false;
    }
  }
  return true;
};

const equalRecords = (
  first: Record<string, unknown>,
  second: Record<string, unknown>,
  compared: WeakMap<object, WeakSet<object>>
): boolean => {
  if (!beginComparison(first, second, compared)) return true;

  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);

  for (const key of firstKeys) {
    if (!secondKeys.includes(key) && key !== 'image' && key !== 'count') {
      return false;
    }
  }

  for (const key of secondKeys) {
    if (!firstKeys.includes(key) && key !== 'image' && key !== 'count') {
      return false;
    }
  }

  for (const key of firstKeys) {
    if (key === 'image' || key === 'count') continue;

    const firstValue = first[key];
    const secondValue = second[key];

    if (isRecord(firstValue) && isRecord(secondValue)) {
      if (!equalRecords(firstValue, secondValue, compared)) return false;
    } else if (Array.isArray(firstValue) && Array.isArray(secondValue)) {
      if (!equalArrays(firstValue, secondValue, compared)) return false;
    } else if (firstValue !== secondValue) {
      return false;
    }
  }

  return true;
};

export const areCardsEqual = (
  first: Readonly<Record<string, unknown>> = {},
  second: Readonly<Record<string, unknown>> = {}
): boolean => {
  if (!isObject(first) || !isObject(second)) return first === second;
  return equalRecords(
    first as Record<string, unknown>,
    second as Record<string, unknown>,
    new WeakMap()
  );
};
