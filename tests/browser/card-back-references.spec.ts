import { expect, test, type Page } from '@playwright/test';
import type { RemoteGameSession } from '../../packages/client-session/src/index.js';
import type { MatchViewState } from '../../packages/game-core/src/index.js';
import type { WireGameCommand } from '../../packages/protocol/src/index.js';

import { ownRoomBudget } from './support/room-budget.js';
import { openSettings, useFlatTable } from './support/table-shell.js';

interface BackRoomWindow extends Window {
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

const TRACKER = 'https://tracker.example.test/';
const STANDARD_BACK = /^\/v2\/assets\/backs\/standard\.[0-9a-f]{10}\.webp$/u;

const liveView = (page: Page): Promise<MatchViewState> =>
  page.evaluate(() => {
    const view = (
      window as BackRoomWindow
    ).__ptcgsimDevRoom?.runtime.session.getSnapshot().view;
    if (!view) throw new Error('Missing room projection');
    return view;
  });

const submit = async (page: Page, command: WireGameCommand): Promise<void> => {
  const result = await page.evaluate((command) => {
    const session = (window as BackRoomWindow).__ptcgsimDevRoom?.runtime
      .session;
    if (!session) throw new Error('Missing room session');
    return session.submit(command);
  }, command);
  expect(result.queued).toBe(true);
  if (!result.queued) throw new Error('Command was not queued');
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window as BackRoomWindow).__ptcgsimDevRoom?.runtime.session
            .getSnapshot()
            .completedCommands.find((entry) => entry.commandId === id)
            ?.accepted,
        result.commandId
      )
    )
    .toBe(true);
};

/** The pictures the guest's table draws for the host's hidden cards. */
const hostBacks = (page: Page, hostId: string) =>
  page.evaluate((ownerId) => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    return [
      ...new Set(
        (scene?.cards ?? [])
          .filter((card) => card.ownerId === ownerId && card.concealed)
          .map((card) => card.imageUrl)
      ),
    ];
  }, hostId);

/**
 * A card back is a reference each viewer draws for itself (ADR-041): an
 * opponent's browser never asks an outside host for one, sees an uploaded
 * back from our own origin, and may choose to see the standard back
 * instead.
 */
test('an opponent never loads an outside card back, sees an uploaded one from our origin, and may hide it', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  const [host, guest] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  const errors: string[] = [];
  const outside: string[] = [];
  try {
    for (const [index, page] of [host!, guest!].entries()) {
      await ownRoomBudget(contexts[index]!);
      await useFlatTable(page);
      page.on('pageerror', (error) => errors.push(error.message));
    }
    await guest!.route(`${TRACKER}**`, async (route) => {
      outside.push(route.request().url());
      await route.abort();
    });

    await host!.goto('/?dev-room=1&room-mode=multiplayer&name=Back%20host');
    await expect(host!.locator('[data-session-phase="ready"]')).toBeVisible();
    const invitation = await host!.evaluate(async () => {
      let copied = '';
      const handle = (window as BackRoomWindow).__ptcgsimDevRoom;
      if (!handle) throw new Error('Missing creator invitation custody');
      await handle.invitations.copyPlayerInvitation({
        writeText: async (text) => {
          copied = await text;
        },
      });
      return copied;
    });
    await guest!.goto('/?room-lobby=1');
    await guest!.locator('#nameInput').fill('Back guest');
    await guest!.locator('#roomIdInput').evaluate((input, text) => {
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: {
          getData: (type: string) => (type === 'text/plain' ? text : ''),
        },
      });
      input.dispatchEvent(paste);
    }, invitation);
    await guest!.locator('#joinRoomButton').click();
    await expect(guest!.locator('[data-session-phase="ready"]')).toBeVisible();

    // The host's deck, face down to the guest.
    await submit(host!, {
      type: 'LoadDeck',
      entries: [
        {
          definition: {
            id: 'back-test-card',
            name: 'Back test card',
            category: 'Pokémon',
            imageUrl: '/v2/assets/cardback.png?back-test-face',
          },
          count: 3,
        },
      ],
    });
    const hostId = (await liveView(host!)).playerOrder[0]!;

    // An older client sets a back by address: the guest's table draws the
    // standard back and its browser never asks the address's host.
    await submit(host!, {
      type: 'SetCardBack',
      cardBackUrl: `${TRACKER}pixel.png?game=1`,
    });
    const revision = (await liveView(host!)).revision;
    await expect
      .poll(() =>
        guest!.evaluate(() => window.__PTCG_RENDERER_SPIKE__?.scene.revision)
      )
      .toBe(revision);
    await expect.poll(() => hostBacks(guest!, hostId)).toHaveLength(1);
    expect((await hostBacks(guest!, hostId))[0]).toMatch(STANDARD_BACK);
    await expect(guest!.locator(`img[src^="${TRACKER}"]`)).toHaveCount(0);

    // An uploaded back: stored by the app, drawn from our own origin.
    const ref = await host!.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 63;
      canvas.height = 88;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#2b4fb3';
      context.fillRect(0, 0, 63, 88);
      const picture = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.8)
      );
      if (!picture) throw new Error('No WebP');
      const response = await fetch('/v2/images', {
        method: 'POST',
        headers: { 'Content-Type': 'image/webp' },
        body: picture,
      });
      if (response.status !== 201) throw new Error(String(response.status));
      return ((await response.json()) as { ref: string }).ref;
    });
    expect(ref).toMatch(/^img:[0-9a-f]{64}$/u);
    const served = `/v2/images/${ref.slice(4)}`;
    await submit(host!, { type: 'SetCardBack', cardBackUrl: ref });
    await expect.poll(() => hostBacks(guest!, hostId)).toEqual([served]);
    await expect
      .poll(() =>
        guest!
          .locator(`.ptcgsim-board-surface img[src="${served}"]`)
          .first()
          .evaluate(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0
          )
      )
      .toBe(true);

    // The guest chooses to see opponents' custom backs as the standard one.
    await openSettings(guest!);
    await guest!.locator('#opponentCardBacksCheckbox').uncheck();
    await expect
      .poll(async () => (await hostBacks(guest!, hostId))[0] ?? '')
      .toMatch(STANDARD_BACK);

    expect(outside).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
