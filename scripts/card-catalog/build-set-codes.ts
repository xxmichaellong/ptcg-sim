/**
 * Writes apps/server/src/card-catalog/set-codes.json: every TCGdex set's
 * Pokémon TCG Live / Limitless code, so the catalog's daily build needs no
 * per-set request for sets it already knows. Sets released later are looked
 * up by the build itself (one request each, remembered).
 *
 *   corepack pnpm exec tsx scripts/card-catalog/build-set-codes.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TCGDEX_GRAPHQL_URL,
  TCGDEX_REST_URL,
  TCGDEX_SETS_QUERY,
  normalizeTcgdexSets,
  setCodeFromDetails,
} from '../../apps/server/src/card-catalog/normalize.js';

const sets = normalizeTcgdexSets(
  await (
    await fetch(TCGDEX_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: TCGDEX_SETS_QUERY }),
    })
  ).json()
);

const codes: Record<string, string> = {};
const missing: string[] = [];
let next = 0;
const worker = async (): Promise<void> => {
  while (next < sets.length) {
    const set = sets[next]!;
    next += 1;
    const response = await fetch(
      `${TCGDEX_REST_URL}/sets/${encodeURIComponent(set.id)}`
    );
    const code = setCodeFromDetails(set.id, await response.json());
    if (code) codes[set.id] = code;
    else missing.push(`${set.id} (${set.name})`);
  }
};
await Promise.all(Array.from({ length: 8 }, worker));

const sorted = Object.fromEntries(
  Object.entries(codes).sort(([left], [right]) => left.localeCompare(right))
);
const output = resolve('apps/server/src/card-catalog/set-codes.json');
writeFileSync(output, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(
  `${Object.keys(sorted).length} of ${sets.length} sets -> ${output}`
);
if (missing.length > 0) console.log(`No code: ${missing.join(', ')}`);
