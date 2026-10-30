import { expect, test, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { openDeck } from './support/table-shell.js';

// Each test opens the table (twice in development's StrictMode): its own
// room budget, whatever ran before it (support/room-budget.ts).
test.beforeEach(async ({ context }) => {
  await ownRoomBudget(context);
});

/**
 * Tournament decks on the deck screen (ADR-037): a deck's name typed in the
 * finder lists that deck's best finishes, and any finish's list goes on the
 * seat; a tournament opens to its standings, and any player's list goes on
 * the seat. The server's index is stubbed here (its Limitless crawl is
 * covered by the Worker's own tests), so this checks what a player sees and
 * does.
 */

const LIST = [
  'Pokémon: 4',
  '4 Dreepy TWM 128',
  '',
  'Energy: 56',
  '56 Psychic Energy MEE 13',
].join('\n');

const TOURNAMENT = {
  id: '6ad8a7d1115c12b73a5a8e4b',
  name: 'ASRcristiano # 197',
  date: '2026-10-21T19:00:00.000Z',
  players: 67,
  format: 'STANDARD',
};
const ARCHETYPE = {
  id: 'dragapult-dusknoir',
  name: 'Dragapult Dusknoir',
  icons: ['dragapult', 'dusknoir'],
};

const stubIndex = async (page: Page): Promise<string[]> => {
  const asked: string[] = [];
  await page.route('**/v2/decks/search**', async (route) => {
    asked.push(new URL(route.request().url()).search);
    await route.fulfill({
      json: {
        available: true,
        updatedAt: '2026-10-22T06:00:00.000Z',
        results: [
          {
            archetype: ARCHETYPE,
            lists: 812,
            top8s: 64,
            best: [
              {
                tournament: TOURNAMENT,
                player: { id: 'redthegoat', name: 'REDTHEGOAT' },
                placing: 1,
                record: { wins: 8, losses: 2, ties: 0 },
              },
            ],
          },
        ],
      },
    });
  });
  await page.route('**/v2/tournaments?**', (route) =>
    route.fulfill({
      json: {
        tournaments: [{ ...TOURNAMENT, organizer: 'League', hasLists: true }],
        nextCursor: null,
      },
    })
  );
  await page.route(`**/v2/tournaments/${TOURNAMENT.id}`, (route) =>
    route.fulfill({
      json: {
        tournament: {
          ...TOURNAMENT,
          organizer: 'League',
          hasLists: true,
          url: `https://play.limitlesstcg.com/tournament/${TOURNAMENT.id}/standings`,
        },
        standings: [
          {
            player: { id: 'redthegoat', name: 'REDTHEGOAT' },
            placing: 1,
            record: { wins: 8, losses: 2, ties: 0 },
            dropped: false,
            archetype: ARCHETYPE,
            hasList: true,
          },
          {
            player: { id: 'nolist', name: 'No List' },
            placing: 2,
            record: { wins: 7, losses: 3, ties: 0 },
            dropped: false,
            archetype: null,
            hasList: false,
          },
        ],
      },
    })
  );
  await page.route('**/v2/tournaments/*/players/*/list', (route) =>
    route.fulfill({
      json: {
        text: LIST,
        archetype: ARCHETYPE,
        player: { id: 'redthegoat', name: 'REDTHEGOAT' },
        tournament: TOURNAMENT,
        url: `https://play.limitlesstcg.com/tournament/${TOURNAMENT.id}/player/redthegoat/decklist`,
      },
    })
  );
  return asked;
};

const openDeckScreen = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await openDeck(page);
};

test("a deck's name finds its tournament finishes, and a finish's list goes on the seat", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const asked = await stubIndex(page);
  await openDeckScreen(page);
  await page.locator('#deckPasteInput').fill('dragapult');
  const results = page.getByRole('region', { name: 'Tournament decks' });
  await expect(results.getByText('Dragapult Dusknoir')).toBeVisible();
  // Typing rests before it asks: one request for the whole word, majors
  // alone in Standard until online events are asked for (ADR-037 §9).
  expect(asked).toEqual(['?q=dragapult&format=STANDARD&kind=major']);
  await expect(
    results.getByRole('link', { name: 'Limitless TCG' })
  ).toHaveAttribute('target', '_blank');
  // A name is one line: Enter doesn't turn it into a list.
  await page.locator('#deckPasteInput').press('Enter');
  await expect(page.locator('#deckPasteInput')).toHaveValue('dragapult');
  await expect(page.locator('#deckPasteImportButton')).toHaveCount(0);

  await results
    .getByRole('button', {
      name: 'Dragapult Dusknoir, 1st of 67, REDTHEGOAT: try it',
    })
    .click();
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  const tray = page.locator('#nativeDeckBuilderTargetMain');
  await expect(tray).toHaveAccessibleName(/Dragapult Dusknoir — 1st of 67/u);
  await expect(tray.locator('.deck-tray__finish')).toHaveText('1st of 67');

  // Esc clears the search before it would leave the screen.
  await page.locator('#deckPasteInput').press('Escape');
  await expect(page.locator('#deckPasteInput')).toHaveValue('');
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="true"]')
  ).toBeVisible();
});

