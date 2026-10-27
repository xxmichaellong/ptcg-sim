import { expect, test } from '@playwright/test';
import type { WireGameCommand } from '../../packages/protocol/src/index.js';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import { ownRoomBudget } from './support/room-budget.js';
import { openDeck, useFlatTable } from './support/table-shell.js';

test('Hide then Hand keeps the same physical card while both actions await authority', async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  await ownRoomBudget(context);
  await useFlatTable(page);
  await routeCardCatalog(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const commands: WireGameCommand[] = [];
  const results: boolean[] = [];
  const held: (() => void)[] = [];
  let holding = false;
  await page.routeWebSocket(/\/v2\/rooms\//u, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message)) as {
        type: string;
        command?: WireGameCommand;
      };
      if (frame.type === 'Command' && frame.command)
        commands.push(frame.command);
      server.send(message);
    });
    server.onMessage((message) => {
      const deliver = () => {
        const frame = JSON.parse(String(message)) as {
          type: string;
          accepted?: boolean;
        };
        if (frame.type === 'CommandResult')
          results.push(frame.accepted === true);
        socket.send(message);
      };
      if (holding) held.push(deliver);
      else deliver();
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const zone = (kind: string) =>
    page.evaluate((kind) => {
      const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
      const target = scene?.zones.find(
        (zone) => zone.kind === kind && zone.side === 'local'
      );
      return {
        revision: scene?.revision ?? -1,
        id: target?.id,
        cards:
          scene?.cards.filter((card) => card.parentId === target?.id) ?? [],
      };
    }, kind);
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'queued-visibility.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'QTY,Name,Type,URL\n3,Queued Pokémon,Pokémon,/v2/assets/cardback.png?queued-visibility'
    ),
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await page.locator('#setupButton').click();
  await expect.poll(async () => (await zone('hand')).cards.length).toBe(3);
  const hand = await zone('hand');
  await page.locator(`[data-card-id="${hand.cards[0]!.id}"]`).click();
  await page.keyboard.press(' ');
  await expect.poll(async () => (await zone('board')).cards.length).toBe(1);
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-board-motion',
    'idle'
  );
  const board = await zone('board');
  const original = board.cards[0]!;
  await page.locator(`[data-card-id="${original.id}"]`).click();
  const sentBefore = commands.length;
  const resultsBefore = results.length;
  holding = true;
  try {
    await page.keyboard.press('z');
    await expect.poll(() => commands.length).toBe(sentBefore + 1);
    expect(commands.at(-1)).toMatchObject({
      type: 'SetPublicReveal',
      cardId: original.id,
      revealed: false,
    });
    await page.keyboard.press('h');
    // A real queued keyboard action predicts the return while the first
    // command's publication/result are still withheld.
    await expect.poll(async () => (await zone('hand')).cards.length).toBe(3);
    await expect.poll(async () => (await zone('board')).cards.length).toBe(0);
    expect(commands).toHaveLength(sentBefore + 1);
    holding = false;
    for (const deliver of held.splice(0)) deliver();
    await expect.poll(() => results.slice(resultsBefore)).toEqual([true, true]);
    await expect
      .poll(async () => (await zone('hand')).revision)
      .toBe(board.revision + 2);
    const moved = commands.at(-1);
    expect(moved?.type).toBe('MoveCard');
    if (moved?.type !== 'MoveCard') throw new Error('Missing queued hand move');
    expect(moved.cardId).not.toBe(original.id);
    expect(moved.expectedSourceZoneId).toBe(board.id);
    expect(moved.destinationZoneId).toBe(hand.id);
    expect((await zone('hand')).cards).toHaveLength(3);
    expect((await zone('board')).cards).toHaveLength(0);
    expect(errors).toEqual([]);
  } finally {
    holding = false;
    for (const deliver of held.splice(0)) deliver();
  }
});
