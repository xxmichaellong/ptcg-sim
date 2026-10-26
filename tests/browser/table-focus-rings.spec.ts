import { expect, test, type Locator, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome } from './support/table-shell.js';

/**
 * The table's own controls show where the keyboard is on every look, by
 * day as by night: a two-toned ring, the look's and not the app theme's,
 * one tone of which stands out at 3:1 from whatever is painted under it --
 * the felt, or the desk where a control sits past the mat's edge. The hand
 * pill's Sort rings inside itself, on the pill, in its ink.
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

interface Control {
  readonly name: string;
  readonly focus: string;
  /** The element the ring is drawn on, from the focused one. */
  readonly ring?: string;
}

/** Each control the keyboard reaches on the flat table, both halves shown. */
const CONTROLS: readonly Control[] = [
  // The rail at the seam (the app bar's buttons keep their glass's ink).
  { name: 'rail', focus: '#boardButtonContainer .ptcgsim-rail-button' },
  { name: 'add to the table', focus: '.table-zone-extras' },
  { name: 'coin', focus: '#flipCoinButton' },
  { name: 'hand sort', focus: '.table-hand-pill__sort input', ring: '..' },
];

/**
 * Each tone of the ring painted in a colour nothing else on the table is,
 * to find its pixels: the ring itself, and the halo inside it.
 */
const MARKS = {
  ring: '*:focus-visible, *:has(> input:focus-visible) { outline-color: #ff00ff !important; }',
  halo: ':root { --color-felt-focus-halo: #ff00ff !important; --color-desk-focus-halo: #ff00ff !important; }',
} as const;
type Tone = keyof typeof MARKS;

const focusByKeyboard = async (page: Page, control: Locator) => {
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  // Past the controls' transitions.
  await page.waitForTimeout(300);
};

/**
 * The contrast between a tone's colour and what lies under each pixel it
 * covers, unfocused: the tone found in a shot with it marked, what lies
 * under it in one with the control blurred. Sorted, lowest first.
 */
const toneContrasts = async (
  page: Page,
  control: Locator,
  ring: Locator,
  tone: Tone
): Promise<number[]> => {
  await focusByKeyboard(page, control);
  const color = await ring.evaluate((element, tone) => {
    const style = getComputedStyle(element);
    // The halo is the first of the box shadows: `rgb(…) 0px 0px 0px 2px`.
    return tone === 'ring'
      ? style.outlineColor
      : (/^rgba?\([^)]*\)/u.exec(style.boxShadow)?.[0] ?? '');
  }, tone);
  if (!color) return [];
  const box = (await ring.boundingBox())!;
  const clip = {
    x: Math.max(0, Math.floor(box.x - 10)),
    y: Math.max(0, Math.floor(box.y - 10)),
    width: Math.ceil(box.width + 20),
    height: Math.ceil(box.height + 20),
  };
  const style = await page.addStyleTag({ content: MARKS[tone] });
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
      // The tone's colour as painted, whatever space the style writes it in.
      const swatch = document.createElement('canvas').getContext('2d')!;
      swatch.fillStyle = color;
      swatch.fillRect(0, 0, 1, 1);
      const painted = luminance(swatch.getImageData(0, 0, 1, 1).data, 0);
      const mark = await pixels(marked);
      const under = await pixels(unfocused);
      const ratios: number[] = [];
      for (let at = 0; at < mark.length; at += 4) {
        if (!(mark[at]! > 235 && mark[at + 1]! < 20 && mark[at + 2]! > 235)) {
          continue;
        }
        const felt = luminance(under, at);
        ratios.push(
          (Math.max(painted, felt) + 0.05) / (Math.min(painted, felt) + 0.05)
        );
      }
      return ratios.sort((left, right) => left - right);
    },
    { marked, unfocused, color }
  );
};

/**
 * The ring stands out where it is drawn: of its two tones, 2px bands all
 * round, enough pixels to make up one whole band (nearly: a few cross a
 * zone's outline, the seam's line or a neighbour's edge) stand out at 3:1
 * from what lies under them -- the dark tone over a light desk, the light
 * one over the mat's dark edge.
 */
const expectRingShows = async (
  page: Page,
  { name, focus, ring: ringOf }: Control
): Promise<void> => {
  const control = page.locator(focus).first();
  const ring = ringOf ? control.locator(ringOf) : control;
  const tones = [
    await toneContrasts(page, control, ring, 'ring'),
    await toneContrasts(page, control, ring, 'halo'),
  ].filter((ratios) => ratios.length > 0);
  const band = Math.min(...tones.map((ratios) => ratios.length));
  const standing = tones.flat().filter((ratio) => ratio >= 3).length;
  expect(band, `${name}: pixels in a band`).toBeGreaterThan(40);
  expect(
    standing / band,
    `${name}: ${standing} of a ${band}-pixel band at 3:1`
  ).toBeGreaterThanOrEqual(0.95);
};

const openTable = async (
  page: Page,
  art: string,
  darkMode: boolean,
  view: Record<string, unknown> = {},
  depth?: string
) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(
    ([darkMode, art, view, depth]) => {
      localStorage.setItem(
        'ptcgsim.table.v1',
        JSON.stringify({ darkMode, art })
      );
      localStorage.setItem('ptcgsim.board-view.v1', JSON.stringify(view));
      if (depth) {
        localStorage.setItem(
          'ptcgsim.table-depth.v1',
          JSON.stringify({ mode: depth })
        );
      }
    },
    [darkMode, art, view, depth] as const
  );
  await ownRoomBudget(page.context());
  await page.goto('/?renderer=dom');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
  await expect(page.locator('html')).toHaveAttribute('data-table-art', art);
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
      // Flat, the controls lie square to the screen shots.
      await openTable(page, art, darkMode, {}, 'flat');
      for (const control of CONTROLS) await expectRingShows(page, control);
      // Sorted, the Sort sits sunk in its socket.
      const sort = page.locator('.table-hand-pill__sort input').first();
      await sort.click();
      await expect(sort).toBeChecked();
      await expectRingShows(page, {
        name: 'hand sort, sorted',
        focus: '.table-hand-pill__sort input',
        ring: '..',
      });
    });
  }
}

// One half on the tilted table: the rail and the Lost Zone's chip sit past
// the mat's edge, over the desk.
for (const darkMode of [true, false]) {
  for (const art of ['classic', 'parchment', 'cream', 'charcoal'] as const) {
    const when = darkMode ? 'night' : 'day';
    test(`rings the keyboard’s place past the mat’s edge, one half on the tilted ${art} table by ${when}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openTable(page, art, darkMode, { show: 'mine', lostZone: true });
      await expectRingShows(page, CONTROLS[0]!);
      await expectRingShows(page, {
        name: 'Lost Zone chip',
        focus: '.table-zone-chip',
      });
    });
  }
}
