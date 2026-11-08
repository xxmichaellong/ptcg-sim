import { expect, test } from '@playwright/test';
import { ownRoomBudget } from './support/room-budget.js';
import {
  openDeck,
  openPlayOnline,
  closeSheet,
  dismissWelcome,
  openSettings,
} from './support/table-shell.js';
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440 });
    test('composes and reuses deck looks, renames both seats and keeps room entry focused', async ({
      page,
      context,
    }) => {
      test.setTimeout(120_000);
      await ownRoomBudget(context);
      await page.goto('/');
      await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
      await dismissWelcome(page);
      await openDeck(page);
      await expect(page.locator('#deckClipboardButton')).toHaveCount(0);
      await page.locator('#deckNewButton').click();
      await page
        .locator('.deck-editor__sections')
        .getByRole('button', { name: 'Customize', exact: true })
        .click();
      await expect(page.locator('.deck-editor__panes')).toHaveCount(0);
      const custom = page.locator('.deck-customize');
      await custom
        .getByRole('button', { name: 'Card back', exact: true })
        .click();
      let designer = page.getByRole('dialog', {
        name: 'Card back',
        exact: true,
      });
      await designer.locator('#cardBackMode-design').check();
      await designer
        .getByRole('radio', { name: 'Gold', exact: true })
        .first()
        .check();
      await designer.locator('#useCardBackButton').click();
      await expect(designer).toHaveCount(0);
      await custom.getByRole('button', { name: 'Coin', exact: true }).click();
      designer = page.getByRole('dialog', { name: 'Coin', exact: true });
      await designer.locator('#cardBackMode-design').check();
      await designer
        .getByRole('radio', { name: 'Gold', exact: true })
        .first()
        .check();
      await designer.locator('#useCardBackButton').click();
      await expect(designer).toHaveCount(0);
      await custom.locator('#deckMat-ocean').check();
      await custom
        .getByRole('textbox', { name: 'Theme name', exact: true })
        .fill('Ocean gold');
      await custom
        .getByRole('button', { name: 'Save theme', exact: true })
        .click();
      const sleeve = await custom
        .locator('.deck-customize__look img')
        .first()
        .getAttribute('src');
      const coin = await custom
        .locator('.deck-customize__coin')
        .getAttribute('src');
      await custom.getByRole('button', { name: 'Reset', exact: true }).click();
      await custom
        .getByRole('button', { name: 'Ocean gold', exact: true })
        .click();
      await expect(custom.locator('#deckMat-ocean')).toBeChecked();
      await expect(
        custom.locator('.deck-customize__look img').first()
      ).toHaveAttribute('src', sleeve!);
      await expect(custom.locator('.deck-customize__coin')).toHaveAttribute(
        'src',
        coin!
      );
      await custom
        .getByRole('button', { name: 'Playmat', exact: true })
        .click();
      designer = page.getByRole('dialog', { name: 'Playmat', exact: true });
      await expect(designer.locator('[data-shape="mat"]')).toBeVisible();
      await designer.locator('#cardBackMode-design').check();
      await designer
        .getByRole('radio', { name: 'Gold', exact: true })
        .first()
        .check();
      await expect(
        designer.locator('.card-back-chooser__card').first()
      ).toHaveCSS('aspect-ratio', '5 / 3');
      await designer
        .getByRole('button', { name: 'Use this playmat', exact: true })
        .click();
      await expect(designer).toHaveCount(0);
      await expect(custom).toHaveCSS('opacity', '1');
      await page.screenshot({
        path: `/tmp/ptcg-deck-customize-${viewport.width}.png`,
      });
      await page.locator('#deckUseOnSeatButton').click();
      await page.locator('#deckEditorBackButton').click();
      await page.locator('#deckBackButton').click();
      await expect(
        page.locator('[data-table-coin="local"] .table-coin__face--heads img')
      ).toHaveAttribute('src', coin!);
      await expect(page.locator('[data-player-frame-side="local"]')).toHaveCSS(
        'background-image',
        /data:image\/svg/
      );
      await expect(
        page.locator('[data-zone-kind="bench"][data-zone-side="local"]')
      ).toHaveAttribute('data-table-art-swatch', 'charcoal');
      await page.reload();
      await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
      await expect(
        page.locator('[data-table-coin="local"] .table-coin__face--heads img')
      ).toHaveAttribute('src', coin!);
      await expect(page.locator('[data-player-frame-side="local"]')).toHaveCSS(
        'background-image',
        /data:image\/svg/
      );
      await openSettings(page);
      const p1 = page.getByRole('textbox', {
          name: 'Name for P1',
          exact: true,
        }),
        p2 = page.getByRole('textbox', { name: 'Name for P2', exact: true });
      await p1.fill('Michael');
      await p1.press('Enter');
      await p2.fill('Practice');
      await p2.press('Enter');
      await closeSheet(page);
      await openSettings(page);
      await expect(p1).toHaveValue('Michael');
      await expect(p2).toHaveValue('Practice');
      await closeSheet(page);
      await openPlayOnline(page);
      await expect(page.locator('#playOnlineSheet')).toBeVisible();
      await expect(page.locator('#pasteInvitationButton')).toHaveCount(0);
      await expect(page.locator('#generateIdButton')).toBeVisible();
      await expect(page.locator('#joinRoomButton')).toBeHidden();
      await page
        .locator('.lobby-flow')
        .getByRole('button', { name: 'Join a room', exact: true })
        .click();
      await expect(page.locator('#generateIdButton')).toBeHidden();
      await expect(page.locator('#joinRoomButton')).toBeVisible();
      await expect(page.locator('#joinRoomButton')).toBeDisabled();
      await page.screenshot({
        path: `/tmp/ptcg-room-entry-${viewport.width}.png`,
      });
    });
  });

