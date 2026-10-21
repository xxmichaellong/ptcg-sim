import { expect, test, type Page, type Route } from '@playwright/test';

import { openDeck } from './support/table-shell.js';

/**
 * Pictures show the moment they are drawn. The deck screen gets ready while
 * the table sits idle -- its script, its lists, the catalog and the covers
 * it opens on -- so it opens with every cover painted. A deck put on a seat
 * has its faces loaded before they are dealt.
 */

const FACE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAD8AAABYCAIAAADNzLhqAAAAfElEQVR4nO3bQQ2AQBDAwJODCIShjjdK0IEHPpvmJqmAMdB1XE+3NS6gb0ZPT18rrn/vsxs9PX0tenr6WvT09LXo6elr0dPT16Knp69FT09fi56evhY9PX0tenr6WvT09LXo6elr0dPT16Kn/6kf/3Y2PpbGBfTN6Ol31H9L9mwjgA6TBwAAAABJRU5ErkJggg==',
  'base64'
);

/** Serves every scan host, never reached; returns what was asked for. */
const serveScans = async (page: Page): Promise<string[]> => {
  const asked: string[] = [];
  const serve = async (route: Route) => {
    asked.push(route.request().url());
    await route.fulfill({ contentType: 'image/png', body: FACE_PNG });
  };
  await page.route('https://assets.tcgdex.net/**', serve);
  await page.route(/^https:\/\/limitlesstcg\.nyc3\./u, serve);
  await page.route('https://images.pokemontcg.io/**', serve);
  return asked;
};

/**
 * A deck's pictures here are the app's own condition chips: served by the
 * app itself, the browser keeps them as it keeps any card scan. (A routed
 * host would not do: Playwright's routing stops the browser reusing an
 * image it already has.)
 */
const chip = (page: Page, kind: string): string =>
  new URL(`/v2/assets/table/condition-${kind}.png`, page.url()).href;

interface OpeningCover {
  readonly src: string;
  readonly painted: boolean;
}

/** Notes what the deck screen shows in the very frame it opens. */
const recordOpeningCovers = (page: Page) =>
  page.evaluate(() => {
    const record = window as unknown as {
      openingCovers?: Promise<OpeningCover[]>;
    };
    record.openingCovers = new Promise((resolve) => {
      const check = (): boolean => {
        const layer = document.querySelector(
          '.ptcgsim-deck-layer[data-open="true"]'
        );
        if (!layer) return false;
        // Just before the browser paints that frame.
        requestAnimationFrame(() =>
          resolve(
            [...layer.querySelectorAll('.deck-cover img')].map((image) => ({
              src: image.getAttribute('src') ?? '',
              painted:
                image instanceof HTMLImageElement &&
                image.complete &&
                image.naturalWidth > 0,
            }))
          )
        );
        return true;
      };
      new MutationObserver((_, observer) => {
        if (check()) observer.disconnect();
      }).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-open'],
      });
    });
  });

const openingCovers = (page: Page): Promise<OpeningCover[]> =>
  page.evaluate(
    () =>
      (window as unknown as { openingCovers: Promise<OpeningCover[]> })
        .openingCovers
  );

const ready = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
};

test('the deck screen opens with its covers already painted', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // A deck saved on one visit...
  await ready(page);
  const burned = chip(page, 'burned');
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'chips.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        `40,Burned Mon,Pokémon,${burned}`,
        `20,Confused Mon,Pokémon,${chip(page, 'confused')}`,
      ].join('\n')
    ),
  });
  await expect(
    page.getByRole('list', { name: 'Your decks' }).getByRole('listitem')
  ).toHaveCount(1);
  await page.waitForTimeout(500);
  const next = await page.context().newPage();
  await page.close();

  // ...is ready on the next: the screen warms up while the table sits
  // idle, its cover fetched before the screen is ever opened.
  const asked: string[] = [];
  next.on('request', (request) => asked.push(request.url()));
  await ready(next);
  await expect.poll(() => asked.includes(burned)).toBe(true);
  await next.waitForTimeout(500);
  await recordOpeningCovers(next);
  await openDeck(next);
  const covers = await openingCovers(next);
  expect(covers.map((cover) => cover.src)).toContain(burned);
  expect(covers.filter((cover) => !cover.painted)).toEqual([]);
});

const NEW_MON = 'https://assets.tcgdex.net/en/sv/sv06/130/high.webp';
const OLD_MON = 'https://assets.tcgdex.net/en/dp/dp1/1/high.webp';

test('a deck put on a seat has its faces loaded before they are dealt', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const asked = await serveScans(page);
  await ready(page);
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  // The deck's cover is its most played Pokémon: New Mon. Old Mon shows
  // nowhere on the deck screen.
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        `40,New Mon,Pokémon,${NEW_MON}`,
        `20,Old Mon,Pokémon,${OLD_MON}`,
      ].join('\n')
    ),
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  // Not dealt yet (no Set up), yet both faces are in the page.
  await expect.poll(() => asked.includes(NEW_MON)).toBe(true);
  await expect.poll(() => asked.includes(OLD_MON)).toBe(true);
  expect(
    await page.locator('[data-in-hand][data-card-side="local"]').count()
  ).toBe(0);
});

test('a connection that drops as the deck screen warms up does not keep it from opening', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  // Offline while the warm-up would fetch the screen's script.
  await context.setOffline(true);
  await page.waitForTimeout(4_000);
  await context.setOffline(false);
  await openDeck(page);
  await expect(page.locator('#nativeDeckBuilderPlayButton')).toBeVisible({
    timeout: 30_000,
  });
});
