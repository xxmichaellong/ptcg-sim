import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type { WireGameCommand } from '../../packages/protocol/src/index.js';

import { overlayToast } from './support/overlay-dialogs.js';
import {
  card,
  cardName,
  logLines,
  NAMED_DECK,
  revision,
  selection,
  shiftClick,
  sweep,
  zoneBox,
  zoneCardIds,
  zoneCount,
} from './support/multi-select.js';
import { ownRoomBudget } from './support/room-budget.js';
import {
  chooseMenuItem,
  chooseMoreAction,
  openDeck,
  useFlatTable,
} from './support/table-shell.js';

/**
 * Several cards at once in a room of two players and a spectator (ADR-042
 * §4, §6): what the group moves where no one else may see is told without
 * its names, to the other player, to the spectator and in their replays;
 * a rectangle never takes the other player's face-down hand or a deck's
 * cover; and the group's one move is undone as one, until the other
 * player has moved.
 */

interface RoomSession {
  getSnapshot(): {
    readonly completedCommands: readonly {
      readonly commandId: string;
      readonly accepted: boolean;
    }[];
  };
  submit(
    command: WireGameCommand
  ):
    | { readonly queued: true; readonly commandId: string }
    | { readonly queued: false };
}
interface DevRoomWindow extends Window {
  readonly __ptcgsimDevRoom?: {
    readonly runtime: { readonly session: RoomSession };
    readonly invitations: {
      copyPlayerInvitation(clipboard: {
        writeText: (text: Promise<string>) => Promise<void>;
      }): Promise<unknown>;
      copySpectatorInvitation(clipboard: {
        writeText: (text: Promise<string>) => Promise<void>;
      }): Promise<unknown>;
    };
  };
}

/** Cards no one but their owner knows the names of, once hidden. */
const SECRET = Array.from(
  { length: 12 },
  (_, index) => `Secret ${String(index + 1).padStart(2, '0')}`
);

/** Sent to the room by the host's own session, and taken. */
const submit = async (page: Page, command: WireGameCommand) => {
  const result = await page.evaluate((command) => {
    const session = (window as DevRoomWindow).__ptcgsimDevRoom?.runtime.session;
    if (!session) throw new Error('Missing host room session');
    return session.submit(command);
  }, command);
  if (!result.queued) throw new Error(`Not sent: ${command.type}`);
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window as DevRoomWindow).__ptcgsimDevRoom?.runtime.session
            .getSnapshot()
            .completedCommands.find((entry) => entry.commandId === id)
            ?.accepted,
        result.commandId
      )
    )
    .toBe(true);
};

const invitation = (page: Page, role: 'player' | 'spectator') =>
  page.evaluate(async (role) => {
    let copied = '';
    const handle = (window as DevRoomWindow).__ptcgsimDevRoom;
    if (!handle) throw new Error('Missing creator invitation custody');
    const clipboard = {
      writeText: async (text: Promise<string>) => {
        copied = await text;
      },
    };
    if (role === 'player')
      await handle.invitations.copyPlayerInvitation(clipboard);
    else await handle.invitations.copySpectatorInvitation(clipboard);
    return copied;
  }, role);

const join = async (page: Page, text: string, name: string) => {
  await page.goto('/?room-lobby=1');
  await page.locator('#nameInput').fill(name);
  await page.locator('#roomIdInput').evaluate((input, text) => {
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    input.dispatchEvent(paste);
  }, text);
  await expect(page.locator('#roomIdInput')).toHaveValue(
    /^[A-HJ-NP-Z2-9]{12}$/u
  );
  await page.locator('#joinRoomButton').click();
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
    timeout: 30_000,
  });
};

interface Room {
  readonly host: Page;
  readonly guest: Page;
  readonly watcher: Page;
  readonly contexts: readonly BrowserContext[];
}

/**
 * A room: its host, the other player and a spectator; the host dealt. The
 * host's own connection can be routed through a test's network (`route`).
 */
