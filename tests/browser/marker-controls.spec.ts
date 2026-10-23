import { expect, test, type Page } from '@playwright/test';

import { chooseMoreAction, openDeck } from './support/table-shell.js';

/**
 * A counter lying on a Pokémon says what it is under a resting mouse, and a
 * press on it opens its controls: damage steps by 10 either way or comes
 * off. A finger's tap does the same, even on the selected card (whose tap
 * would otherwise read it). Solo, on the tilted table.
 */

const deckCsv = Buffer.from(
  [
    'QTY,Name,Type,URL',
    '30,Main Mon,Pokémon,/v2/assets/cardback.png?main-mon',
    '30,Main Energy,Energy,/v2/assets/cardback.png?main-energy',
  ].join('\n')
);

const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1);

/** A Solo table with one Pokémon in the Active Spot carrying 60 damage. */
const activeWithDamage = async (page: Page): Promise<string> => {
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
  const revision = () =>
    page
      .locator('.ptcgsim-board-surface')
      .getAttribute('data-revision')
      .then(Number);
  await expect.poll(revision).toBeGreaterThan(0);
  const loaded = await revision();
  // Set up, the room's answer in and the deal finished, before the hand is
  // measured: mid-deal a card is still on the deck.
  await chooseMoreAction(page, 'setupBothButton');
  await expect.poll(revision).toBeGreaterThan(loaded);
  await idle(page);
  const pokemon = page
    .locator('[data-in-hand][data-card-side="local"]')
    .filter({ has: page.locator('img') })
    .and(page.locator('[aria-label="Main Mon"]'))
    .first();
  const cardId = (await pokemon.getAttribute('data-card-id'))!;
  const from = (await pokemon.boundingBox())!;
  const active = (await page
    .locator('[data-zone-kind="active"][data-zone-side="local"]')
    .boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 30);
  await page.mouse.down();
  for (let step = 1; step <= 14; step += 1) {
    await page.mouse.move(
      from.x +
        from.width / 2 +
        ((active.x + active.width / 2 - from.x - from.width / 2) * step) / 14,
      from.y + 30 + ((active.y + active.height / 2 - from.y - 30) * step) / 14
    );
  }
  await page.mouse.up();
  await idle(page);
  const card = page.locator(`[data-card-id="${cardId}"]`);
  await card.click();
  await page.keyboard.press('6');
  await expect(damage(page)).toHaveAttribute('data-board-hint', '60 damage');
  await page.keyboard.press('Escape');
  await idle(page);
  return cardId;
};

const damage = (page: Page) => page.locator('[data-marker-hint-id$=":damage"]');

const centre = async (page: Page) => {
  const box = (await damage(page).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const controls = (page: Page) =>
  page.locator('.ptcgsim-marker-controls[data-marker-controls="damage"]');

test('a damage counter names itself, and its controls step it by 10 or take it off', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await activeWithDamage(page);

  const at = await centre(page);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await expect(page.locator('.ptcgsim-board-hint [role="tooltip"]')).toHaveText(
    '60 damage'
  );

  await page.mouse.click(at.x, at.y);
  await expect(controls(page)).toBeVisible();
  await controls(page).getByRole('button', { name: '10 more damage' }).click();
  await expect(damage(page)).toHaveAttribute('data-board-hint', '70 damage');
  await controls(page).getByRole('button', { name: '10 less damage' }).click();
  await controls(page).getByRole('button', { name: '10 less damage' }).click();
  await expect(damage(page)).toHaveAttribute('data-board-hint', '50 damage');
  await expect(controls(page).locator('input')).toHaveValue('50');
  // The card under the counter was not selected by those presses.
  await expect(page.locator('.ptcgsim-card[aria-pressed="true"]')).toHaveCount(
    0
  );

  await controls(page)
    .getByRole('button', { name: 'Remove all damage' })
    .click();
  await expect(damage(page)).toHaveCount(0);
  await expect(controls(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a double press on a counter opens its controls, not the card's preview", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await activeWithDamage(page);
  const at = await centre(page);
  await page.mouse.dblclick(at.x, at.y);
  await expect(controls(page)).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-preview-kind]')).toHaveCount(0);
  await expect(controls(page)).toBeVisible();
});

test("the card menu's Special condition hands the keyboard to the chips, and Escape gives it back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const cardId = await activeWithDamage(page);
  const card = page.locator(`[data-card-id="${cardId}"]`);
  await card.focus();
  await card.press('Shift+F10');
  await page
    .getByRole('menuitem', { name: /Special condition/u })
    .press('Enter');
  const chips = page.locator(
    '.ptcgsim-marker-controls[data-marker-controls="specialCondition"]'
  );
  await expect(chips).toBeVisible();
  // Put on as Poisoned, the current choice has the focus.
  await expect(chips.getByRole('button', { name: 'Poisoned' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement?.closest('.ptcgsim-marker-controls') !== null
      )
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(chips).toHaveCount(0);
  await expect(card).toBeFocused();
});

test("the card menu's Damage opens the controls with the number to type, beside the steps by 10", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const cardId = await activeWithDamage(page);
  const card = page.locator(`[data-card-id="${cardId}"]`);
  await card.focus();
  await card.press('Shift+F10');
  await page.getByRole('menuitem', { name: /Damage counter/u }).press('Enter');
  const number = controls(page).locator('input');
  await expect(number).toBeFocused();
  await expect(number).toHaveValue('60');
  // Typed over at once (it is selected), as v1's editor was.
  await page.keyboard.type('120');
  await page.keyboard.press('Enter');
  await expect(damage(page)).toHaveAttribute('data-board-hint', '120 damage');
  await expect(controls(page)).toHaveCount(0);
  await expect(card).toBeFocused();
  await idle(page);

  // Pressed open, typed into, then stepped: from what was typed.
  const at = await centre(page);
  await page.mouse.click(at.x, at.y);
  await number.click();
  await number.fill('30');
  await controls(page).getByRole('button', { name: '10 more damage' }).click();
  await expect(damage(page)).toHaveAttribute('data-board-hint', '40 damage');
  // Stepped down to none, they stay open for the next step.
  for (let step = 0; step < 4; step += 1)
    await controls(page)
      .getByRole('button', { name: '10 less damage' })
      .click();
  await expect(damage(page)).toHaveCount(0);
  await expect(controls(page)).toBeVisible();
  await expect(number).toHaveValue('');
  await controls(page).getByRole('button', { name: '10 more damage' }).click();
  await expect(damage(page)).toHaveAttribute('data-board-hint', '10 damage');
  // A press elsewhere sets what was typed and puts them away.
  await number.fill('90');
  await page.mouse.click(700, 120);
  await expect(controls(page)).toHaveCount(0);
  await expect(damage(page)).toHaveAttribute('data-board-hint', '90 damage');
  expect(errors).toEqual([]);
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test("a tap on the selected card's counter opens its controls, not the card", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const cardId = await activeWithDamage(page);
    const card = page.locator(`[data-card-id="${cardId}"]`);
    await card.tap();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    const at = await centre(page);
    await page.touchscreen.tap(at.x, at.y);
    await expect(controls(page)).toBeVisible();
    // Longer than the card's own tap takes to open its preview: none came.
    await page.waitForTimeout(500);
    await expect(page.locator('.ptcgsim-legacy-card-preview')).toHaveCount(0);
    await expect(controls(page)).toBeVisible();
  });
});
