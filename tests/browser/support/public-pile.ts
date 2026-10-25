import { expect, type BrowserContext, type Page } from '@playwright/test';
import type { RemoteGameSession } from '../../../packages/client-session/src/index.js';
import type {
  MatchViewState,
  ViewCardId,
} from '../../../packages/game-core/src/index.js';
import type { WireGameCommand } from '../../../packages/protocol/src/index.js';

import { ownRoomBudget } from './room-budget.js';
import { useFlatTable } from './table-shell.js';

interface PileTestWindow extends Window {
  readonly __ptcgsimDevRoom?: {
    readonly runtime: {
      readonly session: Pick<RemoteGameSession, 'getSnapshot' | 'submit'>;
    };
  };
}

const view = async (page: Page): Promise<MatchViewState> =>
  page.evaluate(() => {
    const current = (
      window as PileTestWindow
    ).__ptcgsimDevRoom?.runtime.session.getSnapshot().view;
    if (!current) throw new Error('Missing real room projection');
    return current;
  });

export const revision = async (page: Page): Promise<number> =>
  (await view(page)).revision;

/** Arrange through the real authority; the actions under test use the UI. */
const submit = async (page: Page, command: WireGameCommand): Promise<void> => {
  const before = await revision(page);
  const queued = await page.evaluate((command) => {
    const session = (window as PileTestWindow).__ptcgsimDevRoom?.runtime
      .session;
    if (!session) throw new Error('Missing real room session');
    return session.submit(command).queued;
  }, command);
  expect(queued).toBe(true);
  await expect.poll(() => revision(page)).toBe(before + 1);
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    String(before + 1)
  );
};

export const pile = async (page: Page, kind: 'discard' | 'lostZone') => {
  const current = await view(page);
  const zone = Object.values(current.zones).find(
    (zone) => zone.ownerId === current.playerOrder[0] && zone.kind === kind
  );
  if (!zone) throw new Error(`Missing ${kind}`);
  return zone;
};

export const fillPile = async (page: Page, kind: 'discard' | 'lostZone') => {
  await page.goto(
    '/?dev-room=1&room-mode=solo&renderer=dom&name=Pile%20ordering'
  );
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  await submit(page, {
    type: 'LoadDeck',
    entries: [
      {
        definition: {
          id: 'zeta',
          name: 'Zeta',
          category: 'Pokémon',
          imageUrl: '/v2/assets/cardback.png?zeta',
        },
        count: 2,
      },
      {
        definition: {
          id: 'alpha',
          name: 'Alpha',
          category: 'Pokémon',
          imageUrl: '/v2/assets/cardback.png?alpha',
        },
        count: 1,
      },
      {
        definition: {
          id: 'beta',
          name: 'Beta',
          category: 'Pokémon',
          imageUrl: '/v2/assets/cardback.png?beta',
        },
        count: 1,
      },
    ],
  });
  const current = await view(page);
  const deck = Object.values(current.zones).find(
    (zone) => zone.ownerId === current.playerOrder[0] && zone.kind === 'deck'
  )!;
  const destination = await pile(page, kind);
  for (const card of deck.cards)
    await submit(page, {
      type: 'MoveCard',
      cardId: card.id,
      expectedSourceZoneId: deck.id,
      destinationZoneId: destination.id,
    });
  const cards = (await pile(page, kind)).cards;
  if (kind === 'discard') {
    await submit(page, {
      type: 'SetCardAbilityUsed',
      cardId: cards[0]!.id,
      used: true,
    });
  }
  return { zoneId: destination.id, cardIds: cards.map((card) => card.id) };
};

export const openPile = async (page: Page, kind: 'discard' | 'lostZone') => {
  const zone = await pile(page, kind);
  const top = zone.cards.at(-1)!;
  await page
    .locator(`.ptcgsim-board-surface [data-card-id="${top.id}"]`)
    .click();
  const browser = page.locator(`[data-zone-browser-id="${zone.id}"]`);
  await expect(browser).toBeVisible();
  return browser;
};

export const ids = async (page: Page, kind: 'discard' | 'lostZone') =>
  (await pile(page, kind)).cards.map((card) => card.id);

export const picked = (page: Page, cardId: ViewCardId) =>
  page.locator(`[data-overlay-card-id="${cardId}"]`);

export const preparePileContext = async (
  context: BrowserContext,
  page: Page
): Promise<void> => {
  await ownRoomBudget(context);
  await useFlatTable(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'ptcgsim.board-view.v1',
      JSON.stringify({ lostZone: true })
    );
  });
};
