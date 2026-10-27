import { expect, test, type Page } from '@playwright/test';

import {
  chooseMoreAction,
  closeActivity,
  dismissWelcome,
  openActivity,
  openDeck,
  useFlatTable,
} from './support/table-shell.js';

/**
 * Each player's coin lies on the table beside their Active (PX-051):
 * pressing it, or the flip key, tosses it at once, and it lands on the
 * room's result, says it, and stays on that face. Solo flips either seat's
 * coin; the rail has no Coin while the table shows one.
 */

const openSolo = async (page: Page): Promise<void> => {
  await page.goto('/?renderer=dom');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
};

const coin = (page: Page, side: 'local' | 'opponent') =>
  page.locator(`[data-table-coin="${side}"]`);

/** Every phase the coin passes through, from now on. */
const recordPhases = (page: Page, side: 'local' | 'opponent') =>
  page.evaluate((side) => {
    const element = document.querySelector<HTMLElement>(
      `[data-table-coin="${side}"]`
    )!;
    const phases: string[] = [];
    (window as unknown as { coinPhases: string[] }).coinPhases = phases;
    new MutationObserver(() => {
      const phase = element.dataset.coinPhase ?? '';
      if (phases.at(-1) !== phase) phases.push(phase);
    }).observe(element, { attributes: true });
  }, side);
const recordedPhases = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { coinPhases: string[] }).coinPhases
  );

/** Presses a coin and waits for it to come down; returns what it showed. */
const flipAndLand = async (
  page: Page,
  side: 'local' | 'opponent',
  press: () => Promise<void>
): Promise<'heads' | 'tails'> => {
  await recordPhases(page, side);
  await press();
  const chip = page.locator(
    `[data-coin-result-chip][data-coin-player-id="${await coin(page, side).getAttribute('data-coin-player-id')}"]`
  );
  await expect(chip).toBeVisible({ timeout: 10_000 });
  const result = (await chip.getAttribute('data-coin-result-chip')) as
    'heads' | 'tails';
  await expect(chip).toHaveText(result === 'heads' ? 'Heads' : 'Tails');
  await expect(coin(page, side)).toHaveAttribute('data-coin-face', result);
  // The chip goes; the coin stays on its face.
  await expect(chip).toHaveCount(0, { timeout: 5_000 });
  await expect(coin(page, side)).toHaveAttribute('data-coin-phase', 'resting');
  await expect(coin(page, side)).toHaveAttribute('data-coin-face', result);
  return result;
};

test('the coin lies on the tilted table and a press tosses it onto the room’s result', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSolo(page);
  const own = coin(page, 'local');
  await expect(own).toBeVisible();
  await expect(coin(page, 'opponent')).toBeVisible();
  // Laid on the tilted table by the cards' own projection.
  expect(await own.evaluate((element) => element.style.transform)).toMatch(
    /^matrix3d\(/u
  );
  // It is the control now: the rail has no Coin.
  const button = page.getByRole('button', { name: 'Flip a coin', exact: true });
  await expect(button).toBeVisible();
  await expect(own.locator('#flipCoinButton')).toHaveCount(1);
  await expect(
    page.locator('#boardButtonContainer #flipCoinButton')
  ).toHaveCount(0);
  await expect(own).toHaveAttribute('data-coin-face', 'heads');

  const result = await flipAndLand(page, 'local', async () => {
    await button.click();
    // Up at once, before the room has answered or while it lands.
    await expect(own).toHaveAttribute('data-coin-in-air', 'true');
    expect(
      await own.evaluate(
        (element) => element.getAnimations({ subtree: true }).length
      )
    ).toBeGreaterThan(0);
  });
  expect(await recordedPhases(page)).toEqual(
    expect.arrayContaining(['spinning', 'landed', 'resting'])
  );
  await openActivity(page);
  await expect(
    page
      .locator('#activitySheet')
      .getByText(new RegExp(`flipped ${result}$`, 'u'))
  ).toHaveCount(1);
  await closeActivity(page);

  // The flip key tosses the same coin.
  await page.mouse.move(5, 5);
  await flipAndLand(page, 'local', () => page.keyboard.press('f'));
  await openActivity(page);
  // Two flips: two lines, or one with a count when both came up the same.
  await expect
    .poll(() =>
      page
        .locator('#activitySheet p[data-event-type="CoinFlipped"]')
        .evaluateAll((rows) =>
          rows.reduce(
            (sum, row) => sum + Number(row.getAttribute('data-repeat') ?? 1),
            0
          )
        )
    )
    .toBe(2);
});

