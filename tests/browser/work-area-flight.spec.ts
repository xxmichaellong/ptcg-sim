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

for (const mode of ['flat', 'tilted'] as const)
  for (const count of [20, 5])
    test(`${count === 20 ? 'an overflow attachment' : 'a turned host attachment'} stays at its drop with its mark while the room is waiting (${mode})`, async ({
      page,
      context,
    }) => {
      test.setTimeout(120000);
      await ownRoomBudget(context);
      if (mode === 'flat') await useFlatTable(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      let hold = false,
        release: (() => void) | undefined;
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
      await page.goto('/?dev-room=1&room-mode=solo&name=Overflow%20flight');
      await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
      await submit(page, {
        type: 'LoadDeck',
        entries: [
          {
            definition: {
              id: 'host',
              name: 'Overflow host',
              category: 'Pokémon',
              imageUrl: '/v2/assets/cardback.png?host',
            },
            count: 1,
          },
          {
            definition: {
              id: 'energy',
              name: 'Basic Psychic Energy',
              category: 'Energy',
              imageUrl: '/v2/assets/cardback.png?energy',
            },
            count,
          },
        ],
      });
      await submit(page, { type: 'DrawCards', count: count + 1 });
      let current = await view(page);
      const me = current.playerOrder[0]!,
        hand = Object.values(current.zones).find(
          (zone) => zone.ownerId === me && zone.kind === 'hand'
        )!;
      const mon = hand.cards.find(
        (card) => card.kind === 'known' && card.category === 'Pokémon'
      )!;
      const energies = hand.cards.filter(
        (card) => card.kind === 'known' && card.category === 'Energy'
      );
      await submit(page, {
        type: 'MoveCardToPlay',
        cardId: mon.id,
        expectedSourceZoneId: hand.id,
        boardPlayerId: me,
        slot: 'active',
      });
      current = await view(page);
      const stackId = current.boards[me]!.activeStackId!;
      if (count === 5)
        await submit(page, {
          type: 'RotateStack',
          stackId,
          rotationQuarterTurns: 1,
        });
      for (const energy of energies)
        await submit(page, {
          type: 'PlaceCardOnPlayStack',
          cardId: energy.id,
          expectedSourceId: hand.id,
          targetStackId: stackId,
          expectedTargetTopCardId: mon.id,
          mode: 'attachment',
        });
      const energy = energies.at(-1)!;
      await submit(page, {
        type: 'SetCardAbilityUsed',
        cardId: energy.id,
        used: true,
      });
      const token = page.locator(
        `.ptcgsim-board-surface [data-card-id="${energy.id}"]`
      );
      const mark = page.locator(
        `.ptcgsim-board-surface [data-marker-id="${energy.id}:abilityUsed"]`
      );
      if (count === 20) {
        await expect(token).toHaveCount(0);
        await expect(mark).toHaveCount(0);
        await page.locator('[data-attachment-compact="overflow"]').click();
      } else {
        await expect(token).toHaveAttribute(
          'data-attachment-compact',
          'energy'
        );
        await expect(mark).toBeVisible();
        const host = page.locator(
          `.ptcgsim-board-surface [data-card-id="${mon.id}"]`
        );
        await host.hover();
        await host.click({ trial: true });
        await host.dblclick();
      }
      const pokemon = page.locator('[data-pokemon-window]');
      const tile = pokemon.locator(
        `[data-stack-preview-card-id="${energy.id}"]`
      );
      await tile.scrollIntoViewIfNeeded();
      const before = await revision(page),
        from = (await tile.boundingBox())!;
      const to = (await page
        .locator('[data-zone-kind="stadium"]')
        .boundingBox())!;
      hold = true;
      try {
        await page.mouse.move(
          from.x + from.width / 2,
          from.y + from.height / 2
        );
        await page.mouse.down();
        await page.mouse.move(
          from.x + from.width / 2 + 20,
          from.y + from.height / 2,
          { steps: 4 }
        );
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
          steps: 15,
        });
        await page.mouse.up();
        await expect.poll(() => release !== undefined).toBe(true);
        await expect(token).toHaveAttribute('data-held', 'settle');
        await expect(mark).toBeVisible();
        // The Pokémon options window has finished its job once the card is dropped.
        await expect(pokemon).toHaveCount(0);
        await page.waitForTimeout(200);
        expect(await revision(page)).toBe(before);
        await expect(token).toHaveAttribute('data-held', 'settle');
        const cardBox = (await token.boundingBox())!,
          markerBox = (await mark.boundingBox())!;
        expect(markerBox.x + markerBox.width / 2).toBeGreaterThanOrEqual(
          cardBox.x
        );
        expect(markerBox.x + markerBox.width / 2).toBeLessThanOrEqual(
          cardBox.x + cardBox.width
        );
        expect(markerBox.y + markerBox.height / 2).toBeGreaterThanOrEqual(
          cardBox.y
        );
        expect(markerBox.y + markerBox.height / 2).toBeLessThanOrEqual(
          cardBox.y + cardBox.height
        );
        const paint = await mark.evaluate((node) => {
          const marker = node as HTMLElement;
          const r = marker.getBoundingClientRect();
          const cards = [
            ...document.querySelectorAll<HTMLElement>(
              '.ptcgsim-card[data-held="settle"], .ptcgsim-card[data-lift-copy]'
            ),
          ];
          const targets = [marker, ...cards];
          const styles = targets.map((el) => el.getAttribute('style'));
          for (const el of targets)
            el.style.setProperty('pointer-events', 'auto', 'important');
          const stack = document.elementsFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2
          );
          const markerIndex = stack.findIndex((el) => marker.contains(el));
          const cardIndex = stack.findIndex((el) =>
            cards.some((card) => card.contains(el))
          );
          const result = {
            above:
              markerIndex >= 0 && (cardIndex < 0 || markerIndex < cardIndex),
            markerZ: getComputedStyle(marker).zIndex,
            cards: cards.map((card) => ({
              z: getComputedStyle(card).zIndex,
              lifted: card.hasAttribute('data-lifted'),
              copy: card.hasAttribute('data-lift-copy'),
            })),
          };
          targets.forEach((el, i) =>
            styles[i] === null
              ? el.removeAttribute('style')
              : el.setAttribute('style', styles[i]!)
          );
          return result;
        });
        expect(paint.above, JSON.stringify(paint)).toBe(true);
        await page.screenshot({
          path: `/tmp/ptcg-pending-${count === 20 ? 'overflow' : 'turned-host'}-${mode}.png`,
        });
      } finally {
        hold = false;
        release?.();
      }
      await expect.poll(() => revision(page)).toBe(before + 1);
      await expect(
        page.locator('.ptcgsim-card[data-held="settle"]')
      ).toHaveCount(0);
      await expect(token).toHaveAttribute('data-card-role', 'zone');
    });
