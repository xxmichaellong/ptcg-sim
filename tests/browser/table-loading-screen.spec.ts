import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

/**
 * The table appears once (table-curtain.ts). Opening the site used to show
 * the empty lobby table, take it away while the Solo room connected, and
 * paint the room's table again: the board appeared, vanished and came back.
 * The page now opens on one loading screen that lifts once, over a table
 * that is already whole; and a later trade of tables (joining a room)
 * happens under it, so a bare desk is never on screen.
 *
 * Each spec records, frame by frame and at every change to the page's
 * route, phase, board or curtain, what the player could see.
 */

interface Sample {
  readonly t: number;
  readonly route: string;
  readonly phase: string;
  /** A board surface is laid out on the page. */
  readonly board: boolean;
  readonly curtain: 'covering' | 'arriving' | 'leaving' | 'gone' | 'absent';
  /** How much of the page the curtain hides: 1 is all of it. */
  readonly cover: number;
}

declare global {
  interface Window {
    __tableLoadSamples?: Sample[];
  }
}

const recordTableSamples = (): void => {
  const samples: Sample[] = [];
  window.__tableLoadSamples = samples;
  let last = '';
  const sample = (): void => {
    const main = document.querySelector('main[data-app-route]');
    const surface = document.querySelector('.ptcgsim-board-surface');
    const rect = surface?.getBoundingClientRect();
    const curtain = document.getElementById('tableCurtain');
    const shown = curtain !== null && !curtain.hidden;
    const next: Sample = {
      t: Math.round(performance.now()),
      route: main?.getAttribute('data-app-route') ?? 'none',
      phase: main?.getAttribute('data-session-phase') ?? '-',
      board: rect !== undefined && rect.width > 0 && rect.height > 0,
      curtain: !curtain
        ? 'absent'
        : shown
          ? ((curtain.dataset.state ?? 'covering') as Sample['curtain'])
          : 'gone',
      cover: shown ? Number(getComputedStyle(curtain).opacity) : 0,
    };
    const key = JSON.stringify({ ...next, t: 0 });
    if (key === last) return;
    last = key;
    samples.push(next);
  };
  const frame = (): void => {
    sample();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  new MutationObserver(sample).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      'data-app-route',
      'data-session-phase',
      'data-renderer-status',
      'data-state',
      'hidden',
    ],
  });
};

/** All but invisible: the curtain counts as down. */
const COVERED = 0.99;

const samplesOf = async (page: Page): Promise<Sample[]> =>
  page.evaluate(() => window.__tableLoadSamples ?? []);

const attachSamples = async (
  testInfo: TestInfo,
  name: string,
  samples: readonly Sample[]
): Promise<void> => {
  await testInfo.attach(name, {
    body: JSON.stringify(samples, null, 1),
    contentType: 'application/json',
  });
};

/** The curtain's states, each run of one state once. */
const curtainStates = (samples: readonly Sample[]): string[] =>
  samples
    .map((sample) => sample.curtain)
    .filter((state) => state !== 'absent')
    .filter((state, index, all) => index === 0 || state !== all[index - 1]);

/**
 * What the player saw of the table, sample by sample: `table` once a board
 * shows through the curtain, `desk` for a page with no board and the
 * curtain not wholly down, `curtain` while it is.
 */
const seen = (sample: Sample): 'table' | 'desk' | 'curtain' =>
  sample.cover >= COVERED ? 'curtain' : sample.board ? 'table' : 'desk';

/**
 * The page opened on the curtain, the table showed through it once and
 * stayed: never a table, then none, then a table again.
 */
const expectTableAppearsOnce = (samples: readonly Sample[]): void => {
  // Until index.html has been read as far as the curtain, the page has
  // nothing on it at all.
  const parsed = samples.findIndex((sample) => sample.curtain !== 'absent');
  expect(parsed, 'the curtain is in the page').toBeGreaterThanOrEqual(0);
  for (const sample of samples.slice(0, parsed)) {
    expect(sample).toMatchObject({ route: 'none', board: false });
  }
  // From there the curtain is down before anything else is drawn.
  const page = samples.slice(parsed);
  expect(page[0]?.curtain).toBe('covering');
  expect(page[0]?.cover).toBeGreaterThanOrEqual(COVERED);
  const firstSeen = page.findIndex((sample) => seen(sample) !== 'curtain');
  expect(firstSeen, 'the curtain lifted').toBeGreaterThan(0);
  const afterwards = page.slice(firstSeen).map(seen);
  expect(afterwards, 'the table, once shown, stays').not.toContain('desk');
  expect(afterwards, 'the curtain lifts once').not.toContain('curtain');
  const states = curtainStates(samples);
  expect(states[0]).toBe('covering');
  expect(states.at(-1)).toBe('gone');
  expect(states.filter((state) => state === 'covering')).toHaveLength(1);
};

