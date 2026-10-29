import { expect, type Locator, type Page } from '@playwright/test';

import { ownRoomBudget } from './room-budget.js';
import {
  chooseMoreAction,
  dismissWelcome,
  openActivity,
  openDeck,
} from './table-shell.js';

/**
 * Helpers for the multi-select specs (ADR-042): a Solo table dealt from a
 * deck whose every card has its own name (so a log line can be read for
 * them), and the selection read off the table's own cards
 * (`data-select-order`).
 */

export type TableMode = 'flat' | 'table';

const two = (value: number) => String(value).padStart(2, '0');

/** Sixty cards, each its own name: 20 Pokémon, 20 Trainers, 20 Energy. */
export const NAMED_DECK = Buffer.from(
  [
    'QTY,Name,Type,URL',
    ...Array.from(
      { length: 20 },
      (_, index) =>
        `1,Mon ${two(index + 1)},Pokémon,/v2/assets/table/coin-heads.webp?mon-${two(index + 1)}`
    ),
    ...Array.from(
      { length: 20 },
      (_, index) =>
        `1,Item ${two(index + 1)},Trainer,/v2/assets/table/coin-tails.webp?item-${two(index + 1)}`
    ),
    ...Array.from(
      { length: 20 },
      (_, index) =>
        `1,Energy ${two(index + 1)},Energy,/v2/assets/table/coin-heads.webp?energy-${two(index + 1)}`
    ),
  ].join('\n')
);

export const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-board-motion="idle"]')
  ).toHaveCount(1, { timeout: 15_000 });

/** The depth the table opens in: flat, or the tilted tabletop. */
export const useTableMode = async (page: Page, mode: TableMode) => {
  await page.addInitScript(
    (mode) =>
      localStorage.setItem(
        'ptcgsim.table-depth.v1',
        JSON.stringify({ mode, tilt: 18 })
      ),
    mode
  );
};

/** Sixty Pokémon, each its own name: a hand of them to put on the Bench. */
export const POKEMON_DECK = Buffer.from(
  [
    'QTY,Name,Type,URL',
    ...Array.from(
      { length: 60 },
      (_, index) =>
        `1,Poke ${two(index + 1)},Pokémon,/v2/assets/table/coin-heads.webp?poke-${two(index + 1)}`
    ),
  ].join('\n')
);

/**
 * A Solo table with a deck on the near seat (the named one unless another
 * is given), and on the far seat when `other` is, both set up.
 */
export const openNamedSolo = async (
  page: Page,
  {
    width = 1440,
    height = 900,
    deck = NAMED_DECK,
    other,
  }: { width?: number; height?: number; deck?: Buffer; other?: Buffer } = {}
): Promise<void> => {
  await ownRoomBudget(page.context());
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
  await openDeck(page);
  for (const [seat, cards] of [
    ['Main', deck],
    ['Alt', other],
  ] as const) {
    if (!cards) continue;
    await page.locator(`#nativeDeckBuilderTarget${seat}`).click();
    await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
      name: `${seat}.csv`,
      mimeType: 'text/csv',
      buffer: cards,
    });
    await expect(
      page.locator('#nativeDeckBuilderSummaryPanel')
    ).toHaveAttribute('data-card-count', '60');
  }
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await chooseMoreAction(page, 'setupBothButton');
  await expect
    .poll(() => zoneCardIds(page, 'local', 'hand').then((ids) => ids.length))
    .toBeGreaterThanOrEqual(7);
  await idle(page);
};

/**
 * Puts away the notices a setup leaves (a deck loaded on a seat, say): on
 * a phone they lie over the near Prizes, where a finger would start.
 */
export const clearNotices = async (page: Page): Promise<void> => {
  const notices = page.locator('[data-ptcgsim-overlay="toast"]');
  for (let left = await notices.count(); left > 0; left -= 1) {
    const close = notices
      .first()
      .getByRole('button', { name: 'Dismiss notification' });
    if (!(await close.isVisible())) break;
    await close.click();
  }
  await expect(notices).toHaveCount(0);
};

/** A seat's cards in one of its zones, as the scene lists them. */
export const zoneCardIds = (
  page: Page,
  side: 'local' | 'opponent',
  kind: string
): Promise<string[]> =>
  page.evaluate(
    ({ side, kind }) => {
      const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
      const zone = scene?.zones.find(
        (candidate) => candidate.side === side && candidate.kind === kind
      );
      return (
        scene?.cards
          .filter((card) => card.parentId === zone?.id)
          .map((card) => card.id) ?? []
      );
    },
    { side, kind }
  );

/** How many cards a seat's zone holds. */
export const zoneCount = (
  page: Page,
  side: 'local' | 'opponent',
  kind: string
): Promise<number> =>
  page.evaluate(
    ({ side, kind }) =>
      window.__PTCG_RENDERER_SPIKE__?.scene.zones.find(
        (candidate) => candidate.side === side && candidate.kind === kind
      )?.count ?? -1,
    { side, kind }
  );

/** A card's name as the table shows it. */
export const cardName = (page: Page, cardId: string): Promise<string> =>
  page.evaluate(
    (cardId) =>
      window.__PTCG_RENDERER_SPIKE__?.scene.cards.find(
        (card) => card.id === cardId
      )?.label ?? '',
    cardId
  );

