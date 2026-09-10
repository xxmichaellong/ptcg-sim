import {
  MAX_DECK_CARD_NAME_CODE_UNITS,
  MAX_DECK_CARD_QUANTITY,
  MAX_DECK_IMAGE_URL_CODE_UNITS,
  MAX_DECK_TOTAL_CARDS,
} from './csv-adapter.js';
import {
  getLegacyCurrentCardType,
  getLegacyOldCardType,
  type LegacyCardType,
} from './legacy-card-type-lookup.js';

export const MAX_PASTED_DECKLIST_CODE_UNITS = 1_000_000;
export const MAX_PASTED_DECKLIST_LINES = 10_000;
export const MAX_PASTED_DECKLIST_LINE_CODE_UNITS = 8_192;
export const MAX_PASTED_DECKLIST_TOKEN_CODE_UNITS = 128;

export const PASTED_DECKLIST_LANGUAGES = [
  'English',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Spanish',
] as const;

export type PastedDecklistLanguage = (typeof PASTED_DECKLIST_LANGUAGES)[number];
export type PastedDecklistFormat = 'pocket' | 'legacy' | 'unknown';

export interface PastedDecklistRow {
  readonly quantity: number;
  readonly name: string;
  readonly setCode?: string;
  readonly number?: string;
  readonly catalogId?: string;
  readonly imageUrl?: string;
  readonly cardType: LegacyCardType;
}

export type PastedDecklistIssueCode =
  | 'input_too_large'
  | 'too_many_lines'
  | 'line_too_long'
  | 'invalid_quantity'
  | 'deck_too_large'
  | 'name_too_long'
  | 'token_too_long'
  | 'url_too_long';

export interface PastedDecklistIssue {
  readonly code: PastedDecklistIssueCode;
  readonly line?: number;
  readonly message: string;
}

export type ParsePastedDecklistResult =
  | {
      readonly ok: true;
      readonly format: PastedDecklistFormat;
      readonly rows: readonly PastedDecklistRow[];
    }
  | { readonly ok: false; readonly issues: readonly PastedDecklistIssue[] };

interface ParsedRow {
  readonly line: number;
  readonly quantity: number;
  readonly name: string;
  readonly setCode?: string;
  readonly number?: string;
  readonly catalogId?: string;
}

const OLD_SET_TO_CATALOG_ID: Readonly<Record<string, string>> = Object.freeze({
  BS: 'base1',
  JU: 'base2',
  PR: 'basep',
  FO: 'base3',
  B2: 'base4',
  TR: 'base5',
  G1: 'gym1',
  G2: 'gym2',
  N1: 'neo1',
  N2: 'neo2',
  N3: 'neo3',
  N4: 'neo4',
  LC: 'base6',
  EX: 'ecard1',
  BP: 'bp',
  AQ: 'ecard2',
  SK: 'ecard3',
  RS: 'ex1',
  SS: 'ex2',
  DR: 'ex3',
  'PR-NP': 'np',
  MA: 'ex4',
  HL: 'ex5',
  RG: 'ex6',
  TRR: 'ex7',
  DX: 'ex8',
  EM: 'ex9',
  UF: 'ex10',
  DS: 'ex11',
  LM: 'ex12',
  HP: 'ex13',
  CG: 'ex14',
  DF: 'ex15',
  PK: 'ex16',
  DP: 'dp1',
  MT: 'dp2',
  SW: 'dp3',
  GE: 'dp4',
  MD: 'dp5',
  LA: 'dp6',
  SF: 'dp7',
  PL: 'pl1',
  RR: 'pl2',
  SV: 'pl3',
  AR: 'pl4',
  POP1: 'pop1',
  POP2: 'pop2',
  POP3: 'pop3',
  POP4: 'pop4',
  POP5: 'pop5',
  POP6: 'pop6',
  POP7: 'pop7',
  POP8: 'pop8',
  POP9: 'pop9',
  P1: 'pop1',
  P2: 'pop2',
  P3: 'pop3',
  P4: 'pop4',
  P5: 'pop5',
  P6: 'pop6',
  P7: 'pop7',
  P8: 'pop8',
  P9: 'pop9',
  pop1: 'pop1',
  pop2: 'pop2',
  pop3: 'pop3',
  pop4: 'pop4',
  pop5: 'pop5',
  pop6: 'pop6',
  pop7: 'pop7',
  pop8: 'pop8',
  pop9: 'pop9',
  SI: 'si1',
  RM: 'ru1',
  FUT20: 'fut20',
  BS2: 'base4',
  EXP: 'ecard1',
  AQP: 'ecard2',
  SKR: 'ecard3',
  E1: 'ecard1',
  E2: 'ecard2',
  E3: 'ecard3',
  WBP: 'basep',
  WBSP: 'basep',
  NP: 'np',
  NBSP: 'np',
  FRLG: 'ex6',
  BG: 'bp',
});

