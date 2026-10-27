import { expect, test, type Page } from '@playwright/test';
import type { RemoteGameSession } from '../../packages/client-session/src/index.js';
import type { MatchViewState } from '../../packages/game-core/src/index.js';
import type { WireGameCommand } from '../../packages/protocol/src/index.js';

import { ownRoomBudget } from './support/room-budget.js';
import { useFlatTable } from './support/table-shell.js';

interface ArrangementWindow extends Window {
  readonly __ptcgsimDevRoom?: {
    readonly runtime: {
      readonly session: Pick<RemoteGameSession, 'getSnapshot' | 'submit'>;
    };
    readonly invitations: {
      copyPlayerInvitation(clipboard: {
        writeText: (text: Promise<string>) => Promise<void>;
      }): Promise<unknown>;
    };
  };
}

const PRIVATE_ART = 'arrangement-private-art';
const liveView = (page: Page): Promise<MatchViewState> =>
  page.evaluate(() => {
    const view = (
      window as ArrangementWindow
    ).__ptcgsimDevRoom?.runtime.session.getSnapshot().view;
    if (!view) throw new Error('Missing creator projection');
    return view;
  });
const scene = (page: Page) =>
  page.evaluate(() => {
    const current = window.__PTCG_RENDERER_SPIKE__?.scene;
    if (!current) throw new Error('Missing installed scene');
    return current;
  });
const submit = async (page: Page, command: WireGameCommand): Promise<void> => {
  const queued = await page.evaluate((command) => {
    const session = (window as ArrangementWindow).__ptcgsimDevRoom?.runtime
      .session;
    if (!session) throw new Error('Missing creator session');
    return session.submit(command);
  }, command);
  expect(queued.queued).toBe(true);
  if (!queued.queued) throw new Error('Fixture command was not queued');
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window as ArrangementWindow).__ptcgsimDevRoom?.runtime.session
            .getSnapshot()
            .completedCommands.find((entry) => entry.commandId === id)
            ?.accepted,
        queued.commandId
      )
    )
    .toBe(true);
};
const localZone = (view: MatchViewState, kind: string) => {
  const zone = Object.values(view.zones).find(
    (zone) => zone.ownerId === view.playerOrder[0] && zone.kind === kind
  );
  if (!zone) throw new Error(`Missing ${kind} zone`);
  return zone;
};
const point = async (page: Page, id: string) => {
  const box = await page
    .locator(`[data-card-id="${id}"] .ptcgsim-card__body`)
    .boundingBox();
  if (!box) throw new Error('Missing painted card');
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.35 };
};
const idle = (page: Page) =>
  expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-board-motion',
    'idle',
    { timeout: 15_000 }
  );

