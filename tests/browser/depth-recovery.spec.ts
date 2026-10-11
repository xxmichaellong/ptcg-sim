import { expect, test, type Page } from '@playwright/test';
import type { WireGameCommand } from '../../packages/protocol/src/index.js';

interface RoomHandle {
  readonly invitations: {
    copyPlayerInvitation(clipboard: {
      writeText: (text: Promise<string>) => Promise<void>;
    }): Promise<unknown>;
  };
  readonly runtime: {
    readonly session: {
      submit(command: WireGameCommand): unknown;
      getSnapshot(): { readonly reconnectAttempt: number };
    };
  };
}

type Faults = {
  hold: boolean;
  rejectMove: boolean;
  release: () => void;
  disconnect: () => void;
  queued: () => number;
  socketCount: () => number;
};
type TestWindow = Window & {
  __ptcgsimDevRoom: RoomHandle;
  __faults: Faults;
};
const state = (page: Page) =>
  page.evaluate(() => window.__PTCG_RENDERER_SPIKE__!.scene);

const faults = async (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      'ptcgsim.table-depth.v1',
      JSON.stringify({ mode: 'table', tilt: 18 })
    );
    const NativeSocket = WebSocket;
    const pending: (() => void)[] = [];
    const sockets: WebSocket[] = [];
    const control: Faults = {
      hold: false,
      rejectMove: false,
      queued: () => pending.length,
      socketCount: () => sockets.length,
      release: () => {
        control.hold = false;
        for (const run of pending.splice(0)) run();
      },
      disconnect: () => {
        control.release();
        sockets.at(-1)?.dispatchEvent(
          new CloseEvent('close', {
            code: 1006,
            reason: 'Recovery test',
            wasClean: false,
          })
        );
      },
    };
    (window as unknown as TestWindow).__faults = control;
    class FaultSocket extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
      override send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data === 'string' && control.rejectMove) {
          const message = JSON.parse(data);
          if (
            message.type === 'Command' &&
            message.command.type === 'MoveCardToPlay'
          ) {
            control.rejectMove = false;
            message.command.expectedSourceZoneId = 'deliberately-stale-source';
            data = JSON.stringify(message);
          }
        }
        super.send(data);
      }
      override addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions
      ) {
        if (type !== 'message' || !listener) {
          if (listener) super.addEventListener(type, listener, options);
          return;
        }
        super.addEventListener(
          type,
          (event) => {
            const deliver = () =>
              typeof listener === 'function'
                ? listener.call(this, event)
                : listener.handleEvent(event);
            if (control.hold) pending.push(deliver);
            else deliver();
          },
          options
        );
      }
    }
    window.WebSocket = FaultSocket;
  });

