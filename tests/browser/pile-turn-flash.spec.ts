import { expect, test, type Page } from '@playwright/test';
import {
  BoardDepthProjection,
  DEFAULT_BOARD_DEPTH,
  DEFAULT_BOARD_PREFERENCES,
  type BoardPreferences,
} from '../../packages/renderer-contract/src/index.js';
import { ownRoomBudget } from './support/room-budget.js';
import { closeSheet, openDeck } from './support/table-shell.js';

/**
 * A card dealt face down onto a pile that already has cards -- the deck's
 * top dragged onto the discard -- shows itself the whole way: never a blank
 * card while its pictures load, and never the card that was under it while
 * it turns over on top of the pile (the owner: "during the animation of the
 * flip, it briefly flashes the card underneath it"). Each card has a face
 * of its own, so the card under it can be told from it.
 */

const FACE = '/v2/assets/pile-turn-face.svg';
const svg = (n: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342"><rect width="245" height="342" fill="hsl(${String((n * 47) % 360)} 70% 50%)"/><text x="122" y="210" font-size="150" text-anchor="middle" fill="white" font-family="sans-serif">${String(n)}</text></svg>`;

const scene = (page: Page) =>
  page.evaluate(() => window.__PTCG_RENDERER_SPIKE__!.scene);
const zoneCount = async (page: Page, kind: string) =>
  (await scene(page)).zones.find(
    (zone) => zone.side === 'local' && zone.kind === kind
  )?.count;

const start = async (
  page: Page,
  mode: 'table' | 'flat'
): Promise<BoardPreferences> => {
  await ownRoomBudget(page.context());
  await page.route(
    (url) => url.pathname === FACE,
    async (route) => {
      const n = Number(new URL(route.request().url()).searchParams.get('n'));
      await route.fulfill({ contentType: 'image/svg+xml', body: svg(n) });
    }
  );
  const depth = { ...DEFAULT_BOARD_DEPTH, mode };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((stored) => {
    localStorage.setItem('ptcgsim.table-depth.v1', JSON.stringify(stored));
  }, depth);
  await page.goto('/?room-lobby=1');
  await page.locator('#nameInput').fill('Pile turn');
  await closeSheet(page);
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible();
  await openDeck(page);
  const lines = ['QTY,Name,Type,URL'];
  for (let n = 1; n <= 60; n += 1)
    lines.push(`1,Card ${String(n)},Pokémon,${FACE}?n=${String(n)}`);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'pile-turn.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(lines.join('\n')),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await page.locator('#setupButton').click();
  await expect.poll(() => zoneCount(page, 'hand')).toBe(7);
  await page.mouse.move(10, 10);
  await idle(page);
  return { ...DEFAULT_BOARD_PREFERENCES, depth };
};

const idle = (page: Page) =>
  expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-board-motion',
    'idle'
  );

/** Picks up the deck's top and carries it over the discard (not let go). */
const carryToDiscard = async (page: Page, preferences: BoardPreferences) => {
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
  return discard.id;
};

interface Frame {
  /** Still in the hand: not yet let go. */
  readonly held: boolean;
  /** The card shows a picture: its back over it, or its own face. */
  readonly painted: boolean;
  /** Marked as turning over (or waiting, back up, to). */
  readonly turning: boolean;
  /** Flat: its face is being turned about its long axis in CSS. */
  readonly spinning: boolean;
  /** Its own face's card number. */
  readonly own: string | null;
  /** The card number the pile under it shows, if a stand-in holds it. */
  readonly under: string | null;
  /** How wide its face is drawn. */
  readonly width: number;
}

/**
 * Samples the discard's top every frame until stopped, and records every
 * picture a stand-in is given (from the DOM's own records, so none is
 * missed however few frames a busy page paints).
 */
