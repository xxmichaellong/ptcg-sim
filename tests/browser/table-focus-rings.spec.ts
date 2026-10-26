import { expect, test, type Locator, type Page } from '@playwright/test';

import { pngPixels, type PngPixels } from './support/png-pixels.js';
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
// Painted at once: a control easing its shadow would still be on its way.
const STILL = '*, *::before, *::after { transition: none !important; }';
const MARKS = {
  ring: `${STILL} *:focus-visible, *:has(> input:focus-visible) { outline-color: #ff00ff !important; }`,
  halo: `${STILL} :root { --color-felt-focus-halo: #ff00ff !important; --color-desk-focus-halo: #ff00ff !important; }`,
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

/** A colour's relative luminance, from `rgb(…)`/`rgba(…)` or 8-bit channels. */
const luminance = (red: number, green: number, blue: number): number => {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
};
const luminanceOf = (color: string): number | undefined => {
  const [red, green, blue] = (/rgba?\(([^)]*)\)/u.exec(color)?.[1] ?? '')
    .split(/[\s,/]+/u)
    .map(Number);
  return red === undefined || green === undefined || blue === undefined
    ? undefined
    : luminance(red, green, blue);
};

/**
 * The contrast between each tone's colour and what lies under each pixel it
 * covers, unfocused: each tone found in a shot with it marked, what lies
 * under it in one with the control blurred. Each sorted, lowest first; a
 * tone the control doesn't draw has none.
 */
const toneContrasts = async (
  page: Page,
  control: Locator,
  ring: Locator
): Promise<Record<Tone, number[]>> => {
  await focusByKeyboard(page, control);
  const colors = await ring.evaluate((element) => {
    const style = getComputedStyle(element);
    // The halo is the first of the box shadows: `rgb(…) 0px 0px 0px 2px`.
    return {
      ring: style.outlineColor,
      halo: /^rgba?\([^)]*\)/u.exec(style.boxShadow)?.[0] ?? '',
    };
  });
  const box = (await ring.boundingBox())!;
  const clip = {
    x: Math.max(0, Math.floor(box.x - 10)),
    y: Math.max(0, Math.floor(box.y - 10)),
    width: Math.ceil(box.width + 20),
    height: Math.ceil(box.height + 20),
  };
  const marked: Partial<Record<Tone, PngPixels>> = {};
  for (const tone of ['ring', 'halo'] as const) {
    if (!colors[tone]) continue;
    const style = await page.addStyleTag({ content: MARKS[tone] });
    await page.waitForTimeout(100);
    marked[tone] = pngPixels(await page.screenshot({ clip }));
    await style.evaluate((element) => element.parentNode?.removeChild(element));
  }
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur()
  );
  await page.waitForTimeout(400);
  const under = pngPixels(await page.screenshot({ clip }));
  const contrasts = { ring: [] as number[], halo: [] as number[] };
  for (const tone of ['ring', 'halo'] as const) {
    const mark = marked[tone];
    const painted = luminanceOf(colors[tone]);
    if (!mark || painted === undefined) continue;
    for (let pixel = 0; pixel < mark.width * mark.height; pixel += 1) {
      const at = pixel * mark.channels;
      if (!(
        mark.data[at]! > 235 &&
        mark.data[at + 1]! < 20 &&
        mark.data[at + 2]! > 235
      )) {
        continue;
      }
      const from = pixel * under.channels;
      const felt = luminance(
        under.data[from]!,
        under.data[from + 1]!,
        under.data[from + 2]!
      );
      contrasts[tone].push(
        (Math.max(painted, felt) + 0.05) / (Math.min(painted, felt) + 0.05)
      );
    }
    contrasts[tone].sort((left, right) => left - right);
  }
  return contrasts;
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
  const tones = Object.values(await toneContrasts(page, control, ring)).filter(
    (ratios) => ratios.length > 0
  );
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
