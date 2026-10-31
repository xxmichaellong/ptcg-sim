import { expect, test, type Page } from '@playwright/test';

import { overlayToast } from './support/overlay-dialogs.js';
import { ownRoomBudget } from './support/room-budget.js';
import { chooseMoreAction, openDeck } from './support/table-shell.js';

/**
 * Selecting several cards from the keyboard (ADR-042 §2-3): `x` takes the
 * card under the pointer in or out, Ctrl+A takes every card where the last
 * one lies, the palette's Selected cards counts them, keys a group can't
 * use say why, and Esc puts them down. The room's one move for a group
 * (ApplyCardSteps) is the room's work package's; this covers what works
 * without it.
 */

const deckCsv = Buffer.from(
  [
    'QTY,Name,Type,URL',
    '30,Group Mon,Pokémon,/v2/assets/table/coin-heads.webp?group-mon',
    '30,Group Energy,Energy,/v2/assets/table/coin-tails.webp?group-energy',
  ].join('\n')
);

const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-board-motion="idle"]')
  ).toHaveCount(1);
const palette = (page: Page) => page.locator('[data-command-palette]');
const field = (page: Page) =>
  page.locator('.ptcgsim-command-palette__field:not(.is-leaving *)');
const rows = (page: Page) => palette(page).locator('[role="option"]');

const openSoloTable = async (page: Page): Promise<void> => {
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
  await chooseMoreAction(page, 'setupBothButton');
  await expect
    .poll(() => handIds(page).then((ids) => ids.length))
    .toBeGreaterThanOrEqual(7);
  await idle(page);
};

/** The bottom seat's hand cards, left to right. */
const handIds = (page: Page) =>
  page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    const hand = scene?.zones.find(
      (zone) => zone.side === 'local' && zone.kind === 'hand'
    );
    return (
      scene?.cards
        .filter((card) => card.parentId === hand?.id)
        .map((card) => card.id) ?? []
    );
  });

const hover = async (page: Page, cardId: string) => {
  const card = page.locator(`[data-card-id="${cardId}"]`);
  await card.hover({ force: true });
};

/** What the palette's Selected cards offers for the group, by title. */
const groupTitles = async (page: Page, search: string) => {
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  await page.keyboard.type(search);
  await expect(rows(page).first()).toBeVisible();
  const titles = await rows(page).allTextContents();
  // ` closes it (Esc would first clear what was typed).
  await page.keyboard.press('Backquote');
  await expect(palette(page)).toHaveCount(0);
  return titles;
};

test('x and Ctrl+A select several cards, the palette counts them, and Esc puts them down', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await ownRoomBudget(context);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSoloTable(page);
  const hand = await handIds(page);

  // x on the card under the pointer, twice.
  await hover(page, hand[0]!);
  await page.keyboard.press('x');
  await hover(page, hand[1]!);
  await page.keyboard.press('x');
  expect((await groupTitles(page, 'discard')).join(' ')).toContain(
    'Discard 2 cards'
  );

  // A key for one card, and a table key, say why they wait.
  await page.keyboard.press('v');
  await expect(overlayToast(page, 'Select one card for that')).toBeVisible();
  await page.keyboard.press('Alt+d');
  await expect(
    overlayToast(page, 'Press Esc to put the cards down')
  ).toBeVisible();
  expect(await handIds(page)).toEqual(hand);

  // Ctrl+A: every card where the last one lies, the whole hand.
  await page.keyboard.press('Control+a');
  expect((await groupTitles(page, 'discard')).join(' ')).toContain(
    `Discard ${String(hand.length)} cards`
  );

  // Only one Pokémon goes Active: the group's own refusal, said at once.
  await page.keyboard.press('a');
  await expect(
    overlayToast(page, 'Only one Pokémon can be Active')
  ).toBeVisible();
  expect(await handIds(page)).toEqual(hand);

  // Esc puts the cards down: the palette offers no group any more.
  await page.keyboard.press('Escape');
  expect((await groupTitles(page, 'discard')).join(' ')).not.toContain(
    `Discard ${String(hand.length)} cards`
  );
  expect(errors).toEqual([]);
});
