import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The room's shell (ADR-030, ADR-036): the table fills the window; the app
 * bar in its top-right corner holds the deck, Play online, the palette, the
 * log, Settings and the menu; Settings, Play online and the deck screen open
 * over the table. Specs reach every one of them through these helpers, so a
 * change to the shell changes one file.
 */

/**
 * The app bar (ADR-036) is always open in the table's top-right corner;
 * kept so older specs read the same.
 */
export const openToolbar = async (page: Page): Promise<void> => {
  await expect(page.locator('.ptcgsim-app-bar')).toBeVisible();
};

/** The button that opens the app menu: the bar's last, ☰. */
export const appMenuOpener = async (page: Page): Promise<Locator> => {
  const menu = page.locator('#appMenuButton');
  await expect(menu).toBeVisible();
  return menu;
};

/**
 * The open app menu, found by the button that opened it. Not by its name:
 * the rail's own More menu, still fading out after a game action, has a
 * name of its own too.
 */
export const appMenu = (page: Page): Locator =>
  page.locator(
    '[role="menu"][aria-labelledby="appMenuButton"]:not([data-ending-style])'
  );

/** Opens the app menu and waits for it. */
export const openAppMenu = async (page: Page): Promise<void> => {
  await (await appMenuOpener(page)).click();
  await expect(appMenu(page)).toBeVisible();
};

/**
 * Chooses an app entry by its id (`settingsButton`, `exportState`): a
 * button on the app bar directly, anything else from the menu (☰).
 */
export const chooseMenuItem = async (page: Page, id: string): Promise<void> => {
  await expect(page.locator('#appMenuButton')).toBeVisible();
  const onToolbar = page.locator(`.ptcgsim-app-bar #${id}`);
  if (await onToolbar.isVisible()) {
    await onToolbar.click();
    return;
  }
  await openAppMenu(page);
  await page.locator(`#${id}`).click();
};

export const openSettings = async (page: Page): Promise<void> => {
  await chooseMenuItem(page, 'settingsButton');
  await expect(page.locator('#settings')).toBeVisible();
};

/** Puts away whichever sheet is open (Settings, Play online, a help page). */
export const closeSheet = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape');
};

/** The deck screen, from the menu. */
export const openDeck = async (page: Page): Promise<void> => {
  await chooseMenuItem(page, 'deckImportButton');
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="true"]')
  ).toBeVisible();
};

export const closeDeck = async (page: Page): Promise<void> => {
  await page.locator('#deckBackButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
};

/** Opens the log (what happened, and the chat) if it is not open. */
export const openActivity = async (page: Page): Promise<void> => {
  const button = page.locator('#activityButton');
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    await button.click();
  }
  await expect(page.locator('#activitySheet')).toBeVisible();
};

/** One of the log's own actions: `exportLog`, `clearLog`. */
export const chooseLogAction = async (
  page: Page,
  id: string
): Promise<void> => {
  await openActivity(page);
  await page.locator('#activityLogMenuButton').click();
  await page.locator(`#${id}`).click();
};

/** Play online, from a Solo table's menu. */
export const openPlayOnline = async (page: Page): Promise<void> => {
  await chooseMenuItem(page, 'p2Button');
  await expect(page.locator('#playOnlineSheet')).toBeVisible();
};

/**
 * A rarer game action: `resetButton`, `setupBothButton`. More holds three
 * or more; one or two sit on the rail itself (TableRail's fitRailActions).
 */
export const chooseMoreAction = async (
  page: Page,
  id: string
): Promise<void> => {
  const onRail = page.locator(`#boardButtonContainer #${id}`);
  const more = page.locator('#moreActionsButton');
  // The rail settles on its actions a moment after the table changes (a
  // deck loaded brings Set up): wait for the action or More, whichever shows.
  await expect(onRail.or(more).first()).toBeVisible();
  if (await onRail.isVisible()) {
    await onRail.click();
    return;
  }
  await more.click();
  await page.locator(`#${id}`).click();
};

/** Puts away the empty table's welcome card, if it is showing. */
export const dismissWelcome = async (page: Page): Promise<void> => {
  const dismiss = page.locator('.table-welcome__dismiss');
  if (await dismiss.isVisible()) await dismiss.click();
};

/**
 * Closes the activity log: the docked panel from its own close button (it
 * sits over the rail's end while docked), a sheet the same way.
 */
export const closeActivity = async (page: Page): Promise<void> => {
  const panel = page.locator('#activitySheet');
  if ((await panel.count()) === 0) return;
  await panel.getByRole('button', { name: /^Close/u }).click();
  await expect(panel).toHaveCount(0);
};

/**
 * Plays on the flat table. A landscape window shows the tilted tabletop by
 * default (Auto); a spec that works in the table's flat coordinates (drags
 * aimed at a zone's logical centre) asks for the flat table instead.
 */
export const useFlatTable = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ptcgsim.table-depth.v1',
      JSON.stringify({ mode: 'flat' })
    );
  });
};
