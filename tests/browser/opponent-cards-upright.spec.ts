import { expect, test, type Page } from '@playwright/test';

import {
  chooseMoreAction,
  closeSheet,
  openDeck,
  openSettings,
  useFlatTable,
} from './support/table-shell.js';

/**
 * Settings → Table → "Opponent's cards face me" (PX-043): the far player's
 * cards turn to read the right way up for this viewer, where they lie, and
 * stay as easy to pick up as before.
 */

const deckCsv = (prefix: string): Buffer =>
  Buffer.from(
    [
      'QTY,Name,Type,URL',
      `30,${prefix} Mon,Pokémon,/v2/assets/cardback.png?${prefix}-mon`,
      `30,${prefix} Energy,Energy,/v2/assets/cardback.png?${prefix}-energy`,
    ].join('\n')
  );

const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-board-motion="idle"]')
  ).toHaveCount(1);

const openSoloTable = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    buffer: deckCsv('Main'),
  });
  await page.locator('#nativeDeckBuilderTargetAlt').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'alt.csv',
    mimeType: 'text/csv',
    buffer: deckCsv('Alt'),
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    '2'
  );
  await chooseMoreAction(page, 'setupBothButton');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    '4'
  );
  await idle(page);
};

/** A face-up card in the far player's hand (Solo plays both sides). */
const farHandCard = (page: Page) =>
  page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
    const hand = scene.zones.find(
      (zone) => zone.side === 'opponent' && zone.kind === 'hand'
    )!;
    return scene.cards.find(
      (card) => card.parentId === hand.id && card.renderKey !== null
    )!.id;
  });

/**
 * Where a card's own top-left corner is painted, as a share of the box it
 * covers on screen: near (0, 0) when it reads upright, near (1, 1) when it
 * is turned half round.
 */
const paintedCorner = (page: Page, cardId: string) =>
  page.evaluate((id) => {
    const card = document.querySelector(
      `.ptcgsim-card[data-card-id="${CSS.escape(id)}"]`
    )!;
    const face = card.querySelector<HTMLElement>('.ptcgsim-card__face')!;
    const probe = document.createElement('i');
    probe.style.cssText =
      'position:absolute;left:0;top:0;width:2px;height:2px;pointer-events:none';
    face.append(probe);
    const corner = probe.getBoundingClientRect();
    const box = face.getBoundingClientRect();
    probe.remove();
    return {
      x: (corner.x + 1 - box.x) / box.width,
      y: (corner.y + 1 - box.y) / box.height,
    };
  }, cardId);

const reads = async (page: Page, cardId: string) => {
  const corner = await paintedCorner(page, cardId);
  return corner.x < 0.5 && corner.y < 0.5 ? 'upright' : 'turned';
};

const setUpright = async (page: Page, on: boolean) => {
  await openSettings(page);
  const toggle = page.locator('#opponentUprightCheckbox');
  if (on) await toggle.check();
  else await toggle.uncheck();
  await closeSheet(page);
  // Gone, not just closing: its backdrop would take the next press.
  await expect(page.locator('#settings')).toHaveCount(0);
  const surface = page.locator('.ptcgsim-board-surface');
  if (on) await expect(surface).toHaveAttribute('data-far-upright', 'true');
  else await expect(surface).not.toHaveAttribute('data-far-upright');
};

for (const [view, name] of [
  ['table', '3D'],
  ['flat', 'flat'],
] as const) {
  test(`the far player's cards read upright on request on the ${name} table, and still pick up`, async ({
    page,
  }) => {
    await openSoloTable(page);
    if (view === 'flat') await useFlatTable(page);
    await idle(page);
    const card = await farHandCard(page);
    // By default the far side faces its owner, as across a real table.
    expect(await reads(page, card)).toBe('turned');
    await expect(page.locator('.ptcgsim-board-surface')).not.toHaveAttribute(
      'data-far-upright'
    );

    await setUpright(page, true);
    await idle(page);
    expect(await reads(page, card)).toBe('upright');
    // The near side never changes.
    const near = await page.evaluate(() => {
      const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
      return scene.cards.find(
        (card) =>
          card.side === 'local' &&
          card.parentId.endsWith(':hand') &&
          card.renderKey !== null
      )!.id;
    });
    expect(await reads(page, near)).toBe('upright');

    // Picked up where it is painted, it goes where it is dropped: onto the
    // far Active, still reading upright there.
    const farActive = await page.evaluate(
      () =>
        window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
          (zone) => zone.side === 'opponent' && zone.kind === 'active'
        )!.id
    );
    const from = await page
      .locator(`.ptcgsim-card[data-card-id="${card}"]`)
      .boundingBox();
    const to = await page
      .locator(`[data-zone-id="${farActive}"]`)
      .boundingBox();
    expect(from && to).toBeTruthy();
    const start = {
      x: from!.x + from!.width / 2,
      y: from!.y + from!.height / 2,
    };
    const end = { x: to!.x + to!.width / 2, y: to!.y + to!.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * step) / 12,
        start.y + ((end.y - start.y) * step) / 12
      );
    }
    await page.mouse.up();
    // A card's identity changes as it moves: find it as the far Active.
    await expect
      .poll(() =>
        page.evaluate(
          (zoneId) =>
            window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
              (zone) => zone.id === zoneId
            )?.count,
          farActive
        )
      )
      .toBe(1);
    await idle(page);
    const played = await page.evaluate(
      () =>
        window.__PTCG_RENDERER_SPIKE__!.scene.cards.find(
          (card) =>
            card.side === 'opponent' &&
            card.role === 'stackEvolution' &&
            card.renderKey !== null
        )!.id
    );
    expect(await reads(page, played)).toBe('upright');

    // Kept on this device, and off again is as it was.
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem('ptcgsim.board-view.v1'))
      )
      .toContain('"opponentCardsUpright":true');
    await setUpright(page, false);
    await idle(page);
    expect(await reads(page, played)).toBe('turned');
  });
}
