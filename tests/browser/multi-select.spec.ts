import { expect, test, type Page } from '@playwright/test';

import { overlayToast } from './support/overlay-dialogs.js';
import {
  card,
  cardName,
  idle,
  logLines,
  markers,
  nextRevision,
  clearNotices,
  openNamedSolo,
  POKEMON_DECK,
  pokemonCards,
  pokemonIn,
  pressOn,
  revision,
  selection,
  shiftClick,
  sweep,
  useTableMode,
  zoneBox,
  zoneCardIds,
  zoneCount,
  type TableMode,
} from './support/multi-select.js';

/**
 * Several cards at once (ADR-042), end to end on a Solo table, flat and
 * tilted: picked with Shift, ⌘/Ctrl, `x`, Ctrl/⌘+A or a rectangle on the
 * felt, moved and marked as one move the room takes or refuses whole, one
 * line in the log, one Undo.
 */

const centre = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/**
 * Drags a card by its middle and lets go over a zone's middle, or over
 * another card's (an id that is a card's).
 */
const dragTo = async (page: Page, cardId: string, targetId: string) => {
  const from = await centre(
    page,
    `.ptcgsim-board-surface [data-card-id="${cardId}"]`
  );
  const to = await centre(
    page,
    `[data-zone-id="${targetId}"], .ptcgsim-board-surface [data-card-id="${targetId}"]`
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
};

const zoneId = (page: Page, side: 'local' | 'opponent', kind: string) =>
  page.evaluate(
    ({ side, kind }) =>
      window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
        (zone) => zone.side === side && zone.kind === kind
      )!.id,
    { side, kind }
  );

/** The selection, once the table has drawn it. */
const expectSelection = (page: Page, cardIds: readonly string[]) =>
  expect.poll(() => selection(page)).toEqual(cardIds);

/** Waits for the move a key or a drag sends to come back from the room. */
const moved = async (page: Page, act: () => Promise<void>) => {
  const before = await revision(page);
  await act();
  await nextRevision(page, before);
  await idle(page);
};

/** Benches the first `count` cards of a seat's hand, one key each. */
const bench = async (
  page: Page,
  side: 'local' | 'opponent',
  count: number
): Promise<string[]> => {
  const hand = await zoneCardIds(page, side, 'hand');
  for (const cardId of hand.slice(0, count))
    await moved(page, () => pressOn(page, cardId, 'b'));
  await page.keyboard.press('Escape');
  const row = await pokemonIn(page, side, 'bench');
  expect(row).toHaveLength(count);
  return row;
};

