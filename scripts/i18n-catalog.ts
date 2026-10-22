import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, type Token } from '@messageformat/parser';

/**
 * The web app's message catalogs (ADR-034): what the translate script and
 * the CI check read and write. A catalog maps a Lingui message id to its
 * English, context, translator comments and translation; `en.json` is the
 * source, written by `lingui extract`.
 */

export const CATALOG_DIRECTORY = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../apps/web/src/locales'
);

export interface CatalogEntry {
  readonly message?: string;
  readonly context?: string;
  readonly comments?: readonly string[];
  readonly obsolete?: boolean;
  readonly translation: string;
}

export type Catalog = Readonly<Record<string, CatalogEntry>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseCatalog = (content: string, label: string): Catalog => {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) throw new Error(`${label} is not a catalog`);
  for (const [id, entry] of Object.entries(parsed)) {
    if (!isRecord(entry) || typeof entry['translation'] !== 'string')
      throw new Error(`${label} has a malformed entry ${id}`);
  }
  return parsed as Catalog;
};

/** The same shape lingui.config.ts writes, so extract and translate agree. */
export const serializeCatalog = (catalog: Catalog): string =>
  `${JSON.stringify(catalog, null, 2)}\n`;

export const catalogPath = (
  locale: string,
  directory = CATALOG_DIRECTORY
): string => join(directory, `${locale}.json`);

export const readCatalog = async (
  locale: string,
  directory = CATALOG_DIRECTORY
): Promise<Catalog> =>
  parseCatalog(
    await readFile(catalogPath(locale, directory), 'utf8'),
    `${locale}.json`
  );

export const writeCatalog = async (
  locale: string,
  catalog: Catalog,
  directory = CATALOG_DIRECTORY
): Promise<void> => {
  await writeFile(catalogPath(locale, directory), serializeCatalog(catalog));
};

/** The English of a source entry: its message, else its translation. */
export const sourceText = (entry: CatalogEntry): string =>
  entry.message ?? entry.translation;

/** Messages a language should have: every live one in the source. */
export const liveSourceEntries = (
  source: Catalog
): readonly (readonly [string, CatalogEntry])[] =>
  Object.entries(source).filter(([, entry]) => !entry.obsolete);

interface MessageShape {
  readonly arguments: ReadonlyMap<string, string>;
  readonly selectCases: ReadonlyMap<string, readonly string[]>;
  readonly pluralsWithoutOther: readonly string[];
  readonly tags: readonly string[];
}

/** What a translation must keep: its arguments, select cases and tags. */
const messageShape = (message: string): MessageShape => {
  const argumentKinds = new Map<string, string>();
  const selectCases = new Map<string, string[]>();
  const pluralsWithoutOther: string[] = [];
  const walk = (tokens: readonly Token[]): void => {
    for (const token of tokens) {
      switch (token.type) {
        case 'argument':
          argumentKinds.set(token.arg, argumentKinds.get(token.arg) ?? 'value');
          break;
        case 'function':
          argumentKinds.set(token.arg, token.key);
          if (token.param) walk(token.param);
          break;
        case 'plural':
        case 'selectordinal':
        case 'select':
          argumentKinds.set(token.arg, token.type);
          if (token.type === 'select')
            selectCases.set(
              token.arg,
              token.cases.map(({ key }) => key).sort()
            );
          else if (!token.cases.some(({ key }) => key === 'other'))
            pluralsWithoutOther.push(token.arg);
          for (const branch of token.cases) walk(branch.tokens);
          break;
        default:
          break;
      }
    }
  };
  walk(parse(message));
  const tags = [...message.matchAll(/<\/?(\d+)\s*\/?>/gu)]
    .map(([tag]) => tag.replace(/\s+/gu, ''))
    .sort();
  return {
    arguments: argumentKinds,
    selectCases,
    pluralsWithoutOther,
    tags,
  };
};

/**
 * The scripts each language writes besides Latin, which every language uses
 * for names. A language missing here writes Latin alone.
 */
const LOCALE_SCRIPTS: Readonly<Record<string, RegExp>> = {
  ar: /\p{Script=Arabic}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  ko: /[\p{Script=Hangul}\p{Script=Han}]/u,
  ru: /\p{Script=Cyrillic}/u,
  sr: /\p{Script=Cyrillic}/u,
  th: /\p{Script=Thai}/u,
  zh: /\p{Script=Han}/u,
};

/** Languages that write accented Latin besides their own script. */
const ALSO_WRITES_LATIN: ReadonlySet<string> = new Set(['sr']);

/**
 * Languages written in their own script, word by word, where a Latin word
 * is a name the English has too ("Esc", "Limitless TCG", "Trainer" for
 * "Trainers", a declined "Guelpha"): a Latin word the English lacks
 * ("Започни potez"), or Latin inside a word ("دecksك", "deckك"), is a slip
 * of the translation. Arabic joins "و" and the like before a name
 * ("وPocket"), never an ending after one.
 */
const SPACED_OWN_SCRIPT: Readonly<Record<string, RegExp>> = {
  ar: /\p{Script=Arabic}\p{Script=Latin}+\p{Script=Arabic}|\p{Script=Latin}\p{Script=Arabic}/u,
  ru: /\p{Script=Cyrillic}\p{Script=Latin}|\p{Script=Latin}\p{Script=Cyrillic}/u,
  sr: /\p{Script=Cyrillic}\p{Script=Latin}|\p{Script=Latin}\p{Script=Cyrillic}/u,
};

/**
 * A message's words: its text, every case's included, without tags,
 * placeholders, or ICU keywords and case keys.
 */