const openRoom = async (
  browser: Browser,
  baseURL: string,
  route?: (context: BrowserContext) => Promise<void>
): Promise<Room> => {
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ baseURL }))
  );
  const [host, guest, watcher] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  for (const [index, page] of [host!, guest!, watcher!].entries()) {
    await ownRoomBudget(contexts[index]!);
    await useFlatTable(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await route?.(contexts[0]!);
  await host!.goto('/?dev-room=1&room-mode=multiplayer&name=Host');
  await expect(host!.locator('[data-session-phase="ready"]')).toBeVisible({
    timeout: 30_000,
  });
  await join(guest!, await invitation(host!, 'player'), 'Guest');
  await join(watcher!, await invitation(host!, 'spectator'), 'Watcher');
  // The host's deck and hand, through the room.
  await submit(host!, {
    type: 'LoadDeck',
    entries: SECRET.map((name, index) => ({
      definition: {
        id: `secret-print-${String(index)}`,
        name,
        category: 'Pokémon',
        imageUrl: `/v2/assets/table/coin-heads.webp?secret-${String(index)}`,
      },
      count: 1,
    })),
  });
  await submit(host!, { type: 'DrawCards', count: 7 });
  await expect
    .poll(() => zoneCardIds(host!, 'local', 'hand').then((ids) => ids.length))
    .toBe(7);
  return { host: host!, guest: guest!, watcher: watcher!, contexts };
};

/** Each page's scene has caught up with the host's. */
const caughtUp = async (room: Room) => {
  const at = await revision(room.host);
  for (const page of [room.guest, room.watcher])
    await expect.poll(() => revision(page)).toBe(at);
};

test('a group put out of sight is told without its names, to the other player, the spectator and their replays', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const room = await openRoom(browser, baseURL!);
  try {
    const { host, guest, watcher } = room;
    const hand = await zoneCardIds(host, 'local', 'hand');
    // Three to the bottom of the deck: no one else learns which.
    const hidden = [hand[0]!, hand[1]!, hand[2]!];
    const hiddenNames = await Promise.all(
      hidden.map((id) => cardName(host, id))
    );
    await shiftClick(host, ...hidden);
    let before = await revision(host);
    await host.keyboard.press('ArrowDown');
    await expect.poll(() => revision(host)).toBeGreaterThan(before);
    // Two to the discard pile: everyone sees them, by name.
    const shown = [hand[3]!, hand[4]!];
    const shownNames = await Promise.all(shown.map((id) => cardName(host, id)));
    await shiftClick(host, ...shown);
    before = await revision(host);
    await host.keyboard.press('d');
    await expect.poll(() => revision(host)).toBeGreaterThan(before);
    await caughtUp(room);
    for (const page of [guest, watcher]) {
      const lines = (await logLines(page)).join('\n');
      for (const name of hiddenNames) expect(lines).not.toContain(name);
      for (const name of shownNames) expect(lines).toContain(name);
    }
    // The log is one for all (ADR-042 §6): the host's names the shown cards
    // and, as for one card, not the ones put out of sight.
    const own = (await logLines(host)).join('\n');
    for (const name of shownNames) expect(own).toContain(name);
    for (const name of hiddenNames) expect(own).not.toContain(name);
    // Each one's replay, as downloaded, names no hidden card either.
    for (const page of [guest, watcher]) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        chooseMenuItem(page, 'exportState'),
      ]);
      const replay = await (await download.createReadStream()).toArray();
      const text = Buffer.concat(replay as Buffer[]).toString('utf8');
      for (const name of hiddenNames) expect(text).not.toContain(name);
      for (const name of shownNames) expect(text).toContain(name);
    }
  } finally {
    await Promise.all(room.contexts.map((context) => context.close()));
  }
});

test("a rectangle takes neither the other player's face-down hand nor a deck's cover", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const room = await openRoom(browser, baseURL!);
  try {
    const { host, guest } = room;
    // The guest's own hand, face down to the host.
    await openDeck(guest);
    await guest.locator('#nativeDeckBuilderCsvImport').setInputFiles({
      name: 'guest.csv',
      mimeType: 'text/csv',
      buffer: NAMED_DECK,
    });
    await guest.locator('#nativeDeckBuilderPlayButton').click();
    await expect(
      guest.locator('.ptcgsim-deck-layer[data-open="false"]')
    ).toBeAttached();
    await chooseMoreAction(guest, 'p2SetupButton');
    await expect.poll(() => zoneCount(host, 'opponent', 'hand')).toBe(7);
    const theirs = await zoneCardIds(host, 'opponent', 'hand');
    // Across the far half, hand and all.
    const far = await zoneBox(host, 'opponent', 'bench');
    await sweep(
      host,
      { x: far.x + 4, y: far.y + far.height - 4 },
      { x: far.x + far.width - 4, y: 2 }
    );
    const taken = await selection(host);
    for (const cardId of theirs) expect(taken).not.toContain(cardId);
    await host.keyboard.press('Escape');
    // Over the host's own deck: its cover is no card to pick.
    const deck = await zoneBox(host, 'local', 'deck');
    await sweep(
      host,
      { x: deck.x - 8, y: deck.y - 8 },
      { x: deck.x + deck.width + 8, y: deck.y + deck.height + 8 }
    );
    expect(await selection(host)).toEqual([]);
  } finally {
    await Promise.all(room.contexts.map((context) => context.close()));
  }
});

