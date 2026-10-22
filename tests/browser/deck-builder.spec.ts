import { expect, test, type Page } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { openDeck } from './support/table-shell.js';

/**
 * The deck screen (ADR-033) with the fixture catalog (ADR-032): a pasted
 * list becomes a saved deck on the seat in one step and survives a reload;
 * the builder searches, filters, adds, checks the rules, undoes and
 * renames; and the deck goes to the table.
 */

const LIST = `Pokémon: 11
4 Dreepy TWM 128
3 Drakloak TWM 129
3 Dragapult ex TWM 130
1 Fezandipiti ex SFA 38

Trainer: 36
4 Iono PAL 185
4 Arven OBF 186
3 Boss's Orders MEG 114
4 Buddy-Buddy Poffin TEF 144
4 Ultra Ball MEG 131
4 Nest Ball SVI 181
4 Rare Candy MEG 125
3 Earthen Vessel PAR 163
2 Counter Catcher PAR 160
1 Prime Catcher TEF 157
1 Super Rod PAL 188
2 Jamming Tower TWM 153

Energy: 13
7 Psychic Energy SVE 5
6 Fire Energy MEE 10

Total Cards: 60`;

const seatCount = (page: Page) =>
  page.locator('#nativeDeckBuilderSummaryPanel');

const openSoloDeckScreen = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?renderer=dom');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await openDeck(page);
};

/** Pastes text with the keyboard's paste, outside any text field. */
const pasteOnScreen = async (page: Page, text: string): Promise<void> => {
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
  }, text);
};

test('a pasted list becomes a saved deck on the seat in one step, and stays saved', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await routeCardCatalog(page);
  await openSoloDeckScreen(page);

  await pasteOnScreen(page, LIST);
  await expect(seatCount(page)).toHaveAttribute('data-card-count', '60');
  await expect(page.locator('#nativeDeckBuilderTargetMain')).toContainText(
    'Dragapult ex'
  );
  const tile = page
    .getByRole('list', { name: 'Your decks' })
    .getByRole('listitem')
    .first();
  await expect(tile.locator('.deck-tile__name')).toHaveText('Dragapult ex');
  await expect(tile.locator('.deck-tile__count')).toContainText('60/60');
  await expect(tile.locator('.deck-tile__seat')).toHaveText('On P1');

  // Saved on this device: a reload finds it.
  await page.reload();
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await openDeck(page);
  const saved = page
    .getByRole('list', { name: 'Your decks' })
    .getByRole('listitem')
    .first();
  await expect(saved.locator('.deck-tile__name')).toHaveText('Dragapult ex');

  // One click puts it on the seat; Play takes it to the table.
  await saved.getByRole('button', { name: /Dragapult ex: put on P1/u }).click();
  await expect(seatCount(page)).toHaveAttribute('data-card-count', '60');
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  // The deck is on the table: 60 cards in the local deck pile.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__PTCG_RENDERER_SPIKE__?.scene.zones.find(
            (zone) => zone.side === 'local' && zone.kind === 'deck'
          )?.count
      )
    )
    .toBe(60);
});