for (const mode of ['flat', 'table'] as const satisfies readonly TableMode[])
  test.describe(`${mode} table`, () => {
    test.beforeEach(async ({ page }) => {
      await useTableMode(page, mode);
    });

    test('three hand cards picked with Shift go to the discard in one drag: one line names them, one Undo brings them back', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await openNamedSolo(page);
      const hand = await zoneCardIds(page, 'local', 'hand');
      const picked = [hand[0]!, hand[2]!, hand[4]!];
      await shiftClick(page, ...picked);
      await expectSelection(page, picked);
      const names = await Promise.all(picked.map((id) => cardName(page, id)));
      const discard = await zoneId(page, 'local', 'discard');
      await moved(page, () => dragTo(page, picked[1]!, discard));
      expect(await zoneCount(page, 'local', 'discard')).toBe(3);
      expect(await zoneCount(page, 'local', 'hand')).toBe(hand.length - 3);
      // The selection is put down with the move.
      await expectSelection(page, []);
      // One line, naming each card.
      const lines = await logLines(page);
      const named = lines.filter((line) =>
        names.every((name) => line.includes(name))
      );
      expect(named, lines.join('\n')).toHaveLength(1);
      // One Undo brings all three back.
      await page.locator('.ptcgsim-board-surface').focus();
      await moved(page, () => page.keyboard.press('u'));
      expect(await zoneCount(page, 'local', 'discard')).toBe(0);
      expect((await zoneCardIds(page, 'local', 'hand')).sort()).toEqual(
        [...hand].sort()
      );
      expect(errors).toEqual([]);
    });

    test("a notice steps aside while the group's menu is open, and comes back as it closes", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openNamedSolo(page);
      await clearNotices(page);
      const notices = page.locator('.ptcgsim-ui-toast-viewport');
      const hand = await zoneCardIds(page, 'local', 'hand');
      // A card sent where it already is says so in a notice.
      await card(page, hand[0]!).click();
      await page.locator('.ptcgsim-board-surface').focus();
      await page.keyboard.press('h');
      await expect(
        page.locator('[data-ptcgsim-overlay="toast"]').first()
      ).toBeVisible();
      await shiftClick(page, hand[1]!);
      await expectSelection(page, [hand[0]!, hand[1]!]);
      await card(page, hand[1]!).click({ button: 'right' });
      await expect(page.locator('[data-group-menu]')).toBeVisible();
      const look = () =>
        notices.evaluate((element) => {
          const style = getComputedStyle(element);
          return { opacity: style.opacity, presses: style.pointerEvents };
        });
      await expect.poll(look).toEqual({ opacity: '0', presses: 'none' });
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-group-menu]')).toHaveCount(0);
      await expect.poll(look).toEqual({ opacity: '1', presses: 'auto' });
    });

    test('⌘/Ctrl picks across the hand and the open discard, and ↑ puts them on the deck, the last picked on top', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openNamedSolo(page);
      const hand = await zoneCardIds(page, 'local', 'hand');
      // Two cards in the discard first, as a group.
      await shiftClick(page, hand[0]!, hand[1]!);
      await moved(page, () => page.keyboard.press('d'));
      const discarded = await zoneCardIds(page, 'local', 'discard');
      expect([...discarded].sort()).toEqual([hand[0]!, hand[1]!].sort());
      // The discard pile open in its viewer.
      const pile = await page.evaluate(
        () =>
          window.__PTCG_RENDERER_SPIKE__!.scene.cards.find(
            (candidate) =>
              candidate.side === 'local' &&
              candidate.parentId.endsWith(':discard') &&
              candidate.renderKey !== null
          )!.id
      );
      await card(page, pile).click();
      const viewer = page.locator('[data-legacy-zone-browser]');
      await expect(viewer).toBeVisible();
      // Two from the hand, the viewer staying open, then one from the pile.
      await card(page, hand[2]!).click({ modifiers: ['ControlOrMeta'] });
      await card(page, hand[3]!).click({ modifiers: ['ControlOrMeta'] });
      await expect(viewer).toBeVisible();
      const fromPile = discarded[0]!;
      await viewer
        .locator(`button[data-overlay-card-id="${fromPile}"]`)
        .click({ modifiers: ['ControlOrMeta'] });
      await expect(
        viewer.locator(
          `button[data-overlay-card-id="${fromPile}"][data-selection-ticked="true"]`
        )
      ).toBeVisible();
      await expectSelection(page, [hand[2]!, hand[3]!]);
      const names = await Promise.all(
        [hand[2]!, hand[3]!, fromPile].map((id) => cardName(page, id))
      );
      await moved(page, () => page.keyboard.press('ArrowUp'));
      await page.keyboard.press('Escape');
      // Item 1 went on first, so the last picked is drawn first.
      for (const name of [...names].reverse()) {
        const before = await zoneCardIds(page, 'local', 'hand');
        await moved(page, () => page.keyboard.press('1'));
        const drawn = (await zoneCardIds(page, 'local', 'hand')).filter(
          (id) => !before.includes(id)
        );
        expect(drawn).toHaveLength(1);
        expect(await cardName(page, drawn[0]!)).toBe(name);
      }
    });

    test('a rectangle over the Bench takes its Pokémon, and d discards each whole', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openNamedSolo(page, { deck: POKEMON_DECK });
      const row = await bench(page, 'local', 3);
      // One of them evolved: two cards that go together.
      const evolution = (await zoneCardIds(page, 'local', 'hand'))[0]!;
      await moved(page, () => dragTo(page, evolution, row[0]!));
      const evolved = (await pokemonIn(page, 'local', 'bench'))[0]!;
      expect(await pokemonCards(page, evolved)).toHaveLength(2);
      // A rectangle from the Bench's empty end across all of it.
      const box = await zoneBox(page, 'local', 'bench');
      await sweep(
        page,
        { x: box.x + box.width - 4, y: box.y + box.height - 4 },
        { x: box.x + 3, y: box.y + 3 }
      );
      await expect.poll(async () => (await selection(page)).length).toBe(3);
      await moved(page, () => page.keyboard.press('d'));
      expect(await pokemonIn(page, 'local', 'bench')).toEqual([]);
      expect(await zoneCount(page, 'local', 'discard')).toBe(4);
    });

    test('d on two Pokémon discards each whole; on one, its top card goes and the rest wait in the window', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openNamedSolo(page, { deck: POKEMON_DECK });
      let row = await bench(page, 'local', 3);
      const evolution = (await zoneCardIds(page, 'local', 'hand'))[0]!;
      await moved(page, () => dragTo(page, evolution, row[0]!));
      row = await pokemonIn(page, 'local', 'bench');
      // Two Pokémon: each goes whole.
      await shiftClick(page, row[1]!, row[2]!);
      await moved(page, () => page.keyboard.press('d'));
      expect(await pokemonIn(page, 'local', 'bench')).toEqual([row[0]!]);
      expect(await zoneCount(page, 'local', 'discard')).toBe(2);
      // One Pokémon, as v1: its top card to the discard, the rest to the
      // attached-cards window.
      await moved(page, () => pressOn(page, row[0]!, 'd'));
      expect(await zoneCount(page, 'local', 'discard')).toBe(3);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
                (zone) => zone.kind === 'attachmentResolution'
              )?.count ?? 0
          )
        )
        .toBe(1);
    });

    test('x and Ctrl/⌘+A pick, Esc and a press on the felt put down', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openNamedSolo(page);
      const hand = await zoneCardIds(page, 'local', 'hand');
      await card(page, hand[0]!).hover({ force: true });
      await page.keyboard.press('x');
      await expectSelection(page, [hand[0]!]);
      await card(page, hand[1]!).hover({ force: true });
      await page.keyboard.press('x');
      await expectSelection(page, [hand[0]!, hand[1]!]);
      // x again takes one out.
      await page.keyboard.press('x');
      await expectSelection(page, [hand[0]!]);
      await page.keyboard.press('Escape');
      await expectSelection(page, []);
      // Every card where the last one lies: the hand.
      await card(page, hand[2]!).hover({ force: true });
      await page.keyboard.press('x');
      await page.keyboard.press('ControlOrMeta+a');
      await expect
        .poll(async () => (await selection(page)).sort())
        .toEqual([...hand].sort());
      // A press on bare felt puts them down.
      const felt = await zoneBox(page, 'opponent', 'bench');
      await page.mouse.click(felt.x + felt.width / 2, felt.y + felt.height / 2);
      await expectSelection(page, []);
    });

    test('x rebound to j picks with j, and x no longer does', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.addInitScript(() =>
        localStorage.setItem(
          'ptcgsim.hotkeys.v1',
          JSON.stringify({ 'select.toggle': 'j' })
        )
      );
      await openNamedSolo(page);
      const hand = await zoneCardIds(page, 'local', 'hand');
      await card(page, hand[0]!).hover({ force: true });
      await page.keyboard.press('x');
      await page.waitForTimeout(200);
      expect(await selection(page)).toEqual([]);
      await page.keyboard.press('j');
      await card(page, hand[1]!).hover({ force: true });
      await page.keyboard.press('j');
      await expectSelection(page, [hand[0]!, hand[1]!]);
    });

    test("a far-half rectangle takes the other seat's Pokémon: 2 puts 20 on each, 0 clears them", async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await openNamedSolo(page, { deck: POKEMON_DECK, other: POKEMON_DECK });
      const row = await bench(page, 'opponent', 3);
      // The far Bench, drawn from its empty end.
      const box = await zoneBox(page, 'opponent', 'bench');
      await sweep(
        page,
        { x: box.x + 4, y: box.y + 4 },
        { x: box.x + box.width - 3, y: box.y + box.height - 3 }
      );
      await expect
        .poll(async () => (await selection(page)).sort())
        .toEqual([...row].sort());
      await moved(page, () => page.keyboard.press('2'));
      await expect
        .poll(async () =>
          (await markers(page, 'damage'))
            .filter((marker) => row.includes(marker.cardId))
            .map((marker) => marker.value)
        )
        .toEqual(['20', '20', '20']);
      // Marks keep the selection: 0 clears all three.
      expect((await selection(page)).length).toBe(3);
      await moved(page, () => page.keyboard.press('0'));
      await expect
        .poll(async () => (await markers(page, 'damage')).length)
        .toBe(0);
    });

    test('Alt+z reveals the group in one line, z hides it; w marks each Pokémon', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openNamedSolo(page, { deck: POKEMON_DECK });
      const hand = await zoneCardIds(page, 'local', 'hand');
      const picked = hand.slice(0, 3);
      const names = await Promise.all(picked.map((id) => cardName(page, id)));
      await shiftClick(page, ...picked);
      await moved(page, () => page.keyboard.press('Alt+z'));
      const lines = await logLines(page);
      expect(
        lines.filter((line) => names.every((name) => line.includes(name))),
        lines.join('\n')
      ).toHaveLength(1);
      await moved(page, () => page.keyboard.press('z'));
      await page.keyboard.press('Escape');
      // Two on the Bench, then w on both.
      const row = await bench(page, 'local', 2);
      await shiftClick(page, ...row);
      await moved(page, () => page.keyboard.press('w'));
      await expect
        .poll(async () =>
          (await markers(page, 'abilityUsed'))
            .map((marker) => marker.cardId)
            .sort()
        )
        .toEqual([...row].sort());
    });

    test('keys for one card wait, and a group the table refuses keeps its selection', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openNamedSolo(page, { deck: POKEMON_DECK });
      const hand = await zoneCardIds(page, 'local', 'hand');
      await shiftClick(page, hand[0]!, hand[1]!);
      await page.keyboard.press('v');
      await expect(
        overlayToast(page, 'Select one card for that')
      ).toBeVisible();
      // Two Pokémon can't both be Active: refused, the selection stays.
      await page.keyboard.press('a');
      await expect(
        overlayToast(page, 'Only one Pokémon can be Active')
      ).toBeVisible();
      await expectSelection(page, [hand[0]!, hand[1]!]);
      expect(await zoneCardIds(page, 'local', 'hand')).toEqual(hand);
    });
  });