test('an uploaded playmat keeps its landscape crop, reaches the live seat and survives reload', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await ownRoomBudget(context);
  await page.goto('/');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  await dismissWelcome(page);
  await openDeck(page);
  await page.locator('#deckNewButton').click();
  await page
    .locator('.deck-editor__sections')
    .getByRole('button', { name: 'Customize', exact: true })
    .click();
  const custom = page.locator('.deck-customize');
  await custom.getByRole('button', { name: 'Playmat', exact: true }).click();
  const designer = page.getByRole('dialog', { name: 'Playmat', exact: true });
  await designer.locator('#cardBackMode-picture').check();
  await designer.locator('#cardBackFileInput').setInputFiles({
    name: 'mat.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="900"><rect width="1500" height="900" fill="#2368a1"/><circle cx="750" cy="450" r="220" fill="#eac04a"/></svg>'
    ),
  });
  await expect(designer.locator('.card-back-crop img')).toBeVisible();
  await designer.locator('#useCardBackButton').click();
  await expect(designer).toHaveCount(0);
  const picture = await custom
    .locator('.deck-customize__mat')
    .evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(picture).toContain('/v2/images/');
  const url = picture.slice(5, -2);
  const pixels = await page.evaluate(async (source) => {
    const bitmap = await createImageBitmap(await (await fetch(source)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const size = {
      width: bitmap.width,
      height: bitmap.height,
      right: [...context.getImageData(950, 300, 1, 1).data],
      center: [...context.getImageData(500, 300, 1, 1).data],
    };
    bitmap.close();
    return size;
  }, url);
  expect(pixels).toMatchObject({ width: 1000, height: 600 });
  expect(pixels.right[3]).toBe(255);
  expect(pixels.right[2]).toBeGreaterThan(pixels.right[0]! + 70);
  expect(pixels.center[0]).toBeGreaterThan(200);
  expect(pixels.center[2]).toBeLessThan(120);
  await page.locator('#deckUseOnSeatButton').click();
  await page.locator('#deckEditorBackButton').click();
  await page.locator('#deckBackButton').click();
  const mat = page.locator('[data-player-frame-side="local"]');
  await expect(mat).toHaveCSS('background-image', picture);
  await page.reload();
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  await expect(mat).toHaveCSS('background-image', picture);
  await page.screenshot({ path: '/tmp/ptcg-playmat-upload.png' });
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test.describe(`asset deletion at ${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440 });
    test('deletion and Undo update deck looks, and cancelled pickers do not resurrect deleted assets', async ({
      page,
      context,
    }) => {
      test.setTimeout(120000);
      await ownRoomBudget(context);
      await page.goto('/');
      await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
      await dismissWelcome(page);
      await openDeck(page);
      await page.locator('#deckNewButton').click();
      await page
        .locator('.deck-editor__sections')
        .getByRole('button', { name: 'Customize', exact: true })
        .click();
      const custom = page.locator('.deck-customize');
      for (const kind of ['Card back', 'Coin', 'Playmat']) {
        const opener = custom.getByRole('button', { name: kind, exact: true });
        await opener.click();
        const designer = page.getByRole('dialog', { name: kind, exact: true });
        await designer.locator('#cardBackMode-design').check();
        await designer
          .getByRole('radio', { name: 'Gold', exact: true })
          .first()
          .check();
        await designer.locator('#useCardBackButton').click();
        await expect(designer).toHaveCount(0);
        const look = custom
          .locator('.deck-customize__look')
          .nth(['Card back', 'Coin', 'Playmat'].indexOf(kind));
        const shown = () =>
          look.evaluate(
            (node) =>
              node.querySelector('img')?.getAttribute('src') ??
              getComputedStyle(node.querySelector('.deck-customize__mat')!)
                .backgroundImage
          );
        const original = await shown();
        await opener.click();
        await designer.locator('#cardBackMode-backs').check();
        const asset = await designer
          .locator('[data-delete-card-back]')
          .first()
          .getAttribute('data-delete-card-back');
        expect(asset).toMatch(/^design:/);
        const deletion = designer.locator(`[data-delete-card-back="${asset}"]`);
        await deletion.click();
        await expect.poll(shown).not.toBe(original);
        await designer.locator('#undoCardBackDeleteButton').click();
        await expect.poll(shown).toBe(original);
        await deletion.click();
        await expect.poll(shown).not.toBe(original);
        await designer
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
        await expect(designer).toHaveCount(0);
        await opener.click();
        await designer.locator('#cardBackMode-backs').check();
        await expect(deletion).toHaveCount(0);
        await designer
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
        await expect(designer).toHaveCount(0);
        await expect.poll(shown).not.toBe(original);
      }
      await page.reload();
      await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
      await openDeck(page);
      await page
        .getByRole('list', { name: 'Your decks', exact: true })
        .getByRole('button', { name: /^Edit /u })
        .first()
        .click();
      await page
        .locator('.deck-editor__sections')
        .getByRole('button', { name: 'Customize', exact: true })
        .click();
      for (const kind of ['Card back', 'Coin', 'Playmat']) {
        await custom.getByRole('button', { name: kind, exact: true }).click();
        const designer = page.getByRole('dialog', { name: kind, exact: true });
        await designer.locator('#cardBackMode-backs').check();
        await expect(designer.locator('[data-delete-card-back]')).toHaveCount(
          0
        );
        await designer
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
        await expect(designer).toHaveCount(0);
      }
    });
  });
