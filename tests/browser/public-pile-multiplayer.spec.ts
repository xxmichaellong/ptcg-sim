import { expect, test, type Locator, type Page } from '@playwright/test';
import type { RemoteGameSession } from '../../packages/client-session/src/index.js';
import type { MatchViewState } from '../../packages/game-core/src/index.js';
import type { WireGameCommand } from '../../packages/protocol/src/index.js';

import { ownRoomBudget } from './support/room-budget.js';
import { useFlatTable } from './support/table-shell.js';

interface PileRoomWindow extends Window {
  readonly __ptcgsimDevRoom?: {
    readonly runtime: {
      readonly session: Pick<RemoteGameSession, 'getSnapshot' | 'submit'>;
      readonly replay: {
        requestReplay(): boolean;
        fastForward(): boolean;
        getSnapshot(): { readonly mode: string };
      };
    };
    readonly invitations: {
      copyPlayerInvitation(clipboard: {
        writeText: (text: Promise<string>) => Promise<void>;
      }): Promise<unknown>;
    };
  };
}

const PRIVATE_NAME = 'Private pile test card';
const PRIVATE_ART = 'private-pile-test-art';
type PileKind = 'discard' | 'lostZone';

const liveView = (page: Page): Promise<MatchViewState> =>
  page.evaluate(() => {
    const view = (
      window as PileRoomWindow
    ).__ptcgsimDevRoom?.runtime.session.getSnapshot().view;
    if (!view) throw new Error('Missing host room projection');
    return view;
  });

const scene = (page: Page) =>
  page.evaluate(() => {
    const current = window.__PTCG_RENDERER_SPIKE__?.scene;
    if (!current) throw new Error('Missing installed room scene');
    return current;
  });

const submit = async (page: Page, command: WireGameCommand): Promise<void> => {
  const result = await page.evaluate((command) => {
    const session = (window as PileRoomWindow).__ptcgsimDevRoom?.runtime
      .session;
    if (!session) throw new Error('Missing host room session');
    return session.submit(command);
  }, command);
  expect(result.queued).toBe(true);
  if (!result.queued) throw new Error('Fixture command was not queued');
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window as PileRoomWindow).__ptcgsimDevRoom?.runtime.session
            .getSnapshot()
            .completedCommands.find((entry) => entry.commandId === id)
            ?.accepted,
        result.commandId
      )
    )
    .toBe(true);
};

const zoneOf = (view: MatchViewState, ownerId: string, kind: string) => {
  const zone = Object.values(view.zones).find(
    (zone) => zone.ownerId === ownerId && zone.kind === kind
  );
  if (!zone) throw new Error(`Missing ${kind} zone`);
  return zone;
};

/** Establish a position through the real authority, then use visible controls. */
const arrangePiles = async (host: Page) => {
  const names = [
    'Discard Alpha',
    'Discard Beta',
    'Discard Gamma',
    'Lost Alpha',
    'Lost Beta',
    'Lost Gamma',
    PRIVATE_NAME,
  ];
  await submit(host, {
    type: 'LoadDeck',
    entries: names.map((name, index) => ({
      definition: {
        id: `pile-print-${String(index)}`,
        name,
        category: 'Pokémon',
        imageUrl: `/v2/assets/cardback.png?${name === PRIVATE_NAME ? PRIVATE_ART : `public-pile-${String(index)}`}`,
      },
      count: 1,
    })),
  });
  const ownerId = (await liveView(host)).playerOrder[0]!;
  for (const name of names) {
    const current = await liveView(host);
    const deck = zoneOf(current, ownerId, 'deck');
    const card = deck.cards.find(
      (card) =>
        card.kind === 'known' &&
        current.definitions[card.definitionId]?.name === name
    );
    if (!card) throw new Error(`Missing fixture card ${name}`);
    await submit(host, {
      type: 'MoveCard',
      cardId: card.id,
      expectedSourceZoneId: deck.id,
      destinationZoneId: zoneOf(
        current,
        ownerId,
        name === PRIVATE_NAME
          ? 'hand'
          : name.startsWith('Discard')
            ? 'discard'
            : 'lostZone'
      ).id,
    });
  }
  const discard = zoneOf(await liveView(host), ownerId, 'discard');
  await submit(host, {
    type: 'SetCardAbilityUsed',
    cardId: discard.cards[0]!.id,
    used: true,
  });
  await submit(host, {
    type: 'SetPublicReveal',
    cardId: zoneOf(await liveView(host), ownerId, 'discard').cards[0]!.id,
    expectedSourceId: discard.id,
    revealed: true,
  });
  return ownerId;
};

