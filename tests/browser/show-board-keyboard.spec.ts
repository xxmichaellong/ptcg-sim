import { expect, test } from '@playwright/test';
import type { MatchViewState } from '../../packages/game-core/src/index.js';
import type { WireGameCommand } from '../../packages/protocol/src/index.js';

import {
  fillPile,
  openPile,
  picked,
  preparePileContext,
  revision,
} from './support/public-pile.js';

test.beforeEach(async ({ context, page }) => {
  await preparePileContext(context, page);
});

test('Show board keeps keyboard focus on Back, then two Escapes return and close the pile', async ({
  page,
}) => {
  const { cardIds } = await fillPile(page, 'discard');
  const browser = await openPile(page, 'discard');
  await picked(page, cardIds[0]!).click();
  await expect(browser.locator('[data-card-action="pile-top"]')).toBeEnabled();
  const back = browser.locator('.ptcgsim-show-board-button');
  // Let entrance motion finish before measuring a stable toolbar position.
  await expect(browser).toHaveCSS('opacity', '1');
  const before = (await back.boundingBox())!;
  await back.click();
  await expect(back).toHaveText('Back to Discard pile');
  await expect
    .poll(async () => Math.abs((await back.boundingBox())!.y - before.y))
    .toBeLessThan(0.5);
  const after = (await back.boundingBox())!;
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.x + after.width).toBeCloseTo(before.x + before.width, 0);

  for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect(back).toBeFocused();
  }
  for (const target of [
    '[data-zone-close]',
    '[data-zone-action="zoom"]',
    '[data-overlay-card-id]',
    '[data-card-action="pile-top"]',
  ]) {
    // Native focus must reject the controls hidden by Show board, too.
    await browser
      .locator(target)
      .first()
      .evaluate((node: HTMLElement) => {
        node.focus();
      });
    await expect(back).toBeFocused();
  }

  await page.keyboard.press('Escape');
  await expect(browser).not.toHaveClass(/is-showing-board/);
  await expect(back).toBeFocused();
  // Restoring Board's tooltip must not consume the second Escape.
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await expect(browser).toHaveCount(0);
});

test('Show board removes work-area cards and bulk actions from the keyboard until Back', async ({
  page,
}) => {
  await fillPile(page, 'discard');
  // The room fixture loaded four cards. Undo the five later arrangement
  // commands, leaving them in Deck for the real keyboard inspection action.
  for (let count = 0; count < 5; count += 1) {
    const before = await revision(page);
    await page.locator('#undoButton').click();
    await expect.poll(() => revision(page)).toBe(before + 1);
  }
  await page
    .locator('.ptcgsim-board-surface')
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+3');
  const area = page.locator('[data-legacy-work-area="inspection"]');
  await expect(area.locator('[data-work-area-card-id]')).toHaveCount(3);
  await area.locator('[data-work-area-card-id]').first().click();
  const back = area.locator('.ptcgsim-show-board-button');
  await back.click();
  await expect(back).toHaveText('Back to Looking at cards');
  const before = await revision(page);
  const hiddenControls = area.locator(
    '[data-work-area-card-id], [data-work-area-action], .ptcgsim-card-actions button:not(:disabled)'
  );
  for (const control of await hiddenControls.all()) {
    await control.evaluate((node: HTMLElement) => node.focus());
    await expect(back).toBeFocused();
  }
  for (let count = 0; count < 8; count += 1) {
    await page.keyboard.press('Tab');
    const inHiddenControl = await page.evaluate(() =>
      Boolean(
        document.activeElement?.closest(
          '.is-showing-board .ptcgsim-legacy-work-area-cards, .is-showing-board .ptcgsim-legacy-work-area-buttons, .is-showing-board .ptcgsim-card-actions'
        )
      )
    );
    expect(inHiddenControl).toBe(false);
  }
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(area).not.toHaveClass(/is-showing-board/);
  await expect(area.locator('[data-work-area-card-id]')).toHaveCount(3);
  expect(await revision(page)).toBe(before);
  await area.locator('[data-work-area-action="toHand"]').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => revision(page)).toBe(before + 1);
  await expect(area).toHaveCount(0);
});

interface DevRoomWindow extends Window {
  readonly __ptcgsimDevRoom?: {
    readonly runtime: {
      readonly session: {
        getSnapshot(): { readonly view: MatchViewState | null };
        submit(command: WireGameCommand): { readonly queued: boolean };
      };
    };
  };
}

test('an attached-card window takes back the move that opened it: U from its buttons, and its own Undo', async ({
  page,
}) => {
  const current = () =>
    page.evaluate(() => {
      const view = (
        window as DevRoomWindow
      ).__ptcgsimDevRoom?.runtime.session.getSnapshot().view;
      if (!view) throw new Error('Missing real room projection');
      return view;
    });
  const arrange = async (command: WireGameCommand) => {
    const before = await revision(page);
    await page.evaluate((command) => {
      (window as DevRoomWindow).__ptcgsimDevRoom?.runtime.session.submit(
        command
      );
    }, command);
    await expect.poll(() => revision(page)).toBe(before + 1);
  };
  await page.goto('/?dev-room=1&room-mode=solo&name=Attached');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  await arrange({
    type: 'LoadDeck',
    entries: [
      {
        definition: {
          id: 'mon',
          name: 'Mon',
          category: 'Pokémon',
          imageUrl: '/v2/assets/cardback.png?mon',
        },
        count: 3,
      },
      {
        definition: {
          id: 'energy',
          name: 'Energy',
          category: 'Energy',
          imageUrl: '/v2/assets/cardback.png?energy',
        },
        count: 2,
      },
    ],
  });
  await arrange({ type: 'DrawCards', count: 5 });
  let view = await current();
  const me = view.playerOrder[0]!;
  const hand = Object.values(view.zones).find(
    (zone) => zone.ownerId === me && zone.kind === 'hand'
  )!;
  const known = hand.cards.flatMap((card) =>
    card.kind === 'known' ? [card] : []
  );
  const mon = known.find((card) => card.category === 'Pokémon')!.id;
  const energy = known.find((card) => card.category === 'Energy')!.id;
  await arrange({
    type: 'MoveCardToPlay',
    cardId: mon,
    expectedSourceZoneId: hand.id,
    boardPlayerId: me,
    slot: 'active',
  });
  view = await current();
  await arrange({
    type: 'PlaceCardOnPlayStack',
    cardId: energy,
    expectedSourceId: hand.id,
    targetStackId: view.boards[me]!.activeStackId!,
    expectedTargetTopCardId: mon,
    mode: 'attachment',
  });
  const area = page.locator('[data-legacy-work-area="staged"]');
  // Changed into a Tool, the Pokémon leaves its Energy waiting in the
  // window, which lies over the rail's Undo and stays through Escape.
  const toTool = async () => {
    await page
      .locator(`.ptcgsim-board-surface [data-card-id="${mon}"]`)
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Change type/ }).click();
    await page.getByRole('menuitem', { name: /Tool/ }).first().click();
    await expect(area).toHaveCount(1);
  };
  await toTool();
  const toHand = area.locator('[data-work-area-action="toHand"]');
  await toHand.focus();
  await page.keyboard.press('Escape');
  await expect(area).toHaveCount(1);
  let before = await revision(page);
  await page.keyboard.press('u');
  await expect.poll(() => revision(page)).toBe(before + 1);
  await expect(area).toHaveCount(0);

  await toTool();
  before = await revision(page);
  await area.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => revision(page)).toBe(before + 1);
  await expect(area).toHaveCount(0);
});
