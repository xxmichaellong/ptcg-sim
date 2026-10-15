/**
 * Builds apps/server/src/card-catalog/tags.json: the card mechanics TCGdex
 * does not record (Tera, Ancient, Future, ACE SPEC before Scarlet & Violet,
 * the Battle Styles, Team Plasma, Ultra Beast, Prism Star, Pokémon ☆, …),
 * taken from the Pokémon TCG API's open data
 * (github.com/PokemonTCG/pokemon-tcg-data, frozen when it closes in 2027)
 * and keyed by TCGdex card id.
 *
 *   git clone --depth 1 https://github.com/PokemonTCG/pokemon-tcg-data <dir>
 *   node scripts/card-catalog/build-tag-table.mjs <dir>
 *
 * Cards are matched set by set (same release date, closest name) and then
 * by collector number and name. Run it again only to pick up corrections;
 * sets released after the data closed get their tags from the catalog's
 * own rules (apps/server/src/card-catalog/normalize.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [dataDirectory] = process.argv.slice(2);
if (!dataDirectory) {
  process.stderr.write(
    'Usage: node build-tag-table.mjs <pokemon-tcg-data checkout>\n'
  );
  process.exit(1);
}

const TAGGED = new Map([
  ['ACE SPEC', 'ACE SPEC'],
  ['Ancient', 'Ancient'],
  ['Future', 'Future'],
  ['Tera', 'Tera'],
  ['Fusion Strike', 'Fusion Strike'],
  ['Single Strike', 'Single Strike'],
  ['Rapid Strike', 'Rapid Strike'],
  ['Team Plasma', 'Team Plasma'],
  ['Ultra Beast', 'Ultra Beast'],
  ['Prism Star', 'Prism Star'],
  ['Star', 'Star'],
  ['Radiant', 'Radiant'],
  ['TAG TEAM', 'TAG TEAM'],
  ['Eternamax', 'Eternamax'],
  ['Baby', 'Baby'],
]);

const fold = (value) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
const number = (value) =>
  String(value)
    .replace(/^0+(?=\d)/u, '')
    .toUpperCase();

// TCGdex's sets and cards, fetched live.
const query = async (body) => {
  const response = await fetch('https://api.tcgdex.net/v2/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: body }),
  });
  return (await response.json()).data;
};
const tcgdexSets = (await query('{ sets { id name releaseDate } }')).sets;
const tcgdexCards = (await query('{ cards { id localId name set { id } } }'))
  .cards;
const cardsBySet = new Map();
for (const card of tcgdexCards) {
  if (!card?.set) continue;
  const list = cardsBySet.get(card.set.id) ?? [];
  list.push(card);
  cardsBySet.set(card.set.id, list);
}

/** Names agree, allowing the two sources' spellings of ☆ and δ. */
const sameName = (left, right) => {
  const plain = (value) =>
    fold(
      value
        .replaceAll('☆', ' star ')
        .replaceAll('δ', ' delta ')
        .replaceAll('-gx', ' gx')
    )
      .replace(/\b(star|delta)\b/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  return plain(left) === plain(right);
};

const words = (value) => new Set(fold(value).split(' ').filter(Boolean));
const similarity = (left, right) => {
  const a = words(left);
  const b = words(right);
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.max(1, Math.max(a.size, b.size));
};

const sets = JSON.parse(
  readFileSync(join(resolve(dataDirectory), 'sets/en.json'), 'utf8')
);
const table = {};
let matchedCards = 0;
let taggedCards = 0;
const unmatchedSets = [];
for (const set of sets) {
  const released = set.releaseDate.replaceAll('/', '-');
  // Same release date first; release dates differ between the two sources
  // for a few sets, so any set within two months is a candidate too.
  const days = (date) => Date.parse(date) / 86_400_000;
  const candidates = tcgdexSets
    .filter(
      (candidate) =>
        candidate.releaseDate &&
        Math.abs(days(candidate.releaseDate) - days(released)) <= 60
    )
    .map((candidate) => {
      const cards = cardsBySet.get(candidate.id) ?? [];
      return {
        candidate,
        cards,
        score:
          similarity(candidate.name, `${set.series} ${set.name}`) +
          similarity(candidate.name, set.name),
      };
    })
    .sort((left, right) => right.score - left.score);
  let cards;
  try {
    cards = JSON.parse(
      readFileSync(
        join(resolve(dataDirectory), `cards/en/${set.id}.json`),
        'utf8'
      )
    );
  } catch {
    continue;
  }
  const tagged = cards.filter((card) =>
    (card.subtypes ?? []).some((subtype) => TAGGED.has(subtype))
  );
  if (tagged.length === 0) continue;
  // The same release date can hold a set and its subset (a gallery, a
  // vault): try each candidate and keep the one whose cards match best.
  // Promo sets carry loose dates: fall back to the closest names.
  const byName = tcgdexSets
    .map((candidate) => ({
      candidate,
      cards: cardsBySet.get(candidate.id) ?? [],
      score: similarity(candidate.name, set.name),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
  let best;
  for (const { cards: tcgdex } of [...candidates, ...byName]) {
    const byNumber = new Map(
      tcgdex.map((card) => [number(card.localId), card])
    );
    const matches = tagged.flatMap((card) => {
      const match = byNumber.get(number(card.number));
      return match && sameName(match.name, card.name) ? [[card, match]] : [];
    });
    if (!best || matches.length > best.length) best = matches;
  }
  if (!best || best.length === 0) {
    unmatchedSets.push(`${set.id} ${set.name} (${tagged.length} tagged)`);
    continue;
  }
  matchedCards += best.length;
  for (const [card, match] of best) {
    const tags = (card.subtypes ?? []).flatMap((subtype) =>
      TAGGED.has(subtype) ? [TAGGED.get(subtype)] : []
    );
    if (tags.length === 0) continue;
    table[match.id] = [...new Set([...(table[match.id] ?? []), ...tags])];
    taggedCards += 1;
  }
  if (best.length < tagged.length) {
    unmatchedSets.push(
      `${set.id} ${set.name}: ${tagged.length - best.length} of ${tagged.length} tagged cards unmatched`
    );
  }
}

// Grouped by tag, ids sorted: small, and a diff reads as cards gaining tags.
const byTag = {};
for (const [id, tags] of Object.entries(table)) {
  for (const tag of tags) (byTag[tag] ??= []).push(id);
}
for (const ids of Object.values(byTag)) ids.sort();
const output = resolve('apps/server/src/card-catalog/tags.json');
writeFileSync(
  output,
  `${JSON.stringify(Object.fromEntries(Object.entries(byTag).sort()), null, 1)}\n`
);
process.stdout.write(
  `${taggedCards} cards tagged (${matchedCards} matched) -> ${output}\n`
);
if (unmatchedSets.length > 0) {
  process.stdout.write(`Not matched:\n  ${unmatchedSets.join('\n  ')}\n`);
}
