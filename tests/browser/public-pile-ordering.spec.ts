import { expect, test, type Page } from '@playwright/test';
import type { RemoteGameSession } from '../../packages/client-session/src/index.js';
import type {
  MatchViewState,
  ViewCardId,
} from '../../packages/game-core/src/index.js';
import type { WireGameCommand } from '../../packages/protocol/src/index.js';

import { ownRoomBudget } from './support/room-budget.js';
import { useFlatTable } from './support/table-shell.js';

interface PileTestWindow extends Window {
  readonly __ptcgsimDevRoom?: {
    readonly runtime: {
      readonly session: Pick<RemoteGameSession, 'getSnapshot' | 'submit'>;
    };
  };
}

const view = async (page: Page): Promise<MatchViewState> =>
  page.evaluate(() => {
    const current = (
      window as PileTestWindow
    ).__ptcgsimDevRoom?.runtime.session.getSnapshot().view;
    if (!current) throw new Error('Missing real room projection');
    return current;
  });

const revision = async (page: Page): Promise<number> =>
  (await view(page)).revision;

/** Arrange through the real authority; the actions under test use the UI. */
const submit = async (page: Page, command: WireGameCommand): Promise<void> => {
  const before = await revision(page);
  const queued = await page.evaluate((command) => {
    const session = (window as PileTestWindow).__ptcgsimDevRoom?.runtime
      .session;
    if (!session) throw new Error('Missing real room session');
    return session.submit(command).queued;
  }, command);
  expect(queued).toBe(true);
  await expect.poll(() => revision(page)).toBe(before + 1);
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    String(before + 1)
  );
};

const pile = async (page: Page, kind: 'discard' | 'lostZone') => {
  const current = await view(page);
  const zone = Object.values(current.zones).find(
    (zone) => zone.ownerId === current.playerOrder[0] && zone.kind === kind
  );
  if (!zone) throw new Error(`Missing ${kind}`);
  return zone;
};

const fillPile = async (page: Page, kind: 'discard' | 'lostZone') => {
  await page.goto(
    '/?dev-room=1&room-mode=solo&renderer=dom&name=Pile%20ordering'
  );
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  await submit(page, {
    type: 'LoadDeck',
    entries: [
      {
        definition: {
          id: 'zeta',
          name: 'Zeta',
          category: 'Pokémon',
          imageUrl: '/v2/assets/cardback.png?zeta',
        },
        count: 2,
      },
      {
        definition: {
          id: 'alpha',
          name: 'Alpha',
          category: 'Pokémon',
          imageUrl: '/v2/assets/cardback.png?alpha',
        },
        count: 1,
      },
      {
        definition: {
          id: 'beta',
          name: 'Beta',
          category: 'Pokémon',
          imageUrl: '/v2/assets/cardback.png?beta',
        },
        count: 1,
      },
    ],
  });
  const current = await view(page);
  const deck = Object.values(current.zones).find(
    (zone) => zone.ownerId === current.playerOrder[0] && zone.kind === 'deck'
  )!;
  const destination = await pile(page, kind);
  for (const card of deck.cards)
    await submit(page, {
      type: 'MoveCard',
      cardId: card.id,
      expectedSourceZoneId: deck.id,
      destinationZoneId: destination.id,
    });
  const cards = (await pile(page, kind)).cards;
  if (kind === 'discard') {
    await submit(page, {
      type: 'SetCardAbilityUsed',
      cardId: cards[0]!.id,
      used: true,
    });
  }
  return { zoneId: destination.id, cardIds: cards.map((card) => card.id) };
};

const openPile = async (page: Page, kind: 'discard' | 'lostZone') => {
  const zone = await pile(page, kind);
  const top = zone.cards.at(-1)!;
  await page
    .locator(`.ptcgsim-board-surface [data-card-id="${top.id}"]`)
    .click();
  const browser = page.locator(`[data-zone-browser-id="${zone.id}"]`);
  await expect(browser).toBeVisible();
  return browser;
};

const ids = async (page: Page, kind: 'discard' | 'lostZone') =>
  (await pile(page, kind)).cards.map((card) => card.id);

const picked = (page: Page, cardId: ViewCardId) =>
  page.locator(`[data-overlay-card-id="${cardId}"]`);

test.beforeEach(async ({ context, page }) => {
  await ownRoomBudget(context);
  await useFlatTable(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'ptcgsim.board-view.v1',
      JSON.stringify({ lostZone: true })
    );
  });
});

test('orders individual discard copies through the keyboard, preserves markers, and undoes exactly', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { cardIds } = await fillPile(page, 'discard');
  const originalCards = (await pile(page, 'discard')).cards;
  const browser = await openPile(page, 'discard');
  await expect(browser.locator('[data-overlay-card-id]')).toHaveCount(3);
  await expect(browser.locator('.ptcgsim-zone-copy-badge')).toHaveText('×2');
  const sort = browser.locator('[data-zone-action="sortZone"]');
  await sort.check();
  await picked(page, cardIds[0]!).focus();
  await page.keyboard.press('Enter');
  const top = browser.locator('[data-card-action="pile-top"]');
  const before = await revision(page);
  await top.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => revision(page)).toBe(before + 1);
  await expect
    .poll(() => ids(page, 'discard'))
    .toEqual([...cardIds.slice(1), cardIds[0]]);
  await expect(sort).not.toBeChecked();
  expect((await pile(page, 'discard')).cards.at(-1)).toEqual(originalCards[0]);
  await expect(browser.locator('[data-overlay-card-id]')).toHaveCount(3);
  await expect(
    browser.locator(`[data-overlay-card-id="${cardIds[1]}"]`)
  ).toHaveCount(1);
  await expect(browser.locator('[data-card-action="pile-top"]')).toBeDisabled();
  await expect(
    browser.locator('[data-card-action="pile-bottom"]')
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(browser).toHaveCount(0);
  await page.locator('#undoButton').click();
  await expect.poll(() => ids(page, 'discard')).toEqual(cardIds);
  expect((await pile(page, 'discard')).cards).toEqual(originalCards);
  expect(errors).toEqual([]);
});

for (const locale of ['ru', 'ar']) {
  test.describe(`320px ${locale} phone`, () => {
    test.use({
      viewport: { width: 320, height: 740 },
      locale,
      isMobile: true,
      hasTouch: true,
    });
    test('keeps both same-pile actions in reach and closes with one Escape', async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const { cardIds } = await fillPile(page, 'lostZone');
      const browser = await openPile(page, 'lostZone');
      await picked(page, cardIds.at(-1)!).tap();
      const bottom = browser.locator('[data-card-action="pile-bottom"]');
      await expect(bottom).toBeEnabled();
      for (const button of await browser
        .locator('.ptcgsim-card-actions button')
        .all()) {
        await expect(button).toBeInViewport({ ratio: 1 });
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
      const before = await revision(page);
      await bottom.tap();
      await expect.poll(() => revision(page)).toBe(before + 1);
      await expect
        .poll(() => ids(page, 'lostZone'))
        .toEqual([cardIds.at(-1), ...cardIds.slice(0, -1)]);
      await page.keyboard.press('Escape');
      await expect(browser).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}
