import { expect, test, type Page } from '@playwright/test';

import { closeSheet, openDeck } from './support/table-shell.js';

/**
 * Undo animates only what the move taken back changed. The authority keeps
 * the alias of every card that move left in the same visibility generation
 * (identitiesSurvivingUndo), so taking back a draw re-keys the one card that
 * goes back to the deck and the rest of the table stays exactly where it is:
 * no card is re-dealt, no element remounts and no pile riffles. Taking back a
 * shuffle riffles that deck again and touches nothing else.
 */

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

interface SceneCard {
  readonly id: string;
  readonly parentId: string;
  readonly side: string;
}

const sceneCards = (page: Page): Promise<readonly SceneCard[]> =>
  page.evaluate(() =>
    window.__PTCG_RENDERER_SPIKE__!.scene.cards.map((card) => ({
      id: String(card.id),
      parentId: card.parentId,
      side: card.side,
    }))
  );

const zoneCount = (page: Page, kind: string) =>
  page.evaluate(
    (kind) =>
      window.__PTCG_RENDERER_SPIKE__?.scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === kind
      )?.count,
    kind
  );

const idle = async (page: Page, renderer: string): Promise<void> => {
  await expect(
    page.locator(
      renderer === 'dom'
        ? '.ptcgsim-board-surface[data-motion="idle"]'
        : 'canvas[data-motion="idle"]'
    )
  ).toBeAttached();
};

const startTable = async (page: Page, renderer: string): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?room-lobby=1&renderer=${renderer}`);
  await page.locator('#nameInput').fill('Undo review');
  // Putting Play online away goes to the Solo table.
  await closeSheet(page);
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'undo.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        '30,Ember ex,Pokémon,/v2/assets/cardback.png?ember',
        '20,Iono,Trainer,/v2/assets/cardback.png?iono',
        '10,Fire Energy,Energy,/v2/assets/cardback.png?energy',
      ].join('\n')
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await page.locator('#setupButton').click();
  await expect.poll(() => zoneCount(page, 'hand')).toBe(7);
  await page.mouse.move(2, 450);
  await idle(page, renderer);
};

/**
 * Watches the painted table through one change: which card elements were
 * replaced rather than kept, which flew, and how many ghosts (a riffle, a
 * card leaving) the motion painted.
 */
const watchTable = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('.ptcgsim-board-surface')!;
    const nodes = new Map(
      [
        ...root.querySelectorAll<HTMLElement>('.ptcgsim-card[data-card-id]'),
      ].map((element) => [element.dataset['cardId']!, element])
    );
    const flying = new Set<string>();
    let ghosts = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'childList') {
          for (const node of record.addedNodes) {
            if (
              node instanceof HTMLElement &&
              node.parentElement?.closest('.ptcgsim-ghost-layer')
            )
              ghosts += 1;
          }
        } else if (
          record.target instanceof HTMLElement &&
          record.target.hasAttribute('data-flying')
        ) {
          flying.add(record.target.dataset['cardId'] ?? '');
        }
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-flying'],
    });
    window.__undoMotionWatch = () => {
      observer.disconnect();
      const remounted = [
        ...root.querySelectorAll<HTMLElement>('.ptcgsim-card[data-card-id]'),
      ].filter((element) => {
        const before = nodes.get(element.dataset['cardId']!);
        return before !== undefined && before !== element;
      }).length;
      return { remounted, flying: [...flying], ghosts };
    };
  });

const finishWatch = (page: Page) =>
  page.evaluate(() => window.__undoMotionWatch!());

declare global {
  interface Window {
    __undoMotionWatch?: () => {
      readonly remounted: number;
      readonly flying: readonly string[];
      readonly ghosts: number;
    };
  }
}

for (const renderer of ['dom', 'pixi'] as const) {
  test(`${renderer}: taking back a draw moves only the drawn card and the hand around it`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await startTable(page, renderer);
    const beforeDraw = await sceneCards(page);
    await page.keyboard.press('1');
    await expect.poll(() => zoneCount(page, 'hand')).toBe(8);
    await idle(page, renderer);
    const drawn = await sceneCards(page);
    if (renderer === 'dom') await watchTable(page);

    await page.keyboard.press('u');
    await expect.poll(() => zoneCount(page, 'hand')).toBe(7);
    await idle(page, renderer);
    const restored = await sceneCards(page);

    // One card changed identity: the drawn card, back on the deck under an
    // alias neither the draw nor the table before it ever showed.
    const drawnIds = new Set(drawn.map((card) => card.id));
    const beforeIds = new Set(beforeDraw.map((card) => card.id));
    const rekeyed = restored.filter((card) => !drawnIds.has(card.id));
    expect(rekeyed).toHaveLength(1);
    expect(rekeyed[0]!.parentId).toMatch(/:deck$/u);
    expect(beforeIds.has(rekeyed[0]!.id)).toBe(false);
    // Everything else -- both decks, the prizes, the opponent, the hand --
    // is the very card it was before the draw.
    expect(restored.filter((card) => card.id !== rekeyed[0]!.id)).toEqual(
      beforeDraw.filter((card) => drawnIds.has(card.id))
    );

    if (renderer === 'dom') {
      const watched = await finishWatch(page);
      expect(watched.remounted).toBe(0);
      // No pile riffles; only the hand closing up and the card going home
      // move.
      expect(watched.ghosts).toBe(0);
      const moving = new Map(restored.map((card) => [card.id, card]));
      for (const id of watched.flying) {
        const card = moving.get(id);
        expect(card?.side, id).toBe('local');
        expect(card?.parentId, id).toMatch(/:(hand|deck)$/u);
      }
    }
  });

  test(`${renderer}: taking back a shuffle riffles that deck and touches nothing else`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await startTable(page, renderer);
    await page.keyboard.press('s');
    await idle(page, renderer);
    const shuffled = await sceneCards(page);
    if (renderer === 'dom') await watchTable(page);

    await page.keyboard.press('u');
    await expect
      .poll(async () =>
        (await sceneCards(page)).some(
          (card) =>
            card.parentId.endsWith(':deck') &&
            card.side === 'local' &&
            !shuffled.some((before) => before.id === card.id)
        )
      )
      .toBe(true);
    await idle(page, renderer);
    const restored = await sceneCards(page);

    const shuffledIds = new Set(shuffled.map((card) => card.id));
    const isLocalDeck = (card: SceneCard) =>
      card.side === 'local' && card.parentId.endsWith(':deck');
    // The un-shuffled deck is dealt afresh: none of the shuffled aliases
    // survive, so the shuffle cannot be traced back.
    expect(
      restored.filter((card) => isLocalDeck(card) && shuffledIds.has(card.id))
    ).toEqual([]);
    // Nothing outside that deck changed identity.
    expect(restored.filter((card) => !isLocalDeck(card))).toEqual(
      shuffled.filter((card) => !isLocalDeck(card))
    );

    if (renderer === 'dom') {
      const watched = await finishWatch(page);
      expect(watched.remounted).toBe(0);
      const byId = new Map(restored.map((card) => [card.id, card]));
      for (const id of watched.flying) {
        expect(byId.get(id) && isLocalDeck(byId.get(id)!), id).toBe(true);
      }
    }
  });
}
