import { expect, test, type Page } from '@playwright/test';
import {
  BoardDepthProjection,
  DEFAULT_BOARD_DEPTH,
  DEFAULT_BOARD_PREFERENCES,
  type BoardPreferences,
} from '../../packages/renderer-contract/src/index.js';
import { closeSheet, openDeck } from './support/table-shell.js';

/**
 * A card dragged off the deck onto the discard is carried face down and
 * turned face up as it lands: a real turn about its long axis, the back on
 * its edge and then the face -- never an empty card, never a second card
 * flying in after it -- on the tabletop and on the flat table. When its face
 * is still loading it waits, back up, and turns once it can.
 */

/** The decks' faces: a small image served here, so the table paints fast. */
const FACE = '/v2/assets/turn-face.png';
const FACE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAD8AAABYCAIAAADNzLhqAAAAfElEQVR4nO3bQQ2AQBDAwJODCIShjjdK0IEHPpvmJqmAMdB1XE+3NS6gb0ZPT18rrn/vsxs9PX0tenr6WvT09LXo6elr0dPT16Knp69FT09fi56evhY9PX0tenr6WvT09LXo6elr0dPT16Kn/6kf/3Y2PpbGBfTN6Ol31H9L9mwjgA6TBwAAAABJRU5ErkJggg==',
  'base64'
);

const scene = (page: Page) =>
  page.evaluate(() => window.__PTCG_RENDERER_SPIKE__!.scene);
const discardCount = async (page: Page) =>
  (await scene(page)).zones.find(
    (zone) => zone.side === 'local' && zone.kind === 'discard'
  )?.count;

/** Serves the faces; until `held` settles, when one is given. */
const serveFaces = (page: Page, held?: Promise<void>) =>
  page.route(
    (url) => url.pathname === FACE,
    async (route) => {
      await held;
      await route.fulfill({ contentType: 'image/png', body: FACE_PNG });
    }
  );

const start = async (
  page: Page,
  mode: 'table' | 'flat'
): Promise<BoardPreferences> => {
  const depth = { ...DEFAULT_BOARD_DEPTH, mode };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((stored) => {
    localStorage.setItem('ptcgsim.table-depth.v1', JSON.stringify(stored));
  }, depth);
  await page.goto('/?room-lobby=1&renderer=dom');
  await page.locator('#nameInput').fill('Card turn');
  await closeSheet(page);
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible();
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'turn.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `QTY,Name,Type,URL\n30,Greninja,Pokémon,${FACE}?p\n20,Head Ringer,Trainer,${FACE}?t\n10,Water Energy,Energy,${FACE}?e`
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await page.locator('#setupButton').click();
  await expect
    .poll(
      async () =>
        (await scene(page)).zones.find(
          (zone) => zone.side === 'local' && zone.kind === 'hand'
        )?.count
    )
    .toBe(7);
  await page.mouse.move(10, 10);
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-motion',
    'idle'
  );
  return { ...DEFAULT_BOARD_PREFERENCES, depth };
};

interface TurnFrame {
  /** The old face (the back) shown over the card. */
  readonly back: boolean;
  /** Its own face is loaded and shown. */
  readonly face: boolean;
  /** How wide its face is drawn: narrow on its edge. */
  readonly width: number;
  /** Its face is being turned about its long axis (flat: in CSS). */
  readonly rotating: boolean;
  /** Marked as turning over by the table. */
  readonly turning: boolean;
  readonly ghosts: number;
}

/**
 * Samples the card every frame until stopped: the one held, then whatever
 * the discard's cover shows (the card under any alias the room gives it).
 */
