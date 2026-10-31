import { expect, type Locator, type Page } from '@playwright/test';

/** The card-back chooser (ADR-041 stage 2), while it is open. */
export const cardBackChooser = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Card back', exact: true });

/** Opens the chooser from the deck screen's tray. */
export const openCardBackChooser = async (page: Page): Promise<Locator> => {
  await page.locator('#changeCardBackButton').click();
  const dialog = cardBackChooser(page);
  await expect(dialog).toBeVisible();
  return dialog;
};

/**
 * Makes an outside picture the back through the chooser: its link fetched
 * through the app (route it with `routeCardBackImport`), shown, then saved
 * as our own and used. Resolves once the chooser has closed.
 */
export const chooseCardBackFromLink = async (
  page: Page,
  url: string
): Promise<void> => {
  const dialog = await openCardBackChooser(page);
  await dialog.locator('#cardBackMode-picture').check();
  await dialog.locator('#cardBackLinkInput').fill(url);
  await dialog.getByRole('button', { name: 'Get', exact: true }).click();
  await expect(dialog.locator('.card-back-crop img')).toBeVisible();
  await dialog.locator('#useCardBackButton').click();
  await expect(dialog).toHaveCount(0);
};
