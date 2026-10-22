import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  closeDeck,
  closeSheet,
  openAppMenu,
  openDeck,
  openSettings,
  useFlatTable,
} from './support/table-shell.js';

/**
 * Tutorial mode (ADR-038): lessons on a practice table of their own, each
 * dealt from its own position by the room's commands, each step done the
 * moment the table shows it -- by a mouse, a finger, a key or the palette.
 * The player's own table waits behind it and comes back as it was.
 */

type Point = { readonly x: number; readonly y: number };

const coach = (page: Page) =>
  page.locator('.tutorial-coach[data-tutorial-step]');
const stepOf = async (page: Page): Promise<string> =>
  (await coach(page)
    .getAttribute('data-tutorial-step', { timeout: 500 })
    .catch(() => null)) ?? '';
const atStep = (page: Page, id: string) =>
  expect.poll(() => stepOf(page), { timeout: 20_000 }).toBe(id);
const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1, { timeout: 20_000 });

const zone = (page: Page, kind: string, side = 'local') =>
  page.locator(
    `.ptcgsim-zone[data-zone-kind="${kind}"][data-zone-side="${side}"]`
  );
const inHand = (page: Page, name: string) =>
  page
    .locator(
      `.ptcgsim-card[data-in-hand][data-card-side="local"][aria-label^="${name}"]`
    )
    .first();
const inPlay = (page: Page, name: string, side = 'local') =>
  page
    .locator(
      `.ptcgsim-card[data-card-side="${side}"]:not([data-in-hand])[aria-label^="${name}"]`
    )
    .first();
const pokemonInHand = (page: Page) =>
  page
    .locator(
      '.ptcgsim-card[data-in-hand][data-card-side="local"]:is([aria-label^="Charmander"], [aria-label^="Pidgey"])'
    )
    .first();

const centre = async (locator: Locator): Promise<Point> => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
/** A hand card runs off the window: hold it by what shows. */
const grip = async (locator: Locator): Promise<Point> => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + Math.min(30, box.height / 2) };
};
/** The Bench's empty right end, where a card lands on its own. */
const benchRoom = async (page: Page, side = 'local'): Promise<Point> => {
  const box = (await zone(page, 'bench', side).boundingBox())!;
  return {
    x: box.x + box.width - box.height * 0.4,
    y: box.y + box.height / 2,
  };
};

const mouseDrag = async (page: Page, from: Point, to: Point) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let index = 1; index <= 14; index += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * index) / 14,
      from.y + ((to.y - from.y) * index) / 14
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await idle(page);
};

/** Finishes a lesson's last step's wait and starts the next one offered. */
const nextLesson = async (page: Page, first: string, touch = false) => {
  const done = page.locator('[data-tutorial-done]');
  await expect(done).toBeVisible({ timeout: 20_000 });
  const next = done.getByRole('button').last();
  if (touch) await next.tap();
  else await next.click();
  await atStep(page, first);
  await idle(page);
};

const openTutorial = async (page: Page, path = '/?tutorial') => {
  await page.goto(path);
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 40_000 });
};

