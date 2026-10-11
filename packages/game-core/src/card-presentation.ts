/** Physical artwork only. This never grants an ability or enforces a play rule. */
export interface CardPresentation {
  /** Turn a portrait scan into its upright reading orientation. */
  readonly readingQuarterTurns: 0 | 1 | 2 | 3;
  readonly overlay?: 'upper-half';
  /** Explicit per-print treatment; omitted retains the cosmetic fallback. */
  readonly finish?: 'matte' | 'sheen' | 'holo' | 'rainbow';
  /** Foil coverage in the original portrait scan, before reading rotation. */
  readonly foilRegion?: 'artwork' | 'full' | 'none';
  readonly join?: {
    /** Same illustration/printing, not merely the Pokémon's name. */
    readonly key: string;
    readonly columns: 1 | 2 | 3 | 4;
    readonly rows: 1 | 2 | 3 | 4;
    /** Reading order, starting at the top left. Missing pieces stay missing. */
    readonly part: 0 | 1 | 2 | 3;
  };
}

export const isCardPresentation = (
  value: unknown
): value is CardPresentation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    !Number.isInteger(item.readingQuarterTurns) ||
    ![0, 1, 2, 3].includes(item.readingQuarterTurns as number)
  )
    return false;
  if (
    item.finish !== undefined &&
    !['matte', 'sheen', 'holo', 'rainbow'].includes(item.finish as string)
  )
    return false;
  if (
    item.foilRegion !== undefined &&
    !['artwork', 'full', 'none'].includes(item.foilRegion as string)
  )
    return false;
  if (item.overlay !== undefined && item.overlay !== 'upper-half') return false;
  if (
    Object.keys(item).some(
      (key) =>
        ![
          'readingQuarterTurns',
          'overlay',
          'join',
          'finish',
          'foilRegion',
        ].includes(key)
    )
  )
    return false;
  if (item.join === undefined) return true;
  if (
    item.overlay !== undefined ||
    !item.join ||
    typeof item.join !== 'object' ||
    Array.isArray(item.join)
  )
    return false;
  const join = item.join as Record<string, unknown>;
  return (
    typeof join.key === 'string' &&
    join.key.trim().length > 0 &&
    join.key.length <= 128 &&
    [1, 2, 3, 4].includes(join.columns as number) &&
    [1, 2, 3, 4].includes(join.rows as number) &&
    Number.isInteger(join.part) &&
    (join.part as number) >= 0 &&
    (join.part as number) < (join.columns as number) * (join.rows as number) &&
    (join.columns as number) * (join.rows as number) > 1 &&
    (join.columns as number) * (join.rows as number) <= 4 &&
    Object.keys(join).every((key) =>
      ['key', 'columns', 'rows', 'part'].includes(key)
    )
  );
};

const LEGEND_STARTS: Readonly<Record<string, readonly number[]>> = {
  hgss1: [111, 113],
  hgss2: [90, 92, 94],
  hgss3: [87, 89],
  hgss4: [99, 101],
};
const UNION_STARTS = [139, 155, 159, 163, 215, 287];

/** Catalog/CSV compatibility. Unknown printings need explicit metadata. */
export const resolveCardPresentation = (card: {
  readonly name?: string;
  readonly imageUrl?: string;
  readonly presentation?: unknown;
}): CardPresentation | undefined => {
  if (isCardPresentation(card.presentation)) return card.presentation;
  const name = card.name ?? '';
  if (/\bBREAK$/u.test(name))
    return { readingQuarterTurns: 1, overlay: 'upper-half' };
  const url = card.imageUrl ?? '';
  const print = /\/(hgss[1-4]|swshp)\/(?:SWSH)?(\d+)(?:\/|[._-]|$)/iu.exec(url);
  if (print) {
    const set = print[1]!.toLowerCase();
    const number = Number(print[2]);
    const union = /V[- ]UNION/iu.test(name) && set === 'swshp';
    const starts = union
      ? UNION_STARTS
      : /LEGEND$/u.test(name)
        ? LEGEND_STARTS[set]
        : undefined;
    const count = union ? 4 : 2;
    const start = starts?.find(
      (value) => number >= value && number < value + count
    );
    if (start !== undefined)
      return {
        readingQuarterTurns: union ? 0 : 1,
        join: {
          key: `${set}:${start}:${name}`,
          columns: union ? 2 : 1,
          rows: 2,
          part: (number - start) as 0 | 1 | 2 | 3,
        },
      };
  }
  // The official Japanese reveal supplies precise left/right collector numbers.
  const stadium = /\bm6[-/](0?\d{2})(?:[-/.]|$)/iu.exec(url);
  if (stadium && /^(?:伝説の|Legendary )/u.test(name)) {
    const number = Number(stadium[1]);
    const start = [71, 73].find(
      (value) => number === value || number === value + 1
    );
    if (start !== undefined)
      return {
        readingQuarterTurns: 0,
        join: {
          key: `m6:${start}:${name}`,
          columns: 2,
          rows: 1,
          part: (number - start) as 0 | 1,
        },
      };
  }
  return undefined;
};

export const sameCardPresentation = (
  left: CardPresentation | undefined,
  right: CardPresentation | undefined
): boolean =>
  left?.readingQuarterTurns === right?.readingQuarterTurns &&
  left?.overlay === right?.overlay &&
  left?.finish === right?.finish &&
  left?.foilRegion === right?.foilRegion &&
  left?.join?.key === right?.join?.key &&
  left?.join?.columns === right?.join?.columns &&
  left?.join?.rows === right?.join?.rows &&
  left?.join?.part === right?.join?.part;
