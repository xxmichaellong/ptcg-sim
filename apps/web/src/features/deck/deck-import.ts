import {
  catalogIndex,
  cardCategoryOf,
  customCardId,
  deckCardFromCatalog,
  deckListOf,
  findCatalogPrint,
  guessDeckFormat,
  lineCardId,
  parsePastedDecklist,
  parseSimCsvResult,
  resolveDecklistRow,
  SIM_CSV_HEADER,
  type DeckCard,
  type DeckEntry,
  type DeckFormatId,
  type DeckList,
  type LoadedCatalog,
  type PastedDecklistLanguage,
  type PastedDecklistRow,
} from '@ptcgsim/deck-core';
import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';

import type { ImportPastedDecklistOptions } from './limitless-decklist-contract.js';
import { completeRowsWithLimitless } from './pasted-decklist-import.js';

/**
 * Text in, deck out: a pasted or dropped decklist (Pokémon TCG Live,
 * Limitless, PTCGO, plain "4 Iono" lines) or a v1 simulator CSV becomes a
 * deck in one step.
 *
 * Each line is placed against the card catalog first -- set and number,
 * then name in that set, then Basic Energy, then name alone -- so a
 * current list resolves instantly and offline, every card with the facts
 * the rules check. Lines the catalog can't place go to Limitless's importer
 * (other languages, Japanese prints), and anything still unknown comes back
 * as a line to look at, never as a reason to refuse the rest.
 */

export interface DeckImportLine {
  readonly quantity: number;
  readonly name: string;
  /** "TWM 130", when the line gave one. */
  readonly print?: string;
}

export type DeckImportResult =
  | {
      readonly ok: true;
      readonly cards: DeckList;
      /** A name for the deck: the list's own, or its main attackers. */
      readonly name: string;
      readonly format: DeckFormatId;
      /** Lines no card could be found for; not in `cards`. */
      readonly missing: readonly DeckImportLine[];
    }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'invalid' | 'aborted';
      readonly message: string;
    };

export interface DeckImportOptions extends Pick<
  ImportPastedDecklistOptions,
  'endpoint' | 'fetch' | 'limits'
> {
  readonly catalog?: LoadedCatalog;
  readonly language?: PastedDecklistLanguage;
  readonly signal?: AbortSignal;
}

const RULE_BOX = ['ex', 'EX', 'GX', 'V', 'VSTAR', 'VMAX', 'Radiant'];

/**
 * A deck's name from its cards, as players name decks: its main attackers
 * ("Dragapult ex / Pidgeot ex"), else its most-played Pokémon.
 */
export const suggestDeckName = (
  cards: DeckList,
  tagsOf: (card: DeckCard) => readonly string[] = () => []
): string => {
  const pokemon = cards.filter((entry) => entry.card.category === 'Pokémon');
  const evolved = (entry: DeckEntry): boolean =>
    entry.card.facts?.stage !== undefined && entry.card.facts.stage !== 'Basic';
  const ruleBox = pokemon
    .filter(
      (entry) =>
        tagsOf(entry.card).some((tag) => RULE_BOX.includes(tag)) ||
        / (?:ex|EX|GX|V|VSTAR|VMAX)$/u.test(entry.card.name)
    )
    .sort(
      (left, right) =>
        Number(evolved(right)) - Number(evolved(left)) ||
        right.count - left.count
    );
  const [main, ...others] = ruleBox;
  if (main) {
    // A partner is named too when the deck is built around it (two or more,
    // evolved or three and up), not for a one-of support Pokémon.
    const partner = others.find(
      (entry) =>
        entry.card.name !== main.card.name &&
        entry.count >= 2 &&
        (evolved(entry) || entry.count >= 3)
    );
    return partner
      ? `${main.card.name} / ${partner.card.name}`
      : main.card.name;
  }
  const top = [...pokemon].sort((left, right) => right.count - left.count)[0];
  return top ? `${top.card.name} deck` : 'Imported deck';
};

/** "### Dragapult" or "Name: Dragapult" at the top of a list names it. */
const namedInText = (text: string): string | undefined => {
  for (const line of text.split(/\r\n|\n|\r/u).slice(0, 5)) {
    const match = /^\s*(?:#{1,3}\s*|name\s*:\s*|deck\s*:\s*)(.+?)\s*$/iu.exec(
      line
    );
    if (match?.[1]) return match[1].slice(0, 80);
  }
  return undefined;
};

const BASIC_ENERGY_LINE =
  /^(?:basic )?(?:grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy) energy$/iu;