const publicOrder = async (page: Page, zoneId: string) =>
  (await scene(page)).cards
    .filter((card) => card.parentId === zoneId)
    .map((card) => card.label);

const openPile = async (page: Page, zoneId: string): Promise<Locator> => {
  const current = await scene(page);
  const top = current.cards.find(
    (card) => card.parentId === zoneId && card.interactive
  );
  if (!top) throw new Error('Missing public pile cover');
  await page
    .locator(`.ptcgsim-board-surface [data-card-id="${top.id}"]`)
    .click();
  const browser = page.locator(`[data-zone-browser-id="${zoneId}"]`);
  await expect(browser).toBeVisible();
  return browser;
};

const selectPileCard = async (
  page: Page,
  browser: Locator,
  zoneId: string,
  name: string
) => {
  const card = (await scene(page)).cards.find(
    (card) => card.parentId === zoneId && card.label === name
  );
  if (!card) throw new Error(`Missing public card ${name}`);
  await browser.locator(`[data-overlay-card-id="${card.id}"]`).click();
  return card.id;
};

test('public-pile controls converge on both peers, preserve disclosed state, and remain read-only in replay', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  const [host, guest] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  const errors: string[] = [];
  const privateRequests: string[] = [];
  const commands: string[] = [];
  try {
    for (const [index, page] of [host!, guest!].entries()) {
      await ownRoomBudget(contexts[index]!);
      await useFlatTable(page);
      await page.addInitScript(() => {
        localStorage.setItem(
          'ptcgsim.board-view.v1',
          JSON.stringify({ lostZone: true })
        );
      });
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('websocket', (socket) =>
        socket.on('framesent', ({ payload }) => {
          const message = JSON.parse(String(payload)) as {
            type?: string;
            command?: { type?: string };
          };
          if (message.type === 'Command')
            commands.push(message.command?.type ?? 'unknown');
        })
      );
    }
    guest!.on('request', (request) => {
      if (request.url().includes(PRIVATE_ART))
        privateRequests.push(request.url());
    });
    await host!.goto('/?dev-room=1&room-mode=multiplayer&name=Pile%20host');
    await expect(host!.locator('[data-session-phase="ready"]')).toBeVisible();
    const invitation = await host!.evaluate(async () => {
      let copied = '';
      const handle = (window as PileRoomWindow).__ptcgsimDevRoom;
      if (!handle) throw new Error('Missing creator invitation custody');
      await handle.invitations.copyPlayerInvitation({
        writeText: async (text) => {
          copied = await text;
        },
      });
      return copied;
    });
    await guest!.goto('/?room-lobby=1');
    await guest!.locator('#nameInput').fill('Pile guest');
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
    await expect(guest!.locator('[data-session-phase="ready"]')).toBeVisible();
    const ownerId = await arrangePiles(host!);
    await expect
      .poll(async () => (await scene(guest!)).revision)
      .toBe((await liveView(host!)).revision);
    const fixtureCommands = commands.length;

    for (const kind of [
      'discard',
      'lostZone',
    ] as const satisfies readonly PileKind[]) {
      const current = await liveView(host!);
      const zone = zoneOf(current, ownerId, kind);
      const original = zone.cards;
      const names = original.map((card) => {
        if (card.kind !== 'known')
          throw new Error('Public fixture card is concealed');
        return current.definitions[card.definitionId]!.name;
      });
      const hostBrowser = await openPile(host!, zone.id);
      const guestBrowser = await openPile(guest!, zone.id);
      const guestAlias = (await scene(guest!)).cards.find(
        (card) => card.parentId === zone.id && card.label === names[0]
      )!.id;
      if (kind === 'discard') {
        await expect(
          guestBrowser.locator(
            `[data-opened-zone-ability-marker][data-marker-card-id="${guestAlias}"]`
          )
        ).toHaveCount(1);

        // A normal drag back onto the same pile remains a local no-op:
        // only the explicit Top/Bottom actions change its order.
        const cardId = await selectPileCard(
          host!,
          hostBrowser,
          zone.id,
          names[0]!
        );
        const source = await hostBrowser
          .locator(`[data-overlay-card-id="${cardId}"]`)
          .boundingBox();
        if (!source) throw new Error('Missing draggable pile card');
        const target = (await scene(host!)).zones.find(
          (candidate) => candidate.id === zone.id
        )!.bounds;
        const beforeDrop = (await liveView(host!)).revision;
        await host!.mouse.move(
          source.x + source.width / 2,
          source.y + source.height / 2
        );
        await host!.mouse.down();
        await host!.mouse.move(
          target.x + target.width / 2,
          target.y + target.height / 2,
          { steps: 12 }
        );
        await host!.mouse.up();
        await expect(hostBrowser).not.toHaveClass(/is-showing-board/u);
        expect((await liveView(host!)).revision).toBe(beforeDrop);
        expect(await publicOrder(host!, zone.id)).toEqual(names);
        expect(commands).toHaveLength(fixtureCommands);
      }

      await selectPileCard(host!, hostBrowser, zone.id, names[0]!);
      const before = (await liveView(host!)).revision;
      await hostBrowser.locator('[data-card-action="pile-top"]').click();
      await expect
        .poll(async () => (await liveView(host!)).revision)
        .toBe(before + 1);
      const movedOrder = [...names.slice(1), names[0]!];
      for (const page of [host!, guest!]) {
        await expect.poll(() => publicOrder(page, zone.id)).toEqual(movedOrder);
        await expect
          .poll(async () => (await scene(page)).revision)
          .toBe(before + 1);
      }
      expect(zoneOf(await liveView(host!), ownerId, kind).cards.at(-1)).toEqual(
        original[0]
      );

      // The peer operates the same disclosed pile through its own aliases.
      await selectPileCard(guest!, guestBrowser, zone.id, names[0]!);
      await guestBrowser.locator('[data-card-action="pile-bottom"]').click();
      await expect
        .poll(async () => (await liveView(host!)).revision)
        .toBe(before + 2);
      for (const page of [host!, guest!]) {
        await expect.poll(() => publicOrder(page, zone.id)).toEqual(names);
        await expect
          .poll(async () => (await scene(page)).revision)
          .toBe(before + 2);
      }
      expect(zoneOf(await liveView(host!), ownerId, kind).cards).toEqual(
        original
      );
      expect(
        (await scene(guest!)).cards.find((card) => card.id === guestAlias)
          ?.label
      ).toBe(names[0]);
      if (kind === 'discard') {
        await expect(
          guestBrowser.locator(
            `[data-opened-zone-ability-marker][data-marker-card-id="${guestAlias}"]`
          )
        ).toHaveCount(1);
      }
      for (const [page, opened] of [
        [host!, hostBrowser],
        [guest!, guestBrowser],
      ] as const) {
        await page.mouse.move(0, 0);
        await page.keyboard.press('Escape');
        await expect(opened).toHaveCount(0);
      }
    }

    const guestHand = (await scene(guest!)).cards.filter(
      (card) => card.parentId === `zone:${ownerId}:hand`
    );
    expect(guestHand).toHaveLength(1);
    expect(guestHand.every((card) => card.concealed)).toBe(true);
    expect(
      (await scene(guest!)).cards.some((card) => card.label === PRIVATE_NAME)
    ).toBe(false);
    expect(privateRequests).toEqual([]);
    expect(commands).toHaveLength(fixtureCommands + 4);

    const liveRevision = (await liveView(host!)).revision;
    expect(
      await host!.evaluate(() =>
        (
          window as PileRoomWindow
        ).__ptcgsimDevRoom!.runtime.replay.requestReplay()
      )
    ).toBe(true);
    await expect
      .poll(() =>
        host!.evaluate(
          () =>
            (
              window as PileRoomWindow
            ).__ptcgsimDevRoom!.runtime.replay.getSnapshot().mode
        )
      )
      .toBe('replay');
    expect(
      await host!.evaluate(() =>
        (
          window as PileRoomWindow
        ).__ptcgsimDevRoom!.runtime.replay.fastForward()
      )
    ).toBe(true);
    await expect
      .poll(async () => (await scene(host!)).revision)
      .toBe(liveRevision);
    const discardId = zoneOf(await liveView(host!), ownerId, 'discard').id;
    const replayBrowser = await openPile(host!, discardId);
    await selectPileCard(host!, replayBrowser, discardId, 'Discard Beta');
    await expect(
      replayBrowser.locator('[data-card-action="pile-top"]')
    ).toBeDisabled();
    await expect(
      replayBrowser.locator('[data-card-action="pile-bottom"]')
    ).toBeDisabled();
    const sent = commands.length;
    await host!.keyboard.press('Enter');
    await host!.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    expect(commands).toHaveLength(sent);
    expect((await liveView(host!)).revision).toBe(liveRevision);
    expect(errors).toEqual([]);
    await test.info().attach('peer-public-pile-evidence', {
      body: JSON.stringify({
        liveRevision,
        commands: commands.length,
        privateRequests: privateRequests.length,
        piles: ['Discard Alpha/Beta/Gamma', 'Lost Alpha/Beta/Gamma'],
      }),
      contentType: 'application/json',
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
