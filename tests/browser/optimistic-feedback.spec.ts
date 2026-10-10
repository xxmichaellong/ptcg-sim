import { expect, test, type Page } from '@playwright/test';

/**
 * The table answers a player's action before the room does. Every message
 * from the room is held back while the actions below are taken, as if the
 * connection had stalled, so anything that waits for the room would not
 * appear at all. Releasing the messages must then leave the table where the
 * predictions put it.
 */

const FACE_URL = '/v2/assets/cardback.png?optimistic=face';

const deckCsv = (): Buffer =>
  Buffer.from(
    [
      'QTY,Name,Type,URL',
      `20,Optimistic Pokemon,Pokémon,${FACE_URL}`,
      `20,Optimistic Trainer,Trainer,${FACE_URL}`,
      `20,Optimistic Energy,Energy,${FACE_URL}`,
    ].join('\n')
  );

/** Wraps the page's WebSocket so incoming frames can be held and released. */
const installServerHold = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const NativeWebSocket = globalThis.WebSocket;
    const held: (() => void)[] = [];
    const control = {
      holding: false,
      release: () => {
        control.holding = false;
        for (const deliver of held.splice(0)) deliver();
      },
      heldCount: () => held.length,
    };
    (globalThis as unknown as { __serverHold: typeof control }).__serverHold =
      control;
    class HoldingWebSocket extends NativeWebSocket {
      override addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions
      ): void {
        if (type !== 'message' || !listener) {
          EventTarget.prototype.addEventListener.call(
            this,
            type,
            listener,
            options
          );
          return;
        }
        const call = (event: Event) =>
          typeof listener === 'function'
            ? listener.call(this, event)
            : listener.handleEvent(event);
        super.addEventListener(
          'message',
          (event) => {
            if (control.holding) held.push(() => call(event));
            else call(event);
          },
          options
        );
      }
    }
    globalThis.WebSocket = HoldingWebSocket as typeof WebSocket;
  });
};

const zoneCount = (page: Page, kind: string, side: 'local' | 'shared') =>
  page.evaluate(
    ([kind, side]) =>
      window.__PTCG_RENDERER_SPIKE__?.scene.zones.find(
        (zone) =>
          zone.kind === kind && (side === 'shared' || zone.side === side)
      )?.count ?? -1,
    [kind, side] as const
  );

const firstHandCard = (page: Page) =>
  page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    const hand = scene?.zones.find(
      (zone) => zone.kind === 'hand' && zone.side === 'local'
    );
    return (
      scene?.cards
        .filter((card) => card.parentId === hand?.id)
        .sort((left, right) => left.bounds.x - right.bounds.x)[0]?.id ?? null
    );
  });

test('the table answers actions while the room is silent, and keeps them when it replies', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installServerHold(page);
  await page.goto('/?room-lobby=1&renderer=dom');
  await page.locator('#nameInput').fill('Blue');
  await page.locator('#p1Button').click();
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  await expect(page.locator('#setupBothButton')).toBeEnabled();
  await page.locator('#deckImportButton').click();
  await expect(page.locator('#nativeDeckBuilderWorkspace')).toBeVisible();
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'optimistic.csv',
    mimeType: 'text/csv',
    buffer: deckCsv(),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toContainText(
    'Total: 60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(page.locator('#p1Box')).toBeVisible();
  await page.locator('#setupButton').click();
  await expect.poll(() => zoneCount(page, 'hand', 'local')).toBe(7);

  const revision = await page
    .locator('.ptcgsim-board-surface')
    .getAttribute('data-revision');
  await page.evaluate(() => {
    (
      globalThis as unknown as { __serverHold: { holding: boolean } }
    ).__serverHold.holding = true;
  });
  // Quick enough that only a prediction can satisfy it.
  const instant = { timeout: 250 };

  const gx = page.locator(
    '[data-player-side="local"][data-once-per-game-marker="gx"]'
  );
  await gx.click();
  await expect(gx).toHaveAttribute('aria-pressed', 'true', instant);

  const stadiumCard = await firstHandCard(page);
  await page.locator(`[data-card-id="${stadiumCard}"]`).click();
  await page.keyboard.press('g');
  await expect
    .poll(() => zoneCount(page, 'stadium', 'shared'), instant)
    .toBe(1);

  const boardCard = await firstHandCard(page);
  await page.locator(`[data-card-id="${boardCard}"]`).click();
  await page.keyboard.press(' ');
  await expect.poll(() => zoneCount(page, 'board', 'local'), instant).toBe(1);

  // The sidebar's Attack button submits outside the board; it clears the
  // loose board into the discard all the same.
  const discardBefore = await zoneCount(page, 'discard', 'local');
  await page.locator('#attackButton').click();
  await expect.poll(() => zoneCount(page, 'board', 'local'), instant).toBe(0);
  expect(await zoneCount(page, 'discard', 'local')).toBe(discardBefore + 1);

  await page
    .locator('.ptcgsim-board-surface')
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+3');
  await expect(
    page.locator('[data-legacy-work-area="inspection"]')
  ).toBeVisible(instant);

  // Nothing above came from the room.
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    revision!
  );
  expect(
    await page.evaluate(
      () =>
        (
          globalThis as unknown as { __serverHold: { heldCount(): number } }
        ).__serverHold.heldCount() > 0
    )
  ).toBe(true);

  const predicted = {
    hand: await zoneCount(page, 'hand', 'local'),
    stadium: await zoneCount(page, 'stadium', 'shared'),
    board: await zoneCount(page, 'board', 'local'),
    discard: await zoneCount(page, 'discard', 'local'),
  };
  await page.evaluate(() =>
    (
      globalThis as unknown as { __serverHold: { release(): void } }
    ).__serverHold.release()
  );
  await expect
    .poll(async () =>
      Number(
        await page
          .locator('.ptcgsim-board-surface')
          .getAttribute('data-revision')
      )
    )
    .toBe(Number(revision) + 5);
  expect({
    hand: await zoneCount(page, 'hand', 'local'),
    stadium: await zoneCount(page, 'stadium', 'shared'),
    board: await zoneCount(page, 'board', 'local'),
    discard: await zoneCount(page, 'discard', 'local'),
  }).toEqual(predicted);
  await expect(gx).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('[data-legacy-work-area="inspection"]')
  ).toBeVisible();
});
