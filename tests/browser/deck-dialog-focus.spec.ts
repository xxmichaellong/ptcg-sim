import { expect, test, type Locator, type Page } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { ownRoomBudget } from './support/room-budget.js';
import { openDeck } from './support/table-shell.js';

const tabTo = async (page: Page, target: Locator): Promise<void> => {
  for (let count = 0; count < 150; count += 1) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Native Tab did not reach the requested deck control');
};
const makeDeck = async (page: Page): Promise<void> => {
  await tabTo(page, page.locator('#deckNewButton'));
  await page.keyboard.press('Enter');
  await expect(page.locator('.deck-editor')).toBeFocused();
  await page.locator('#deckNameInput').fill('Alpha');
  await page.keyboard.press('Enter');
};
const sleevePrompt = async (page: Page, seat: string): Promise<Locator> => {
  const sleeve = page.getByRole('button', {
    name: `Change card back for ${seat}`,
    exact: true,
  });
  await tabTo(page, sleeve);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Change card back' });
  await expect(dialog.locator('input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(sleeve).toBeFocused();
  return sleeve;
};
const noReturnTooltip = async (page: Page, label: string): Promise<void> => {
  // Let a tooltip opened by the automatic return focus become observable.
  await page.waitForTimeout(300);
  await expect(
    page.locator('.ptcgsim-ui-tooltip').filter({ hasText: label })
  ).toHaveCount(0, { timeout: 1_000 });
};

test.beforeEach(async ({ page, context }) => {
  await ownRoomBudget(context);
  await routeCardCatalog(page);
  await page.goto('/');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  await openDeck(page);
});

for (const editor of [false, true]) {
  for (const seat of ['P1', 'P2']) {
    test(`${seat} sleeve cancellation returns to its opener from ${editor ? 'editor' : 'shelf'}, then Escape leaves`, async ({
      page,
    }) => {
      if (editor) await makeDeck(page);
      await sleevePrompt(page, seat);
      await noReturnTooltip(page, `Card back for ${seat}`);
      await page.keyboard.press('Escape');
      await expect(page.locator('.ptcgsim-deck-layer')).toHaveAttribute(
        'data-open',
        'false'
      );
    });
  }
}

for (const action of ['editor-delete', 'shelf-delete', 'shelf-rename']) {
  test(`${action} cancellation returns to its persistent menu button`, async ({
    page,
  }) => {
    await makeDeck(page);
    const editor = action === 'editor-delete';
    if (!editor) {
      await tabTo(page, page.locator('#deckEditorBackButton'));
      await page.keyboard.press('Enter');
    }
    const trigger = editor
      ? page.locator('#nativeDeckBuilderExportCsv')
      : page.getByRole('button', { name: 'More for Alpha', exact: true });
    await tabTo(page, trigger);
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', {
      name: editor ? 'Export' : 'More for Alpha',
      exact: true,
    });
    await expect(menu).toHaveCSS('opacity', '1');
    const rename = action === 'shelf-rename';
    await page.keyboard.press(rename ? 'Home' : 'End');
    const item = menu.getByRole('menuitem', {
      name: rename ? 'Rename' : editor ? 'Delete deck' : 'Delete',
      exact: true,
    });
    await expect(item).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole(rename ? 'dialog' : 'alertdialog');
    await expect(
      dialog.locator(rename ? 'input' : '[data-dialog-action="confirm"]')
    ).toBeFocused();
    // Its menu item is transient: cancel after the menu has finished
    // closing, so that item cannot serve as the dialog's return target.
    await expect(item).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(
      dialog.locator(rename ? 'input' : '[data-dialog-action="confirm"]')
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused({ timeout: 1_000 });
    await noReturnTooltip(page, editor ? 'Export' : 'More');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ptcgsim-deck-layer')).toHaveAttribute(
      'data-open',
      'false'
    );
  });
}

for (const intent of ['hover', 'keyboard']) {
  test(`a sleeve tooltip still opens on ordinary ${intent} after returning`, async ({
    page,
  }) => {
    const sleeve = await sleevePrompt(page, 'P1');
    await noReturnTooltip(page, 'Card back for P1');
    if (intent === 'hover') {
      await page.mouse.move(0, 0);
      await sleeve.hover();
    } else {
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(sleeve).toBeFocused();
    }
    await expect(
      page
        .locator('.ptcgsim-ui-tooltip')
        .filter({ hasText: 'Card back for P1' })
    ).toBeVisible();
  });
}

test('an empty editor wraps both Tab directions around its checked view radio and keeps native arrows', async ({
  page,
}) => {
  await makeDeck(page);
  const list = page.locator('#deckView-list');
  const images = page.locator('#deckView-images');
  const first = page.locator('#deckBackButton');
  await expect(list).toBeChecked();
  await list.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(list).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(images).toBeChecked();
  await expect(images).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(images).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(list).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
});
