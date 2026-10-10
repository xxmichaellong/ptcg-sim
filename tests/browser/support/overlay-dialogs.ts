import type { Locator, Page } from '@playwright/test';

/**
 * Browser-side handles for the v2 overlay primitives (apps/web/src/ui),
 * which replaced the native `confirm`, `prompt` and `alert` dialogs. The v1
 * legacy runtime still uses native dialogs; its specs keep `page.on('dialog')`.
 */

/** The prompt dialog that is open now (not one animating out). */
export const openOverlayPrompt = (page: Page): Locator =>
  page.locator('[data-ptcgsim-overlay="dialog"][data-open]');

/** The confirmation (role=alertdialog) that is open now. */
export const openOverlayConfirm = (page: Page): Locator =>
  page.locator('[data-ptcgsim-overlay="alert"][data-open]');

/** Any overlay dialog that is open now. */
export const openOverlayDialogs = (page: Page): Locator =>
  page.locator(
    '[data-ptcgsim-overlay="dialog"][data-open], [data-ptcgsim-overlay="alert"][data-open]'
  );

/** A notice in the toast stack whose text includes `text`. */
export const overlayToast = (page: Page, text: string): Locator =>
  page.locator('[data-ptcgsim-overlay="toast"]').filter({ hasText: text });

export interface OverlayPromptAnswer {
  readonly type: 'prompt';
  /** The question: the dialog's title. */
  readonly message: string;
  /** What the field held when the dialog opened. */
  readonly defaultValue: string;
}

/**
 * Waits for the next prompt dialog and answers it: `value` is typed and
 * submitted with Enter, `null` presses Cancel. Start it before the action
 * that asks, and await it afterwards, like a `page.once('dialog')` handler.
 * A value the dialog refuses leaves it open with its message.
 */
export const answerOverlayPrompt = async (
  page: Page,
  value: string | null
): Promise<OverlayPromptAnswer> => {
  const dialog = openOverlayPrompt(page);
  await dialog.waitFor({ state: 'visible' });
  const message =
    (await dialog.locator('.ptcgsim-ui-dialog__title').textContent()) ?? '';
  const field = dialog.locator('.ptcgsim-ui-field__input');
  const defaultValue = await field.inputValue();
  if (value === null) {
    await dialog.locator('[data-dialog-action="cancel"]').click();
  } else {
    await field.fill(value);
    await field.press('Enter');
  }
  return { type: 'prompt', message, defaultValue };
};

export interface OverlayConfirmAnswer {
  readonly type: 'confirm';
  /** The question as v1 worded it: the dialog's description. */
  readonly message: string;
}

/**
 * Waits for the next confirmation and presses its confirm (`true`) or
 * Cancel (`false`) button. Start it before the action that asks.
 */
export const answerOverlayConfirm = async (
  page: Page,
  accept: boolean
): Promise<OverlayConfirmAnswer> => {
  const dialog = openOverlayConfirm(page);
  await dialog.waitFor({ state: 'visible' });
  const message =
    (await dialog.locator('.ptcgsim-ui-dialog__description').textContent()) ??
    '';
  await dialog
    .locator(`[data-dialog-action="${accept ? 'confirm' : 'cancel'}"]`)
    .click();
  return { type: 'confirm', message };
};