for (const kind of ['board', 'hand'] as const) {
  test(`native ${kind} arrangement preserves disclosure and recipient aliases`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const contexts = await Promise.all(
      [0, 1].map(() =>
        browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })
      )
    );
    const [host, guest] = await Promise.all(
      contexts.map((context) => context.newPage())
    );
    const errors: string[] = [];
    let privateRequests = 0;
    try {
      for (const [index, page] of [host!, guest!].entries()) {
        await ownRoomBudget(contexts[index]!);
        await useFlatTable(page);
        page.on('pageerror', (error) => errors.push(error.message));
      }
      guest!.on('request', (request) => {
        if (request.url().includes(PRIVATE_ART)) privateRequests += 1;
      });
      await host!.goto('/?dev-room=1&room-mode=multiplayer&renderer=dom');
      await expect(host!.locator('[data-session-phase="ready"]')).toBeVisible();
      await submit(host!, {
        type: 'LoadDeck',
        entries: ['Alpha', 'Beta', 'Private'].map((name, index) => ({
          definition: {
            id: `arrangement-${name}`,
            name: `Arrangement ${name}`,
            category: 'Pokémon',
            imageUrl: `/v2/assets/cardback.png?${index === 2 ? PRIVATE_ART : `arrangement-${name}`}`,
          },
          count: 1,
        })),
      });
      const loaded = await liveView(host!);
      const deck = localZone(loaded, 'deck');
      const destination = localZone(loaded, kind);
      for (const card of deck.cards)
        await submit(host!, {
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: deck.id,
          destinationZoneId: destination.id,
        });
      const target = localZone(await liveView(host!), kind).cards.at(-1)!;
      // Establish disclosure before the guest joins, so its private-art
      // request check cannot be satisfied by an earlier legitimate reveal.
      await submit(host!, {
        type: 'SetPublicReveal',
        cardId: target.id,
        expectedSourceId: destination.id,
        revealed: kind === 'hand',
      });
      const invitation = await host!.evaluate(async () => {
        let copied = '';
        await (
          window as ArrangementWindow
        ).__ptcgsimDevRoom!.invitations.copyPlayerInvitation({
          writeText: async (text) => {
            copied = await text;
          },
        });
        return copied;
      });
      await guest!.goto('/?room-lobby=1&renderer=dom');
      await guest!.locator('#nameInput').fill('Arrangement guest');
      await guest!.locator('#roomIdInput').evaluate((input, text) => {
        const paste = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(paste, 'clipboardData', {
          value: {
            getData: (type: string) => (type === 'text/plain' ? text : ''),
          },
        });
        input.dispatchEvent(paste);
      }, invitation);
      await expect(guest!.locator('#roomIdInput')).toHaveValue(
        /^[A-HJ-NP-Z2-9]{12}$/u
      );
      await guest!.locator('#joinRoomButton').click();
      await expect(
        guest!.locator('[data-session-phase="ready"]')
      ).toBeVisible();
      const before = await liveView(host!);
      await expect
        .poll(() =>
          guest!.evaluate(
            () => window.__PTCG_RENDERER_SPIKE__?.scene?.revision ?? null
          )
        )
        .toBe(before.revision);
      const original = localZone(before, kind).cards;
      const peerCards = (await scene(guest!)).cards
        .filter((card) => card.parentId === destination.id)
        .map(({ id, label, imageUrl, concealed }) => ({
          id,
          label,
          imageUrl,
          concealed,
        }));
      expect(peerCards).toHaveLength(3);
      expect(peerCards.at(-1)!.concealed).toBe(kind === 'board');
      if (kind === 'board') {
        expect(JSON.stringify(await scene(guest!))).not.toContain(PRIVATE_ART);
        expect(privateRequests).toBe(0);
      }
      await host!.mouse.move(5, 5);
      await idle(host!);
      const a = await point(host!, original[0]!.id);
      const b = await point(host!, original[1]!.id);
      const initial = await point(host!, original[2]!.id);
      await host!.mouse.move(initial.x, initial.y);
      await host!.waitForTimeout(200);
      const grip = await point(host!, original[2]!.id);
      await host!.mouse.move(grip.x, grip.y);
      await host!.mouse.down();
      await host!.mouse.move((a.x + b.x) / 2, a.y, { steps: 14 });
      await host!.mouse.up();
      await host!.mouse.move(5, 5);
      await expect
        .poll(async () => (await liveView(host!)).revision)
        .toBe(before.revision + 1);
      await expect
        .poll(async () => (await scene(guest!)).revision)
        .toBe(before.revision + 1);
      await idle(host!);
      expect(localZone(await liveView(host!), kind).cards).toEqual([
        original[0],
        original[2],
        original[1],
      ]);
      const peerAfter = (await scene(guest!)).cards
        .filter((card) => card.parentId === destination.id)
        .map(({ id, label, imageUrl, concealed }) => ({
          id,
          label,
          imageUrl,
          concealed,
        }));
      expect(peerAfter).toEqual([peerCards[0], peerCards[2], peerCards[1]]);
      if (kind === 'board') {
        expect(JSON.stringify(await scene(guest!))).not.toContain(PRIVATE_ART);
        expect(privateRequests).toBe(0);
      }
      expect(errors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}