test('a group is undone as one move, and not once the other player has moved', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const room = await openRoom(browser, baseURL!);
  try {
    const { host, guest } = room;
    let hand = await zoneCardIds(host, 'local', 'hand');
    await shiftClick(host, hand[0]!, hand[1]!);
    let before = await revision(host);
    await host.keyboard.press('d');
    await expect.poll(() => revision(host)).toBeGreaterThan(before);
    expect(await zoneCount(host, 'local', 'discard')).toBe(2);
    // Undone, both come back.
    before = await revision(host);
    await host.keyboard.press('u');
    await expect.poll(() => revision(host)).toBeGreaterThan(before);
    await expect.poll(() => zoneCount(host, 'local', 'discard')).toBe(0);
    expect(await zoneCount(host, 'local', 'hand')).toBe(7);
    // Again, then the other player moves: the group stays where it went.
    hand = await zoneCardIds(host, 'local', 'hand');
    await shiftClick(host, hand[0]!, hand[1]!);
    before = await revision(host);
    await host.keyboard.press('d');
    await expect.poll(() => revision(host)).toBeGreaterThan(before);
    before = await revision(host);
    await guest
      .getByRole('button', { name: 'Flip a coin', exact: true })
      .click();
    await expect.poll(() => revision(host)).toBeGreaterThan(before);
    await host.keyboard.press('u');
    await expect(overlayToast(host, "Didn't go through")).toBeVisible();
    expect(await zoneCount(host, 'local', 'discard')).toBe(2);
  } finally {
    await Promise.all(room.contexts.map((context) => context.close()));
  }
});

/**
 * The host's connection to the room, through a network the test controls
 * (memory: network chaos testing): as it is, slow both ways, or a silent
 * drop that the room never hears of.
 */
type Network = 'clear' | 'slow' | 'dropped';
const routeHost =
  (network: { current: Network }) => async (context: BrowserContext) => {
    await context.routeWebSocket(/\/v2\/rooms\/[^/]+\/connect/u, (socket) => {
      const room = socket.connectToServer();
      const pass = (send: () => void) => {
        if (network.current === 'dropped') return;
        if (network.current === 'slow') setTimeout(send, 400);
        else send();
      };
      socket.onMessage((message) => pass(() => room.send(message)));
      room.onMessage((message) => pass(() => socket.send(message)));
      // A dropped connection closes nothing: the room never hears of it.
      socket.onClose(() => {
        if (network.current !== 'dropped') void room.close();
      });
    });
  };

/**
 * After the weather: the room and both players agree where the six went,
 * no card is held where it was let go, and a group the room never took is
 * selected again.
 */
const settled = async (room: Room, group: readonly string[]) => {
  const { host, guest } = room;
  await expect
    .poll(
      async () =>
        (await host.locator('[data-held="settle"]').count()) === 0 &&
        (await revision(guest)) === (await revision(host)),
      { timeout: 90_000 }
    )
    .toBe(true);
  const discard = await zoneCount(host, 'local', 'discard');
  expect(discard === 0 || discard === group.length).toBe(true);
  expect(await zoneCount(host, 'local', 'hand')).toBe(7 - discard);
  await expect
    .poll(() => zoneCount(guest, 'opponent', 'discard'))
    .toBe(discard);
  if (discard === 0)
    await expect
      .poll(async () => (await selection(host)).sort())
      .toEqual([...group].sort());
};

test.describe('on a bad network', () => {
  for (const weather of ['slow', 'dropped'] as const)
    test(`a group of six moved over a ${weather} connection lands once, or comes back selected`, async ({
      browser,
      baseURL,
    }) => {
      test.setTimeout(180_000);
      const network = { current: 'clear' as Network };
      const room = await openRoom(browser, baseURL!, routeHost(network));
      try {
        const { host } = room;
        const group = (await zoneCardIds(host, 'local', 'hand')).slice(0, 6);
        await shiftClick(host, ...group);
        await expect.poll(async () => (await selection(host)).length).toBe(6);
        network.current = weather;
        if (weather === 'slow') await host.keyboard.press('d');
        else {
          // Dragged to the discard pile: shown where the board predicts
          // them while the room has not answered.
          const from = (await card(host, group[2]!).boundingBox())!;
          const to = await zoneBox(host, 'local', 'discard');
          await host.mouse.move(
            from.x + from.width / 2,
            from.y + from.height / 2
          );
          await host.mouse.down();
          await host.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
            steps: 12,
          });
          await host.mouse.up();
          await expect
            .poll(() => zoneCount(host, 'local', 'discard'))
            .toBe(group.length);
        }
        await host.waitForTimeout(weather === 'dropped' ? 4_000 : 2_000);
        network.current = 'clear';
        await settled(room, group);
      } finally {
        await Promise.all(room.contexts.map((context) => context.close()));
      }
    });

  test('a group of six moved while offline for fifteen seconds lands once, or comes back selected', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const room = await openRoom(browser, baseURL!);
    try {
      const { host } = room;
      const group = (await zoneCardIds(host, 'local', 'hand')).slice(0, 6);
      await shiftClick(host, ...group);
      await expect.poll(async () => (await selection(host)).length).toBe(6);
      await room.contexts[0]!.setOffline(true);
      await host.keyboard.press('d');
      await host.waitForTimeout(15_000);
      await room.contexts[0]!.setOffline(false);
      await settled(room, group);
    } finally {
      await Promise.all(room.contexts.map((context) => context.close()));
    }
  });
});
