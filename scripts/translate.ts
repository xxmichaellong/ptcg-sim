/**
 * Translates the web app's catalogs (ADR-034).
 *
 *   corepack pnpm run i18n:translate [--locale=de,fr] [--force] [--dry-run]
 *
 * For each language it finds the messages missing, blank or failing the
 * checks in `i18n-catalog.ts`, sends them to Claude in batches with the
 * language's guide (`translate-glossary.ts`), checks every answer the same
 * way, and writes the catalog after each batch. A message whose English
 * changes has a new id, so it is simply missing again.
 *
 * Claude is reached through the Anthropic API when `ANTHROPIC_API_KEY` is
 * set, otherwise through Claude Code (`claude -p`) on the developer's plan.
 * Run `corepack pnpm run i18n:extract` first.
 */

import { spawn } from 'node:child_process';

import { LOCALES, SOURCE_LOCALE } from '../apps/web/src/i18n/locales.js';
import {
  liveSourceEntries,
  readCatalog,
  sourceText,
  translationProblem,
  writeCatalog,
  type Catalog,
  type CatalogEntry,
} from './i18n-catalog.js';
import { LANGUAGE_GUIDES, type LanguageGuide } from './translate-glossary.js';

const API_MODEL = 'claude-sonnet-5-5';
const CLI_MODEL = 'sonnet';
const BATCH_SIZE = 40;
const MAX_OUTPUT_TOKENS = 12_288;
const CONCURRENCY = 4;

interface Options {
  readonly locales: readonly string[];
  readonly force: boolean;
  readonly dryRun: boolean;
}

const parseOptions = (args: readonly string[]): Options => {
  const flag = (name: string) => args.includes(`--${name}`);
  const value = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
  const targets = LOCALES.map(({ locale }) => locale).filter(
    (locale) => locale !== SOURCE_LOCALE
  );
  const requested = value('locale')?.split(',').filter(Boolean);
  for (const locale of requested ?? [])
    if (!targets.includes(locale as (typeof targets)[number]))
      throw new Error(`No such language: ${locale}`);
  return {
    locales: requested ?? targets,
    force: flag('force'),
    dryRun: flag('dry-run'),
  };
};

interface Request {
  readonly key: string;
  readonly id: string;
  readonly message: string;
  readonly context?: string;
  readonly comments?: readonly string[];
}

export const systemPrompt = (locale: string, guide: LanguageGuide): string => {
  const terms = Object.entries(guide.terms)
    .map(([english, term]) => `- ${english}: ${term}`)
    .join('\n');
  return [
    `You translate the interface of PTCG-sim, a free, open-source Pokémon Trading Card Game tabletop simulator for practising and playing online, from English into ${guide.name} (${locale}).`,
    '',
    'Each message is shown in the app: buttons, menus, settings, the game log, notices. Translate each one so a player of that language reads natural, concise interface text.',
    '',
    'Rules:',
    '- Keep every placeholder exactly as it is, e.g. {name}, {count}, {card}. Never translate or rename what is inside braces, and never add or drop one.',
    '- Keep ICU plural and select syntax: translate only the text inside the cases. Use the plural categories your language needs (one, few, many, other...); always keep "other". Keep # where the English has it. Keep select case keys exactly.',
    '- Keep numbered tags like <0>…</0> and <1/> around the matching words.',
    '- Do not translate card names, player names, PTCG-sim, Pokémon TCG Live, Limitless, TCGdex, Discord, PayPal, GitHub, or keyboard keys written as single letters.',
    '- Use sentence case, as the English does. No exclamation marks unless the English has them.',
    '- A context says which sense of a short word is meant; a comment says where the text shows or what a placeholder holds.',
    `- ${guide.style}`,
    terms
      ? `\nUse these terms, the ones the game and this app use in ${guide.name}; where a term gives a short label, use that on short controls and names:\n${terms}`
      : '',
    '',
    'Reply with only a JSON object {"translations": {"<key>": "<translation>", ...}} with one entry for every key you were given.',
  ].join('\n');
};

export const userPrompt = (requests: readonly Request[]): string =>
  JSON.stringify(
    requests.map(({ key, message, context, comments }) => ({
      key,
      message,
      ...(context ? { context } : {}),
      ...(comments?.length ? { comments } : {}),
    })),
    null,
    1
  );

const translationSchema = (requests: readonly Request[]) => ({
  type: 'object',
  properties: {
    translations: {
      type: 'object',
      properties: Object.fromEntries(
        requests.map(({ key }) => [key, { type: 'string' }])
      ),
      required: requests.map(({ key }) => key),
      additionalProperties: false,
    },
  },
  required: ['translations'],
  additionalProperties: false,
});