const NO_IMAGE_CATALOG_IDS: Readonly<Record<string, string>> = Object.freeze({
  'BUS 112a': 'sm3-112a',
  'FLI 102a': 'sm6-102a',
  'UNM 191a': 'sm11-191a',
  'GRI 121a': 'sm2-121a',
  'UPR 119a': 'sm5-119a',
  'BUS 115a': 'sm3-115a',
  'UPR 125a': 'sm5-125a',
  'UPR 153a': 'sm5-153a',
  'UNB 182a': 'sm10-182a',
  'TEU 152a': 'sm9-152a',
  'LOT 188a': 'sm8-188a',
  'SLG 68a': 'sm35-68a',
  'UPR 135a': 'sm5-135a',
  'UNB 189a': 'sm10-189a',
  'SVP 85': 'svp-85',
  'SVP 102': 'svp-102',
  'SVP 190': 'svp-190',
  'SVP 191': 'svp-191',
  'SVP 192': 'svp-192',
});

const SET_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'PR-SV': 'SVP',
  'PR-SW': 'SP',
  'PR-SM': 'SMP',
  'PR-XY': 'XYP',
  'PR-BLW': 'BWP',
  'PR-HS': 'HSP',
  sma: 'HIF',
});

const TPC_SET_CODES = new Set([
  'SV11W',
  'SV11B',
  'SV11',
  'SV10W',
  'SV10',
  'SV9W',
  'SV9',
  'SV8W',
  'SV8',
  'SV7W',
  'SV7',
  'SV6W',
  'SV6',
  'SV5W',
  'SV5',
  'SV4W',
  'SV4',
  'SV3W',
  'SV3',
  'SV2W',
  'SV2',
  'SV1W',
  'SV1',
]);

const POCKET_LEGACY_COLLISIONS = new Set([
  'N1',
  'N2',
  'N3',
  'N4',
  'G1',
  'G2',
  'E1',
  'E2',
  'E3',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P8',
  'P9',
]);

const LANGUAGE_CODES: Readonly<Record<PastedDecklistLanguage, string>> = {
  English: 'EN',
  French: 'FR',
  German: 'DE',
  Italian: 'IT',
  Portuguese: 'PT',
  Spanish: 'ES',
};

const energyImages = (
  language: PastedDecklistLanguage
): Readonly<Record<string, string>> => {
  const code = LANGUAGE_CODES[language];
  const tpci = 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/';
  const energy = (set: string, symbol: string): string =>
    `${tpci}${set}/${set}_${symbol}_R_${code}.png`;
  const current = {
    Fire: energy('BRS', 'R'),
    Grass: energy('BRS', 'G'),
    Fairy: energy('TEU', 'Y'),
    Darkness: energy('BRS', 'D'),
    Lightning: energy('BRS', 'L'),
    Fighting: energy('BRS', 'F'),
    Psychic: energy('BRS', 'P'),
    Metal: energy('BRS', 'M'),
    Water: energy('BRS', 'W'),
  } as const;
  return Object.freeze({
    'Fire Energy': current.Fire,
    'Grass Energy': current.Grass,
    'Fairy Energy': current.Fairy,
    'Darkness Energy': current.Darkness,
    'Lightning Energy': current.Lightning,
    'Fighting Energy': current.Fighting,
    'Psychic Energy': current.Psychic,
    'Metal Energy': current.Metal,
    'Water Energy': current.Water,
    'Basic Fire Energy': current.Fire,
    'Basic Grass Energy': current.Grass,
    'Basic Fairy Energy': current.Fairy,
    'Basic Darkness Energy': current.Darkness,
    'Basic Lightning Energy': current.Lightning,
    'Basic Fighting Energy': current.Fighting,
    'Basic Psychic Energy': current.Psychic,
    'Basic Metal Energy': current.Metal,
    'Basic Water Energy': current.Water,
    'Basic {W} Energy Energy': current.Water,
    'Basic {R} Energy Energy': current.Fire,
    'Basic {G} Energy Energy': current.Grass,
    'Basic {Y} Energy Energy': current.Fairy,
    'Basic {D} Energy Energy': current.Darkness,
    'Basic {L} Energy Energy': current.Lightning,
    'Basic {F} Energy Energy': current.Fighting,
    'Basic {P} Energy Energy': current.Psychic,
    'Basic {M} Energy Energy': current.Metal,
    'Basic Fire Energy null': energy('SVE', '002'),
    'Basic Grass Energy null': energy('SVE', '001'),
    'Basic Darkness Energy null': energy('SVE', '007'),
    'Basic Lightning Energy null': energy('SVE', '004'),
    'Basic Fighting Energy null': energy('SVE', '006'),
    'Basic Psychic Energy null': energy('SVE', '005'),
    'Basic Metal Energy null': energy('SVE', '008'),
    'Basic Water Energy null': energy('SVE', '003'),
  });
};