test("a tournament opens to its standings, and any player's list goes on the seat", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await stubIndex(page);
  await openDeckScreen(page);
  // The shelf asks for its events as it comes near the screen.
  await page.locator('#deckTournamentsTitle').scrollIntoViewIfNeeded();
  const events = page.getByRole('list', { name: 'Tournaments' });
  await events.getByRole('button', { name: /ASRcristiano # 197/u }).click();
  const standings = page.getByRole('list', { name: 'Standings' });
  await expect(standings.getByRole('listitem')).toHaveCount(2);
  await expect(standings.getByRole('listitem').nth(1)).toContainText('No list');
  await expect(
    page.getByRole('link', { name: /Limitless/u }).first()
  ).toHaveAttribute(
    'href',
    `https://play.limitlesstcg.com/tournament/${TOURNAMENT.id}/standings`
  );
  await standings
    .getByRole('button', {
      name: 'Dragapult Dusknoir, 1st, REDTHEGOAT: try it',
    })
    .click();
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  // Back to the shelves, the finder as it was.
  await page.locator('#deckSubviewBackButton').click();
  await expect(page.locator('#deckPasteInput')).toBeVisible();
});

test("majors come alone until online events are asked for, and a major's list goes on the seat", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await stubIndex(page);
  const NICE = {
    id: 'labs-0077',
    name: 'Regional Nice',
    date: '2026-10-17T06:30:00.000Z',
    players: 2336,
    format: 'STANDARD',
    kind: 'regional',
  };
  const asked: string[] = [];
  // Routes added later are matched first.
  await page.route('**/v2/tournaments?**', (route) => {
    const search = new URL(route.request().url()).searchParams;
    asked.push(search.toString());
    return route.fulfill({
      json: {
        tournaments:
          search.get('kind') === 'major'
            ? [{ ...NICE, organizer: null, hasLists: true }]
            : [
                { ...TOURNAMENT, organizer: 'League', hasLists: true },
                { ...NICE, organizer: null, hasLists: true },
              ],
        nextCursor: null,
      },
    });
  });
  await page.route(`**/v2/tournaments/${NICE.id}`, (route) =>
    route.fulfill({
      json: {
        tournament: {
          ...NICE,
          organizer: null,
          hasLists: true,
          url: 'https://labs.limitlesstcg.com/0077/standings',
        },
        standings: [
          {
            player: { id: '2115', name: 'Luc Gantner', country: 'CH' },
            placing: 1,
            record: { wins: 15, losses: 1, ties: 2 },
            dropped: false,
            archetype: ARCHETYPE,
            hasList: true,
          },
        ],
      },
    })
  );
  await openDeckScreen(page);
  await page.locator('#deckTournamentsTitle').scrollIntoViewIfNeeded();
  const events = page.getByRole('list', { name: 'Tournaments' });
  // Regionals and up, in Standard, at first.
  await expect(events.getByRole('listitem')).toHaveCount(1);
  await expect(events.getByRole('listitem').first()).toContainText(
    'Regional · Standard · 2,336 players'
  );
  expect(asked.at(-1)).toBe('format=STANDARD&minPlayers=16&kind=major');
  const online = page.locator('#deckEventsOnlineToggle');
  await expect(online).toHaveAttribute('aria-pressed', 'false');
  await online.click();
  await expect(online).toHaveAttribute('aria-pressed', 'true');
  await expect(events.getByRole('listitem')).toHaveCount(2);
  expect(asked.at(-1)).toBe('format=STANDARD&minPlayers=16');
  // Majors alone in Expanded: there are none, said plainly, with the way
  // to the online events that have it.
  await online.click();
  await page.locator('#deckEventsFormat-EXPANDED').check();
  const none = page.locator('.deck-events [data-no-majors]');
  await expect(none).toContainText('No majors in Expanded');
  await none.getByRole('button', { name: 'Show online events' }).click();
  await expect(online).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => asked.at(-1)).toBe('format=EXPANDED&minPlayers=16');
  // Back to majors in Standard, for the next visit too.
  await page.locator('#deckEventsFormat-STANDARD').check();
  await online.click();
  await expect(events.getByRole('listitem')).toHaveCount(1);
  await events.getByRole('button', { name: /Regional Nice/u }).click();
  await expect(
    page.getByRole('link', { name: /Limitless/u }).first()
  ).toHaveAttribute('href', 'https://labs.limitlesstcg.com/0077/standings');
  await page
    .getByRole('list', { name: 'Standings' })
    .getByRole('button', {
      name: 'Dragapult Dusknoir, 1st, Luc Gantner: try it',
    })
    .click();
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
});

