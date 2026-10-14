import { expect, test, type Page } from '@playwright/test';
import {
  BoardDepthProjection,
  DEFAULT_BOARD_PREFERENCES,
  parseBoardDepth,
} from '../../packages/renderer-contract/src/index.js';

import {
  chooseMenuItem,
  closeSheet,
  dismissWelcome,
  openDeck,
} from './support/table-shell.js';

const escape = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
const csv = () => {
  const rows: unknown[][] = [];
  const add = (
    name: string,
    type: string,
    part: string,
    presentation?: unknown
  ) =>
    rows.push([
      1,
      name,
      type,
      `/v2/assets/cardback.png?${part}`,
      presentation ? JSON.stringify(presentation) : '',
    ]);
  for (let part = 0; part < 4; part++)
    add('Mewtwo V-UNION', 'Pokémon', `union-${part}`, {
      readingQuarterTurns: 0,
      finish: 'rainbow',
      foilRegion: 'full',
      join: { key: 'mewtwo', columns: 2, rows: 2, part },
    });
  for (let part = 0; part < 2; part++)
    add('Lugia LEGEND', 'Pokémon', `legend-${part}`, {
      readingQuarterTurns: 1,
      join: { key: 'lugia', columns: 1, rows: 2, part },
    });
  add('Greninja', 'Pokémon', 'greninja');
  add('Greninja BREAK', 'Pokémon', 'break', {
    readingQuarterTurns: 1,
    overlay: 'upper-half',
  });
  for (let part = 0; part < 2; part++)
    add('Legendary Pyroduct', 'Trainer', `stadium-${part}`, {
      readingQuarterTurns: 0,
      join: { key: 'pyroduct', columns: 2, rows: 1, part },
    });
  add('Head Ringer', 'Trainer', 'head-ringer');
  add('Ordinary Stadium', 'Trainer', 'replacement');
  return [
    'QTY,Name,Type,URL,Presentation',
    ...rows.map((row) => row.map(escape).join(',')),
  ].join('\n');
};

const start = async (page: Page) => {
  await page.goto('/?room-lobby=1&renderer=dom');
  await page.locator('#nameInput').fill('Special card review');
  // Putting Play online away goes to the Solo table.
  await closeSheet(page);
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible();
  await dismissWelcome(page);
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'formats.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv()),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toContainText(
    'Total: 12'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__PTCG_RENDERER_SPIKE__?.scene.cards.length)
    )
    .toBe(12);
};

const sceneCard = (page: Page, piece: string) =>
  page.evaluate(
    (piece) =>
      window.__PTCG_RENDERER_SPIKE__!.scene.cards.find((card) =>
        card.imageUrl.endsWith(`?${piece}`)
      )!,
    piece
  );
