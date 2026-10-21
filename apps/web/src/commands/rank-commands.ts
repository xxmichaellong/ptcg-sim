import type { CommandEntry } from './command-tree.js';
import { createFuzzyScorer } from './fuzzy-score.js';
import { COMMAND_SECTIONS, type CommandSection } from './types.js';

/**
 * Ranks the palette's commands for a search (ADR-035 §5), ported from
 * Magic Circle's launcher: a command matches on its title, its title's
 * initials or a keyword (a little less), a nested one on its path too (a
 * little less again); recency and promotion add small
 * boosts that never beat a better match; results are capped overall and
 * per section and grouped with the best section first.
 */

const MAX_RECENT_SHOWN = 6;
const MAX_RESULTS = 18;
const MAX_PER_SECTION = 8;
const KEYWORD_WEIGHT = 0.9;
const NESTED_WEIGHT = 0.9;
const RECENCY_BOOST_MAX = 8;
const PROMOTED_BOOST = 20;

export type RankedSectionLabel = CommandSection | 'recent';

export interface RankedEntry {
  readonly entry: CommandEntry;
  /** A number typed after its name ("draw 3"), for a command taking one. */
  readonly count?: number;
}

export interface RankedSection {
  readonly section: RankedSectionLabel;
  readonly entries: readonly RankedEntry[];
}

/** "draw 3" → the words and the number; a lone number has no words. */
export const splitTrailingCount = (
  query: string
): { readonly text: string; readonly count?: number } => {
  // Up to five digits: damage goes to 9990; each command holds its own range.
  const match = /^(.*\S)\s+(\d{1,5})$/u.exec(query.trim());
  return match
    ? { text: match[1]!, count: Number(match[2]) }
    : { text: query.trim() };
};

const initialsCache = new Map<string, string>();

/** "Look at the top cards" → "latttc". */
const initialsOf = (title: string): string => {
  const cached = initialsCache.get(title);
  if (cached !== undefined) return cached;
  const initials = title
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toLowerCase();
  if (initialsCache.size > 2_000) initialsCache.clear();
  initialsCache.set(title, initials);
  return initials;
};

interface Scorers {
  /** Titles: exact > prefix > the rest. */
  readonly title: (candidate: string) => number;
  /** Keywords: by the match alone, below a title starting the same way. */
  readonly keyword: (candidate: string) => number;
}

const scorersFor = (query: string): Scorers => ({
  title: createFuzzyScorer(query),
  keyword: createFuzzyScorer(query, false),
});

const matchScore = (entry: CommandEntry, scorers: Scorers): number => {
  const { command } = entry;
  const score = scorers.title;
  let best = score(command.title);
  if (entry.ancestors.length === 0) {
    const initials = initialsOf(command.title);
    if (initials.length >= 2) best = Math.max(best, score(initials));
  } else if (entry.ancestorText !== '' && score(entry.ancestorText) <= 0) {
    // A nested command also matches with its path in front of it, but only
    // where the path alone does not: "language" lists Language… once, not
    // every language under it.
    best = Math.max(best, score(`${entry.ancestorText} ${command.title}`));
  }
  for (const keyword of command.keywords ?? []) {
    best = Math.max(best, scorers.keyword(keyword) * KEYWORD_WEIGHT);
  }
  return entry.ancestors.length === 0 ? best : best * NESTED_WEIGHT;
};

interface Scored {
  readonly ranked: RankedEntry;
  readonly score: number;
  /** Its place in the sources' own order, which settles a tie. */
  readonly order: number;
}

const compareScored = (left: Scored, right: Scored): number =>
  right.score - left.score || left.order - right.order;

/** Scores every entry; a command taking a number may take it from the end. */
const scoreAll = (
  entries: readonly CommandEntry[],
  query: string,
  boost: (entry: CommandEntry) => number
): Scored[] => {
  const whole = scorersFor(query);
  const { text, count } = splitTrailingCount(query);
  const words = count === undefined ? null : scorersFor(text);
  const scored: Scored[] = [];
  for (const [order, entry] of entries.entries()) {
    const takes = entry.command.count;
    if (words && takes && count !== undefined) {
      const match = matchScore(entry, words);
      if (match > 0) {
        scored.push({
          ranked: {
            entry,
            count: Math.min(takes.max, Math.max(takes.min, count)),
          },
          score: match + boost(entry),
          order,
        });
        continue;
      }
    }
    const match = matchScore(entry, whole);
    if (match > 0)
      scored.push({ ranked: { entry }, score: match + boost(entry), order });
  }
  return scored.sort(compareScored);
};

const isDirect = (entry: CommandEntry): boolean => entry.ancestors.length === 0;

/**
 * The root screen for a search. Empty: Recent, then each section's direct
 * commands in their declared order. Otherwise every entry, nested ones
 * included, ranked and capped, sections ordered by their best result.
 */
export const rankCommands = (
  entries: readonly CommandEntry[],
  query: string,
  recentIds: readonly string[]
): RankedSection[] => {
  if (query.trim() === '') {
    const byId = new Map(entries.map((entry) => [entry.command.id, entry]));
    const recent: RankedEntry[] = [];
    for (const id of new Set(recentIds)) {
      const entry = byId.get(id);
      if (!entry) continue;
      recent.push({ entry });
      if (recent.length >= MAX_RECENT_SHOWN) break;
    }
    const sections: RankedSection[] =
      recent.length > 0 ? [{ section: 'recent', entries: recent }] : [];
    for (const section of COMMAND_SECTIONS) {
      const listed = entries.filter(
        (entry) =>
          isDirect(entry) &&
          entry.section === section &&
          !entry.command.requiresQuery
      );
      if (listed.length > 0)
        sections.push({ section, entries: listed.map((entry) => ({ entry })) });
    }
    return sections;
  }
  const recency = new Map<string, number>();
  recentIds.forEach((id, index) => {
    if (!recency.has(id)) recency.set(id, index);
  });
  const scored = scoreAll(entries, query, (entry) => {
    const rank = recency.get(entry.command.id);
    return (
      (rank === undefined ? 0 : Math.max(1, RECENCY_BOOST_MAX - rank)) +
      (entry.promoted ? PROMOTED_BOOST : 0)
    );
  });
  const perSection = new Map<CommandSection, number>();
  const sections: RankedSection[] = [];
  const indexOf = new Map<CommandSection, number>();
  let kept = 0;
  for (const { ranked } of scored) {
    if (kept >= MAX_RESULTS) break;
    const section = ranked.entry.section;
    const inSection = perSection.get(section) ?? 0;
    if (inSection >= MAX_PER_SECTION) continue;
    perSection.set(section, inSection + 1);
    kept += 1;
    const at = indexOf.get(section);
    if (at === undefined) {
      indexOf.set(section, sections.length);
      sections.push({ section, entries: [ranked] });
    } else {
      (sections[at]!.entries as RankedEntry[]).push(ranked);
    }
  }
  return sections;
};

/**
 * A sub-screen's list: its own commands in order, or for a search,
 * everything under it ranked, with no sections, recents or caps.
 */
export const rankScreen = (
  entries: readonly CommandEntry[],
  query: string
): RankedEntry[] =>
  query.trim() === ''
    ? entries.filter(isDirect).map((entry) => ({ entry }))
    : scoreAll(entries, query, (entry) =>
        entry.promoted ? PROMOTED_BOOST : 0
      ).map(({ ranked }) => ranked);