const sample = (page: Page, discardId: string) =>
  page.evaluate((discardZoneId) => {
    const frames: Frame[] = [];
    const under: string[] = [];
    const store = window as unknown as {
      __pileFrames: Frame[];
      __pileUnder: string[];
      __pileStop: boolean;
    };
    store.__pileFrames = frames;
    store.__pileUnder = under;
    store.__pileStop = false;
    const number = (url: string | null | undefined) =>
      url ? (/[?&]n=(\d+)/u.exec(url)?.[1] ?? 'other') : null;
    const pictureNumber = (picture: Element) =>
      number(
        picture instanceof HTMLCanvasElement
          ? picture.dataset['cardPicture']
          : picture.getAttribute('src')
      ) ?? 'other';
    const observer = new MutationObserver((records) => {
      if (store.__pileStop) {
        observer.disconnect();
        return;
      }
      for (const record of records)
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof Element)) continue;
          // A stand-in laid down, or given another picture.
          const pictures = node.matches('.ptcgsim-card-ghost')
            ? Array.from(
                node.querySelectorAll(
                  ':scope > .ptcgsim-card__face > :is(img, canvas)'
                )
              )
            : node.matches(':is(img, canvas)') &&
                record.target instanceof Element &&
                record.target.closest('.ptcgsim-card-ghost')
              ? [node]
              : [];
          for (const picture of pictures) under.push(pictureNumber(picture));
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const shows = (picture: Element | null): boolean => {
      if (!picture) return false;
      if (picture instanceof HTMLCanvasElement) return true;
      const image = picture as HTMLImageElement;
      return (
        image.complete &&
        image.naturalWidth > 0 &&
        getComputedStyle(image).visibility !== 'hidden'
      );
    };
    const tick = () => {
      const cover = window.__PTCG_RENDERER_SPIKE__?.scene.cards.find(
        (candidate) => candidate.renderKey === `cover:${discardZoneId}`
      );
      const card = cover
        ? document.querySelector<HTMLElement>(
            `.ptcgsim-card[data-card-id="${CSS.escape(String(cover.id))}"]`
          )
        : null;
      const face = card?.querySelector<HTMLElement>('.ptcgsim-card__face');
      if (card && face) {
        const own = face.querySelector<HTMLImageElement>(
          ':scope > img:not(.ptcgsim-card__turn)'
        );
        const over = face.querySelector(':scope > .ptcgsim-card__turn');
        const spun = face
          .getAnimations()
          .some(
            (animation) =>
              Number(animation.currentTime ?? 0) > 0 &&
              animation.playState === 'running'
          );
        const ghost = document.querySelector(
          '.ptcgsim-card-ghost .ptcgsim-card__face > :is(img, canvas)'
        ) as HTMLElement | null;
        frames.push({
          held: card.dataset['held'] !== undefined,
          painted: shows(over) || shows(own),
          turning: card.dataset['turning'] !== undefined,
          spinning: spun,
          own: number(own?.getAttribute('src')),
          under: ghost
            ? number(ghost.dataset['cardPicture'] ?? ghost.getAttribute('src'))
            : null,
          width: face.getBoundingClientRect().width,
        });
      }
      if (!store.__pileStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, discardId);
const sampled = (page: Page) =>
  page.evaluate(() => {
    const store = window as unknown as {
      __pileFrames: Frame[];
      __pileUnder: string[];
      __pileStop: boolean;
    };
    store.__pileStop = true;
    return { frames: store.__pileFrames, under: store.__pileUnder };
  });

/** The card number the discard's top shows now. */
const discardTop = (page: Page, discardId: string) =>
  page.evaluate((discardZoneId) => {
    const top = window.__PTCG_RENDERER_SPIKE__?.scene.cards.find(
      (card) => card.renderKey === `cover:${discardZoneId}`
    );
    const url = top ? (top.tableImageUrl ?? top.imageUrl) : '';
    return /[?&]n=(\d+)/u.exec(url)?.[1] ?? null;
  }, discardId);

for (const mode of ['table', 'flat'] as const) {
  test(`${mode}: a card dealt onto the discard over others never shows blank, nor the card under it as it turns`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const preferences = await start(page, mode);
    // Two of their own already in the discard.
    for (let dealt = 1; dealt <= 2; dealt += 1) {
      await carryToDiscard(page, preferences);
      await page.mouse.up();
      await expect.poll(() => zoneCount(page, 'discard')).toBe(dealt);
      await page.waitForTimeout(400);
      await idle(page);
    }
    const discardId = await carryToDiscard(page, preferences);
    const oldTop = await discardTop(page, discardId);
    expect(oldTop).not.toBeNull();
    await sample(page, discardId);
    await page.mouse.up();
    await expect.poll(() => zoneCount(page, 'discard')).toBe(3);
    await page.waitForTimeout(1200);
    await idle(page);
    const { frames: all, under } = await sampled(page);
    const frames = all.filter((frame) => !frame.held);
    // Let go, it ends lying face up, its own face shown.
    expect(frames.length).toBeGreaterThan(3);
    const last = frames.at(-1)!;
    expect(last.painted).toBe(true);
    expect(last.own).not.toBe(oldTop);
    // Never blank: its back over it, or its own face, every frame.
    expect(frames.filter((frame) => !frame.painted)).toEqual([]);
    // The pile under it: the card it covers while it lands, then -- as it
    // turns over, before the stand-in goes -- the card itself. Judged on
    // every picture the stand-in was given, not on frames a busy page may
    // not have painted.
    expect(under[0]).toBe(oldTop);
    expect(under.at(-1)).toBe(last.own);
    // And no frame that was painted mid-turn (flat: its face turned in CSS;
    // on the tabletop, drawn narrower than it lies) showed the card it
    // covers under it.
    const turning = frames.filter((frame) =>
      mode === 'flat'
        ? frame.spinning
        : frame.turning && frame.width < last.width * 0.97
    );
    expect(turning.filter((frame) => frame.under === oldTop)).toEqual([]);
  });
}
