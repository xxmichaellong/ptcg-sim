import type { DeckCard } from './types.js';

export type CardPoolFilter = 'all' | 'pocket' | 'tcg';
export type CardSortField = 'name' | 'releaseDate';
export type SortDirection = 'asc' | 'desc';

export interface CardSearchControls {
  readonly cardType?: CardPoolFilter;
  readonly sortBy?: CardSortField;
  readonly sortDirection?: SortDirection;
}

const stripWildcards = (value: string): string =>
  value.replace(/^\*+|\*+$/gu, '').trim();

const compareReleaseDate = <Card extends DeckCard>(
  first: Card,
  second: Card,
  direction: SortDirection = 'desc'
): number => {
  const firstDate = first.set?.releaseDate || '';
  const secondDate = second.set?.releaseDate || '';

  if (firstDate && secondDate && firstDate !== secondDate) {
    return direction === 'asc'
      ? firstDate.localeCompare(secondDate)
      : secondDate.localeCompare(firstDate);
  }
  if (firstDate && !secondDate) return direction === 'asc' ? 1 : -1;
  if (!firstDate && secondDate) return direction === 'asc' ? -1 : 1;

  const nameComparison = (first.name || '').localeCompare(second.name || '');
  if (nameComparison !== 0) {
    return direction === 'asc' ? nameComparison : -nameComparison;
  }
  const idComparison = (first.id || '').localeCompare(second.id || '');
  return direction === 'asc' ? idComparison : -idComparison;
};

const compareName = <Card extends DeckCard>(
  first: Card,
  second: Card,
  direction: SortDirection = 'asc'
): number => {
  const comparison = (first.name || '').localeCompare(second.name || '');
  if (comparison !== 0) return direction === 'asc' ? comparison : -comparison;

  const releaseDateComparison = compareReleaseDate(first, second, direction);
  if (releaseDateComparison !== 0) return releaseDateComparison;

  const idComparison = (first.id || '').localeCompare(second.id || '');
  return direction === 'asc' ? idComparison : -idComparison;
};

export const applyLocalControls = <Card extends DeckCard>(
  cards: readonly Card[] = [],
  options: CardSearchControls = {}
): Card[] => {
  const {
    cardType = 'all',
    sortBy = 'releaseDate',
    sortDirection = 'desc',
  } = options;
  let filtered = [...cards];

  if (cardType === 'pocket') {
    filtered = filtered.filter((card) => (card.image || '').includes('/tcgp/'));
  } else if (cardType === 'tcg') {
    filtered = filtered.filter(
      (card) => !(card.image || '').includes('/tcgp/')
    );
  }

  filtered.sort((first, second) =>
    sortBy === 'name'
      ? compareName(first, second, sortDirection)
      : compareReleaseDate(first, second, sortDirection)
  );
  return filtered;
};

export const normalizeSearchQuery = (term: unknown): string => {
  let normalized = String(term).trim();

  if (/^E4$/iu.test(normalized)) return '4';
  if (/ E4 LV\. X$/iu.test(normalized)) {
    return normalized.replace(/ E4 LV\. X$/iu, ' 4');
  }
  if (/ E4 LV\.X$/iu.test(normalized)) {
    return normalized.replace(/ E4 LV\.X$/iu, ' 4');
  }
  if (/ E4$/iu.test(normalized)) {
    return normalized.replace(/ E4$/iu, ' 4');
  }

  normalized = normalized.replace(/\bLV\.X$/iu, 'LV. X');

  if (/^(prism star|◇|\{\*\})$/iu.test(normalized)) return '◇';
  if (/ prism star$/iu.test(normalized)) {
    return normalized.replace(/ prism star$/iu, ' ◇');
  }
  if (/ \{\*\}$/u.test(normalized)) {
    return normalized.replace(/ \{\*\}$/u, ' ◇');
  }

  if (/^(gold star|\*|☆)$/iu.test(normalized)) return 'Star';
  if (/ gold star$/iu.test(normalized)) {
    return normalized.replace(/ gold star$/iu, ' Star');
  }
  if (/ \*$/u.test(normalized)) {
    return normalized.replace(/ \*$/u, ' Star');
  }
  if (/ ☆$/u.test(normalized)) {
    return normalized.replace(/ ☆$/u, ' Star');
  }

  if (/^delta$/iu.test(normalized)) return 'δ';
  if (/ delta$/iu.test(normalized)) {
    return normalized.replace(/ delta$/iu, ' δ');
  }
  return normalized;
};

export const prepareCardSearchTerm = (term: unknown): string =>
  stripWildcards(normalizeSearchQuery(term));

export type CardSearchPlan =
  | {
      readonly type: 'stage';
      readonly stage: 'LEVEL-UP';
      readonly baseName: string;
    }
  | {
      readonly type: 'name';
      readonly queries: readonly string[];
    };

export const resolveSearchPlan = (term: string): CardSearchPlan => {
  if (/\bLV\. X$/iu.test(term)) {
    return {
      type: 'stage',
      stage: 'LEVEL-UP',
      baseName: term.replace(/\s*\bLV\. X$/iu, '').trim(),
    };
  }
  if (/-EX$/iu.test(term)) {
    return { type: 'name', queries: [term, term.replace(/-EX$/iu, ' EX')] };
  }
  if (/ EX$/iu.test(term)) {
    return { type: 'name', queries: [term, term.replace(/ EX$/iu, '-EX')] };
  }
  if (/-GX$/iu.test(term)) {
    return { type: 'name', queries: [term, term.replace(/-GX$/iu, ' GX')] };
  }
  if (/ GX$/iu.test(term)) {
    return { type: 'name', queries: [term, term.replace(/ GX$/iu, '-GX')] };
  }
  return { type: 'name', queries: [term] };
};