const proseOf = (message: string): string => {
  const text: string[] = [];
  const walk = (tokens: readonly Token[]): void => {
    for (const token of tokens) {
      switch (token.type) {
        case 'content':
          text.push(token.value);
          break;
        case 'function':
          if (token.param) walk(token.param);
          break;
        case 'plural':
        case 'selectordinal':
        case 'select':
          for (const branch of token.cases) walk(branch.tokens);
          break;
        default:
          break;
      }
    }
  };
  try {
    walk(parse(message));
  } catch {
    // Unparseable: `translationProblem` says so first.
    return '';
  }
  // A tag is no gap between letters ("<0>deck</0>ك" is one word).
  return text.join(' ').replaceAll(/<\/?\d+\s*\/?>/gu, '');
};

const strayLatin = (text: string, locale: string, source: string): boolean => {
  const mixed = SPACED_OWN_SCRIPT[locale];
  if (!mixed) return false;
  const prose = proseOf(text);
  // "Pokémon" too takes no ending glued on ("Pokémonа"); as a word it is
  // written so in every language.
  if (mixed.test(prose)) return true;
  const words = prose.replaceAll('Pokémon', ' ');
  const english =
    proseOf(source)
      .toLowerCase()
      .match(/\p{L}+/gu) ?? [];
  // The same word, or one stem with another ending (min three letters).
  const sameStem = (left: string, right: string): boolean =>
    left === right ||
    (Math.min(left.length, right.length) >= 3 &&
      (left.startsWith(right) || right.startsWith(left)));
  return (words.match(/\p{Script=Latin}{2,}/gu) ?? []).some(
    (word) => !english.some((known) => sameStem(word.toLowerCase(), known))
  );
};

/** UTF-8 read back as Windows-1250/1252 ("Ã©" for "é", "â€™" for "’"). */
const MISENCODED_LATIN =
  /Ă(?![A-Za-z])|Ĺ|Ä[\u0080-¿Ā-ſ‘-™]|[ÃÅĆ][\u0080-\u009F¡-¿]|Â[\u0080-\u009F¡-¿Ā-ſ]|â€/u;

/**
 * Known encoding and script mistakes, not translation quality: a literal
 * `\uXXXX`, a letter from a script the language does not write (and the
 * source does not contain), stray Latin (`strayLatin`), or mojibake.
 */
export const looksGarbled = (
  text: string,
  locale: string,
  source = ''
): boolean => {
  for (const escape of text.match(/\\u[\da-f]{4}/giu) ?? [])
    if (!source.includes(escape)) return true;
  const own = LOCALE_SCRIPTS[locale];
  const writesLatin = !own || ALSO_WRITES_LATIN.has(locale);
  // Pokémon is written so in every language, its accent included.
  const letters = text.replace(/Pokémon/gu, '').match(/\p{L}/gu) ?? [];
  for (const letter of letters) {
    if (
      source.includes(letter) ||
      /[\p{Script=Common}\p{Script=Inherited}]/u.test(letter)
    )
      continue;
    const foreign = /\p{Script=Latin}/u.test(letter)
      ? !writesLatin && letter > '\u007f'
      : !own?.test(letter);
    if (foreign) return true;
  }
  if (strayLatin(text, locale, source)) return true;
  return writesLatin && MISENCODED_LATIN.test(text);
};

const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

/**
 * Why a translation of `source` into `locale` cannot ship, or undefined
 * when it can: blank, unparseable, a lost, renamed or extra placeholder, a
 * changed select, a plural without `other`, a lost or extra tag, or garbled
 * text.
 */
export const translationProblem = (
  source: string,
  translation: string | undefined,
  locale: string
): string | undefined => {
  if (!translation?.trim()) return 'missing';
  let expected: MessageShape;
  let actual: MessageShape;
  try {
    expected = messageShape(source);
  } catch {
    return 'the English does not parse';
  }
  try {
    actual = messageShape(translation);
  } catch (error) {
    return `does not parse (${error instanceof Error ? error.message : String(error)})`;
  }
  for (const [name, kind] of expected.arguments) {
    const translated = actual.arguments.get(name);
    if (translated === undefined) return `lost {${name}}`;
    // A language without plural or ordinal forms may say the bare number.
    const bareNumber =
      translated === 'value' && (kind === 'plural' || kind === 'selectordinal');
    if (translated !== kind && !bareNumber)
      return `{${name}} became ${translated}`;
  }
  for (const name of actual.arguments.keys())
    if (!expected.arguments.has(name)) return `added {${name}}`;
  for (const [name, cases] of expected.selectCases)
    if (!sameList(cases, actual.selectCases.get(name) ?? []))
      return `changed the cases of {${name}}`;
  if (actual.pluralsWithoutOther.length > 0)
    return `a plural without "other" ({${actual.pluralsWithoutOther[0]}})`;
  if (!sameList(expected.tags, actual.tags)) return 'changed the tags';
  if (looksGarbled(translation, locale, source)) return 'garbled';
  return undefined;
};

export interface CatalogProblem {
  readonly id: string;
  readonly problem: string;
}

/** Every message `catalog` (in `locale`) cannot ship as it is. */
export const catalogProblems = (
  source: Catalog,
  catalog: Catalog,
  locale: string
): readonly CatalogProblem[] => {
  const problems: CatalogProblem[] = [];
  for (const [id, entry] of liveSourceEntries(source)) {
    const problem = translationProblem(
      sourceText(entry),
      catalog[id]?.translation,
      locale
    );
    if (problem) problems.push({ id, problem });
  }
  return problems;
};
