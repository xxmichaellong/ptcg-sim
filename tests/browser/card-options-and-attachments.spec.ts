import { expect, test } from '@playwright/test';
import { ownRoomBudget } from './support/room-budget.js';
import { view, submit, revision } from './support/public-pile.js';
import {
  dismissWelcome,
  chooseMoreAction,
  openSettings,
  closeSheet,
} from './support/table-shell.js';

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
      // The far seat follows the same viewing preference, including while held.
      const facing = page.locator(
        `.ptcgsim-board-surface [data-card-id="${attached[0]!.id}"]`
      );
      const horizontalAxis = () =>
        facing.evaluate(
          (node) => new DOMMatrix(getComputedStyle(node).transform).m11
        );
      await chooseMoreAction(page, 'flipBoardButton');
      await expect(facing).toHaveAttribute('data-card-side', 'opponent');
      await expect.poll(horizontalAxis).toBeLessThan(0);
      await openSettings(page, 'cards');
      await page.locator('#opponentUprightCheckbox').check();
      await closeSheet(page);
      await expect.poll(horizontalAxis).toBeGreaterThan(0);
      await facing.click({ trial: true });
      const farBox = (await facing.boundingBox())!;
      await page.mouse.move(
        farBox.x + farBox.width / 2,
        farBox.y + farBox.height / 2
      );
      await page.mouse.down();
      await page.mouse.move(
        farBox.x + farBox.width / 2 + 18,
        farBox.y + farBox.height / 2 + 18,
        { steps: 5 }
      );
      await expect(facing).toHaveAttribute('data-held', 'drag');
      await expect(facing).not.toHaveAttribute('data-attachment-compact');
      await expect.poll(horizontalAxis).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(facing).toHaveAttribute('data-attachment-compact');
      await openSettings(page, 'cards');
      await page.locator('#opponentUprightCheckbox').uncheck();
      await closeSheet(page);
      await chooseMoreAction(page, 'flipBoardButton');
      await expect(facing).toHaveAttribute('data-card-side', 'local');
      await expect.poll(horizontalAxis).toBeGreaterThan(0);
      await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
        'data-board-motion',
        'idle'
      );
      await hostNode.click({ trial: true });
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
    test('paired Stadium options move the requested half after viewing its artwork', async ({
      page,
      context,
    }) => {
      await ownRoomBudget(context);
      await page.goto('/?dev-room=1&room-mode=solo&name=Stadium%20pieces');
      await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
      await dismissWelcome(page);
      for (const destination of ['hand', 'discard'] as const) {
        await submit(page, {
          type: 'LoadDeck',
          entries: [
            ...([0, 1] as const).map((part) => ({
              count: 1,
              definition: {
                id: `stadium-piece-${part}`,
                name: 'Paired Stadium',
                category: 'Trainer' as const,
                imageUrl: `/v2/assets/cardback.png?stadium-${part}`,
                presentation: {
                  readingQuarterTurns: 0 as const,
                  join: {
                    key: 'stadium-pair',
                    columns: 2 as const,
                    rows: 1 as const,
                    part,
                  },
                },
              },
            })),
            {
              count: 1,
              definition: {
                id: 'played-card',
                name: 'Played card',
                category: 'Trainer' as const,
                imageUrl: '/v2/assets/cardback.png?played',
              },
            },
          ],
        });
        await submit(page, { type: 'DrawCards', count: 3 });
        let current = await view(page);
        const me = current.playerOrder[0]!,
          hand = Object.values(current.zones).find(
            (zone) => zone.ownerId === me && zone.kind === 'hand'
          )!;
        for (const card of hand.cards) {
          if (
            card.kind === 'known' &&
            !current.definitions[card.definitionId]?.presentation?.join
          ) {
            await submit(page, {
              type: 'MoveCard',
              cardId: card.id,
              expectedSourceZoneId: hand.id,
              destinationZoneId: Object.values(current.zones).find(
                (zone) => zone.ownerId === me && zone.kind === 'discard'
              )!.id,
            });
            continue;
          }
          const occupants = Object.values((await view(page)).zones)
            .find((zone) => zone.kind === 'stadium')!
            .cards.map((card) => card.id);
          await submit(page, {
            type: 'MoveCardToStadium',
            cardId: card.id,
            expectedSourceId: hand.id,
            expectedStadiumCardId: occupants[0] ?? null,
            expectedStadiumCardIds: occupants,
            ...(occupants.length ? { placement: 'add' as const } : {}),
          });
        }
        current = await view(page);
        const stadium = Object.values(current.zones).find(
          (zone) => zone.kind === 'stadium'
        )!;
        expect(stadium.cards).toHaveLength(2);
        const right = stadium.cards.find(
          (card) =>
            card.kind === 'known' &&
            current.definitions[card.definitionId]?.presentation?.join?.part ===
              1
        )!;
        const left = stadium.cards.find((card) => card.id !== right.id)!;
        const node = page.locator(
          `.ptcgsim-board-surface [data-card-id="${right.id}"]`
        );
        await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
          'data-board-motion',
          'idle'
        );
        // The seam toolbar can cross the centre on a phone. Press a visible
        // part of the piece, as a player does, without forcing through it.
        const point = await node.evaluate((element) => {
          const box = element.getBoundingClientRect();
          for (const fy of [0.85, 0.15, 0.5])
            for (const fx of [0.5, 0.2, 0.8]) {
              const x = box.x + box.width * fx,
                y = box.y + box.height * fy;
              if (element.contains(document.elementFromPoint(x, y)))
                return { x, y };
            }
          return null;
        });
        expect(point).not.toBeNull();
        await page.screenshot({
          path: `/tmp/ptcg-paired-stadium-table-${device.width}.png`,
        });
        await page.mouse.move(point!.x, point!.y);
        await page.mouse.dblclick(point!.x, point!.y);
        const options = page.locator('[data-card-actions-window]');
        await expect(options).toBeVisible();
        await expect(options.locator('[data-motion-origin]')).toHaveAttribute(
          'data-motion-origin',
          right.id
        );
        await options.locator('.card-window__card').click();
        await expect(options).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(options).toBeVisible();
        const move = options.locator(
          `[data-card-destination="${destination}"]`
        );
        if (device.touch) await move.tap();
        else await move.click();
        await expect(options).toHaveCount(0);
        await expect
          .poll(async () =>
            Object.values((await view(page)).zones)
              .find((zone) => zone.kind === 'stadium')!
              .cards.map((card) => card.id)
          )
          .toEqual([left.id]);
        current = await view(page);
        expect(
          Object.values(current.zones)
            .find((zone) => zone.ownerId === me && zone.kind === destination)!
            .cards.some(
              (card) =>
                card.kind === 'known' &&
                current.definitions[card.definitionId]?.presentation?.join
                  ?.part === 1
            )
        ).toBe(true);
      }
    });
    test('extra deck moves put the card options away, including a shuffle into an empty deck', async ({
      page,
      context,
    }) => {
      await ownRoomBudget(context);
      await page.goto('/?dev-room=1&room-mode=solo&name=Extra%20moves');
      await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
      await dismissWelcome(page);
      for (const destination of ['deckSwitch', 'deckShuffle'] as const) {
        await submit(page, {
          type: 'LoadDeck',
          entries: [
            {
              count: destination === 'deckSwitch' ? 2 : 1,
              definition: {
                id: 'move-test',
                name: 'Move card',
                category: 'Trainer',
                imageUrl: '/v2/assets/cardback.png?move',
              },
            },
          ],
        });
        await submit(page, { type: 'DrawCards', count: 1 });
        const current = await view(page),
          me = current.playerOrder[0]!;
        const hand = Object.values(current.zones).find(
          (zone) => zone.kind === 'hand' && zone.ownerId === me
        )!;
        const node = page.locator(
          `.ptcgsim-board-surface [data-card-id="${hand.cards[0]!.id}"]`
        );
        await node.click({ trial: true });
        await node.dblclick();
        const options = page.locator('[data-card-actions-window]');
        await expect(options).toBeVisible();
        const button = options.locator(
            `[data-card-destination="${destination}"]`
          ),
          before = await revision(page);
        if (device.touch) await button.tap();
        else await button.click();
        await expect(options).toHaveCount(0);
        await expect.poll(() => revision(page)).toBeGreaterThan(before);
        const next = await view(page);
        expect(
          Object.values(next.zones).find(
            (zone) => zone.kind === 'deck' && zone.ownerId === me
          )!.cards
        ).toHaveLength(1);
        expect(
          Object.values(next.zones).find(
            (zone) => zone.kind === 'hand' && zone.ownerId === me
          )!.cards
        ).toHaveLength(destination === 'deckSwitch' ? 1 : 0);
      }
    });
  });
