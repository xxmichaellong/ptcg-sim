import { expect, test, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import {
  chooseMoreAction,
  closeSheet,
  openDeck,
} from './support/table-shell.js';

/**
 * A riffle moves the whole pile, its top too, on every path that shuffles a
 * deck: setup and setting up again, the deck's own Shuffle, a card
 * shuffled in, and a hand shuffled in and drawn again. The cards to be
 * dealt off the deck afterwards wait on it while it is riffled; they are
 * its top, so none may sit still over the halves (the top staying put
 * while only the cards under it moved). Sampled every frame on the flat
 * and the tilted table.
 */

const zoneCount = (page: Page, kind: string) =>
  page.evaluate(
    (kind) =>
      window.__PTCG_RENDERER_SPIKE__?.scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === kind
      )?.count,
    kind
  );

const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-board-motion="idle"]')
  ).toBeAttached({ timeout: 20_000 });

const start = async (page: Page, mode: 'flat' | 'table') => {
  await ownRoomBudget(page.context());
  await page.addInitScript((mode) => {
    localStorage.setItem('ptcgsim.table-depth.v1', JSON.stringify({ mode }));
  }, mode);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?room-lobby=1');
  await page.locator('#nameInput').fill('Riffle review');
  await closeSheet(page);
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'riffle.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        '30,Ember ex,Pokémon,/v2/assets/cardback.png?ember',
        '20,Iono,Trainer,/v2/assets/cardback.png?iono',
        '10,Fire Energy,Energy,/v2/assets/cardback.png?energy',
      ].join('\n')
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect.poll(() => zoneCount(page, 'deck')).toBe(60);
  await page.mouse.move(2, 450);
  await idle(page);
};

interface Riffled {
  /** Frames in which the riffle was under way (two or more stand-ins). */
  readonly frames: number;
  /** Most real cards seen still over the deck in any such frame. */
  readonly still: number;
  /** Frames in which the deck's own top showed meanwhile. */
  readonly coverShown: number;
  /** Distinct places its stand-ins were drawn at: it moved. */
  readonly places: number;
}

/**
 * Watches the local deck every frame from now until the riffle is over (or
 * `ms` pass): what was drawn over it while it riffled.
 */
const watchRiffle = (page: Page, ms: number) =>
  page.evaluate(
    (ms) =>
      new Promise<Riffled>((resolve) => {
        const deckTop = () => {
          const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
          const deck = scene.zones.find(
            (zone) => zone.side === 'local' && zone.kind === 'deck'
          )!;
          const top = scene.cards.find(
            (card) => card.parentId === deck.id && card.renderKey !== null
          );
          return {
            ids: new Set(
              scene.cards
                .filter((card) => card.parentId === deck.id)
                .map((card) => String(card.id))
            ),
            element: top
              ? document.querySelector<HTMLElement>(
                  `[data-card-id="${String(top.id)}"]`
                )
              : null,
          };
        };
        const box = deckTop().element!.getBoundingClientRect();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const shown = (element: Element) => {
          const style = getComputedStyle(element);
          return Number(style.opacity) > 0.05 && style.visibility !== 'hidden';
        };
        const over = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return (
            Math.abs(rect.x + rect.width / 2 - cx) < box.width * 0.3 &&
            Math.abs(rect.y + rect.height / 2 - cy) < box.height * 0.3
          );
        };
        let frames = 0;
        let still = 0;
        let coverShown = 0;
        const places = new Set<string>();
        let seen = false;
        const begun = performance.now();
        const tick = () => {
          const stands = [
            ...document.querySelectorAll<HTMLElement>(
              '.ptcgsim-card-ghost--riffle'
            ),
          ].filter(shown);
          if (stands.length >= 2) {
            seen = true;
            frames += 1;
            const { ids, element } = deckTop();
            if (element && shown(element)) coverShown += 1;
            let here = 0;
            for (const card of document.querySelectorAll<HTMLElement>(
              '.ptcgsim-board-surface [data-card-id]'
            ))
              if (
                !ids.has(card.dataset['cardId']!) &&
                shown(card) &&
                over(card)
              )
                here += 1;
            still = Math.max(still, here);
            for (const stand of stands) {
              const style = getComputedStyle(stand);
              places.add(`${style.transform}|${style.translate}`);
            }
          }
          const done =
            (seen && stands.length === 0) || performance.now() - begun > ms;
          if (done) resolve({ frames, still, coverShown, places: places.size });
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    ms
  );

/** Runs `act` and checks the riffle it sets off moved the whole deck. */
const riffles = async (page: Page, what: string, act: () => Promise<void>) => {
  await page.mouse.move(2, 450);
  await idle(page);
  const watching = watchRiffle(page, 8_000);
  await act();
  const riffled = await watching;
  // A loaded machine may draw only a few frames of it: each is checked.
  expect(riffled.frames, `${what}: the deck riffles`).toBeGreaterThan(0);
  expect(
    riffled.still,
    `${what}: no card sits still on it while it riffles`
  ).toBe(0);
  expect(riffled.coverShown, `${what}: its old top is not left showing`).toBe(
    0
  );
  expect(riffled.places, `${what}: its stand-ins move`).toBeGreaterThan(1);
  await idle(page);
};

for (const mode of ['table', 'flat'] as const) {
  test(`every shuffle riffles the whole deck, its top too, on the ${mode === 'table' ? 'tilted' : 'flat'} table`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await start(page, mode);
    await riffles(page, 'setup', () => chooseMoreAction(page, 'setupButton'));
    await expect.poll(() => zoneCount(page, 'hand')).toBe(7);
    await riffles(page, 'setting up again', () =>
      chooseMoreAction(page, 'setupButton')
    );
    await expect.poll(() => zoneCount(page, 'prizes')).toBe(6);
    await riffles(page, 'Shuffle deck', () => page.keyboard.press('s'));
    const handCard = await page.evaluate(() => {
      const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
      const hand = scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'hand'
      )!;
      return String(
        scene.cards.find((card) => card.parentId === hand.id && card.renderKey)!
          .id
      );
    });
    await riffles(page, 'a card shuffled in', async () => {
      const card = page.locator(
        `.ptcgsim-board-surface [data-card-id="${handCard}"]`
      );
      await card.click({ trial: true });
      await card.dblclick();
      await page
        .locator(
          '[data-card-actions-window] [data-card-destination="deckShuffle"]'
        )
        .click();
    });
    await expect.poll(() => zoneCount(page, 'hand')).toBe(6);
    await riffles(page, 'the hand shuffled in and drawn again', async () => {
      await page.keyboard.press('Alt+s');
      await page.locator('[data-count-pick="7"]').click();
      const submit = page.locator('[data-dialog-action="submit"]');
      if (await submit.isVisible()) await submit.click();
    });
    await expect.poll(() => zoneCount(page, 'hand')).toBe(7);
  });
}
