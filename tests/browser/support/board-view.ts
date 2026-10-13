import { expect, type Page } from '@playwright/test';

/**
 * The Board view panel holds every choice about how the table is shown
 * (halves, split, depth, outlines, hover preview). It opens from the table's
 * own controls and closes on Escape or a press anywhere else.
 */
export const openBoardView = async (page: Page): Promise<void> => {
  const panel = page.locator('#boardViewPanel');
  if ((await panel.count()) === 0) {
    await page.locator('#boardViewButton').click();
  }
  await expect(panel).toBeVisible();
};

export const closeBoardView = async (page: Page): Promise<void> => {
  const panel = page.locator('#boardViewPanel');
  if ((await panel.count()) > 0) {
    await panel.getByRole('button', { name: 'Close board view' }).click();
  }
  await expect(panel).toHaveCount(0);
};

const TABLE_VIEW_IDS = {
  flat: '#tableViewFlat',
  depth: '#tableViewDepth',
  table: '#tableViewTable',
} as const;

export const chooseTableView = async (
  page: Page,
  mode: keyof typeof TABLE_VIEW_IDS
): Promise<void> => {
  await openBoardView(page);
  await page.locator(TABLE_VIEW_IDS[mode]).check();
};

export const tableViewChoice = (
  page: Page,
  mode: keyof typeof TABLE_VIEW_IDS
) => page.locator(TABLE_VIEW_IDS[mode]);