export const isPastedDecklistPocketSet = (
  setCode: string,
  format: PastedDecklistFormat = 'unknown'
): boolean => {
  if (POCKET_LEGACY_COLLISIONS.has(setCode)) return false;
  if (setCode === 'B2' && format === 'legacy') return false;
  return /^[A-Z]\d+[a-z]?$/u.test(setCode) || setCode === 'P-A';
};

const isUnambiguousPocketCode = (setCode: string): boolean =>
  setCode === 'P-A' || setCode === 'B1' || /^A\d+[a-z]?$/u.test(setCode);

const detectFormat = (rows: readonly ParsedRow[]): PastedDecklistFormat => {
  let pocket = false;
  let legacy = false;
  for (const { setCode } of rows) {
    if (!setCode || setCode === 'B2') continue;
    if (isUnambiguousPocketCode(setCode)) pocket = true;
    else if (
      POCKET_LEGACY_COLLISIONS.has(setCode) ||
      !/^[A-Z]\d+[a-z]?$/u.test(setCode)
    ) {
      legacy = true;
    }
  }
  if (legacy && !pocket) return 'legacy';
  if (pocket && !legacy) return 'pocket';
  return 'unknown';
};

const parseLine = (sourceLine: string, line: number): ParsedRow | undefined => {
  let value = sourceLine.replace(/[[\]()]/gu, '');
  value = value.replace(/(?!PR-|P-A)(\w{2,3})-(\w{2,3}) (\d+)/gu, '$1 $2$3');
  value = value.replace(/xy5-5 /gu, 'DCR ');
  value = value.replace(/ DPP /gu, ' PR-DPP ');

  const oldSet = /^\s*(\d+) (.+?)(?= \w*-\w*\d*\s*$) (\w*-\w*\d*)\s*$/u.exec(
    value
  );
  if (oldSet) {
    return {
      line,
      quantity: Number.parseInt(oldSet[1] ?? '', 10),
      name: oldSet[2] ?? '',
      catalogId: oldSet[3],
    };
  }

  const set =
    /^\s*(\d+) (.+?) (\w{2,5}[1-9]?[A-Z]?|WBSP|NBSP|FRLG|FUT20) (\d+[a-zA-Z]?)\s*$/u.exec(
      value
    );
  if (set) {
    return {
      line,
      quantity: Number.parseInt(set[1] ?? '', 10),
      name: set[2] ?? '',
      setCode: set[3],
      number: set[4],
    };
  }

  const promo =
    /^\s*(\d+) (.+?) (PR-\w{2,3}) ((?:DP|HGSS|BW|XY|SM|SWSH)?)(\d+)\s*$/u.exec(
      value
    );
  if (promo) {
    return {
      line,
      quantity: Number.parseInt(promo[1] ?? '', 10),
      name: promo[2] ?? '',
      setCode: promo[3],
      number: promo[5],
    };
  }

  const pocketPromo = /^\s*(\d+) (.+?) (P-[A-Z]) (\d+)\s*$/u.exec(value);
  if (pocketPromo) {
    return {
      line,
      quantity: Number.parseInt(pocketPromo[1] ?? '', 10),
      name: pocketPromo[2] ?? '',
      setCode: pocketPromo[3],
      number: pocketPromo[4],
    };
  }

  // The source rewrites PTCGL gallery forms such as `BRS-TG 17` to
  // `BRS TG17`, but its next regex accepts only digit-first numbers. Preserve
  // the intended rewrite instead of misreading `Card BRS` as set/number.
  const prefixedNumber =
    /^\s*(\d+) (.+?) (\w{2,5}[1-9]?[A-Z]?|WBSP|NBSP|FRLG|FUT20) ([a-zA-Z]{1,3}\d+[a-zA-Z]?)\s*$/u.exec(
      value
    );
  if (prefixedNumber) {
    return {
      line,
      quantity: Number.parseInt(prefixedNumber[1] ?? '', 10),
      name: prefixedNumber[2] ?? '',
      setCode: prefixedNumber[3],
      number: prefixedNumber[4],
    };
  }

  // A name-only custom card is an advertised source workflow. The generic
  // special-set regex otherwise steals its final words as a fake set/number,
  // including every multiword Basic Energy name.
  const nameOnly = /^\s*(\d+) (.+)$/u.exec(value);
  const finalNameToken = nameOnly?.[2]?.trim().split(/\s+/u).at(-1) ?? '';
  if (nameOnly && !/\d/u.test(finalNameToken)) {
    return {
      line,
      quantity: Number.parseInt(nameOnly[1] ?? '', 10),
      name: nameOnly[2] ?? '',
    };
  }

  const special =
    /^\s*(\d+) (.+?) ((?:\w{2,3}[a-zA-Z]\d*|\w{2,3}(?:\s+[a-zA-Z\d]+)*)(?:\s+(\w{2,3}\s*[a-zA-Z\d]+)\s*)*)$/u.exec(
      value
    );
  if (special) {
    const [setCode, number] = (special[3] ?? '').trim().split(/(?<=\S)\s/u);
    return {
      line,
      quantity: Number.parseInt(special[1] ?? '', 10),
      name: special[2] ?? '',
      ...(setCode ? { setCode } : {}),
      ...(number ? { number } : {}),
    };
  }

  const withoutSet = /^\s*(\d+) (.+?)(?=\s\d|$|(\s\d+))/u.exec(value);
  if (!withoutSet) return undefined;
  return {
    line,
    quantity: Number.parseInt(withoutSet[1] ?? '', 10),
    name: withoutSet[2] ?? '',
  };
};

