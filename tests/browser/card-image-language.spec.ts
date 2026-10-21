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
 * loads, in a pile viewer and on the Pixi table too; and choosing English
 * in Settings asks for the English scans. The scan hosts are served here,
 * never reached.
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
    // The Pixi table fetches its scans, so they answer as the hosts do.
    const headers = { 'access-control-allow-origin': '*' };
    if (url.startsWith('https://assets.tcgdex.net/fr/dp/'))
      await route.fulfill({ status: 404, headers, body: 'Not found' });
    else
      await route.fulfill({
        contentType: 'image/png',
        headers,
        body: FACE_PNG,
      });
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

test("a pile viewer keeps the deck's own scan once it loads, asking for a missing translation once", async ({
  page,
}) => {
  test.setTimeout(120_000);
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
  await expect
    .poll(() =>
      page
        .locator('.ptcgsim-board-surface')
        .getAttribute('data-revision')
        .then(Number)
    )
    .toBeGreaterThan(0);
  // The deck's cards, never yet shown on the table, first seen in its viewer.
  const deckId = await page.evaluate(
    () =>
      window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'deck'
      )!.id
  );
  await page.locator(`[data-zone-id="${deckId}"]`).focus();
  await page.keyboard.press('Enter');
  const browser = page.locator('[data-legacy-zone-browser]');
  await expect(browser).toBeVisible();
  const oldFaces = () =>
    browser.locator('.ptcgsim-legacy-overlay-card-image').evaluateAll((faces) =>
      faces
        .map((face) => ({
          state: face.getAttribute('data-overlay-image-state'),
          src: face.querySelector('img')?.getAttribute('src') ?? '',
          shown: face.querySelector('img')?.style.opacity === '1',
        }))
        .filter((face) => face.src.includes('/dp/dp1/'))
    );
  await expect
    .poll(async () => {
      const faces = await oldFaces();
      return (
        faces.length > 0 &&
        faces.every((face) => face.state === 'ready' && face.src === OLD_EN)
      );
    })
    .toBe(true);
  const oldFrench = () => asked.filter((url) => url === OLD_FR).length;
  const settled = oldFrench();
  await page.waitForTimeout(1_000);
  expect(oldFrench()).toBe(settled);
  expect(
    (await oldFaces()).every(
      (face) => face.state === 'ready' && face.src === OLD_EN && face.shown
    )
  ).toBe(true);

  // Built again (the window resized), the table asks for the deck's scan
  // itself; what has loaded stays shown.
  await page.setViewportSize({ width: 1400, height: 880 });
  await page.waitForTimeout(500);
  await expect
    .poll(async () => {
      const faces = await oldFaces();
      return (
        faces.length > 0 &&
        faces.every(
          (face) => face.state === 'ready' && face.src === OLD_EN && face.shown
        )
      );
    })
    .toBe(true);
});

test("the Pixi table shows cards in the player's language too, falling back to the deck's own scan", async ({
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
  await page.goto('/?renderer=pixi');
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
  /** The table's renderer and the faces it is given for the viewer's hand. */
  const hand = () =>
    page.evaluate(() => {
      const spike = window.__PTCG_RENDERER_SPIKE__;
      const zones = new Set(
        (spike?.scene.zones ?? [])
          .filter((zone) => zone.side === 'local' && zone.kind === 'hand')
          .map((zone) => zone.id)
      );
      return {
        renderer: spike?.rendererKind,
        revision: spike?.scene.revision ?? 0,
        urls: (spike?.scene.cards ?? [])
          .filter((card) => zones.has(card.parentId))
          .map((card) => card.imageUrl),
      };
    });
  await expect
    .poll(async () => {
      const { renderer, revision } = await hand();
      return renderer === 'pixi' && revision > 0;
    })
    .toBe(true);
  await chooseMoreAction(page, 'setupBothButton');
  // Draws until the hand holds both cards, asked for in French.
  await expect
    .poll(
      async () => {
        const { urls } = await hand();
        if (urls.includes(NEW_FR) && urls.includes(OLD_FR)) return true;
        await page.keyboard.press('2');
        return false;
      },
      { timeout: 30_000, intervals: [500] }
    )
    .toBe(true);

  // French where it exists; the old card's French scan, missing, is asked
  // for once, and the deck's English scan is painted instead.
  await expect.poll(() => asked.includes(OLD_EN)).toBe(true);
  expect(asked).toContain(NEW_FR);
  await page.waitForTimeout(1_000);
  expect(asked.filter((url) => url === OLD_FR)).toHaveLength(1);
  expect(asked).not.toContain(NEW_EN);
  expect(errors).toEqual([]);
});