test('deck search says quietly when it is offline', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route('**/v2/decks/search**', (route) =>
    route.fulfill({ status: 500, body: 'no' })
  );
  await page.route('**/v2/tournaments?**', (route) =>
    route.fulfill({ json: { tournaments: [], nextCursor: null } })
  );
  await openDeckScreen(page);
  await page.locator('#deckPasteInput').fill('gardevoir');
  await expect(
    page
      .getByRole('region', { name: 'Tournament decks' })
      .getByText('Deck search is offline')
  ).toBeVisible();
  // A list pasted into the same field imports as ever.
  await page.locator('#deckPasteInput').fill(LIST);
  await page.locator('#deckPasteImportButton').click();
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
});

test('a list still loading gives way to a deck chosen meanwhile', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await stubIndex(page);
  // The list is slow to come; it is held until the test lets it go.
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v2/tournaments/*/players/*/list', async (route) => {
    await held;
    await route.fulfill({
      json: {
        text: LIST,
        archetype: ARCHETYPE,
        player: { id: 'redthegoat', name: 'REDTHEGOAT' },
        tournament: TOURNAMENT,
        url: `https://play.limitlesstcg.com/tournament/${TOURNAMENT.id}/player/redthegoat/decklist`,
      },
    });
  });
  await openDeckScreen(page);
  // A deck of the player's own, saved, then put back on the shelf's seat.
  await page
    .locator('#deckPasteInput')
    .fill(
      [
        'Pokémon: 4',
        '4 Ralts ASR 60',
        '',
        'Energy: 56',
        '56 Psychic Energy MEE 5',
      ].join('\n')
    );
  await page.locator('#deckPasteImportButton').click();
  const tray = page.locator('#nativeDeckBuilderTargetMain');
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  // Named for its first Pokémon.
  const ownName = 'Ralts deck';
  await expect(tray).toHaveAccessibleName(new RegExp(ownName, 'u'));

  await page.locator('#deckPasteInput').fill('dragapult');
  await page
    .getByRole('region', { name: 'Tournament decks' })
    .getByRole('button', {
      name: 'Dragapult Dusknoir, 1st of 67, REDTHEGOAT: try it',
    })
    .click();
  await page.locator('#deckPasteInput').fill('');
  // Chosen while the list is still on its way: the choice stands.
  await page
    .getByRole('button', { name: new RegExp(`^${ownName}: put on P1$`, 'u') })
    .click();
  release();
  await page.waitForTimeout(1_500);
  await expect(tray).not.toHaveAccessibleName(/Dragapult/u);
  await expect(tray).toHaveAccessibleName(new RegExp(ownName, 'u'));
});

test('All lists for a deck with no recent finishes lists its older ones', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await stubIndex(page);
  const asked: string[] = [];
  await page.route(`**/v2/decks/archetype/${ARCHETYPE.id}**`, (route) => {
    const since = new URL(route.request().url()).searchParams.get('since');
    asked.push(since ?? 'default');
    return route.fulfill({
      json: {
        archetype: ARCHETYPE,
        // Nothing in the last 90 days; a win from last year.
        finishes:
          since === null
            ? []
            : [
                {
                  tournament: {
                    ...TOURNAMENT,
                    date: '2025-09-01T19:00:00.000Z',
                  },
                  player: { id: 'oldwin', name: 'Old Win' },
                  placing: 1,
                  record: { wins: 9, losses: 0, ties: 0 },
                },
              ],
        nextCursor: null,
      },
    });
  });
  await openDeckScreen(page);
  await page.locator('#deckPasteInput').fill('dragapult');
  await page
    .getByRole('region', { name: 'Tournament decks' })
    .getByRole('button', { name: /All lists/u })
    .first()
    .click();
  await expect(
    page.getByRole('list', { name: `Lists for ${ARCHETYPE.name}` })
  ).toContainText('Old Win');
  // Recent first (asked again under StrictMode in development), then all.
  expect(asked[0]).toBe('default');
  expect(asked.at(-1)).toBe('3650');
});

