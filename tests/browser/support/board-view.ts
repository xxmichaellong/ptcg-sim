import { expect, type Page } from '@playwright/test';

import { closeSheet, openSettings } from './table-shell.js';

/**
 * How the table is shown (halves, split, depth, Lost Zone, outlines, hover
 * preview) is the Table section of Settings (ADR-030; first a Board view
 * panel). It opens from the app menu and closes on Escape.
 */
export const openBoardView = async (page: Page): Promise<void> => {
  const settings = page.locator('#settings');
  if (!(await settings.isVisible())) await openSettings(page);
  await expect(page.locator('#boardShowBoth')).toBeAttached();
};

export const closeBoardView = async (page: Page): Promise<void> => {
  const settings = page.locator('#settings');
  if (await settings.isVisible()) await closeSheet(page);
  await expect(settings).toHaveCount(0);
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