test('the builder searches, filters, checks the rules, undoes and renames', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await routeCardCatalog(page);
  await openSoloDeckScreen(page);
  await page.locator('#deckNewButton').click();
  const search = page.locator('#nativeDeckBuilderSearchInput');
  await expect(search).toBeVisible();

  // Typed syntax and chips are one query.
  await search.fill('t:dragon');
  const results = page
    .getByRole('list', { name: 'Cards found' })
    .getByRole('listitem');
  await expect(results.first()).toContainText('Dragapult ex');
  await page.getByRole('button', { name: 'Pokémon', exact: true }).click();
  await page.getByRole('button', { name: 'Stage 2', exact: true }).click();
  await expect(results).toHaveCount(1);
  await expect(page.locator('#nativeDeckBuilderSearchStatus')).toContainText(
    '1 card'
  );

  // One print per card unless asked: the full art waits behind "prints".
  await expect(results.first()).toContainText('2 prints');

  // Enter adds the first card; clicks add; Shift+click removes.
  await search.press('Enter');
  await results.first().getByRole('button').click();
  await results.first().getByRole('button').click();
  await results.first().getByRole('button').click();
  await results
    .first()
    .getByRole('button')
    .click({ modifiers: ['Shift'] });
  const deck = page.locator('#nativeDeckBuilderCardsPanel');
  await expect(
    deck.locator('[data-deck-card="TWM 130"] .deck-row__count')
  ).toHaveText('3');

  // The rules speak plainly.
  const check = page.locator('#deckCheckPanel');
  await expect(check).toContainText('57 more cards needed (3/60).');
  await expect(check).toContainText('Needs at least one Basic Pokémon.');

  // Undo and redo.
  await page.locator('.deck-editor').press('Control+z');
  await expect(
    deck.locator('[data-deck-card="TWM 130"] .deck-row__count')
  ).toHaveText('4');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(
    deck.locator('[data-deck-card="TWM 130"] .deck-row__count')
  ).toHaveText('3');

  // A fifth copy is called out by name.
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await search.fill('"dragapult ex" u:prints');
  await expect(results).toHaveCount(2);
  await results.first().getByRole('button').click();
  await results.first().getByRole('button').click();
  await expect(check).toContainText('5 copies of Dragapult ex (max 4).');

  // Renaming saves; the deck is on the decks list under its new name.
  await page.locator('#deckNameInput').fill('Phantom Dive');
  await page.locator('#deckNameInput').press('Enter');
  await page.locator('#deckEditorBackButton').click();
  await expect(
    page
      .getByRole('list', { name: 'Your decks' })
      .locator('.deck-tile__name')
      .first()
  ).toHaveText('Phantom Dive');
});

test('lines the catalog cannot place are listed, and the rest imports', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await routeCardCatalog(page);
  await page.route('https://limitlesstcg.com/api/dm/import', (route) =>
    route.fulfill({ json: { cards: [], errors: ['Unknown card'] } })
  );
  await openSoloDeckScreen(page);
  await page
    .locator('#deckPasteInput')
    .fill('4 Dreepy TWM 128\n2 Not A Real Card');
  await page.locator('#deckPasteImportButton').click();
  await expect(seatCount(page)).toHaveAttribute('data-card-count', '4');
  await expect(page.locator('.deck-missing')).toContainText('1 line not found');
  await expect(page.locator('.deck-missing')).toContainText('Not A Real Card');
});

test('a deck chosen while an import still reads keeps the seat', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // The catalog still building: a list import waits for it a moment.
  await routeCardCatalog(page, { building: true });
  // Limitless answers only once the deck is chosen, so the import is
  // still reading when the choice is made however slow the run.
  let answer = (): void => undefined;
  const chosen = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route('https://limitlesstcg.com/api/dm/import', async (route) => {
    await chosen;
    await route
      .fulfill({ json: { cards: [], errors: [] } })
      .catch(() => undefined);
  });
  await openSoloDeckScreen(page);
  // A simulator file imports at once: a saved deck to choose.
  await pasteOnScreen(
    page,
    'QTY,Name,Type,URL\n4,Dreepy,Pokémon,https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_128_R_EN.png'
  );
  await expect(seatCount(page)).toHaveAttribute('data-card-count', '4');
  const dreepy = page
    .getByRole('list', { name: 'Your decks' })
    .getByRole('listitem')
    .first();
  await expect(dreepy.locator('.deck-tile__count')).toContainText('4/60');

  // A list starts importing, then the player picks the saved deck.
  await pasteOnScreen(page, LIST);
  await dreepy.getByRole('button', { name: /put on P1/u }).click();
  // Past the import's wait, and Limitless answered: the choice stands.
  await page.waitForTimeout(3_500);
  answer();
  await page.waitForTimeout(1_000);
  await expect(seatCount(page)).toHaveAttribute('data-card-count', '4');
  await expect(
    page.getByRole('list', { name: 'Your decks' }).getByRole('listitem')
  ).toHaveCount(1);
});
