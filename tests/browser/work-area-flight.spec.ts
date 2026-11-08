import { expect, test } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { revision, submit, view } from './support/public-pile.js';
import { useFlatTable } from './support/table-shell.js';

for (const mode of ['flat', 'tilted'] as const)
  test(`a turned attachment keeps its turn in the hand and a staged drop stays painted while waiting (${mode})`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90000);
    await ownRoomBudget(context);
    await page.setViewportSize({ width: 1440, height: 900 });
    if (mode === 'flat') await useFlatTable(page);
    let hold = false;
    let release: (() => void) | undefined;
    await page.routeWebSocket(/\/v2\/rooms\/[^/]+\/connect/u, (socket) => {
      const room = socket.connectToServer();
      socket.onMessage((message) => {
        const frame = JSON.parse(String(message)) as {
          type?: string;
          command?: { type?: string };
        };
        if (
          hold &&
          frame.type === 'Command' &&
          frame.command?.type === 'MoveCardToStadium'
        ) {
          release = () => room.send(message);
          return;
        }
        room.send(message);
      });
      room.onMessage((message) => socket.send(message));
    });
    await page.goto('/?dev-room=1&room-mode=solo&name=Pending%20flight');
    await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
    await submit(page, {
      type: 'LoadDeck',
      entries: [
        {
          definition: {
            id: 'mon',
            name: 'Host Pokémon',
            category: 'Pokémon',
            imageUrl: '/v2/assets/cardback.png?mon',
          },
          count: 2,
        },
        {
          definition: {
            id: 'energy',
            name: 'Basic Psychic Energy',
            category: 'Energy',
            imageUrl: '/v2/assets/cardback.png?energy',
          },
          count: 1,
        },
      ],
    });
    await submit(page, { type: 'DrawCards', count: 3 });
    let current = await view(page);
    const me = current.playerOrder[0]!;
    const hand = Object.values(current.zones).find(
      (zone) => zone.ownerId === me && zone.kind === 'hand'
    )!;
    const mon = hand.cards.find(
      (card) => card.kind === 'known' && card.category === 'Pokémon'
    )!;
    const energy = hand.cards.find(
      (card) => card.kind === 'known' && card.category === 'Energy'
    )!;
    await submit(page, {
      type: 'MoveCardToPlay',
      cardId: mon.id,
      expectedSourceZoneId: hand.id,
      boardPlayerId: me,
      slot: 'active',
    });
    current = await view(page);
    const stackId = current.boards[me]!.activeStackId!;
    await submit(page, {
      type: 'PlaceCardOnPlayStack',
      cardId: energy.id,
      expectedSourceId: hand.id,
      targetStackId: stackId,
      expectedTargetTopCardId: mon.id,
      mode: 'attachment',
    });
    const token = page.locator(
      `.ptcgsim-board-surface [data-card-id="${energy.id}"]`
    );
    await token.click();
    await page.keyboard.press('Alt+r');
    await expect
      .poll(
        async () =>
          (await view(page)).stacks[stackId]!.attachmentCards[0]!
            .orientationQuarterTurns
      )
      .toBe(1);
    await token.click({ trial: true });
    const start = (await token.boundingBox())!;
    await page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      start.x + start.width / 2 + 25,
      start.y + start.height / 2 + 25,
      { steps: 5 }
    );
    await expect(token).toHaveAttribute('data-held', 'drag');
    await expect(token).not.toHaveAttribute('data-attachment-compact');
    const carried = (await token.boundingBox())!;
    expect(carried.width).toBeGreaterThan(carried.height);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(token).toHaveAttribute('data-attachment-compact');

    await page
      .locator(`.ptcgsim-board-surface [data-card-id="${mon.id}"]`)
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Change type/ }).click();
    await page.getByRole('menuitem', { name: /Tool/ }).first().click();
    const area = page.locator('[data-legacy-work-area="staged"]');
    await expect(area).toBeVisible();
    const tile = area.locator('[data-work-area-card-id]').first();
    await tile.click({ trial: true });
    const from = (await tile.boundingBox())!;
    const stadium = page.locator(
      '.ptcgsim-board-surface [data-zone-kind="stadium"]'
    );
    const to = (await stadium.boundingBox())!;
    const before = await revision(page);
    hold = true;
    try {
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        from.x + from.width / 2 + 18,
        from.y + from.height / 2,
        { steps: 4 }
      );
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
        steps: 15,
      });
      await page.mouse.up();
      await expect.poll(() => release !== undefined).toBe(true);
      await expect(token).toHaveAttribute('data-held', 'settle');
      await expect(token).toBeVisible();
      await expect(area).toHaveAttribute(
        'data-work-area-dragging-card',
        energy.id
      );
      await page.waitForTimeout(200);
      expect(await revision(page)).toBe(before);
      await expect(token).toHaveAttribute('data-held', 'settle');
      await page.screenshot({
        path: `/tmp/ptcg-pending-work-area-${mode}.png`,
      });
    } finally {
      hold = false;
      release?.();
    }
    await expect.poll(() => revision(page)).toBe(before + 1);
    await expect(area).toHaveCount(0);
    await expect(page.locator('.ptcgsim-card[data-held="settle"]')).toHaveCount(
      0
    );
    await expect
      .poll(
        async () =>
          Object.values((await view(page)).zones).find(
            (zone) => zone.kind === 'stadium'
          )?.cards.length
      )
      .toBe(1);
  });
