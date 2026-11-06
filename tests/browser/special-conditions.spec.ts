import { expect, test, type Page } from '@playwright/test';

import {
  idle,
  logLines,
  markers,
  nextRevision,
  openNamedSolo,
  POKEMON_DECK,
  revision,
  zoneCardIds,
} from './support/multi-select.js';

/**
 * Special Conditions as the rules have them (ADR-043 §14): Poisoned and
 * Burned beside one of Asleep, Paralyzed and Confused, a new one of those
 * replacing the last. Chosen in the Pokémon's window, each lies on the card
 * as its own chip and the log tells them as they now stand.
 */

const centre = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const onCard = (cardId: string) =>
  `.ptcgsim-board-surface [data-card-id="${cardId}"]`;

/** Puts a hand card into the near Active Spot by dragging it there. */
const playActive = async (page: Page, cardId: string) => {
  const active = await page.evaluate(
    () =>
      window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'active'
      )!.id
  );
  const from = await centre(page, onCard(cardId));
  const to = await centre(page, `[data-zone-id="${active}"]`);
  const before = await revision(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
  await nextRevision(page, before);
  await idle(page);
};

test('several Special Conditions at once, each a chip on the card and told as they stand', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openNamedSolo(page, { deck: POKEMON_DECK });
  const [pokemon] = await zoneCardIds(page, 'local', 'hand');
  await playActive(page, pokemon!);
  await page.locator(onCard(pokemon!)).dblclick();
  const window = page.locator('[data-pokemon-window]');
  await expect(window).toBeVisible();
  const chip = (name: string) =>
    window.locator(`.pokemon-window__toggle[aria-label="${name}"]`);
  const press = async (name: string) => {
    const before = await revision(page);
    await chip(name).click();
    await nextRevision(page, before);
  };

  // Poisoned and Burned together, beside Asleep.
  await press('Poisoned');
  await press('Burned');
  await press('Asleep');
  for (const name of ['Poisoned', 'Burned', 'Asleep']) {
    await expect(chip(name)).toHaveAttribute('aria-pressed', 'true');
  }
  // Paralyzed replaces Asleep; the markers stay.
  await press('Paralyzed');
  await expect(chip('Asleep')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip('Paralyzed')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('Poisoned')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('Burned')).toHaveAttribute('aria-pressed', 'true');

  // On the card: a chip each, in checkup order.
  await expect
    .poll(async () =>
      (await markers(page, 'specialCondition'))
        .filter((marker) => marker.cardId === pokemon)
        .map((marker) => marker.value)
    )
    .toEqual(['P', 'B', 'Pa']);
  const chips = page.locator(
    `.ptcgsim-board-surface [data-marker-hint-id^="${pokemon!}:specialCondition"]`
  );
  await expect(chips).toHaveCount(3);

  // The log: the run of changes reads as where it stands.
  await page.keyboard.press('Escape');
  await expect(window).toHaveCount(0);
  await expect
    .poll(async () => (await logLines(page)).at(-1) ?? '')
    .toMatch(/made Poke \d+ Poisoned, Burned and Paralyzed$/u);

  // Taken off one at a time from the card's own controls: Burned goes,
  // Poisoned and Paralyzed stay; then all of them.
  // A press on a chip, where it lies (the table finds it by position).
  const first = (await chips.first().boundingBox())!;
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
  const controls = page.locator('.ptcgsim-marker-controls');
  await expect(controls).toBeVisible();
  let before = await revision(page);
  await controls.getByRole('button', { name: 'Burned' }).click();
  await nextRevision(page, before);
  await expect
    .poll(async () => (await logLines(page)).at(-1) ?? '')
    .toMatch(/took Burned off Poke \d+, still Poisoned and Paralyzed$/u);
  before = await revision(page);
  await controls.getByRole('button', { name: 'Remove all conditions' }).click();
  await nextRevision(page, before);
  await expect
    .poll(async () => (await markers(page, 'specialCondition')).length)
    .toBe(0);
});
