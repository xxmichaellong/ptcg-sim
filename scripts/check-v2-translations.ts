/**
 * CI's check that every language can ship (ADR-034): each catalog has a
 * translation for every live English message, and each keeps its
 * placeholders, plurals, select cases and tags, in the language's own
 * script. `lingui check sync` separately checks the catalogs are current.
 */

import { LOCALES, SOURCE_LOCALE } from '../apps/web/src/i18n/locales.js';
import { catalogProblems, readCatalog } from './i18n-catalog.js';

const source = await readCatalog(SOURCE_LOCALE);
let failures = 0;
for (const { locale } of LOCALES) {
  if (locale === SOURCE_LOCALE) continue;
  const problems = catalogProblems(source, await readCatalog(locale), locale);
  failures += problems.length;
  for (const { id, problem } of problems.slice(0, 20))
    console.error(
      `${locale}.json ${id} (${JSON.stringify(source[id]?.message)}): ${problem}`
    );
  if (problems.length > 20)
    console.error(`${locale}.json: …and ${problems.length - 20} more`);
}
if (failures > 0) {
  console.error(
    `${failures} translations are missing or broken. Run corepack pnpm run i18n:translate.`
  );
  process.exitCode = 1;
} else {
  console.log(
    `Translations passed (${LOCALES.length - 1} languages, ${Object.keys(source).length} messages).`
  );
}
