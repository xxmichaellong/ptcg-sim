import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { ownRoomBudget } from './support/room-budget.js';
import { openDeck } from './support/table-shell.js';

test.beforeEach(async ({ page, context }) => {
  await ownRoomBudget(context);
  await routeCardCatalog(page);
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await openDeck(page);
  await page.locator('#deckNewButton').click();
});

for (const closeWith of ['Escape', 'submit'] as const) {
  test(`custom cards return keyboard focus after ${closeWith}, and the next Escape leaves the deck`, async ({
    page,
  }) => {
    const custom = page.locator('#nativeDeckBuilderAddCustomCard');
    await custom.focus();
    await page.keyboard.press('Enter');
    const modal = page.locator('#nativeDeckBuilderCustomCardModal');
    await expect(page.locator('#nativeCustomCardName')).toBeFocused();
    if (closeWith === 'submit') {
      await page.locator('#nativeCustomCardName').fill('Proxy');
      await page
        .locator('#nativeCustomCardImageUrl')
        .fill(new URL('/v2/assets/cardback.png', page.url()).href);
      await page.locator('#nativeCustomCardImageUrl').press('Enter');
      await expect(page.locator('#nativeCustomCardPreviewImage')).toBeVisible();
      await expect(
        page.locator('.custom-card-slot[data-status="ready"]')
      ).toHaveCount(1);
      await page.locator('#nativeCustomCardSubmit').focus();
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(modal).toBeHidden();
    await expect(custom).toBeFocused();
    // A tooltip opened by script focus would consume this next Escape.
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ptcgsim-deck-layer')).toHaveAttribute(
      'data-open',
      'false'
    );
  });
}

const PICTURE = readFileSync(
  fileURLToPath(
    new URL('../../apps/web/public/v2/assets/cardback.png', import.meta.url)
  )
);

test('a chosen picture is uploaded to the image store and the card shows our copy', async ({
  page,
}) => {
  await page.locator('#nativeDeckBuilderAddCustomCard').click();
  await page.locator('#nativeCustomCardName').fill('Proxy');
  await page.locator('#nativeCustomCardImageFile-0').setInputFiles({
    name: 'proxy.png',
    mimeType: 'image/png',
    buffer: PICTURE,
  });
  await expect(
    page.locator('.custom-card-slot[data-status="ready"]')
  ).toHaveCount(1, { timeout: 20_000 });
  const stored = await page
    .locator('#nativeCustomCardPreviewImage')
    .getAttribute('src');
  expect(stored).toMatch(/^\/v2\/images\/[0-9a-f]{64}$/u);
  await page.locator('#nativeCustomCardSubmit').click();
  await expect(page.locator('#nativeDeckBuilderCustomCardModal')).toBeHidden();
  await expect(page.locator('#deckCheckPanel')).toContainText('(1/60)');
});

test("a picture dropped on its slot is the card's, not a deck list to import", async ({
  page,
}) => {
  await page.locator('#nativeDeckBuilderAddCustomCard').click();
  await page.locator('#nativeCustomCardName').fill('Proxy');
  const transfer = await page.evaluateHandle(
    (data) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(data)], 'dropped.png', { type: 'image/png' })
      );
      return transfer;
    },
    [...PICTURE]
  );
  // Every notice shown from here on, however briefly.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as { __notices?: string[] }).__notices = seen;
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll(
        '[data-ptcgsim-overlay="toast"]'
      ))
        if (!seen.includes(toast.textContent ?? ''))
          seen.push(toast.textContent ?? '');
    }).observe(document.body, { childList: true, subtree: true });
  });
  const frame = page.locator('.custom-card-slot__frame').first();
  await frame.dispatchEvent('dragover', { dataTransfer: transfer });
  await frame.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(
    page.locator('.custom-card-slot[data-status="ready"]')
  ).toHaveCount(1, { timeout: 20_000 });
  // The deck screen around it read nothing: no list, nor a notice that the
  // picture is none (a list waits up to 2.5 s for the catalog first).
  await page.waitForTimeout(4000);
  const notices = await page.evaluate(
    () => (window as { __notices?: string[] }).__notices ?? []
  );
  expect(
    notices.filter((notice) => /Couldn't (read|open)/u.test(notice))
  ).toEqual([]);
});

test('a V-UNION goes into the deck as four pieces from one window', async ({
  page,
}) => {
  await page.locator('#nativeDeckBuilderAddCustomCard').click();
  await page.locator('#nativeCustomCardName').fill('Mewtwo V-UNION');
  await page.locator('#nativeCustomCardQty').fill('2');
  await page.locator('#nativeCustomCardMultiPiece').click();
  await expect(page.locator('#nativeCustomCardTitle')).toHaveText(
    'Multi-piece card'
  );
  const slots = page.locator('.custom-card-slot');
  await expect(slots).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await page.locator(`#nativeCustomCardImageFile-${index}`).setInputFiles({
      name: `piece-${index}.png`,
      mimeType: 'image/png',
      buffer: PICTURE,
    });
  }
  await expect(
    page.locator('.custom-card-slot[data-status="ready"]')
  ).toHaveCount(4, { timeout: 20_000 });
  await page.locator('#nativeCustomCardSubmit').click();
  await expect(page.locator('#nativeDeckBuilderCustomCardModal')).toBeHidden();
  await expect(page.locator('#deckCheckPanel')).toContainText('(8/60)');
});

test.describe('a German phone', () => {
  test.use({
    locale: 'de',
    viewport: { width: 320, height: 740 },
    isMobile: true,
    hasTouch: true,
  });

  test('keeps both translated custom-card actions fully reachable', async ({
    page,
  }) => {
    await page.locator('#nativeDeckBuilderAddCustomCard').click();
    const actions = page.locator('.native-deck-builder-modal-actions');
    await actions.scrollIntoViewIfNeeded();
    for (const id of ['nativeCustomCardCancel', 'nativeCustomCardSubmit']) {
      const button = page.locator(`#${id}`);
      await expect(button).toBeInViewport({ ratio: 1 });
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
    await page.locator('#nativeCustomCardCancel').click();
    await expect(page.locator('#nativeDeckBuilderAddCustomCard')).toBeFocused();
  });
});