/** The JSON object in a reply, fenced or not. */
export const parseReply = (reply: unknown): Record<string, string> => {
  let value = reply;
  if (typeof value === 'string') {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('no JSON object in reply');
    value = JSON.parse(value.slice(start, end + 1));
  }
  const translations =
    typeof value === 'object' && value !== null
      ? Reflect.get(value, 'translations')
      : undefined;
  if (typeof translations !== 'object' || translations === null)
    throw new Error('reply has no translations');
  return Object.fromEntries(
    Object.entries(translations).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
};

const askApi = async (
  key: string,
  system: string,
  user: string
): Promise<unknown> => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: API_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!response.ok)
    throw new Error(
      `Anthropic API ${response.status}: ${await response.text()}`
    );
  const body = (await response.json()) as {
    content?: readonly { type: string; text?: string }[];
  };
  return (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
};

const askClaudeCode = (
  system: string,
  user: string,
  schema: unknown
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--model',
        CLI_MODEL,
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(schema),
        '--system-prompt',
        system,
        '--tools',
        '',
        '--no-session-persistence',
        '--setting-sources',
        '',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const result = JSON.parse(stdout) as {
          structured_output?: unknown;
          result?: unknown;
          is_error?: boolean;
        };
        if (result.is_error) throw new Error(String(result.result));
        resolve(result.structured_output ?? result.result);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdin.end(user);
  });

const ask = (
  requests: readonly Request[],
  locale: string
): Promise<unknown> => {
  const guide = LANGUAGE_GUIDES[locale];
  if (!guide) throw new Error(`No guide for ${locale}`);
  const system = systemPrompt(locale, guide);
  const user = userPrompt(requests);
  const key = process.env['ANTHROPIC_API_KEY'];
  return key
    ? askApi(key, system, user)
    : askClaudeCode(system, user, translationSchema(requests));
};

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
};

const pending = (
  source: Catalog,
  catalog: Catalog,
  locale: string,
  force: boolean
): Request[] =>
  liveSourceEntries(source)
    .filter(
      ([id, entry]) =>
        force ||
        translationProblem(sourceText(entry), catalog[id]?.translation, locale)
    )
    .map(([id, entry], index) => ({
      key: `m${index}`,
      id,
      message: sourceText(entry),
      ...(entry.context ? { context: entry.context } : {}),
      ...(entry.comments?.length ? { comments: entry.comments } : {}),
    }));

const translateLocale = async (
  locale: string,
  source: Catalog,
  options: Options
): Promise<number> => {
  let catalog: Record<string, CatalogEntry> = {
    ...(await readCatalog(locale)),
  };
  let requests = pending(source, catalog, locale, options.force);
  // Why each message's last answer was turned down, for the report.
  const problems = new Map<string, string>();
  console.log(`${locale}: ${requests.length} to translate`);
  if (options.dryRun || requests.length === 0) return requests.length;
  // Two rounds: whatever the first gets wrong is asked again, alone with
  // the other failures, before the language is left incomplete.
  for (let round = 0; round < 2 && requests.length > 0; round += 1) {
    const failed: Request[] = [];
    const batches = chunks(requests, round === 0 ? BATCH_SIZE : 10);
    for (let start = 0; start < batches.length; start += CONCURRENCY) {
      await Promise.all(
        batches.slice(start, start + CONCURRENCY).map(async (batch) => {
          let reply: Record<string, string> = {};
          try {
            reply = parseReply(await ask(batch, locale));
          } catch (error) {
            console.error(`${locale}: a batch failed: ${String(error)}`);
          }
          for (const request of batch) {
            const translation = reply[request.key];
            const problem = translationProblem(
              request.message,
              translation,
              locale
            );
            if (problem || translation === undefined) {
              problems.set(
                request.id,
                `${problem ?? 'missing'}: ${JSON.stringify(translation)}`
              );
              failed.push(request);
              continue;
            }
            const entry = catalog[request.id] ?? source[request.id]!;
            catalog = {
              ...catalog,
              [request.id]: { ...entry, translation },
            };
          }
        })
      );
      await writeCatalog(locale, catalog);
    }
    requests = failed;
  }
  for (const request of requests)
    console.error(
      `${locale}: still untranslated: ${request.message}\n  (${problems.get(request.id) ?? 'no answer'})`
    );
  return requests.length;
};

const main = async () => {
  const options = parseOptions(process.argv.slice(2));
  const source = await readCatalog(SOURCE_LOCALE);
  let left = 0;
  for (const locale of options.locales)
    left += await translateLocale(locale, source, options);
  if (left > 0) {
    console.error(
      options.dryRun
        ? `${left} messages need translating.`
        : `${left} messages are still untranslated.`
    );
    process.exitCode = 1;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) await main();