const sampleCard = (page: Page, heldId: string, discardId: string) =>
  page.evaluate(
    ([held, discardZoneId]) => {
      const frames: TurnFrame[] = [];
      const store = window as unknown as {
        __turnFrames: TurnFrame[];
        __turnStop: boolean;
      };
      store.__turnFrames = frames;
      store.__turnStop = false;
      const tick = () => {
        const cover = window.__PTCG_RENDERER_SPIKE__?.scene.cards.find(
          (candidate) => candidate.renderKey === `cover:${discardZoneId}`
        );
        const card = document.querySelector<HTMLElement>(
          `.ptcgsim-card[data-card-id="${CSS.escape(
            cover ? String(cover.id) : held
          )}"]`
        );
        const face = card?.querySelector<HTMLElement>('.ptcgsim-card__face');
        if (card && face) {
          const own = face.querySelector<HTMLImageElement>(
            ':scope > img:not(.ptcgsim-card__turn)'
          );
          const back = face.querySelector<HTMLImageElement>(
            '.ptcgsim-card__turn'
          );
          frames.push({
            back: Boolean(back && Number(getComputedStyle(back).opacity) > 0.5),
            face: Boolean(
              own?.complete &&
              own.naturalWidth > 0 &&
              getComputedStyle(own).visibility !== 'hidden'
            ),
            width: face.getBoundingClientRect().width,
            rotating: face
              .getAnimations()
              .some((animation) =>
                (animation.effect as KeyframeEffect | null)
                  ?.getKeyframes()
                  .some((frame) =>
                    String(frame['transform']).includes('rotateY(90deg)')
                  )
              ),
            turning: card.dataset['turning'] !== undefined,
            ghosts: document.querySelectorAll('.ptcgsim-card-ghost').length,
          });
        }
        if (!store.__turnStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [heldId, discardId] as const
  );
const sampled = (page: Page, stop = true) =>
  page.evaluate((stopping) => {
    const store = window as unknown as {
      __turnFrames: TurnFrame[];
      __turnStop: boolean;
    };
    if (stopping) store.__turnStop = true;
    return store.__turnFrames;
  }, stop);

/** Drags the deck's top card onto the discard, sampling it from the drop. */
const dealToDiscard = async (page: Page, preferences: BoardPreferences) => {
  const current = await scene(page);
  const projection = new BoardDepthProjection(current, preferences);
  const host = (await page.locator('.renderer-surface-host').boundingBox())!;
  const onScreen = (point: { x: number; y: number }) => ({
    x: host.x + point.x,
    y: host.y + point.y,
  });
  const top = current.cards.find(
    (card) =>
      card.side === 'local' &&
      card.renderKey !== null &&
      card.parentId.endsWith(':deck')
  )!;
  const discard = current.zones.find(
    (zone) => zone.side === 'local' && zone.kind === 'discard'
  )!;
  const pose = projection.pose(top);
  const from = onScreen(
    projection.point(
      {
        x: top.bounds.x + top.bounds.width / 2,
        y: top.bounds.y + top.bounds.height / 2,
      },
      pose.elevation,
      pose.plane === 0
    )
  );
  const to = onScreen(
    projection.point(
      {
        x: discard.bounds.x + discard.bounds.width / 2,
        y: discard.bounds.y + discard.bounds.height / 2,
      },
      0,
      false
    )
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await sampleCard(page, String(top.id), discard.id);
  await page.mouse.up();
  await expect.poll(() => discardCount(page)).toBe(1);
};

/** Lets the landing and the turn play, then waits for the table to rest. */
const settle = async (page: Page) => {
  await page.waitForTimeout(1200);
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-motion',
    'idle'
  );
};

/** The turn every renderer owes the card, checked frame by frame. */
const expectTurnedOver = (
  frames: readonly TurnFrame[],
  mode: 'table' | 'flat'
) => {
  // It set off as a back, was turned over, and ends as its face, flat.
  expect(frames.some((frame) => frame.back)).toBe(true);
  expect(frames.some((frame) => frame.turning)).toBe(true);
  const widest = Math.max(...frames.map((frame) => frame.width));
  expect(frames.at(-1)).toMatchObject({
    back: false,
    face: true,
    turning: false,
  });
  expect(frames.at(-1)!.width).toBeGreaterThan(widest * 0.9);
  // Never an empty card: the back or the face, every frame.
  expect(frames.filter((frame) => !frame.back && !frame.face)).toEqual([]);
  // Turned over in depth, not swapped: flat, its face turns about its long
  // axis in CSS; on the tabletop the table draws it narrower on its edge (a
  // swap never narrows it; a slow runner may catch no frame near edge-on).
  if (mode === 'flat')
    expect(frames.some((frame) => frame.rotating)).toBe(true);
  else
    expect(Math.min(...frames.map((frame) => frame.width))).toBeLessThan(
      widest * 0.9
    );
  // One card went to the discard: no second one flies in after it.
  expect(Math.max(...frames.map((frame) => frame.ghosts))).toBe(0);
};

for (const mode of ['table', 'flat'] as const) {
  test(`${mode}: a card dealt onto the discard turns over as it lands, and never shows empty`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await serveFaces(page);
    await dealToDiscard(page, await start(page, mode));
    await settle(page);
    expectTurnedOver(await sampled(page), mode);
  });
}

test('a turn waits, back up, for a face that is still loading', async ({
  page,
}) => {
  test.setTimeout(90_000);
  let release!: () => void;
  await serveFaces(
    page,
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  await dealToDiscard(page, await start(page, 'table'));
  // Landed, its face still loading: it lies there back up, unturned. (The
  // sampler starts while the card is still held, and a busy page can paint
  // a few of those frames, the held card's back drawn by its own image:
  // from the frame it lies back up on, it must stay so.)
  await page.waitForTimeout(700);
  const sampledSoFar = await sampled(page, false);
  const landed = sampledSoFar.findIndex((frame) => frame.back);
  expect(landed).toBeGreaterThanOrEqual(0);
  const waiting = sampledSoFar.slice(landed);
  expect(waiting.every((frame) => frame.back && !frame.face)).toBe(true);
  const resting = Math.max(...waiting.map((frame) => frame.width));
  expect(waiting.at(-1)!.width).toBeGreaterThan(resting * 0.9);
  release();
  await settle(page);
  expectTurnedOver(await sampled(page), 'table');
});