/** A card from what a line (and Limitless) said, with no catalog facts. */
const cardFromLine = (row: PastedDecklistRow): DeckCard | undefined => {
  const category = cardCategoryOf(row.cardType);
  if (
    !category ||
    !row.imageUrl ||
    row.imageUrl.length > MAX_IMAGE_URL_CODE_UNITS
  ) {
    return undefined;
  }
  const basicEnergy = category === 'Energy' && BASIC_ENERGY_LINE.test(row.name);
  return Object.freeze({
    id: lineCardId(row) ?? customCardId([row.name, category, row.imageUrl]),
    name: row.name,
    category,
    image: row.imageUrl,
    ...(row.setCode ? { set: row.setCode } : {}),
    ...(row.number ? { number: row.number } : {}),
    ...(basicEnergy
      ? { facts: Object.freeze({ energyType: 'Basic' as const }) }
      : {}),
  });
};

const isCsv = (text: string): boolean =>
  text
    .replace(/^\uFEFF/u, '')
    .trimStart()
    .startsWith(SIM_CSV_HEADER);

const importCsv = (
  text: string,
  options: DeckImportOptions
): DeckImportResult => {
  const parsed = parseSimCsvResult(text);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: 'invalid',
      message: parsed.issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join(' '),
    };
  }
  // A v1 file kept only names and images; a catalogued printing gets its
  // facts back, so the rules can check it. The file's picture stays, its
  // thumbnail too: a German scan isn't shown small in English.
  const cards = deckListOf(
    parsed.cards.map(({ card, count }) => {
      const print =
        options.catalog && !card.presentation
          ? findCatalogPrint(options.catalog, card)
          : undefined;
      if (!print) return { card, count };
      const {
        imageSmall,
        image: catalogImage,
        ...found
      } = deckCardFromCatalog(print, { catalog: options.catalog! });
      const small = card.image === catalogImage ? imageSmall : card.imageSmall;
      return {
        card: {
          ...found,
          image: card.image,
          ...(small ? { imageSmall: small } : {}),
        },
        count,
      };
    })
  );
  return finish(cards, namedInText(text), []);
};

const finish = (
  cards: DeckList,
  name: string | undefined,
  missing: readonly DeckImportLine[]
): DeckImportResult =>
  cards.length === 0 && missing.length === 0
    ? {
        ok: false,
        reason: 'empty',
        message: 'There are no cards in that list.',
      }
    : {
        ok: true,
        cards,
        name: name ?? suggestDeckName(cards, (card) => card.facts?.tags ?? []),
        format: guessDeckFormat(cards),
        missing,
      };

export const importDeckText = async (
  text: string,
  options: DeckImportOptions = {}
): Promise<DeckImportResult> => {
  if (options.signal?.aborted) {
    return { ok: false, reason: 'aborted', message: '' };
  }
  if (!text.trim()) {
    return {
      ok: false,
      reason: 'empty',
      message: 'There is no list to import.',
    };
  }
  if (isCsv(text)) return importCsv(text, options);

  const parsed = parsePastedDecklist(text, {
    ...(options.language ? { language: options.language } : {}),
  });
  if (!parsed.ok) {
    return {
      ok: false,
      reason: 'invalid',
      message: parsed.issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join(' '),
    };
  }
  if (parsed.rows.length === 0) {
    return {
      ok: false,
      reason: 'empty',
      message: 'No card lines found. Lines look like "4 Iono PAL 185".',
    };
  }

  const entries: { card: DeckCard; count: number }[] = [];
  let rest: PastedDecklistRow[] = [];
  const index = options.catalog ? catalogIndex(options.catalog) : undefined;
  for (const row of parsed.rows) {
    const resolved = index ? resolveDecklistRow(index, row) : undefined;
    // A line naming a printing the catalog doesn't have (a set it lacks,
    // or one still being built) is never swapped for another card of its
    // name -- Charizard PGO 10 is not Base Set's -- but taken as the line
    // says, like a line the catalog can't place at all; its facts follow
    // once the catalog has it.
    if (resolved?.card && !(resolved.match === 'name' && row.setCode)) {
      const card = deckCardFromCatalog(resolved.card, {
        ...(options.language ? { language: options.language } : {}),
        ...(options.catalog ? { catalog: options.catalog } : {}),
      });
      entries.push({ card, count: row.quantity });
    } else {
      rest.push(row);
    }
  }

  const missing: DeckImportLine[] = [];
  if (rest.length > 0) {
    const completed = await completeRowsWithLimitless(rest, parsed.format, {
      ...(options.language ? { language: options.language } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.limits ? { limits: options.limits } : {}),
    });
    if (options.signal?.aborted) {
      return { ok: false, reason: 'aborted', message: '' };
    }
    rest = [...completed.rows];
    for (const row of rest) {
      const card = cardFromLine(row);
      if (card) entries.push({ card, count: row.quantity });
      else {
        missing.push({
          quantity: row.quantity,
          name: row.name,
          ...(row.setCode && row.number
            ? { print: `${row.setCode} ${row.number}` }
            : {}),
        });
      }
    }
  }
  return finish(deckListOf(entries), namedInText(text), missing);
};
