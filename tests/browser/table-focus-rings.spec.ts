import { expect, test, type Locator, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome } from './support/table-shell.js';

/**
 * The table's own controls show where the keyboard is on every look, by
 * day as by night: their ring is the look's, not the app theme's, at 3:1
 * at least against the painted felt or desk it lies on. The hand pill's
 * Sort rings inside itself, on the pill, in the theme's accent.
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

/** Each control the keyboard reaches, and the element its ring is drawn on. */
const CONTROLS = [
  // The rail at the seam (the app bar's buttons keep their glass's ink).
  { name: 'rail', focus: '#boardButtonContainer .ptcgsim-rail-button' },
  { name: 'add to the table', focus: '.table-zone-extras' },
  { name: 'coin', focus: '#flipCoinButton' },
  { name: 'hand sort', focus: '.table-hand-pill__sort input', ring: '..' },
] as const;

/** The ring painted in a colour nothing else on the table is, to find it. */
const MARKED =
  '*:focus-visible, *:has(> input:focus-visible) { outline-color: #ff00ff !important; }';

const focusByKeyboard = async (page: Page, control: Locator) => {
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  // Past the controls' transitions.
  await page.waitForTimeout(300);
};

/**
 * The contrast between the ring's colour and what lies under each pixel it
 * covers, unfocused: the ring found in a shot with it marked, the felt in
 * one with the control blurred.
 */
const ringContrasts = async (
  page: Page,
  control: Locator,
  ring: Locator
): Promise<number[]> => {
  await focusByKeyboard(page, control);
  const color = await ring.evaluate(
    (element) => getComputedStyle(element).outlineColor
  );
  const box = (await ring.boundingBox())!;
  const clip = {
    x: Math.max(0, Math.floor(box.x - 10)),
    y: Math.max(0, Math.floor(box.y - 10)),
    width: Math.ceil(box.width + 20),
    height: Math.ceil(box.height + 20),
  };
  const style = await page.addStyleTag({ content: MARKED });
  await page.waitForTimeout(100);
  const marked = (await page.screenshot({ clip })).toString('base64');
  await style.evaluate((element) => element.parentNode?.removeChild(element));
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur()
  );
  await page.waitForTimeout(400);
  const unfocused = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(
    async ({ marked, unfocused, color }) => {
      const pixels = async (png: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const linear = (value: number) => {
        const channel = value / 255;
        return channel <= 0.03928
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (data: Uint8ClampedArray, at: number) =>
        0.2126 * linear(data[at]!) +
        0.7152 * linear(data[at + 1]!) +
        0.0722 * linear(data[at + 2]!);
      // The ring's colour as painted, whatever space the style writes it in.
      const swatch = document.createElement('canvas').getContext('2d')!;
      swatch.fillStyle = color;
      swatch.fillRect(0, 0, 1, 1);
      const ring = luminance(swatch.getImageData(0, 0, 1, 1).data, 0);
      const mark = await pixels(marked);
      const under = await pixels(unfocused);
      const ratios: number[] = [];
      for (let at = 0; at < mark.length; at += 4) {
        if (!(mark[at]! > 235 && mark[at + 1]! < 20 && mark[at + 2]! > 235)) {
          continue;
        }
        const felt = luminance(under, at);
        ratios.push(
          (Math.max(ring, felt) + 0.05) / (Math.min(ring, felt) + 0.05)
        );
      }
      return ratios.sort((left, right) => left - right);
    },
    { marked, unfocused, color }
  );
};

// A test a look, each in a room of its own: a pass over all twenty in one
// test outlasts any sensible timeout on a slow runner.
for (const darkMode of [true, false]) {
  for (const art of LOOKS) {
    const when = darkMode ? 'night' : 'day';
    test(`rings the keyboard’s place on the ${art} table by ${when} at 3:1`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.addInitScript(
        ([darkMode, art]) => {
          localStorage.setItem(
            'ptcgsim.table.v1',
            JSON.stringify({ darkMode, art })
          );
          // Flat, the controls lie square to the screen shots.
          localStorage.setItem(
            'ptcgsim.table-depth.v1',
            JSON.stringify({ mode: 'flat' })
          );
        },
        [darkMode, art] as const
      );
      await ownRoomBudget(page.context());
      await page.goto('/?renderer=dom');
      await expect(
        page.locator(
          '[data-app-route="remote-room"][data-session-phase="ready"]'
        )
      ).toBeVisible({ timeout: 30_000 });
      await dismissWelcome(page);
      await expect(page.locator('html')).toHaveAttribute('data-table-art', art);
      for (const { name, focus, ...rest } of CONTROLS) {
        const control = page.locator(focus).first();
        const ring = 'ring' in rest ? control.locator(rest.ring) : control;
        const ratios = await ringContrasts(page, control, ring);
        // A whole ring's worth of pixels, nearly all of them at 3:1 (a few
        // cross the seam's line or a neighbour's edge).
        expect(ratios.length, name).toBeGreaterThan(60);
        expect(ratios[Math.floor(ratios.length * 0.05)], name).toBeGreaterThan(
          3
        );
      }
    });
  }
}