test('All lists for a deck shows its recent lists, and its older ones at All time', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await stubIndex(page);
  const finish = (player: string, date: string, n: number) => ({
    tournament: {
      ...TOURNAMENT,
      id: `${TOURNAMENT.id.slice(0, -1)}${String(n)}`,
      date,
    },
    player: { id: player, name: player.toUpperCase() },
    placing: 1,
    record: { wins: 9, losses: 0, ties: 0 },
  });
  await page.route(`**/v2/decks/archetype/${ARCHETYPE.id}**`, (route) => {
    const since = new URL(route.request().url()).searchParams.get('since');
    const recent = [finish('newwin', '2026-10-10T19:00:00.000Z', 1)];
    return route.fulfill({
      json: {
        archetype: ARCHETYPE,
        finishes:
          since === null
            ? recent
            : [
                ...recent,
                finish('oldwin', '2025-09-01T19:00:00.000Z', 2),
                finish('oldtop', '2025-06-01T19:00:00.000Z', 3),
              ],
        nextCursor: null,
      },
    });
  });
  await openDeckScreen(page);
  await page.locator('#deckPasteInput').fill('dragapult');
  await page
    .getByRole('region', { name: 'Tournament decks' })
    .getByRole('button', { name: /All lists/u })
    .first()
    .click();
  const lists = page.getByRole('list', {
    name: `Lists for ${ARCHETYPE.name}`,
  });
  await expect(lists.getByRole('listitem')).toHaveCount(1);
  await page.locator('#deckAllTimeButton').click();
  await expect(lists.getByRole('listitem')).toHaveCount(3);
  await expect(lists).toContainText('OLDWIN');
  await expect(page.locator('#deckAllTimeButton')).toHaveCount(0);
});

test('a tournament opens and closes from the keyboard, and Esc steps back before it leaves', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await stubIndex(page);
  await openDeckScreen(page);
  await page.locator('#deckTournamentsTitle').scrollIntoViewIfNeeded();
  const event = page
    .getByRole('list', { name: 'Tournaments' })
    .getByRole('button', { name: /ASRcristiano # 197/u });
  await event.focus();
  await page.keyboard.press('Enter');
  // The tournament's name, read first: focus stays on the screen.
  await expect(page.locator('.deck-subhead__title h2')).toBeFocused();
  await expect(
    page.getByRole('list', { name: 'Standings' }).getByRole('listitem')
  ).toHaveCount(2);
  // Esc goes back to the decks, to the event that opened it.
  await page.keyboard.press('Escape');
  await expect(page.locator('#deckPasteInput')).toBeVisible();
  await expect(event).toBeFocused();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="true"]')
  ).toBeVisible();
  // From the decks, Esc leaves the screen.
  await page.keyboard.press('Escape');
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
});

test("a deck's name pasted onto the screen is looked up", async ({ page }) => {
  test.setTimeout(60_000);
  const asked = await stubIndex(page);
  await openDeckScreen(page);
  // Pasted onto the screen itself, not into the finder.
  await expect(page.locator('#deckPasteInput')).toBeVisible();
  await expect(async () => {
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'Dragapult');
      document.body.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    await expect(page.locator('#deckPasteInput')).toHaveValue('Dragapult', {
      timeout: 500,
    });
  }).toPass();
  await expect(page.locator('#deckPasteInput')).toBeFocused();
  await expect(
    page
      .getByRole('region', { name: 'Tournament decks' })
      .getByText('Dragapult Dusknoir')
  ).toBeVisible();
  expect(asked).toEqual(['?q=Dragapult&format=STANDARD&kind=major']);
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true });

  test("the finder's field sits beside its icon at every phone width", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await stubIndex(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
      timeout: 30_000,
    });
    await openDeck(page);
    for (const width of [320, 360, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 800 });
      // The page lays out again at the new width: two frames on.
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      );
      const icon = (await page.locator('.deck-paste__icon').boundingBox())!;
      const field = (await page.locator('#deckPasteInput').boundingBox())!;
      // One row: the field starts after the icon, beside it.
      expect(
        field.x > icon.x + icon.width && field.y < icon.y + icon.height,
        `one row at ${String(width)}`
      ).toBe(true);
    }
  });
});
