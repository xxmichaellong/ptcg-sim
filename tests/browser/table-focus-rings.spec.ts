import { expect, test } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome } from './support/table-shell.js';

/**
 * The table's own controls show where the keyboard is on every look, by
 * day as by night: their ring is the look's, not the app theme's, at 3:1
 * at least against the felt it lies on (and over the desk, the hand pill's).
 */
const LOOKS = [
  'cream',
  'frost',
  'sakura',
  'parchment',
  'classic',
  'ocean',
  'slate',
  'midnight',
  'burgundy',
  'charcoal',
] as const;

test('rings the keyboard’s place on the table at 3:1 on every look, by day and by night', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const darkMode of [true, false]) {
    for (const art of LOOKS) {
      await page.addInitScript(
        ([darkMode, art]) =>
          localStorage.setItem(
            'ptcgsim.table.v1',
            JSON.stringify({ darkMode, art })
          ),
        [darkMode, art] as const
      );
      // A Solo room a look: each from a client of its own.
      await ownRoomBudget(page.context());
      await page.goto('/?renderer=dom');
      await expect(
        page.locator(
          '[data-app-route="remote-room"][data-session-phase="ready"]'
        )
      ).toBeVisible({ timeout: 30_000 });
      await dismissWelcome(page);
      await expect(page.locator('html')).toHaveAttribute('data-table-art', art);
      // The rail at the seam (the app bar's buttons keep their glass's ink).
      const button = page
        .locator('#boardButtonContainer .ptcgsim-rail-button')
        .first();
      await button.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
      const contrast = await button.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d')!;
        // The colour as painted, whatever space the style writes it in.
        const luminance = (color: string): number => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
          const linear = (value: number) => {
            const channel = value / 255;
            return channel <= 0.03928
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
        };
        const ratio = (left: string, right: string): number => {
          const [high, low] = [luminance(left), luminance(right)].sort(
            (a, b) => b - a
          ) as [number, number];
          return (high + 0.05) / (low + 0.05);
        };
        const root = getComputedStyle(document.documentElement);
        const token = (name: string) => root.getPropertyValue(name).trim();
        const ring = getComputedStyle(element).outlineColor;
        return {
          felt: Math.min(
            ratio(ring, token('--color-felt')),
            ratio(ring, token('--color-felt-deep'))
          ),
          desk: Math.min(
            ratio(token('--color-desk-focus'), token('--color-desk')),
            ratio(token('--color-desk-focus'), token('--color-desk-hi'))
          ),
        };
      });
      const at = `${art} ${darkMode ? 'night' : 'day'}`;
      expect(contrast.felt, at).toBeGreaterThanOrEqual(3);
      expect(contrast.desk, at).toBeGreaterThanOrEqual(3);
    }
  }
});
