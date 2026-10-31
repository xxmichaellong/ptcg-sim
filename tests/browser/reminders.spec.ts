import { expect, test, type Page } from '@playwright/test';

import {
  card,
  idle,
  logLines,
  nextRevision,
  openNamedSolo,
  POKEMON_DECK,
  pokemonIn,
  pressOn,
  revision,
  useTableMode,
  zoneCardIds,
  zoneCount,
  type TableMode,
} from './support/multi-select.js';
import { chooseMoreAction } from './support/table-shell.js';

/**
 * Reminders of lasting effects on a Pokémon (PX-081): put on from the
 * card's menu, shown as a chip on the card from either seat, taken off from
 * the chip's controls, and gone with the Pokémon. Solo, flat and tilted.
 */

/** Waits for the move a press sends to come back from the room. */
const moved = async (page: Page, act: () => Promise<void>) => {
  const before = await revision(page);
  await act();
  await nextRevision(page, before);
  await idle(page);
};

const chip = (page: Page, topId: string, reminder: string) =>
  page.locator(`[data-marker-hint-id="${topId}:reminder:${reminder}"]`);

const controls = (page: Page) =>
  page.locator('.ptcgsim-marker-controls[data-marker-controls="reminder"]');

/** The card's menu, then its Reminder entry: the reminders' controls. */
const openReminders = async (page: Page, topId: string) => {
  await card(page, topId).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reminder', exact: true }).click();
  await expect(controls(page)).toBeVisible();
};

for (const mode of ['flat', 'table'] as const satisfies readonly TableMode[])
  test(`a reminder goes on a Pokémon from its menu, shows from either seat, comes off from its chip, and goes with it (${mode})`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await useTableMode(page, mode);
    await openNamedSolo(page, { deck: POKEMON_DECK });
    const hand = await zoneCardIds(page, 'local', 'hand');
    await moved(page, () => pressOn(page, hand[0]!, 'a'));
    await page.keyboard.press('Escape');
    const [top] = await pokemonIn(page, 'local', 'active');

    // Put on from the card's menu: none goes on until one is chosen.
    await openReminders(page, top!);
    await expect(
      page.locator('[data-marker-hint-id*=":reminder:"]')
    ).toHaveCount(0);
    await moved(page, () =>
      controls(page).getByRole('button', { name: "Can't attack" }).click()
    );
    await expect(chip(page, top!, 'cantAttack')).toHaveAttribute(
      'data-board-hint',
      "Reminder: Can't attack"
    );
    await expect(
      controls(page).getByRole('button', { name: "Can't attack" })
    ).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(controls(page)).toHaveCount(0);

    // The table turned to the other seat: the chip lies on the same
    // Pokémon, now across the table.
    await chooseMoreAction(page, 'flipBoardButton');
    await idle(page);
    await expect(
      page.locator(
        `[data-marker-id="${top}:reminder:cantAttack"][data-marker-side="opponent"]`
      )
    ).toHaveCount(1);
    await chooseMoreAction(page, 'flipBoardButton');
    await idle(page);

    // A press on the chip opens its controls; pressed again, it comes off.
    const box = (await chip(page, top!, 'cantAttack').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(controls(page)).toBeVisible();
    await moved(page, () =>
      controls(page).getByRole('button', { name: "Can't attack" }).click()
    );
    await expect(chip(page, top!, 'cantAttack')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // One put on again goes with the Pokémon to the discard pile.
    await openReminders(page, top!);
    await moved(page, () =>
      controls(page).getByRole('button', { name: 'Takes less damage' }).click()
    );
    await expect(chip(page, top!, 'takesLess')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await moved(page, () => pressOn(page, top!, 'd'));
    expect(await zoneCount(page, 'local', 'discard')).toBe(1);
    await expect(
      page.locator('[data-marker-hint-id*=":reminder:"]')
    ).toHaveCount(0);

    const lines = await logLines(page);
    expect(
      lines.filter((line) => line.includes('put a reminder on')),
      lines.join('\n')
    ).toHaveLength(2);
    expect(
      lines.filter((line) => line.includes('took the reminder off')),
      lines.join('\n')
    ).toHaveLength(1);
    expect(errors).toEqual([]);
  });