/** Where a card lies: the zone it is in, by kind. */
export const zoneKindOf = (page: Page, cardId: string): Promise<string> =>
  page.evaluate((cardId) => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    const card = scene?.cards.find((candidate) => candidate.id === cardId);
    const zone = scene?.zones.find(
      (candidate) => candidate.id === card?.parentId
    );
    return zone?.kind ?? card?.parentId ?? '';
  }, cardId);

export const card = (page: Page, cardId: string): Locator =>
  page.locator(`.ptcgsim-board-surface [data-card-id="${cardId}"]`);

/**
 * The selection as the table shows it, in its order: a group's numbers
 * (`data-select-order`), or the one card pressed when it is one alone.
 */
export const selection = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const numbered = [
      ...document.querySelectorAll<HTMLElement>(
        '.ptcgsim-board-surface [data-select-order]'
      ),
    ];
    if (numbered.length > 0)
      return numbered
        .map((node) => ({
          id: node.dataset.cardId ?? '',
          order: Number(node.dataset.selectOrder),
        }))
        .sort((left, right) => left.order - right.order)
        .map((entry) => entry.id);
    return [
      ...document.querySelectorAll<HTMLElement>(
        '.ptcgsim-board-surface [data-card-id][aria-pressed="true"]'
      ),
    ].map((node) => node.dataset.cardId ?? '');
  });

/** Shift-clicks cards on the table, one after another. */
export const shiftClick = async (page: Page, ...cardIds: string[]) => {
  for (const cardId of cardIds)
    await card(page, cardId).click({ modifiers: ['Shift'] });
};

/** The scene's revision, to wait for the next. */
export const revision = (page: Page): Promise<number> =>
  page.evaluate(() => window.__PTCG_RENDERER_SPIKE__?.scene.revision ?? -1);

export const nextRevision = async (page: Page, after: number) =>
  expect.poll(() => revision(page), { timeout: 15_000 }).toBeGreaterThan(after);

/** The log's lines, newest last (the log is opened if it is shut). */
export const logLines = async (page: Page): Promise<string[]> => {
  await openActivity(page);
  return page
    .locator('#activitySheet [role="log"] p')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
};

/**
 * A seat's Pokémon in one row of play ('bench' or 'active'), left to
 * right, by their top cards: each Pokémon is a stack whose cards lie in
 * that row's zone.
 */
export const pokemonIn = (
  page: Page,
  side: 'local' | 'opponent',
  kind: 'bench' | 'active'
): Promise<string[]> =>
  page.evaluate(
    ({ side, kind }) => {
      const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
      const row = scene?.zones.find(
        (zone) => zone.side === side && zone.kind === kind
      );
      if (!scene || !row) return [];
      const within = (bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) => {
        const x = bounds.x + bounds.width / 2;
        const y = bounds.y + bounds.height / 2;
        return (
          x >= row.bounds.x &&
          x <= row.bounds.x + row.bounds.width &&
          y >= row.bounds.y &&
          y <= row.bounds.y + row.bounds.height
        );
      };
      const tops = new Map<string, { id: string; x: number }>();
      for (const card of scene.cards) {
        if (card.role !== 'stackEvolution' || !within(card.bounds)) continue;
        tops.set(card.parentId, { id: card.id, x: card.bounds.x });
      }
      return [...tops.values()]
        .sort((left, right) => left.x - right.x)
        .map((entry) => entry.id);
    },
    { side, kind }
  );

/** The cards of the Pokémon whose top card this is. */
export const pokemonCards = (page: Page, topId: string): Promise<string[]> =>
  page.evaluate((topId) => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    const top = scene?.cards.find((candidate) => candidate.id === topId);
    return (
      scene?.cards
        .filter((candidate) => candidate.parentId === top?.parentId)
        .map((candidate) => candidate.id) ?? []
    );
  }, topId);

/** Clicks a card plainly (selects it alone), then presses a key. */
export const pressOn = async (page: Page, cardId: string, key: string) => {
  await card(page, cardId).click();
  await page.keyboard.press(key);
};

/**
 * Draws a rectangle on the felt from one screen point to another (a drag
 * that starts where no card is), as a mouse would, with keys held.
 */
export const sweep = async (
  page: Page,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  modifiers: readonly ('Shift' | 'ControlOrMeta')[] = []
) => {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
};

/** The table's markers of one kind: the card each is on, and its value. */
export const markers = (
  page: Page,
  kind: 'damage' | 'specialCondition' | 'abilityUsed'
): Promise<{ readonly cardId: string; readonly value: string }[]> =>
  page.evaluate(
    (kind) =>
      window
        .__PTCG_RENDERER_SPIKE__!.scene.markers.filter(
          (marker) => marker.kind === kind
        )
        .map((marker) => ({
          cardId: marker.parentCardId,
          value: marker.value,
        })),
    kind
  );

/** A zone's box on the screen (its painted outline when tilted). */
export const zoneBox = async (
  page: Page,
  side: 'local' | 'opponent',
  kind: string
) => {
  const id = await page.evaluate(
    ({ side, kind }) =>
      window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
        (zone) => zone.side === side && zone.kind === kind
      )!.id,
    { side, kind }
  );
  return (await page.locator(`[data-zone-id="${id}"]`).first().boundingBox())!;
};
