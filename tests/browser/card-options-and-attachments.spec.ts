import { expect, test } from '@playwright/test';
import { ownRoomBudget } from './support/room-budget.js';
import { view, submit, revision } from './support/public-pile.js';
import { dismissWelcome } from './support/table-shell.js';

for (const device of [
  { width: 1440, height: 900, touch: false },
  { width: 820, height: 1024, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 844, height: 390, touch: true },
])
  test.describe(`${device.width} x ${device.height}`, () => {
    test.use({
      viewport: { width: device.width, height: device.height },
      hasTouch: device.touch,
    });
    test('opens options before artwork, keeps attachments compact and drags them as cards', async ({
      page,
      context,
    }) => {
      test.setTimeout(120_000);
      await ownRoomBudget(context);
      await page.goto('/?dev-room=1&room-mode=solo&name=Options');
      await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
      await dismissWelcome(page);
      await submit(page, {
        type: 'LoadDeck',
        entries: [
          {
            definition: {
              id: 'mon',
              name: 'Host Pokémon',
              category: 'Pokémon',
              imageUrl: '/v2/assets/cardback.png?host',
            },
            count: 3,
          },
          {
            definition: {
              id: 'basic',
              name: 'Psychic Energy',
              category: 'Energy',
              imageUrl: '/v2/assets/cardback.png?energy',
            },
            count: 9,
          },
          {
            definition: {
              id: 'special',
              name: 'Double Colorless Energy',
              category: 'Energy',
              imageUrl: '/v2/assets/cardback.png?special',
            },
            count: 1,
          },
          {
            definition: {
              id: 'tool',
              name: 'Tool attachment',
              category: 'Trainer',
              imageUrl: '/v2/assets/cardback.png?tool',
            },
            count: 2,
          },
        ],
      });
      await submit(page, { type: 'DrawCards', count: 15 });
      let current = await view(page);
      const me = current.playerOrder[0]!;
      const hand = Object.values(current.zones).find(
        (zone) => zone.ownerId === me && zone.kind === 'hand'
      )!;
      const known = hand.cards.flatMap((card) =>
        card.kind === 'known' ? [card] : []
      );
      const host = known.find(
        (card) =>
          current.definitions[card.definitionId]?.name === 'Host Pokémon'
      )!;
      await submit(page, {
        type: 'MoveCardToPlay',
        cardId: host.id,
        expectedSourceZoneId: hand.id,
        boardPlayerId: me,
        slot: 'active',
      });
      const hostNode = page.locator(
        `.ptcgsim-board-surface [data-card-id="${host.id}"]`
      );
      await expect(hostNode).toBeVisible();
      const before = (await hostNode.boundingBox())!;
      current = await view(page);
      const stackId = current.boards[me]!.activeStackId!;
      const attached = known.filter((card) => card.category !== 'Pokémon');
      for (const card of attached)
        await submit(page, {
          type: 'PlaceCardOnPlayStack',
          cardId: card.id,
          expectedSourceId: hand.id,
          targetStackId: stackId,
          expectedTargetTopCardId: host.id,
          mode: 'attachment',
        });
      const after = (await hostNode.boundingBox())!;
      expect(after.width).toBeGreaterThan(before.width * 0.95);
      expect(after.height).toBeGreaterThan(before.height * 0.95);
      const tokens = page.locator('[data-attachment-compact]');
      await expect(tokens.first()).toBeVisible();
      await expect(
        page.locator('[data-attachment-compact="energy"]').first()
      ).toBeVisible();
      await expect(
        page.locator('[data-attachment-compact="overflow"]')
      ).toBeVisible();
      // The +N handle opens the full list, never an arbitrary hidden card.
      const overflow = page.locator('[data-attachment-compact="overflow"]');
      const overflowRevision = await revision(page);
      await overflow.focus();
      await page.keyboard.press('x');
      await page.keyboard.press('Control+a');
      await expect(page.locator('[data-select-order]')).toHaveCount(0);
      await overflow.evaluate((element) => (element as HTMLElement).blur());
      await overflow.hover();
      await page.keyboard.press('x');
      await expect(page.locator('[data-select-order]')).toHaveCount(0);
      expect(await revision(page)).toBe(overflowRevision);
      await overflow.click();
      await expect(page.locator('[data-pokemon-window]')).toBeVisible();
      await expect(
        page.locator('[data-pokemon-window] [data-stack-preview-card-id]')
      ).toHaveCount(attached.length + 1);
      await page.locator('[data-pokemon-window-close]').click();
      // Carrying the whole Pokémon keeps its compact handles together with it.
      const hostBox = (await hostNode.boundingBox())!;
      await page.mouse.move(
        hostBox.x + hostBox.width / 2,
        hostBox.y + hostBox.height / 3
      );
      await page.mouse.down();
      await page.mouse.move(
        hostBox.x + hostBox.width / 2 + 20,
        hostBox.y + hostBox.height / 3 + 20,
        { steps: 5 }
      );
      await expect(
        page
          .locator(
            '[data-card-role="stackAttachment"][data-held="drag"][data-attachment-compact]'
          )
          .first()
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await hostNode.dblclick();
      const pokemon = page.locator('[data-pokemon-window]');
      await expect(pokemon).toBeVisible();
      await expect(pokemon.locator('[data-stack-preview-card-id]')).toHaveCount(
        attached.length + 1
      );
      await pokemon.locator('[data-pokemon-window-close]').click();
      const token = page.locator('[data-attachment-compact="energy"]').first();
      const tokenId = (await token.getAttribute('data-card-id'))!;
      const box = (await token.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + 18,
        box.y + box.height / 2 + 18,
        { steps: 5 }
      );
      await expect(
        page.locator(`[data-card-id="${tokenId}"][data-held="drag"]`).first()
      ).not.toHaveAttribute('data-attachment-compact');
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(
        page.locator(
          `[data-card-id="${tokenId}"][data-attachment-compact="energy"]`
        )
      ).toBeVisible();
      // Hand, prizes and Stadium all enter the same options window.
      const spare = known.filter(
        (card) =>
          current.definitions[card.definitionId]?.name === 'Host Pokémon' &&
          card.id !== host.id
      );
      const prize = Object.values(current.zones).find(
        (zone) => zone.ownerId === me && zone.kind === 'prizes'
      )!;
      await submit(page, {
        type: 'MoveCard',
        cardId: spare[0]!.id,
        expectedSourceZoneId: hand.id,
        destinationZoneId: prize.id,
      });
      for (const kind of ['hand', 'prizes'] as const) {
        current = await view(page);
        const zone = Object.values(current.zones).find(
          (zone) => zone.ownerId === me && zone.kind === kind
        )!;
        const card = zone.cards[0]!;
        const node = page.locator(
          `.ptcgsim-board-surface [data-card-id="${card.id}"]`
        );
        const oldRevision = await revision(page);
        await node.dblclick();
        const options = page.locator('[data-card-actions-window]');
        await expect(options).toBeVisible();
        expect(await revision(page)).toBe(oldRevision);
        if (kind === 'prizes')
          await expect(
            options.locator('[data-context-action="shufflePrizes"]')
          ).toBeVisible();
        await options.locator('[data-card-window-view]').click();
        const artwork = page.locator('[data-preview-kind="card"]');
        await expect(artwork).toBeVisible();
        await expect(
          artwork.getByRole('button', { name: 'Close card preview' })
        ).toHaveCount(0);
        await artwork.locator('.ptcgsim-card-preview-stage').click();
        await expect(options).toBeVisible();
        await options
          .getByRole('button', { name: 'Close', exact: true })
          .click();
      }
      await submit(page, {
        type: 'MoveCardToStadium',
        cardId: spare[1]!.id,
        expectedSourceId: hand.id,
        expectedStadiumCardId: null,
      });
      current = await view(page);
      const stadium = Object.values(current.zones).find(
        (zone) => zone.kind === 'stadium'
      )!;
      await page
        .locator(
          `.ptcgsim-board-surface [data-card-id="${stadium.cards[0]!.id}"]`
        )
        .dblclick();
      await expect(page.locator('[data-card-actions-window]')).toBeVisible();
      await expect(page.locator('[data-card-actions-window]')).toHaveCSS(
        'opacity',
        '1'
      );
      await page.screenshot({
        path: `/tmp/ptcg-card-options-${device.width}.png`,
      });
      const beforeBottom = await revision(page);
      await page
        .locator(
          '[data-card-actions-window] [data-card-destination="deck-bottom"]'
        )
        .click();
      await expect.poll(() => revision(page)).toBe(beforeBottom + 1);
      current = await view(page);
      const remainingPrize = Object.values(current.zones).find(
        (zone) => zone.kind === 'prizes' && zone.ownerId === me
      )!;
      await page
        .locator(
          `.ptcgsim-board-surface [data-card-id="${remainingPrize.cards[0]!.id}"]`
        )
        .dblclick();
      const beforeTop = await revision(page);
      await page
        .locator(
          '[data-card-actions-window] [data-card-destination="deck-top"]'
        )
        .click();
      await expect.poll(() => revision(page)).toBe(beforeTop + 1);
      current = await view(page);
      expect(
        Object.values(current.zones).find(
          (zone) => zone.kind === 'prizes' && zone.ownerId === me
        )!.cards
      ).toHaveLength(0);
      expect(
        Object.values(current.zones).find(
          (zone) => zone.kind === 'deck' && zone.ownerId === me
        )!.cards
      ).toHaveLength(2);
    });
  });