const fromDeck = async (page: Page, piece: string, key: string) => {
  const card = await sceneCard(page, piece);
  const cover = await page.evaluate(
    () =>
      window.__PTCG_RENDERER_SPIKE__!.scene.cards.find(
        (card) =>
          card.side === 'local' &&
          card.parentId.endsWith(':deck') &&
          card.renderKey !== null
      )!.id
  );
  if (!(await page.locator('[data-legacy-zone-browser]').isVisible())) {
    // A pile in flight (after Flip) takes no double-click.
    await expect(
      page.locator('.ptcgsim-board-surface[data-motion="idle"]')
    ).toHaveCount(1);
    await page.locator(`[data-card-id="${cover}"]`).dblclick();
  }
  await page
    .locator(
      `[data-legacy-zone-browser] button[data-overlay-card-id="${card.id}"]`
    )
    .click();
  const revision = await page.evaluate(
    () => window.__PTCG_RENDERER_SPIKE__!.scene.revision
  );
  if (key === 'q') {
    await page
      .locator('[data-legacy-zone-browser]')
      .getByRole('button', { name: 'Actions', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Assemble / attach to a card…' })
      .click();
  } else await page.keyboard.press(key);
  if (key !== 'q')
    await expect
      .poll(() =>
        page.evaluate(() => window.__PTCG_RENDERER_SPIKE__!.scene.revision)
      )
      .toBeGreaterThan(revision);
  return (await sceneCard(page, piece)).id;
};
const join = async (page: Page, piece: string, anchor: string) => {
  await fromDeck(page, piece, 'q');
  const revision = await page.evaluate(
    () => window.__PTCG_RENDERER_SPIKE__!.scene.revision
  );
  await page.locator(`[data-card-id="${anchor}"]`).click();
  await expect
    .poll(async () => (await sceneCard(page, piece)).role)
    .toBe('stackEvolution');
  await expect
    .poll(() =>
      page.evaluate(() => window.__PTCG_RENDERER_SPIKE__!.scene.revision)
    )
    .toBeGreaterThan(revision);
  // The card lands before anything else is done with it: one still in
  // flight from the deck leaves the deck under a double-click aimed at it.
  await expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1);
  return (await sceneCard(page, piece)).id;
};

for (const mode of ['flat', 'table'] as const)
  test.describe(`${mode} table`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        (mode) =>
          localStorage.setItem(
            'ptcgsim.table-depth.v1',
            JSON.stringify({ mode, tilt: 18 })
          ),
        mode
      );
    });
    test('four pieces remain joined through preview, drag, rotation and board flip', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await start(page);
      let top = await fromDeck(page, 'union-3', 'b');
      const anchor = top;
      for (const piece of ['union-0', 'union-2', 'union-1'])
        top = await join(page, piece, anchor);
      const cards = await page.evaluate(() =>
        window.__PTCG_RENDERER_SPIKE__!.scene.cards.filter(
          (card) => card.composition?.kind === 'joined'
        )
      );
      expect(cards).toHaveLength(4);
      const first = await sceneCard(page, 'union-0');
      const right = await sceneCard(page, 'union-1');
      expect(first.bounds.x + first.bounds.width).toBeCloseTo(
        right.bounds.x,
        5
      );
      await page.locator(`[data-card-id="${first.id}"]`).dblclick();
      const preview = page.locator('[data-preview-kind="composition"]');
      await expect(preview).toBeVisible();
      await expect(preview.locator('.ptcgsim-composition-piece')).toHaveCount(
        4
      );
      await preview
        .getByRole('button', { name: 'View individual cards' })
        .click();
      await expect(page.locator('[data-stack-preview-card-id]')).toHaveCount(4);
      await page.locator(`[data-stack-preview-card-id="${first.id}"]`).click();
      await expect(page.locator('[data-preview-kind="card"]')).toBeVisible();
      await expect(
        page.locator('[data-preview-kind="card"] img')
      ).toHaveAttribute('src', /\?union-0$/);
      await page.keyboard.press('Escape');

      const current = await page.evaluate(
        () => window.__PTCG_RENDERER_SPIKE__!.scene
      );
      const settings = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('ptcgsim.table-depth.v1')!)
      );
      const projection = new BoardDepthProjection(current, {
        ...DEFAULT_BOARD_PREFERENCES,
        depth: parseBoardDepth(settings),
      });
      const bounds = current.zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'active'
      )!.bounds;
      const projected = projection.point({
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      });
      const host = (await page
        .locator('.renderer-surface-host')
        .boundingBox())!;
      const target = { x: host.x + projected.x, y: host.y + projected.y };
      const element = page.locator(`[data-card-id="${first.id}"]`);
      const box = (await element.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 12 });
      await expect(
        page.locator('[data-card-composition="joined"][data-held="drag"]')
      ).toHaveCount(4);
      if (mode === 'table') {
        const heights = await page
          .locator('[data-card-composition="joined"][data-held="drag"]')
          .evaluateAll((nodes) =>
            nodes.map((node) => (node as HTMLElement).dataset['elevation'])
          );
        expect(new Set(heights).size).toBe(1);
        const edge = async (id: string, x: number) =>
          page.locator(`[data-card-id="${id}"]`).evaluate((node, x) => {
            const style = getComputedStyle(node);
            const point = new DOMMatrix(style.transform).transformPoint(
              new DOMPoint(
                parseFloat(style.width) * x,
                parseFloat(style.height) * 0.5
              )
            );
            return { x: point.x / point.w, y: point.y / point.w };
          }, x);
        const a = await edge(first.id, 1);
        const b = await edge(right.id, 0);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1);
      }
      await page.mouse.up();
      await expect
        .poll(async () => (await sceneCard(page, 'union-0')).bounds.y)
        .toBeLessThan(first.bounds.y);
      await page.locator(`[data-card-id="${top}"]`).click();
      await page.keyboard.press('r');
      await expect
        .poll(
          async () => (await sceneCard(page, 'union-0')).rotationQuarterTurns
        )
        .toBe(1);
      await page.locator('#flipBoardButton').click();
      await expect
        .poll(async () => (await sceneCard(page, 'union-0')).side)
        .toBe('opponent');
      // The full composition and per-print metadata survive recipient replay.
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        chooseMenuItem(page, 'exportState'),
      ]);
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      // Watch a replay… opens this picker.
      await page.locator('#jsonReplay').setInputFiles({
        name: 'assembled.json',
        mimeType: 'application/json',
        buffer: Buffer.concat(chunks),
      });
      // File input completion precedes the asynchronous replay installation.
      // Reset belongs to the replay only after its controls have taken over.
      const exitReplay = page.locator('#boardButtonContainer #exitReplay');
      await expect(exitReplay).toBeVisible();
      // The transport's fast-forward.
      await page.locator('#boardButtonContainer #resetBothButton').click();
      await expect(
        page.locator('.ptcgsim-card[data-card-composition="joined"]')
      ).toHaveCount(4);
      await exitReplay.click();
      const piece = await sceneCard(page, 'union-0');
      await page.locator(`[data-card-id="${piece.id}"]`).dblclick();
      await page.getByRole('button', { name: 'View individual cards' }).click();
      await page.locator(`[data-stack-preview-card-id="${piece.id}"]`).click();
      await page
        .getByRole('button', { name: 'Separate this card to hand' })
        .click();
      await expect
        .poll(async () =>
          (await sceneCard(page, 'union-0')).parentId.endsWith(':hand')
        )
        .toBe(true);
      await expect(
        page.locator('.ptcgsim-card[data-card-composition="joined"]')
      ).toHaveCount(3);
    });

    test('LEGEND and BREAK preserve their physical artwork and readable previews', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await start(page);
      let top = await fromDeck(page, 'legend-0', 'b');
      top = await join(page, 'legend-1', top);
      await page.locator(`[data-card-id="${top}"]`).dblclick();
      await expect(
        page.locator('[data-preview-kind="composition"]')
      ).toBeVisible();
      await expect(page.locator('.ptcgsim-composition-piece')).toHaveCount(2);
      await page.keyboard.press('Escape');
      const base = await fromDeck(page, 'greninja', 'a');
      const breakId = await join(page, 'break', base);
      await expect
        .poll(() =>
          page
            .locator('.board-spike-host')
            .evaluate((element) => element.scrollLeft)
        )
        .toBe(0);
      const overlay = await sceneCard(page, 'break');
      expect(overlay.rotationQuarterTurns).toBe(1);
      await page.locator(`[data-card-id="${breakId}"]`).dblclick();
      await expect(
        page.locator(
          '.ptcgsim-composition-artwork[data-card-composition="overlay"]'
        )
      ).toBeVisible();
      await page.getByRole('button', { name: 'View individual cards' }).click();
      await page.locator(`[data-stack-preview-card-id="${breakId}"]`).click();
      await expect(page.locator('[data-preview-kind="card"]')).toHaveAttribute(
        'data-landscape',
        'true'
      );
      await expect(
        page.locator('[data-preview-kind="card"] img')
      ).toHaveAttribute('src', /\?break$/);
      const image = await page
        .locator('.ptcgsim-card-preview-tilt')
        .boundingBox();
      expect(image!.width / image!.height).toBeCloseTo(88 / 63, 2);
    });

    test('paired Stadium parts coexist and replacement clears the entire old Stadium', async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await start(page);
      await fromDeck(page, 'stadium-1', 'g');
      await fromDeck(page, 'stadium-0', 'g');
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
                (zone) => zone.kind === 'stadium'
              )!.count
          )
        )
        .toBe(2);
      await page.keyboard.press('Escape');
      const left = await sceneCard(page, 'stadium-0');
      const right = await sceneCard(page, 'stadium-1');
      expect(left.bounds.x + left.bounds.width).toBeCloseTo(right.bounds.x, 5);
      await page.locator(`[data-card-id="${left.id}"]`).dblclick();
      await expect(
        page.locator('[data-preview-kind="composition"]')
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await fromDeck(page, 'replacement', 'g');
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
                (zone) => zone.kind === 'stadium'
              )!.count
          )
        )
        .toBe(1);
      expect((await sceneCard(page, 'stadium-0')).parentId).toMatch(
        /:discard$/
      );
      expect((await sceneCard(page, 'stadium-1')).parentId).toMatch(
        /:discard$/
      );
    });

    test('an opponent-attached Tool retains its owner when the Pokémon leaves play', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await start(page);
      await openDeck(page);
      await page.locator('#nativeDeckBuilderTargetAlt').click();
      await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
        name: 'opponent.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          'QTY,Name,Type,URL\n1,Opponent EX,Pokémon,/v2/assets/cardback.png?opponent'
        ),
      });
      await expect(
        page.locator('#nativeDeckBuilderSummaryPanel')
      ).toContainText('Total: 1');
      await page.locator('#nativeDeckBuilderPlayButton').click();
      await expect(page.locator('#nativeDeckBuilderWorkspace')).toBeHidden();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__PTCG_RENDERER_SPIKE__!.scene.cards.length
          )
        )
        .toBe(13);
      const opponentSide = await page.evaluate(
        () =>
          window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
            (zone) => zone.kind === 'deck' && zone.count === 1
          )!.side
      );
      if (opponentSide !== 'local')
        await page.locator('#flipBoardButton').click();
      // The deck is loaded but not set up, so the rail offers Set up rather
      // than Turn (ADR-030); Start turn's key draws the card.
      await page.keyboard.press('Alt+t');
      await expect
        .poll(async () => (await sceneCard(page, 'opponent'))?.parentId)
        .toMatch(/:hand$/);
      const inHand = await sceneCard(page, 'opponent');
      await page.locator(`[data-card-id="${inHand.id}"]`).click();
      await page.keyboard.press('a');
      await expect
        .poll(async () => (await sceneCard(page, 'opponent'))?.role)
        .toBe('stackEvolution');
      const opponent = await sceneCard(page, 'opponent');
      if (opponent.side === 'local') {
        await page.locator('#flipBoardButton').click();
        await expect
          .poll(async () => (await sceneCard(page, 'opponent')).side)
          .toBe('opponent');
      }
      await fromDeck(page, 'head-ringer', 'q');
      await page
        .getByRole('button', { name: 'Opponent EX', exact: true })
        .click();
      await expect
        .poll(async () => (await sceneCard(page, 'head-ringer')).role)
        .toBe('stackAttachment');
      const attached = await sceneCard(page, 'head-ringer');
      expect(attached.side).toBe('opponent');
      await page
        .getByRole('button', { name: 'Opponent EX', exact: true })
        .click();
      await page.keyboard.press('d');
      await expect(
        page.locator('[data-legacy-work-area="staged"]')
      ).toBeVisible();
      const stagedRevision = await page.evaluate(
        () => window.__PTCG_RENDERER_SPIKE__!.scene.revision
      );
      await page
        .getByRole('button', { name: 'Discard all', exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(() => window.__PTCG_RENDERER_SPIKE__!.scene.revision)
        )
        .toBeGreaterThan(stagedRevision);
      await expect
        .poll(async () => (await sceneCard(page, 'head-ringer'))?.parentId)
        .toMatch(/:discard$/);
      expect((await sceneCard(page, 'head-ringer')).side).toBe('local');
      expect(
        await page.evaluate(
          () =>
            window.__PTCG_RENDERER_SPIKE__!.scene.cards.filter((card) =>
              card.imageUrl.endsWith('?head-ringer')
            ).length
        )
      ).toBe(1);
    });
  });
