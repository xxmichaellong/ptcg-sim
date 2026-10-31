import { expect, test, type Page } from '@playwright/test';

import {
  CARD_CATALOG_FIXTURE,
  routeCardCatalog,
} from './support/card-catalog-fixture.js';
import {
  idle,
  logLines,
  nextRevision,
  revision,
  zoneCardIds,
  zoneCount,
} from './support/multi-select.js';
import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome, openDeck } from './support/table-shell.js';

/**
 * Cards printed to be played as another kind (gap 5 of the card-effects
 * audit): a Fossil dropped on the Bench is a Pokémon there, and a Holon's
 * Pokémon dropped on a Pokémon is attached as an Energy, each one move with
 * its own log line. The catalog says which cards they are.
 */

const catalog = {
  ...CARD_CATALOG_FIXTURE,
  sets: [
    ...CARD_CATALOG_FIXTURE.sets,
    {
      id: 'sm6',
      code: 'FLI',
      name: 'Forbidden Light',
      series: 'Sun & Moon',
      released: '2018-05-04',
      img: 'https://assets.tcgdex.net/en/sm/sm6/',
      cards: [
        {
          n: '116',
          nm: 'Unidentified Fossil',
          c: 'T',
          tt: 'Item',
          tx: 'Play this card as if it were a 60-HP Colorless Basic Pokémon. At any time during your turn (before your attack), you may discard this card from play.',
        },
      ],
    },
    {
      id: 'ex13',
      code: 'HP',
      name: 'Holon Phantoms',
      series: 'EX',
      released: '2006-05-03',
      img: 'https://assets.tcgdex.net/en/ex/ex13/',
      cards: [
        {
          n: '44',
          nm: "Holon's Castform",
          c: 'P',
          st: 'Basic',
          hp: 50,
          ty: 'C',
        },
      ],
    },
  ],
} as typeof CARD_CATALOG_FIXTURE;

const LIST = `Pokémon: 2
1 Ralts SVI 84
1 Holon's Castform HP 44

Trainer: 1
1 Unidentified Fossil FLI 116

Energy: 2
2 Psychic Energy SVE 5

Total Cards: 5`;

const centre = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Drags a hand card by its middle onto a zone's or a card's middle. */
const dragTo = async (page: Page, cardId: string, target: string) => {
  const from = await centre(
    page,
    `.ptcgsim-board-surface [data-card-id="${cardId}"]`
  );
  const to = await centre(page, target);
  const before = await revision(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
  await nextRevision(page, before);
  await idle(page);
};

const handCardNamed = (page: Page, name: string) =>
  page.evaluate((wanted) => {
    const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
    const hand = scene.zones.find(
      (zone) => zone.side === 'local' && zone.kind === 'hand'
    )!;
    return scene.cards.find(
      (card) => card.parentId === hand.id && card.label === wanted
    )!.id;
  }, name);

const roleOf = (page: Page, cardId: string) =>
  page.evaluate(
    (id) =>
      window.__PTCG_RENDERER_SPIKE__!.scene.cards.find((card) => card.id === id)
        ?.role,
    cardId
  );

test('a Fossil goes on the Bench as a Pokémon, and a Holon’s Pokémon onto a Pokémon as an Energy', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await ownRoomBudget(context);
  await page.addInitScript(() =>
    localStorage.setItem(
      'ptcgsim.table-depth.v1',
      JSON.stringify({ mode: 'flat' })
    )
  );
  await routeCardCatalog(page, { catalog });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
  await openDeck(page);
  await page.locator('.deck-home').click({ position: { x: 4, y: 4 } });
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.activeElement?.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  }, LIST);
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '5'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await idle(page);

  // The whole deck into the hand, once the deck is on the table (its load
  // is a move of its own, which a revision taken before it would catch).
  await expect.poll(() => zoneCount(page, 'local', 'deck')).toBe(5);
  await page.locator('.ptcgsim-board-surface').focus();
  await page.keyboard.press('5');
  await expect
    .poll(() => zoneCardIds(page, 'local', 'hand').then((ids) => ids.length))
    .toBe(5);
  await idle(page);

  const active = await page.evaluate(
    () =>
      window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'active'
      )!.id
  );
  const bench = await page.evaluate(
    () =>
      window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'bench'
      )!.id
  );
  const ralts = await handCardNamed(page, 'Ralts');
  await dragTo(page, ralts, `[data-zone-id="${active}"]`);

  // The Fossil from its menu: Play as a Pokémon puts it on the Bench.
  const menuFossil = await handCardNamed(page, 'Unidentified Fossil');
  await page
    .locator(`.ptcgsim-board-surface [data-card-id="${menuFossil}"]`)
    .click({ button: 'right' });
  await page.locator('[data-context-action="playAsPokemon"]').click();
  await expect.poll(() => roleOf(page, menuFossil)).toBe('stackEvolution');
  // Taken back, to drop it this time.
  await page.locator('.ptcgsim-board-surface').focus();
  await page.keyboard.press('u');
  await expect
    .poll(() => handCardNamed(page, 'Unidentified Fossil').catch(() => null))
    .not.toBeNull();
  await idle(page);

  // The Fossil, dropped on the Bench: a Pokémon there.
  const fossil = await handCardNamed(page, 'Unidentified Fossil');
  await dragTo(page, fossil, `[data-zone-id="${bench}"]`);
  expect(await roleOf(page, fossil)).toBe('stackEvolution');

  // The Holon's Pokémon, dropped on Ralts: attached as an Energy.
  const castform = await handCardNamed(page, "Holon's Castform");
  await dragTo(
    page,
    castform,
    `.ptcgsim-board-surface [data-card-id="${ralts}"]`
  );
  expect(await roleOf(page, castform)).toBe('stackAttachment');
  expect(await roleOf(page, ralts)).toBe('stackEvolution');

  const lines = (await logLines(page)).join('\n');
  expect(lines).toContain(
    'Unidentified Fossil from hand to bench as a Pokémon'
  );
  expect(lines).toContain("Holon's Castform from hand to Ralts as an Energy");
});
