/**
 * The palette's fuzzy matcher, ported from Magic Circle's launcher
 * (ADR-035 §5). A candidate matches when every query character appears in
 * it in order, case-insensitively; among matches, word starts, runs and a
 * prefix score higher:
 *
 *   exact > prefix > word-start subsequence > scattered subsequence.
 *
 * An empty query matches everything with one neutral score.
 */

const SCORE_MATCH = 16;
const SCORE_BOUNDARY_BONUS = 12;
const SCORE_CONSECUTIVE_BONUS = 18;
const SCORE_PREFIX_BONUS = 40;
const SCORE_EXACT_BONUS = 60;

export const EMPTY_QUERY_SCORE = 1;

/** Accents don't have to be typed: "pokemon" finds "Pokémon". */
const fold = (char: string): string =>
  char.normalize('NFD').replace(/\p{Mn}/gu, '') || char;

interface CandidateParts {
  readonly chars: readonly string[];
  readonly lower: readonly string[];
}

/** Kept small: card names change with the table, unlike Magic Circle's. */
const partsCache = new Map<string, CandidateParts>();
const PARTS_KEPT = 4_000;

const partsOf = (candidate: string): CandidateParts => {
  const cached = partsCache.get(candidate);
  if (cached) return cached;
  const chars = [...candidate];
  const parts = {
    chars,
    lower: chars.map((char) => fold(char.toLowerCase())),
  };
  if (partsCache.size >= PARTS_KEPT) partsCache.clear();
  partsCache.set(candidate, parts);
  return parts;
};

/**
 * Prepares a query once for scoring many candidates. Without `tiers` the
 * prefix and exact bonuses are left out: a keyword (an English word, a
 * synonym) then never outranks a title that starts with the query.
 */
export const createFuzzyScorer = (
  query: string,
  tiers = true
): ((candidate: string) => number) => {
  const wanted = [...query].map((char) => fold(char.toLowerCase()));
  return (candidate) => score(wanted, candidate, tiers);
};

const NO_MATCH = Number.NEGATIVE_INFINITY;

const score = (
  query: readonly string[],
  candidate: string,
  tiers: boolean
): number => {
  if (query.length === 0) return EMPTY_QUERY_SCORE;
  const { chars, lower } = partsOf(candidate);
  const m = query.length;
  const n = chars.length;
  if (m > n || !isSubsequence(query, lower)) return 0;
  const aligned = bestAlignment(query, chars, lower, m, n);
  if (aligned <= NO_MATCH) return 0;
  let total = aligned;
  if (tiers && query.every((char, index) => lower[index] === char)) {
    total += SCORE_PREFIX_BONUS;
    if (m === n) total += SCORE_EXACT_BONUS;
  }
  return total;
};

/**
 * The best alignment of the query in the candidate: `previous[j]` is the
 * best score with the last matched query character at `j`, `best[j]` the
 * best of that row up to `j`.
 */
const bestAlignment = (
  query: readonly string[],
  chars: readonly string[],
  lower: readonly string[],
  m: number,
  n: number
): number => {
  let previous = new Array<number>(n).fill(NO_MATCH);
  let best = new Array<number>(n).fill(NO_MATCH);
  for (let i = 0; i < m; i += 1) {
    const current = new Array<number>(n).fill(NO_MATCH);
    for (let j = i; j < n; j += 1) {
      if (query[i] !== lower[j]) continue;
      const base =
        SCORE_MATCH + (isWordStart(chars, j) ? SCORE_BOUNDARY_BONUS : 0);
      if (i === 0) {
        current[j] = base;
        continue;
      }
      const gap = j >= 1 ? best[j - 1]! : NO_MATCH;
      if (gap > NO_MATCH) current[j] = gap + base;
      if (j >= 1 && previous[j - 1]! > NO_MATCH) {
        const run = previous[j - 1]! + base + SCORE_CONSECUTIVE_BONUS;
        if (run > current[j]!) current[j] = run;
      }
    }
    const nextBest = new Array<number>(n).fill(NO_MATCH);
    let running = NO_MATCH;
    for (let j = 0; j < n; j += 1) {
      if (current[j]! > running) running = current[j]!;
      nextBest[j] = running;
    }
    previous = current;
    best = nextBest;
  }
  return best[n - 1]!;
};

const isSubsequence = (
  query: readonly string[],
  candidate: readonly string[]
): boolean => {
  let index = 0;
  for (const char of candidate) {
    if (char !== query[index]) continue;
    index += 1;
    if (index === query.length) return true;
  }
  return false;
};

const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;
const isAlphaNumeric = (char: string): boolean => ALPHANUMERIC.test(char);
const isLetter = (char: string): boolean => LETTER.test(char);
const isDigit = (char: string): boolean => char >= '0' && char <= '9';
const isUpper = (char: string): boolean =>
  isLetter(char) && char === char.toUpperCase() && char !== char.toLowerCase();
const isLower = (char: string): boolean =>
  isLetter(char) && char === char.toLowerCase() && char !== char.toUpperCase();

/**
 * A word starts at the beginning, after a separator, at a camelCase hump,
 * and where digits begin or end.
 */
const isWordStart = (chars: readonly string[], j: number): boolean => {
  if (j === 0) return true;
  const before = chars[j - 1]!;
  const at = chars[j]!;
  return (
    (!isAlphaNumeric(before) && isAlphaNumeric(at)) ||
    (isLower(before) && isUpper(at)) ||
    (!isDigit(before) && isDigit(at)) ||
    (isDigit(before) && isLetter(at))
  );
};
