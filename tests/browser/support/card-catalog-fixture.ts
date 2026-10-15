import type { Page, Route } from '@playwright/test';

import fixture from '../../fixtures/card-catalog.json' with { type: 'json' };

/**
 * The deck builder's card catalog (ADR-032) for browser specs: a small
 * catalog of real cards in the server's wire format (74 cards, 28 sets; see
 * scripts/card-catalog/build-test-fixture.ts), served in place of the
 * server's so a spec never waits for, or depends on, TCGdex.
 */
export const CARD_CATALOG_FIXTURE = fixture;

/** The version the fixture is served as: 20 hex digits, like the server's. */
export const CARD_CATALOG_FIXTURE_VERSION = 'f1f1f1f1f1f1f1f1f1f1';

const cardCount = (catalog: typeof fixture): number =>
  catalog.sets.reduce((total, set) => total + set.cards.length, 0);

/**
 * Serves `catalog` for `/v2/cards/catalog` and its body. With `building`,
 * the manifest answers 503 as a server still building its first catalog
 * does, until `ready()` is called.
 */
export const routeCardCatalog = async (
  page: Page,
  options: {
    readonly catalog?: typeof fixture;
    readonly version?: string;
    readonly building?: boolean;
  } = {}
): Promise<{ readonly ready: () => void; readonly requests: () => number }> => {
  const catalog = options.catalog ?? fixture;
  const version = options.version ?? CARD_CATALOG_FIXTURE_VERSION;
  let building = options.building ?? false;
  let requests = 0;
  await page.route('**/v2/cards/catalog', async (route: Route) => {
    requests += 1;
    if (building) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'unavailable', building: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        version,
        url: `/v2/cards/catalog/${version}.json`,
        builtAt: catalog.builtAt,
        sets: catalog.sets.length,
        cards: cardCount(catalog),
        complete: true,
      }),
    });
  });
  await page.route(
    `**/v2/cards/catalog/${version}.json`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify(catalog),
      });
    }
  );
  return {
    ready: () => {
      building = false;
    },
    requests: () => requests,
  };
};