const openRecorded = async (
  context: BrowserContext,
  path: string,
  options: { readonly throttle?: number } = {}
): Promise<{ readonly page: Page; readonly errors: string[] }> => {
  await context.addInitScript(recordTableSamples);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  // A cold load, on a slow machine: where the flash showed longest.
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (options.throttle) {
    await cdp.send('Emulation.setCPUThrottlingRate', {
      rate: options.throttle,
    });
  }
  await page.goto(path);
  return { page, errors };
};

const curtainGone = (page: Page) =>
  expect(page.locator('#tableCurtain')).toBeHidden({ timeout: 30_000 });

test('the Solo table appears once behind one loading screen on a cold, slow load', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ baseURL });
  try {
    const { page, errors } = await openRecorded(context, '/', {
      throttle: 4,
    });
    await expect(
      page.locator(
        '[data-app-route="remote-room"][data-session-phase="ready"] .ptcgsim-table-rail'
      )
    ).toBeVisible({ timeout: 45_000 });
    await curtainGone(page);
    const samples = await samplesOf(page);
    await attachSamples(testInfo, 'solo-load-samples.json', samples);

    expectTableAppearsOnce(samples);
    // Under the curtain the empty table stood in for the room and gave way
    // to it; the player saw only the room's.
    const firstSeen = samples.find((sample) => seen(sample) === 'table');
    expect(firstSeen).toMatchObject({ route: 'remote-room', phase: 'ready' });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Play online opens over a table that appears once', async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({ baseURL });
  try {
    const { page, errors } = await openRecorded(context, '/?room-lobby=1');
    await expect(page.locator('#playOnlineSheet')).toBeVisible();
    await curtainGone(page);
    const samples = await samplesOf(page);
    await attachSamples(testInfo, 'lobby-load-samples.json', samples);

    expectTableAppearsOnce(samples);
    expect(samples.find((sample) => seen(sample) === 'table')?.route).toBe(
      'remote-room-lobby'
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('under reduced motion the loading screen goes at once, and the table still appears once', async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL,
    reducedMotion: 'reduce',
  });
  try {
    const { page } = await openRecorded(context, '/');
    await expect(
      page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
    ).toBeVisible({ timeout: 30_000 });
    await curtainGone(page);
    const samples = await samplesOf(page);
    await attachSamples(testInfo, 'reduced-motion-samples.json', samples);

    expectTableAppearsOnce(samples);
    expect(curtainStates(samples)).toEqual(['covering', 'gone']);
  } finally {
    await context.close();
  }
});

test('joining a room trades tables under the curtain, never over a bare desk', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  const options = {
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
  };
  const hostContext = await browser.newContext(options);
  const guestContext = await browser.newContext(options);
  try {
    const host = await hostContext.newPage();
    await host.goto('/?room-lobby=1');
    await curtainGone(host);
    await host.locator('#generateIdButton').click();
    await expect(host.locator('#roomIdInput')).toHaveValue(
      /^[A-HJ-NP-Z2-9]{12}$/u
    );
    await host.locator('#copyButton').click();
    await expect
      .poll(() => host.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/^PTCGSIM2-INVITE:/u);
    const invitation = await host.evaluate(() =>
      navigator.clipboard.readText()
    );

    const { page: guest, errors } = await openRecorded(
      guestContext,
      '/?room-lobby=1'
    );
    await curtainGone(guest);
    await guest.locator('#nameInput').fill('Guest');
    await guest.evaluate(
      (text) => navigator.clipboard.writeText(text),
      invitation
    );
    await guest.locator('#roomIdInput').focus();
    await guest.keyboard.press('Control+V');
    await expect(guest.locator('#roomIdInput')).toHaveValue(
      /^[A-HJ-NP-Z2-9]{12}$/u
    );
    const joinedAt = await guest.evaluate(() => performance.now());
    await guest.locator('#joinRoomButton').click();
    await expect(
      guest.locator(
        '[data-app-route="remote-room"][data-session-phase="ready"] .ptcgsim-table-rail'
      )
    ).toBeVisible({ timeout: 30_000 });
    await curtainGone(guest);
    // From what was on screen when Join was pressed.
    const recorded = await samplesOf(guest);
    const atJoin = recorded.findLastIndex((sample) => sample.t < joinedAt);
    const samples = recorded.slice(Math.max(0, atJoin));
    await attachSamples(testInfo, 'join-samples.json', samples);

    // The lobby's table, covered, swapped, and the room's uncovered: at no
    // frame a page without a table that the curtain did not hide.
    expect(samples.map(seen)).not.toContain('desk');
    expect(curtainStates(samples)).toEqual([
      'gone',
      'arriving',
      'covering',
      'leaving',
      'gone',
    ]);
    expect(samples.at(-1)).toMatchObject({
      route: 'remote-room',
      board: true,
      curtain: 'gone',
    });
    expect(
      samples.some(
        (sample) => sample.route === 'remote-room' && seen(sample) === 'table'
      )
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