const resolveCatalogId = (
  row: ParsedRow,
  format: PastedDecklistFormat
): string | undefined => {
  if (row.catalogId) return row.catalogId;
  const { setCode, number } = row;
  if (!setCode || !number) return undefined;
  const mappedSet = OLD_SET_TO_CATALOG_ID[setCode];
  if (mappedSet && !isPastedDecklistPocketSet(setCode, format)) {
    return `${mappedSet}-${number}`;
  }
  if (setCode === 'PR-DPP' || setCode === 'DPP') {
    const padded = number.length < 3 ? number.padStart(2, '0') : number;
    return `dpp-DP${padded}`;
  }
  return NO_IMAGE_CATALOG_IDS[`${setCode} ${number}`];
};

const resolveImageUrl = (
  row: ParsedRow,
  catalogId: string | undefined,
  format: PastedDecklistFormat,
  language: PastedDecklistLanguage,
  energies: Readonly<Record<string, string>>
): string | undefined => {
  if (!row.setCode && !catalogId) return energies[row.name];
  const setCode = row.setCode ? (SET_ALIASES[row.setCode] ?? row.setCode) : '';
  if (catalogId) {
    const separator = catalogId.indexOf('-');
    if (separator <= 0 || separator === catalogId.length - 1) return undefined;
    return `https://images.pokemontcg.io/${catalogId.slice(0, separator)}/${catalogId.slice(separator + 1)}_hires.png`;
  }
  if (!setCode || !row.number) return undefined;
  if (TPC_SET_CODES.has(setCode)) {
    return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/${setCode}/${setCode}_${row.number}_R_JP_LG.png`;
  }
  const paddedNumber = row.number.replace(
    /^(\d+)([a-zA-Z])?$/u,
    (_match, digits: string, letter: string | undefined) =>
      `${digits.length < 3 ? digits.padStart(3, '0') : digits}${letter ?? ''}`
  );
  if (isPastedDecklistPocketSet(setCode, format)) {
    return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/pocket/${setCode}/${setCode}_${paddedNumber}_EN_SM.webp`;
  }
  const path = setCode.replaceAll(' ', '/');
  const filename = setCode.replaceAll(' ', '_');
  return `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/${path}/${filename}_${paddedNumber}_R_${LANGUAGE_CODES[language]}.png`;
};

const resolveCardType = (
  row: ParsedRow,
  catalogId: string | undefined,
  energies: Readonly<Record<string, string>>
): LegacyCardType => {
  let type: LegacyCardType = 'Unknown';
  if (row.setCode && row.number) {
    type = getLegacyCurrentCardType(row.setCode, row.number);
  }
  if (catalogId) type = getLegacyOldCardType(catalogId);
  if (energies[row.name]) type = 'Energy';
  return type;
};

const issue = (
  code: PastedDecklistIssueCode,
  message: string,
  line?: number
): PastedDecklistIssue => ({
  code,
  ...(line === undefined ? {} : { line }),
  message,
});

/**
 * Bounded local half of the source textarea importer. Unrecognized headings are
 * ignored exactly as before; recognized rows are resolved without DOM/network
 * access and remain editable if image or type metadata is incomplete.
 */
