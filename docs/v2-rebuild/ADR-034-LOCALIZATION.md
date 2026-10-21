# ADR-034: localization — Lingui catalogs in 20 languages

- Status: **ACCEPTED**
- Decision date: 2026-10-20
- Scope: every word the v2 web app shows (`apps/web`, and the
  `deck-core`, `renderer-contract` and `renderer-dom` text it renders), the
  catalogs under `apps/web/src/locales/`, and the translate script. Card
  names and card text stay English (the catalog is TCGdex's English one,
  ADR-032).

## Context

The owner asked for the app in "all languages", following magiccircle.gg
(ADR-019). magiccircle.gg uses Lingui: messages are written in English in
the source with macros, extracted into one JSON catalog per language,
translated by its own script calling Claude, and checked in CI. It offers
20 languages, takes the browser's language until one is chosen in
Settings, and has its server send codes that the client words.

## Decision

1. **Lingui 6 with its Vite plugin.** The plugin compiles the macros
   natively (no Babel or SWC) in the app and in Vitest, and compiles a
   catalog when it is imported with `?lingui`. Message ids are Lingui's
   hashes of the English text and its context.
2. **20 languages** (`apps/web/src/i18n/locales.ts`): English, Español,
   Português, Deutsch, Français, Italiano, Nederlands, Polski, Svenska,
   Türkçe, Русский, Српски, العربية, 日本語, 简体中文, 한국어, ไทย, Tiếng
   Việt, Bahasa Indonesia and Filipino — magiccircle.gg's list. Chinese is
   Simplified only (the owner's choice); a `zh-TW` browser gets it.
   Arabic is written right to left (2026-10-21, the owner asked for it):
   see 7.
3. **The language is a preference** (`ptcgsim.language.v1`): `auto`
   follows the browser's languages, else English; Settings → Language
   chooses one, each named in itself. English is compiled into the page and
   active before any other module runs; the chosen language's catalog loads
   before the first render (the loading screen covers it), and later
   changes apply live, without a reload. `<html lang>` follows it, and
   `translate="no"` keeps browser translation from rewriting React's DOM.
4. **Catalogs** are `apps/web/src/locales/{locale}.json`, holding each
   message's English, context, comments and translation. `en.json` is
   generated (`corepack pnpm run i18n:extract`) and committed; a message a
   language lacks shows in English. CI fails when the catalogs are not up
   to date with the source or a translation is missing or broken
   (`corepack pnpm run check:i18n:v2`).
5. **Translations** come from `corepack pnpm run i18n:translate`
   (`scripts/translate.ts`): it sends each language's missing or broken
   messages to Claude in batches with the language's guide and the game's
   official terms (`scripts/translate-glossary.ts`), and keeps only answers
   that keep every placeholder, plural, select case and tag, in the
   language's own script. A message id is a hash of its English, so changed
   English is simply missing again; no lock file is needed. It uses
   `ANTHROPIC_API_KEY` when set and Claude Code (`claude -p`, on the
   developer's plan) otherwise.
6. **The server sends codes.** Refusals and notices from the room arrive
   as codes with values, and the app words them. Chat, names and deck
   names are never translated.
7. **Right to left: the chrome mirrors, the table does not.** In Arabic
   (`textDirection` in `locales.ts`) `<html dir="rtl">` is set with the
   language, and Base UI's menus, popups and sliders follow it
   (`DirectionProvider` in `OverlayHost`). Everything that is read
   mirrors: sheets', dialogs' and the log's headings and rows, menus
   (a submenu opens to the left), the deck screen, toasts, switches and
   icons that point the way the line reads (`ds-mirror-rtl`: back, send,
   undo). The table is laid out in the world, not in a language, so
   `.board-spike-host` stays `dir="ltr"`: the board, its rail, coins and
   overlays' card rows keep their places, the log still docks at the
   right beside the table (the table's geometry reserves that column),
   and the side sheets keep to the right with it. What the table raises
   to be read -- a card's menu, a panel's heading -- sets the page's
   direction again (`usePageDirection`). Keys always read left to right
   (Alt + N), the keyboard map is a keyboard, and a name inside an
   Arabic Log line is isolated (U+2068/2069) so it keeps its own order.
   Write new CSS with logical properties (`margin-inline-start`,
   `inset-inline-end`, `text-align: start`) unless it places something on
   the table.

## How to write text

- In a component: `import { Trans, useLingui } from '@lingui/react/macro'`.
  Text in JSX is `<Trans>Draw a card</Trans>`; a string for a prop is
  `` const { t } = useLingui(); … t`Draw a card` ``. These compile to
  `apps/web/src/i18n/react.tsx` (package import `#lingui-react`), which
  needs no provider and re-renders the component when the language
  changes. Only `apps/web` may use these two macros.
- Outside components (`deck-core`, `renderer-contract`, `renderer-dom`,
  controllers): `import { t, msg, plural } from '@lingui/core/macro'`.
  `t` translates when it runs, so call it when the text is needed, never
  at module load. For text kept for later (a constant table, a Log line),
  store a `msg` descriptor and translate it when shown:
  `i18n._(descriptor)` or `useLingui()._(descriptor)`.
- Whole sentences only. Never join translated pieces or English words with
  `+` or a template; give the sentence placeholders. Name each one by
  using a plain variable (`${count}`, `${name}`), so translators see
  `{count}`, not `{0}`.
- Counts use plural: `` t`${plural(count, { one: '# card', other: '# cards' })}` ``
  or `<Plural value={count} one="# card" other="# cards" />`.
- Give a short or ambiguous word a `context` ("Turn" the noun or the verb,
  "Flip", "Draw", "Pass", "Active", "Bench") and a `comment` when a
  translator needs to know where it shows or what a placeholder holds:
  `t({ message: 'Pass', context: 'end the turn' })`.
- Never translate ids, data attributes, CSS classes, storage keys, URLs,
  keyboard key codes, card names, set codes, chat, player or deck names,
  or the names PTCG-sim, Limitless, TCGdex and Pokémon TCG Live.
- Tests run in English. Keep the English wording when wrapping, so tests
  and selectors that read it keep passing.
- Numbers and dates go through `Intl` with `i18n.locale`.

## Consequences

- Every string in the web app is a message; a new one shows in English
  until the translate script runs, and CI says so.
- Translations are machine-made and unreviewed by native speakers; the
  game's terms follow each language's official Pokémon TCG names where
  they exist (the glossary in `scripts/translate.ts`).
- The production bundle carries English only; each other language is one
  extra request of its own catalog.
- Card names and text stay English until a per-language catalog (TCGdex
  has fr, de, it, es, pt, ja, ko and zh) is built.