test('two raised tables reconcile delayed and rejected play, resume after disconnect, and never load private opponent art', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90000);
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  const [owner, guest] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  const errors: string[] = [];
  const privateRequests: string[] = [];
  for (const page of [owner!, guest!])
    page.on('pageerror', (error) => errors.push(error.message));
  try {
    await faults(owner!);
    await faults(guest!);
    await owner!.goto('/?dev-room=1&renderer=dom&name=Depth%20owner');
    await expect(owner!.locator('[data-session-phase="ready"]')).toBeVisible();
    const invitation = await owner!.evaluate(async () => {
      let value = '';
      await (
        window as unknown as TestWindow
      ).__ptcgsimDevRoom.invitations.copyPlayerInvitation({
        writeText: async (text) => {
          value = await text;
        },
      });
      return value;
    });
    await guest!.goto('/?room-lobby=1&renderer=dom');
    await guest!.locator('#nameInput').fill('Depth guest');
    await guest!.locator('#roomIdInput').evaluate((input, text) => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) => (type === 'text/plain' ? text : ''),
        },
      });
      input.dispatchEvent(event);
    }, invitation);
    await guest!.locator('#joinRoomButton').click();
    await expect(guest!.locator('[data-session-phase="ready"]')).toBeVisible();
    guest!.on('request', (request) => {
      if (request.url().includes('private-depth-art'))
        privateRequests.push(request.url());
    });
    await owner!.evaluate(() =>
      (window as unknown as TestWindow).__ptcgsimDevRoom.runtime.session.submit(
        {
          type: 'LoadDeck',
          entries: [
            {
              count: 60,
              definition: {
                id: 'depth-recovery-art',
                name: 'Recovery card',
                category: 'Pokémon',
                imageUrl: '/v2/assets/cardback.png?private-depth-art',
                presentation: {
                  readingQuarterTurns: 0,
                  finish: 'rainbow',
                  foilRegion: 'full',
                },
              },
            },
          ],
        }
      )
    );
    await expect.poll(async () => (await state(owner!)).cards.length).toBe(60);
    await owner!.evaluate(() =>
      (window as unknown as TestWindow).__ptcgsimDevRoom.runtime.session.submit(
        {
          type: 'SetupPlayer',
        }
      )
    );
    const handCount = async () =>
      (await state(owner!)).zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'hand'
      )!.count;
    await expect.poll(handCount).toBe(7);
    await expect.poll(async () => (await state(guest!)).cards.length).toBe(60);
    expect(privateRequests).toEqual([]);
    const hand = (await state(owner!)).cards.find(
      (card) => card.side === 'local' && card.parentId.endsWith(':hand')
    )!;
    await owner!.evaluate(() => {
      (window as unknown as TestWindow).__faults.hold = true;
      (window as unknown as TestWindow).__faults.rejectMove = true;
    });
    await owner!.locator(`[data-card-id="${hand.id}"]`).click();
    await owner!.keyboard.press('a');
    await expect.poll(handCount, { timeout: 500 }).toBe(6);
    await expect
      .poll(() =>
        owner!.evaluate(() =>
          (window as unknown as TestWindow).__faults.queued()
        )
      )
      .toBeGreaterThan(0);
    await owner!.evaluate(() =>
      (window as unknown as TestWindow).__faults.release()
    );
    await expect.poll(handCount).toBe(7);
    await expect(owner!.locator('.ptcgsim-board-surface')).toHaveAttribute(
      'data-motion',
      'idle'
    );
    expect(
      (await state(owner!)).cards.find((card) => card.id === hand.id)?.role
    ).toBe('zone');
    expect(privateRequests).toEqual([]);
    await owner!.evaluate(() => {
      (window as unknown as TestWindow).__faults.hold = true;
    });
    await owner!.locator(`[data-card-id="${hand.id}"]`).click();
    await owner!.keyboard.press('a');
    await expect.poll(handCount, { timeout: 500 }).toBe(6);
    await expect
      .poll(
        async () =>
          (await state(guest!)).cards.filter(
            (card) => card.role === 'stackEvolution'
          ).length
      )
      .toBe(1);
    await owner!.evaluate(() =>
      (window as unknown as TestWindow).__faults.release()
    );
    await expect
      .poll(async () => (await state(owner!)).revision)
      .toBe((await state(guest!)).revision);
    const connectedSockets = await owner!.evaluate(() =>
      (window as unknown as TestWindow).__faults.socketCount()
    );
    await owner!.evaluate(() =>
      (window as unknown as TestWindow).__faults.disconnect()
    );
    await expect
      .poll(() =>
        owner!.evaluate(() =>
          (window as unknown as TestWindow).__faults.socketCount()
        )
      )
      .toBe(connectedSockets + 1);
    await expect(owner!.locator('[data-session-phase="ready"]')).toBeVisible();
    await expect
      .poll(() =>
        owner!.evaluate(
          () =>
            (
              window as unknown as TestWindow
            ).__ptcgsimDevRoom.runtime.session.getSnapshot().reconnectAttempt
        )
      )
      .toBe(0);
    await expect
      .poll(async () => (await state(owner!)).revision)
      .toBe((await state(guest!)).revision);
    await expect(owner!.locator('.ptcgsim-board-surface')).toHaveAttribute(
      'data-motion',
      'idle'
    );
    await expect(
      owner!.locator('[data-held="drag"], .ptcgsim-panel-drag-face')
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
