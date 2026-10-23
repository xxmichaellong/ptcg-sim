/**
 * Writes tests/fixtures/card-catalog.json: a small catalog in the server's
 * wire format, built from live TCGdex data by the server's own normalizer,
 * for unit and browser tests. It covers every kind of card the builder
 * treats differently: each stage, ex/V/VSTAR/Tera/Ancient/Future/Radiant/
 * Prism Star/Mega, ACE SPEC Items and Energy, Supporters, Tools, Stadiums,
 * Basic and Special Energy (some with no TCGdex image), a rotated card and
 * its Standard-legal reprint, Expanded-banned cards, old prints, and TCG
 * Pocket.
 *
 *   corepack pnpm exec tsx scripts/card-catalog/build-test-fixture.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  EXPANDED_BANS,
  STANDARD_BANS,
} from '../../apps/server/src/card-catalog/bans.js';
import {
  SEEDED_SET_CODES,
  TCGDEX_GRAPHQL_URL,
  TCGDEX_SETS_QUERY,
  normalizeTcgdexSets,
  tcgdexCardsOf,
  tcgdexSetCardsQuery,
  wireSetJson,
} from '../../apps/server/src/card-catalog/normalize.js';

const CARDS: Readonly<Record<string, readonly string[]>> = {
  me03: ['076'],
  'me02.5': ['181'],
  me01: ['076', '077', '114', '119', '125', '131'],
  mee: ['002', '005'],
  sv07: ['131'],
  'sv06.5': ['038', '039'],
  sv06: ['025', '095', '128', '129', '130', '153', '165', '200'],
  sv05: ['081', '123', '144', '157', '161', '162'],
  'sv04.5': ['007'],
  sv04: ['087', '139', '160', '163'],
  'sv03.5': ['151'],
  sv03: ['027', '125', '162', '164', '186', '215'],
  sv02: ['169', '173', '185', '188', '190'],
  sv01: ['084', '085', '086', '176', '181', '189', '191'],
  sve: ['004', '005', '006'],
  swsh11: ['058'],
  'swsh10.5': ['011'],
  swsh9: ['040', '122', '123', '151'],
  swsh6: ['148'],
  sm9: ['51'],
  sm8: ['90'],
  bw7: ['137'],
  xy7: ['75'],
  xy6: ['77', '77a'],
  xy4: ['99'],
  base1: ['4'],
  A1: ['001', '096', '129', '220'],
  'P-A': ['007'],
};

const post = async (query: string): Promise<unknown> =>
  await (
    await fetch(TCGDEX_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    })
  ).json();

const sets = normalizeTcgdexSets(await post(TCGDEX_SETS_QUERY));
const parts: string[] = [];
let total = 0;
for (const set of [...sets].sort(
  (left, right) =>
    right.released.localeCompare(left.released) ||
    left.id.localeCompare(right.id)
)) {
  const wanted = CARDS[set.id];
  if (!wanted) continue;
  const cards = (
    tcgdexCardsOf(await post(tcgdexSetCardsQuery(set.id))) ?? []
  ).filter(
    (card) =>
      typeof card === 'object' &&
      card !== null &&
      wanted.includes(String((card as { localId?: unknown }).localId))
  );
  const built = wireSetJson(set, SEEDED_SET_CODES[set.id], cards);
  if (built.cards !== wanted.length) {
    throw new Error(`${set.id}: wanted ${wanted.length}, built ${built.cards}`);
  }
  total += built.cards;
  parts.push(built.json);
}

const body = JSON.parse(
  `{"v":1,"builtAt":"2026-10-15T00:00:00.000Z","source":"TCGdex","bans":${JSON.stringify({ standard: STANDARD_BANS, expanded: EXPANDED_BANS })},"sets":[${parts.join(',')}]}`
) as unknown;
const output = resolve('tests/fixtures/card-catalog.json');
writeFileSync(output, `${JSON.stringify(body, null, 2)}\n`);
console.log(`${total} cards in ${parts.length} sets -> ${output}`);
