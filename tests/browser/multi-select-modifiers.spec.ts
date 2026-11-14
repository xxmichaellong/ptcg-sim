import { expect, test, type Page } from '@playwright/test';

import {
  card,
  openNamedSolo,
  selection,
  useTableMode,
  zoneCardIds,
} from './support/multi-select.js';

/**
 * The keys a press is read with (ADR-042 §2), in every browser: ⌘ on a
 * Mac, Ctrl elsewhere, and Shift everywhere take a card in or out; a Mac's
 * Ctrl+click is its right-click (the system sends a context menu, not a
 * click), which on a selected card opens the group's menu. Runs in the
 * cross-browser config too (WebKit, Firefox).
 */

/** The page told it runs on a Mac, as Safari and Chrome there say. */
const asMac = async (page: Page) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'platform', {
      get: () => 'MacIntel',
    });
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => undefined,
    });
  });
};

const groupMenu = (page: Page) => page.locator('[data-group-menu]');

test.beforeEach(async ({ page }) => {
  await useTableMode(page, 'flat');
});

test('on a Mac, ⌘ picks and puts down, and Ctrl+click on a selected card opens the group menu', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await asMac(page);
  await openNamedSolo(page);
  const hand = await zoneCardIds(page, 'local', 'hand');
  await card(page, hand[0]!).click({ modifiers: ['Meta'] });
  await card(page, hand[1]!).click({ modifiers: ['Meta'] });
  await card(page, hand[2]!).click({ modifiers: ['Shift'] });
  await expect
    .poll(() => selection(page))
    .toEqual([hand[0]!, hand[1]!, hand[2]!]);
  await card(page, hand[1]!).click({ modifiers: ['Meta'] });
  await expect.poll(() => selection(page)).toEqual([hand[0]!, hand[2]!]);
  // macOS turns Ctrl+click into a context menu, with Ctrl held.
  const box = (await card(page, hand[2]!).boundingBox())!;
  await card(page, hand[2]!).dispatchEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    button: 0,
    clientX: box.x + 8,
    clientY: box.y + box.height / 2,
  });
  await expect(groupMenu(page)).toBeVisible();
  await expect(
    groupMenu(page).locator('[data-group-menu-header]')
  ).toContainText('2');
  // The group is still the selection under its menu.
  expect(await selection(page)).toEqual([hand[0]!, hand[2]!]);
});

test('elsewhere, Ctrl picks and puts down, and a right-click on a selected card opens the group menu', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openNamedSolo(page);
  const hand = await zoneCardIds(page, 'local', 'hand');
  await card(page, hand[0]!).click({ modifiers: ['Control'] });
  await card(page, hand[1]!).click({ modifiers: ['Control'] });
  await expect.poll(() => selection(page)).toEqual([hand[0]!, hand[1]!]);
  await card(page, hand[0]!).click({ modifiers: ['Control'] });
  await expect.poll(() => selection(page)).toEqual([hand[1]!]);
  await card(page, hand[3]!).click({ modifiers: ['Shift'] });
  await expect.poll(() => selection(page)).toEqual([hand[1]!, hand[3]!]);
  await card(page, hand[3]!).click({ button: 'right' });
  await expect(groupMenu(page)).toBeVisible();
  expect(await selection(page)).toEqual([hand[1]!, hand[3]!]);
});