test('Solo flips the far coin for the other seat', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useFlatTable(page);
  await openSolo(page);
  const far = coin(page, 'opponent');
  const button = far.getByRole('button', { name: /^Flip a coin for / });
  await expect(button).toBeVisible();
  const before = await coin(page, 'local').getAttribute('data-coin-phase');
  const result = await flipAndLand(page, 'opponent', () => button.click());
  expect(before).toBe('resting');
  await expect(coin(page, 'local')).toHaveAttribute(
    'data-coin-phase',
    'resting'
  );
  await openActivity(page);
  await expect(
    page
      .locator('#activitySheet')
      .getByText(new RegExp(`flipped ${result}$`, 'u'))
  ).toHaveCount(1);
});

test('the far coin shows its result above it, clear of the rail at the seam', async ({
  page,
}) => {
  // The rail's actions lie along the seam's left, by the far Active.
  await page.setViewportSize({ width: 1024, height: 768 });
  await openSolo(page);
  const far = coin(page, 'opponent');
  await far.getByRole('button', { name: /^Flip a coin for / }).click();
  const chip = page.locator(
    `[data-coin-result-chip][data-coin-player-id="${await far.getAttribute('data-coin-player-id')}"]`
  );
  await expect(chip).toBeVisible({ timeout: 10_000 });
  const box = (await chip.boundingBox())!;
  const coinBox = (await far.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(
    coinBox.y + coinBox.height / 2
  );
  for (const button of await page
    .locator('#boardButtonContainer button')
    .all()) {
    const rail = await button.boundingBox();
    if (!rail) continue;
    const overlaps =
      box.x < rail.x + rail.width &&
      rail.x < box.x + box.width &&
      box.y < rail.y + rail.height &&
      rail.y < box.y + box.height;
    expect(overlaps, String(await button.getAttribute('id'))).toBe(false);
  }
});

test('with reduced motion the coin turns straight to its face', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await useFlatTable(page);
  await openSolo(page);
  await flipAndLand(page, 'local', () =>
    page.locator('#flipCoinButton').click()
  );
  expect(await recordedPhases(page)).not.toContain('spinning');
  expect(await recordedPhases(page)).not.toContain('tossing');
});

test('a phone keeps both coins on the table and a tap flips', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSolo(page);
  await expect(coin(page, 'local')).toBeVisible();
  await expect(coin(page, 'opponent')).toBeVisible();
  const box = (await coin(page, 'local').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await flipAndLand(page, 'local', () =>
    page.locator('#flipCoinButton').click()
  );
});

test('a card carried over a coin is drawn over it, and settles back under nothing', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSolo(page);
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        '60,Main Mon,Pokémon,/v2/assets/cardback.png?main-mon',
      ].join('\n')
    ),
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  const surface = page.locator('.ptcgsim-board-surface');
  const revision = () => surface.getAttribute('data-revision').then(Number);
  await expect.poll(revision).toBeGreaterThan(0);
  const loaded = await revision();
  await chooseMoreAction(page, 'setupBothButton');
  await expect.poll(revision).toBeGreaterThan(loaded);
  await expect(
    page.locator('.ptcgsim-board-surface[data-board-motion="idle"]')
  ).toHaveCount(1);
  const card = page
    .locator('[data-in-hand][data-card-side="local"]')
    .filter({ has: page.locator('img') })
    .first();
  const cardId = (await card.getAttribute('data-card-id'))!;
  const from = (await card.boundingBox())!;
  const at = (await coin(page, 'local').boundingBox())!;
  const target = { x: at.x + at.width / 2, y: at.y + at.height / 2 };
  await page.mouse.move(from.x + from.width / 2, from.y + 30);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1)
    await page.mouse.move(
      from.x +
        from.width / 2 +
        ((target.x - from.x - from.width / 2) * step) / 12,
      from.y + 30 + ((target.y - from.y - 30) * step) / 12
    );
  // Over the coin, the card is shown on the lift layer, above it.
  const original = page.locator(`[data-card-id="${cardId}"]`);
  await expect(original).toHaveAttribute('data-lifted', '');
  await expect(
    page.locator('.ptcgsim-board-lift [data-lift-copy]')
  ).toHaveCount(1);
  // Carried away from it again, it is drawn where it is.
  await page.mouse.move(700, 330, { steps: 6 });
  await expect(original).not.toHaveAttribute('data-lifted', '');
  await page.mouse.up();
  await expect(
    page.locator('.ptcgsim-board-lift [data-lift-copy]')
  ).toHaveCount(0);
});