test('walks every lesson with a mouse, each step done by the table', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await useFlatTable(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTutorial(page);
  const list = page.locator('[data-tutorial-lessons="true"]');
  await expect(list).toBeVisible();
  // A keyboard's lessons: the keys, not the touch screen's Commands.
  await expect(list.locator('[data-lesson]')).toHaveCount(10);
  await expect(list.locator('[data-lesson="keys"]')).toBeVisible();
  await expect(list.locator('[data-lesson="commands"]')).toHaveCount(0);
  await expect(list.locator('[data-suggested="true"]')).toHaveAttribute(
    'data-lesson',
    'start'
  );

  // 1. Start a game: Set up, then any Pokémon dealt, Active and Bench.
  await list.locator('[data-lesson="start"]').click();
  await atStep(page, 'start:setup');
  await idle(page);
  await page.locator('#boardButtonContainer #setupButton').click();
  await atStep(page, 'start:hand');
  await coach(page).getByRole('button', { name: 'Next' }).click();
  await atStep(page, 'start:active');
  // The step shows the drag: a ring on a Pokémon in the hand, one where it goes.
  await expect(page.locator('.tutorial-ring--from')).toBeVisible();
  await expect(page.locator('.tutorial-ring--to')).toBeVisible();
  await mouseDrag(
    page,
    await grip(pokemonInHand(page)),
    await centre(zone(page, 'active'))
  );
  await atStep(page, 'start:bench');
  // Dealt no second Pokémon, the step has nothing to do and goes on.
  if ((await pokemonInHand(page).count()) > 0) {
    await mouseDrag(
      page,
      await grip(pokemonInHand(page)),
      await benchRoom(page)
    );
  }

  // 2. Look at cards.
  await nextLesson(page, 'cards:read');
  await expect(coach(page)).toContainText(
    'Double-click Charmeleon in your hand to read it.'
  );
  await inHand(page, 'Charmeleon').dblclick({ position: { x: 30, y: 20 } });
  await atStep(page, 'cards:close');
  await page.keyboard.press('Escape');
  await atStep(page, 'cards:menu');
  await inPlay(page, 'Charmander').click({ button: 'right' });
  await atStep(page, 'cards:menu-close');
  await page.keyboard.press('Escape');

  // 3. Attach and evolve, a Trainer, the Bench, and Undo.
  await nextLesson(page, 'attach:energy');
  const active = await centre(inPlay(page, 'Charmander'));
  await mouseDrag(page, await grip(inHand(page, 'Fire Energy')), active);
  await atStep(page, 'attach:evolve');
  await mouseDrag(page, await grip(inHand(page, 'Charmeleon')), active);
  await atStep(page, 'attach:trainer');
  await mouseDrag(
    page,
    await grip(inHand(page, "Professor's Research")),
    await centre(zone(page, 'board'))
  );
  await atStep(page, 'attach:bench');
  await mouseDrag(
    page,
    await grip(inHand(page, 'Pidgey')),
    await benchRoom(page)
  );
  await atStep(page, 'attach:undo');
  await page.locator('#boardButtonContainer #undoButton').click();

  // 4. Damage and conditions, through the card's own menu.
  await nextLesson(page, 'damage:menu');
  const kirlia = inPlay(page, 'Kirlia', 'opponent');
  await kirlia.click({ button: 'right' });
  await atStep(page, 'damage:counter');
  await page
    .locator(
      '[data-legacy-card-context-menu] [data-context-action="setDamage"]'
    )
    .click();
  await atStep(page, 'damage:sixty');
  await page.locator('input.ptcgsim-marker-controls__value').fill('60');
  await page.keyboard.press('Enter');
  await atStep(page, 'damage:poison');
  await kirlia.click({ button: 'right' });
  await page
    .locator(
      '[data-legacy-card-context-menu] [data-context-action="setSpecialCondition"]'
    )
    .click();

  // 5. Knock Out: the whole Pokémon to the discard, a Prize, the next up.
  await nextLesson(page, 'knock-out:discard');
  await mouseDrag(
    page,
    await centre(inPlay(page, 'Kirlia', 'opponent')),
    await centre(zone(page, 'discard', 'opponent'))
  );
  await atStep(page, 'knock-out:prize');
  const prizes = (await zone(page, 'prizes').boundingBox())!;
  await mouseDrag(
    page,
    { x: prizes.x + prizes.width * 0.25, y: prizes.y + prizes.height * 0.17 },
    await centre(zone(page, 'hand'))
  );
  await atStep(page, 'knock-out:promote');
  await mouseDrag(
    page,
    await centre(inPlay(page, 'Ralts', 'opponent')),
    await centre(zone(page, 'active', 'opponent'))
  );

  // 6. Your deck: draw, look through it, take a card, shuffle.
  await nextLesson(page, 'deck:draw');
  await mouseDrag(
    page,
    await centre(zone(page, 'deck')),
    await centre(zone(page, 'hand'))
  );
  await atStep(page, 'deck:search');
  const deck = await centre(zone(page, 'deck'));
  await page.mouse.click(deck.x, deck.y);
  await atStep(page, 'deck:take');
  const candy = page
    .locator(
      '[data-zone-browser-kind="deck"] button[data-overlay-card-id][aria-label^="Rare Candy"]'
    )
    .first();
  // The card itself is lit in the open deck.
  await expect(page.locator('.tutorial-ring')).toHaveCount(1);
  await candy.click();
  await page.keyboard.press('h');
  await atStep(page, 'deck:shuffle');
  await page
    .locator('[data-zone-browser-kind="deck"] [data-zone-action="shuffleDeck"]')
    .click();

  // 7. Turns.
  await nextLesson(page, 'turns:turn');
  await page.locator('#boardButtonContainer #turnButton').click();
  await atStep(page, 'turns:coin');
  await page.locator('[data-table-coin="local"] button').first().click();
  await atStep(page, 'turns:attack');
  await page.locator('#boardButtonContainer #attackButton').click();

  // 8. Both sides: the table turned round, their turn, back again.
  await nextLesson(page, 'both-sides:flip');
  await page.locator('#boardButtonContainer #flipBoardButton').click();
  await atStep(page, 'both-sides:their-turn');
  await page.locator('#boardButtonContainer #turnButton').click();
  await atStep(page, 'both-sides:flip-back');
  await page.locator('#boardButtonContainer #flipBoardButton').click();

  // 9. Keys and commands.
  await nextLesson(page, 'keys:bench-key');
  await inHand(page, 'Pidgey').click({ position: { x: 30, y: 20 } });
  await page.keyboard.press('b');
  await atStep(page, 'keys:palette');
  await page.keyboard.press('`');
  await atStep(page, 'keys:palette-draw');
  // The coach reads over the open palette.
  await expect(coach(page)).toBeVisible();
  await page.keyboard.type('draw');
  await page.keyboard.press('Enter');
  await atStep(page, 'keys:palette-close');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await atStep(page, 'keys:shortcuts');
  await coach(page).getByRole('button', { name: 'Done' }).click();

  // 10. Around the table: what each of the app bar's buttons is for.
  await nextLesson(page, 'around:deck');
  for (const id of ['online', 'log', 'settings', 'menu']) {
    await coach(page)
      .getByRole('button', { name: /^(Next|Done)$/u })
      .click();
    await atStep(page, `around:${id}`);
  }
  await coach(page).getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-tutorial-done]')).toContainText(
    "Tutorial complete. You're ready to play."
  );
  // Every lesson is kept as done on this device.
  await page
    .locator('[data-tutorial-done]')
    .getByRole('button', { name: 'All lessons' })
    .click();
  await expect(list.locator('[data-done="true"]')).toHaveCount(10);
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('teaches by touch: Set up, a drag, Read and Actions', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await page.context().newCDPSession(page);
    const touchDrag = async (from: Point, to: Point) => {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: from.x, y: from.y }],
      });
      for (let index = 1; index <= 14; index += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: from.x + ((to.x - from.x) * index) / 14,
              y: from.y + ((to.y - from.y) * index) / 14,
            },
          ],
        });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await idle(page);
    };
    await openTutorial(page);
    const list = page.locator('[data-tutorial-lessons="true"]');
    // A touch screen's lessons: Commands, not the keys.
    await expect(list.locator('[data-lesson="commands"]')).toBeVisible();
    await expect(list.locator('[data-lesson="keys"]')).toHaveCount(0);
    await list.locator('[data-lesson="start"]').tap();
    await atStep(page, 'start:setup');
    await idle(page);
    // The coach keeps clear of the app bar in the corner.
    const bar = (await page.locator('.ptcgsim-app-bar').boundingBox())!;
    const box = (await coach(page).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    await page.locator('#boardButtonContainer #setupButton').tap();
    await atStep(page, 'start:hand');
    await coach(page).getByRole('button', { name: 'Next' }).tap();
    await atStep(page, 'start:active');
    await idle(page);
    await touchDrag(
      await grip(pokemonInHand(page)),
      await centre(zone(page, 'active'))
    );
    await atStep(page, 'start:bench');
    if ((await pokemonInHand(page).count()) > 0) {
      await touchDrag(await grip(pokemonInHand(page)), await benchRoom(page));
    }

    await nextLesson(page, 'cards:read', true);
    await expect(coach(page)).toContainText(
      'Tap Charmeleon in your hand, then Read.'
    );
    await inHand(page, 'Charmeleon').tap({ position: { x: 20, y: 15 } });
    await page.locator('#touchReadCardButton').tap();
    await atStep(page, 'cards:close');
    await expect(coach(page)).toContainText('Tap outside the card');
    await page.touchscreen.tap(195, 420);
    await atStep(page, 'cards:menu');
    await expect(coach(page)).toContainText('then Actions');
    await inPlay(page, 'Charmander').tap();
    await page.locator('#touchCardActionsButton').tap();
    await atStep(page, 'cards:menu-close');
  });
});

