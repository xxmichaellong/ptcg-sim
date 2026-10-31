import { devices, expect, test, type Page } from '@playwright/test';

import {
  card,
  idle,
  nextRevision,
  openNamedSolo,
  POKEMON_DECK,
  pokemonIn,
  revision,
  zoneCardIds,
} from './support/multi-select.js';

/**
 * A Bench of 8 (Sky Field, Area Zero Underdepths) on a phone, upright and
 * on its side: every Benched Pokémon stays on the screen, its card can
 * still be told apart and reached by a finger.
 */

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];

const SIZES = [
  { name: 'a phone held upright', width: 390, height: 844 },
  { name: 'a phone on its side', width: 844, height: 390 },
] as const;

/** A finger's tap on a card's left strip, which the next card leaves bare. */
const tapCard = async (page: Page, cardId: string) => {
  const box = (await card(page, cardId).boundingBox())!;
  await page.touchscreen.tap(
    box.x + Math.min(8, box.width / 4),
    box.y + box.height / 2
  );
};

/** Each benched Pokémon's top card as drawn, and whether a tap reaches it. */
const benchGeometry = (page: Page, tops: readonly string[]) =>
  page.evaluate((ids) => {
    const boxes = ids.map((id) => {
      const node = document.querySelector<HTMLElement>(
        `.ptcgsim-board-surface [data-card-id="${CSS.escape(id)}"]`
      )!;
      const box = node.getBoundingClientRect();
      // Where a finger lands: the card's own uncovered strip, left of the
      // next card, or its middle for the last one.
      const probe = {
        x: box.x + Math.min(8, box.width / 4),
        y: box.y + box.height / 2,
      };
      const hit = document.elementFromPoint(probe.x, probe.y);
      return {
        id,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        reached:
          hit?.closest('[data-card-id]')?.getAttribute('data-card-id') === id,
      };
    });
    return { boxes, width: innerWidth, height: innerHeight };
  }, tops);

for (const size of SIZES)
  test.describe(size.name, () => {
    test.use({
      ...phone,
      viewport: { width: size.width, height: size.height },
    });

    test('eight Benched Pokémon stay on the screen, each one reachable', async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await openNamedSolo(page, { ...size, deck: POKEMON_DECK });
      // An eighth card, then the whole hand to the Bench as one group.
      await page.locator('.ptcgsim-board-surface').focus();
      let before = await revision(page);
      await page.keyboard.press('1');
      await nextRevision(page, before);
      await idle(page);
      const hand = await zoneCardIds(page, 'local', 'hand');
      expect(hand).toHaveLength(8);
      await tapCard(page, hand[0]!);
      await page.locator('#touchSelectCardButton').tap();
      await page.keyboard.press('ControlOrMeta+a');
      await expect(page.locator('[data-touch-group-count]')).toHaveText('8');
      before = await revision(page);
      await page.keyboard.press('b');
      await nextRevision(page, before);
      await idle(page);
      const bench = await pokemonIn(page, 'local', 'bench');
      expect(bench).toHaveLength(8);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      await page.screenshot({
        path: test.info().outputPath(`bench-eight-${size.width}.png`),
      });

      const { boxes, width, height } = await benchGeometry(page, bench);
      for (const box of boxes) {
        expect(box.x, `${box.id} off the left edge`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${box.id} off the top`).toBeGreaterThanOrEqual(0);
        expect(
          box.x + box.width,
          `${box.id} off the right edge`
        ).toBeLessThanOrEqual(width + 0.5);
        expect(
          box.y + box.height,
          `${box.id} off the bottom`
        ).toBeLessThanOrEqual(height + 0.5);
        expect(box.reached, `${box.id} out of a finger's reach`).toBe(true);
      }
      // Side by side, each shows a strip of its own.
      const lefts = boxes.map((box) => box.x).sort((a, b) => a - b);
      for (let index = 1; index < lefts.length; index += 1)
        expect(lefts[index]! - lefts[index - 1]!).toBeGreaterThanOrEqual(8);
    });
  });
