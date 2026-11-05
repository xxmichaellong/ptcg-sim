import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The room's shell (ADR-030, ADR-036, ADR-045): the table fills the
 * window; the app bar in its top-right corner holds the deck, Play online,
 * the palette, the log and Settings, which holds the rest; Settings, Play
 * online and the deck screen open over or beside the table. Specs reach
 * every one of them through these helpers, so a change to the shell
 * changes one file.
 */

/**
 * The app bar (ADR-036) is always open in the table's top-right corner;
 * kept so older specs read the same.
 */
export const openToolbar = async (page: Page): Promise<void> => {
  await expect(page.locator('.ptcgsim-app-bar')).toBeVisible();
};

/** The bar's last button: Settings (ADR-045), which holds the rest. */
export const appMenuOpener = async (page: Page): Promise<Locator> => {
  const settings = page.locator('#settingsButton');
  await expect(settings).toBeVisible();
  return settings;
};

/** Settings' first page, while it is shown. */
export const appMenu = (page: Page): Locator =>
  page.locator('#settings #settingsHome');

/** Opens Settings at its first page and waits for it. */
export const openAppMenu = async (page: Page): Promise<void> => {
  if (!(await page.locator('#settings').isVisible())) {
    await (await appMenuOpener(page)).click();
  }
  await expect(page.locator('#settings')).toBeVisible();
  // Back to the first page, if another was left open.
  const back = page.locator('#settingsBackButton');
  while (await back.isVisible()) await back.click();
  await expect(appMenu(page)).toBeVisible();
  await tableSettled(page);
};

/**
 * Chooses an app entry by its id (`exportState`, `deckImportButton`): a
 * button on the app bar directly, anything else from Settings' first page.
 */
export const chooseMenuItem = async (page: Page, id: string): Promise<void> => {
  await expect(page.locator('#settingsButton')).toBeVisible();
  const onToolbar = page.locator(`.ptcgsim-app-bar #${id}`);
  if (await onToolbar.isVisible()) {
    await onToolbar.click();
    return;
  }
  await openAppMenu(page);
  await page.locator(`#settings #${id}`).click();
};

/**
 * Until the table has stopped making room for the column beside it (or
 * taking it back): Settings docks there on a wide screen, as the log does.
 */
export const tableSettled = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const surface = document.querySelector('.ptcgsim-board-surface');
        if (!surface) {
          resolve();
          return;
        }
        let last = Number.NaN;
        let still = 0;
        const tick = (): void => {
          const width = surface.getBoundingClientRect().width;
          still = width === last ? still + 1 : 0;
          last = width;
          if (still >= 4) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
  );

/** Settings' pages past the first (ADR-045), by the rows that open them. */
export type SettingsPageName =
  'table' | 'cards' | 'motion' | 'language' | 'reportBug' | 'about';

const SETTINGS_PAGE_ROWS: Readonly<
  Record<SettingsPageName, readonly [row: string, page: string]>
> = {
  table: ['settingsTableRow', 'settingsTable'],
  cards: ['settingsCardsRow', 'settingsCards'],
  motion: ['settingsMotionRow', 'settingsMotion'],
  language: ['settingsLanguageRow', 'settingsLanguage'],
  reportBug: ['settingsReportBugRow', 'settingsReportBug'],
  about: ['settingsAboutRow', 'settingsAbout'],
};

/** Opens Settings, at one of its pages if named. */
export const openSettings = async (
  page: Page,
  at?: SettingsPageName
): Promise<void> => {
  await openAppMenu(page);
  if (!at) return;
  const [row, shown] = SETTINGS_PAGE_ROWS[at];
  await page.locator(`#settings #${row}`).click();
  await expect(page.locator(`#settings #${shown}`)).toBeVisible();
};

/**
 * Puts away whichever sheet is open (Settings, Play online, a help page).
 * Settings goes back a page on each Esc, so it is put away from its close
 * button.
 */
export const closeSheet = async (page: Page): Promise<void> => {
  const settings = page.locator('#settings');
  if (await settings.isVisible()) {
    await settings.locator('.ptcgsim-sheet__close').first().click();
    await expect(settings).toBeHidden();
  } else {
    await page.keyboard.press('Escape');
  }
  await tableSettled(page);
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

/**
 * The turn's Attack, declared without naming one: no longer on the rail
 * (attacks are declared from a Pokémon's window, by name), so from the
 * command palette.
 */
export const declareAttack = async (page: Page): Promise<void> => {
  await page.keyboard.press('Backquote');
  await page.keyboard.type('attack');
  await expect(
    page.locator('[data-command-palette] [role="option"][aria-selected="true"]')
  ).toContainText(/^Attack/u);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-command-palette]')).toHaveCount(0);
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