test('leaves the player’s own table as it was, and comes back to it', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTutorial(page, '/');
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'own.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        '30,Own Mon,Pokémon,/v2/assets/table/coin-heads.webp?own-mon',
        '30,Own Energy,Energy,/v2/assets/table/coin-tails.webp?own-energy',
      ].join('\n')
    ),
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await page.locator('#boardButtonContainer #setupButton').click();
  await idle(page);
  const ownHand = () =>
    page
      .locator('.ptcgsim-card[data-in-hand][data-card-side="local"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('aria-label')).sort()
      );
  await expect.poll(async () => (await ownHand()).length).toBe(7);
  const before = await ownHand();
  // Turned around, the player's hand is the far one.
  const farHand = () =>
    page
      .locator('.ptcgsim-card[data-in-hand][data-card-side="opponent"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('aria-label')).sort()
      );
  await page.locator('#boardButtonContainer #flipBoardButton').click();
  await expect.poll(farHand).toEqual(before);
  await idle(page);

  // The menu opens the tutorial on a practice table of its own.
  await openAppMenu(page);
  await page.locator('#tutorialButton').click();
  await expect(page.locator('[data-tutorial-lessons="true"]')).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('[data-lesson="cards"]').click();
  await atStep(page, 'cards:read');
  expect((await ownHand()).every((name) => !name?.startsWith('Own'))).toBe(
    true
  );

  // Its X goes back to the player's own table, just as they left it:
  // turned around too.
  await page.locator('#tutorialExitButton').click();
  await expect(page.locator('.tutorial-coach')).toHaveCount(0);
  await expect.poll(farHand, { timeout: 20_000 }).toEqual(before);
  await idle(page);
  await page.locator('#boardButtonContainer #flipBoardButton').click();
  await expect.poll(ownHand).toEqual(before);
  await idle(page);

  // Play online pressed on the practice table leaves it for the player's
  // own table, with Play online open there.
  await openAppMenu(page);
  await page.locator('#tutorialButton').click();
  await expect(page.locator('[data-tutorial-lessons="true"]')).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('[data-lesson="cards"]').click();
  await atStep(page, 'cards:read');
  await page.locator('.ptcgsim-app-bar #p2Button').click();
  // Back at the player's own table first (its cards), then Play online open
  // over it -- not only for a moment over the practice table it left.
  await expect.poll(ownHand, { timeout: 20_000 }).toEqual(before);
  await page.waitForTimeout(800);
  await expect(page.locator('.tutorial-coach')).toHaveCount(0);
  await expect(page.locator('#playOnlineSheet')).toBeVisible();
});

