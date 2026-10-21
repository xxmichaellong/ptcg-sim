import { expect, test, type Page, type Route } from '@playwright/test';

import {
  chooseMoreAction,
  closeSheet,
  openDeck,
  openSettings,
} from './support/table-shell.js';

/**
 * Each player sees cards in their own language: with French chosen, the
 * table asks TCGdex for the French scan; a printing never made in French
 * (here, an old set's card) shows the deck's own English scan instead and
 * loads; and choosing English in Settings asks for the English scans. The
 * scan hosts are served here, never reached.
 */

const FACE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAD8AAABYCAIAAADNzLhqAAAAfElEQVR4nO3bQQ2AQBDAwJODCIShjjdK0IEHPpvmJqmAMdB1XE+3NS6gb0ZPT18rrn/vsxs9PX0tenr6WvT09LXo6elr0dPT16Knp69FT09fi56evhY9PX0tenr6WvT09LXo6elr0dPT16Kn/6kf/3Y2PpbGBfTN6Ol31H9L9mwjgA6TBwAAAABJRU5ErkJggg==',
  'base64'
);

const NEW_EN = 'https://assets.tcgdex.net/en/sv/sv06/130/high.webp';
const NEW_FR = 'https://assets.tcgdex.net/fr/sv/sv06/130/high.webp';
const OLD_EN = 'https://assets.tcgdex.net/en/dp/dp1/1/high.webp';
const OLD_FR = 'https://assets.tcgdex.net/fr/dp/dp1/1/high.webp';

const deckCsv = Buffer.from(
  [
    'QTY,Name,Type,URL',
    `30,New Mon,Pokémon,${NEW_EN}`,
    `30,Old Mon,Pokémon,${OLD_EN}`,
  ].join('\n')
);

/** Serves every scan host; the old card has no French scan. */
const serveScans = async (page: Page): Promise<string[]> => {
  const asked: string[] = [];
  const serve = async (route: Route) => {
    const url = route.request().url();
    asked.push(url);
    if (url.startsWith('https://assets.tcgdex.net/fr/dp/'))
      await route.fulfill({ status: 404, body: 'Not found' });
    else await route.fulfill({ contentType: 'image/png', body: FACE_PNG });
  };
  await page.route('https://assets.tcgdex.net/**', serve);
  await page.route(/^https:\/\/limitlesstcg\.nyc3\./u, serve);
  await page.route('https://images.pokemontcg.io/**', serve);
  return asked;
};

const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1);

/** Each of the viewer's hand cards: its name, the scan shown, its state. */
const handFaces = (page: Page) =>
  page.locator('[data-in-hand][data-card-side="local"]').evaluateAll((cards) =>
    cards.map((card) => {
      const image = card.querySelector('img');
      return {
        name: card.getAttribute('aria-label') ?? '',
        src: image?.getAttribute('src') ?? '',
        state: image?.dataset.cardImageState ?? '',
      };
    })
  );

/** Draws until the hand holds both cards. */
const bothInHand = async (page: Page): Promise<void> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const names = new Set((await handFaces(page)).map((face) => face.name));
    if (names.has('New Mon') && names.has('Old Mon')) return;
    await page.mouse.click(700, 330);
    await page.keyboard.press('2');
    await idle(page);
  }
  throw new Error('Could not draw both cards');
};

test("the table shows cards in the player's language, falling back to the deck's own scan", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const asked = await serveScans(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'ptcgsim.card-images.v1',
      JSON.stringify({ cardImages: 'fr' })
    );
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    buffer: deckCsv,
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  const revision = () =>
    page
      .locator('.ptcgsim-board-surface')
      .getAttribute('data-revision')
      .then(Number);
  await expect.poll(revision).toBeGreaterThan(0);
  const loaded = await revision();
  await chooseMoreAction(page, 'setupBothButton');
  await expect.poll(revision).toBeGreaterThan(loaded);
  await idle(page);
  await bothInHand(page);

  // French where it exists; the deck's English scan where it does not.
  await expect
    .poll(async () =>
      (await handFaces(page)).every(
        (face) =>
          face.state === 'ready' &&
          face.src === (face.name === 'New Mon' ? NEW_FR : OLD_EN)
      )
    )
    .toBe(true);
  expect(asked).toContain(NEW_FR);
  expect(asked).toContain(OLD_FR);
  expect(asked).not.toContain(NEW_EN);

  // English, chosen in Settings, applies at once.
  await openSettings(page);
  await expect(page.locator('#cardImageLanguageSelect')).toHaveValue('fr');
  await page.locator('#cardImageLanguageSelect').selectOption('en');
  await closeSheet(page);
  await expect
    .poll(async () =>
      (await handFaces(page)).every(
        (face) =>
          face.state === 'ready' &&
          face.src === (face.name === 'New Mon' ? NEW_EN : OLD_EN)
      )
    )
    .toBe(true);
  expect(asked).toContain(NEW_EN);
  expect(errors).toEqual([]);
});