export const parsePastedDecklist = (
  input: string,
  options: { readonly language?: PastedDecklistLanguage } = {}
): ParsePastedDecklistResult => {
  const source = String(input).replace(/^\uFEFF/u, '');
  if (source.length > MAX_PASTED_DECKLIST_CODE_UNITS) {
    return {
      ok: false,
      issues: [
        issue(
          'input_too_large',
          `Decklist exceeds ${MAX_PASTED_DECKLIST_CODE_UNITS} code units.`
        ),
      ],
    };
  }
  const lines = source.split(/\r\n|\n|\r/u);
  if (lines.length > MAX_PASTED_DECKLIST_LINES) {
    return {
      ok: false,
      issues: [
        issue(
          'too_many_lines',
          `Decklist contains more than ${MAX_PASTED_DECKLIST_LINES} lines.`
        ),
      ],
    };
  }

  const oversizedLine = lines.findIndex(
    (line) => line.length > MAX_PASTED_DECKLIST_LINE_CODE_UNITS
  );
  if (oversizedLine >= 0) {
    const line = oversizedLine + 1;
    return {
      ok: false,
      issues: [
        issue(
          'line_too_long',
          `Line ${line} exceeds ${MAX_PASTED_DECKLIST_LINE_CODE_UNITS} code units.`,
          line
        ),
      ],
    };
  }

  const parsed = lines.flatMap((line, index) => {
    const row = parseLine(line, index + 1);
    return row ? [row] : [];
  });
  const issues: PastedDecklistIssue[] = [];
  let totalCards = 0;
  for (const row of parsed) {
    if (
      !Number.isSafeInteger(row.quantity) ||
      row.quantity < 1 ||
      row.quantity > MAX_DECK_CARD_QUANTITY
    ) {
      issues.push(
        issue(
          'invalid_quantity',
          `Line ${row.line} quantity must be an integer from 1 to ${MAX_DECK_CARD_QUANTITY}.`,
          row.line
        )
      );
    } else {
      totalCards += row.quantity;
    }
    if (row.name.length > MAX_DECK_CARD_NAME_CODE_UNITS) {
      issues.push(
        issue(
          'name_too_long',
          `Line ${row.line} card name exceeds ${MAX_DECK_CARD_NAME_CODE_UNITS} code units.`,
          row.line
        )
      );
    }
    for (const token of [row.setCode, row.number, row.catalogId]) {
      if (token && token.length > MAX_PASTED_DECKLIST_TOKEN_CODE_UNITS) {
        issues.push(
          issue(
            'token_too_long',
            `Line ${row.line} set or card identifier exceeds ${MAX_PASTED_DECKLIST_TOKEN_CODE_UNITS} code units.`,
            row.line
          )
        );
        break;
      }
    }
  }
  if (totalCards > MAX_DECK_TOTAL_CARDS) {
    issues.push(
      issue(
        'deck_too_large',
        `Decklist contains more than ${MAX_DECK_TOTAL_CARDS} cards.`
      )
    );
  }
  if (issues.length > 0) return { ok: false, issues };

  const format = detectFormat(parsed);
  // TypeScript callers are constrained by the public union, but persisted or
  // untyped browser input can still cross this boundary at runtime. Preserve
  // the source default instead of synthesizing an "undefined" language code.
  const requestedLanguage: string | undefined = options.language;
  const language: PastedDecklistLanguage =
    requestedLanguage &&
    (PASTED_DECKLIST_LANGUAGES as readonly string[]).includes(requestedLanguage)
      ? (requestedLanguage as PastedDecklistLanguage)
      : 'English';
  const energies = energyImages(language);
  const rows = parsed.map((row): PastedDecklistRow => {
    const catalogId = resolveCatalogId(row, format);
    const imageUrl = resolveImageUrl(
      row,
      catalogId,
      format,
      language,
      energies
    );
    if (imageUrl && imageUrl.length > MAX_DECK_IMAGE_URL_CODE_UNITS) {
      issues.push(
        issue(
          'url_too_long',
          `Line ${row.line} image URL exceeds ${MAX_DECK_IMAGE_URL_CODE_UNITS} code units.`,
          row.line
        )
      );
    }
    return Object.freeze({
      quantity: row.quantity,
      name: row.name,
      ...(row.setCode ? { setCode: row.setCode } : {}),
      ...(row.number ? { number: row.number } : {}),
      ...(catalogId ? { catalogId } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      cardType: resolveCardType(row, catalogId, energies),
    });
  });
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, format, rows: Object.freeze(rows) };
};