test('a lesson in the address starts at once, on both halves of the table', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // The player keeps only their own half on their table: a lesson about
  // the other side shows it all the same, and leaves their setting alone.
  await page.addInitScript(() => {
    localStorage.setItem(
      'ptcgsim.board-view.v1',
      JSON.stringify({ show: 'mine' })
    );
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTutorial(page, '/?tutorial=damage');
  await atStep(page, 'damage:menu');
  await expect(inPlay(page, 'Kirlia', 'opponent')).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('ptcgsim.board-view.v1'))
  ).toContain('mine');
  // Their Kirlia is lit; the coach covers none of what it points at.
  const ring = (await page.locator('.tutorial-ring').first().boundingBox())!;
  const box = (await coach(page).boundingBox())!;
  const apart =
    box.x + box.width <= ring.x ||
    ring.x + ring.width <= box.x ||
    box.y + box.height <= ring.y ||
    ring.y + ring.height <= box.y;
  expect(apart).toBe(true);
});

test('steps aside for the deck screen and sheets, and comes back after', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTutorial(page, '/?tutorial=around');
  await atStep(page, 'around:deck');
  await openDeck(page);
  await expect(coach(page)).toHaveCount(0);
  await closeDeck(page);
  await atStep(page, 'around:deck');
  for (const id of ['online', 'log', 'settings', 'menu']) {
    await coach(page)
      .getByRole('button', { name: /^(Next|Done)$/u })
      .click();
    await atStep(page, `around:${id}`);
  }
  await coach(page).getByRole('button', { name: 'Done' }).click();
  const done = page.locator('[data-tutorial-done]');
  await expect(done).toBeVisible();
  // The lesson's done card leaves the deck screen and Settings usable.
  await openDeck(page);
  await expect(done).toHaveCount(0);
  await closeDeck(page);
  await expect(done).toBeVisible();
  await openSettings(page);
  await expect(done).toHaveCount(0);
  await closeSheet(page);
  await expect(done).toBeVisible();
});
