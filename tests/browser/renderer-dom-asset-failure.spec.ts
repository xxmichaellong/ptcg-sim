import { expect, test, type Page } from '@playwright/test';

const assetOrigin = 'https://arbitrary-card-images.example.test';
const missingUrl = `${assetOrigin}/missing.png`;
const corruptUrl = `${assetOrigin}/corrupt.png`;
const directUrl = `${assetOrigin}/direct.png`;
const redirectUrl = `${assetOrigin}/redirect.png`;
const redirectedUrl = 'http://127.0.0.1:4173/v2/assets/cardback.png';
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==',
  'base64'
);

const collectRuntimeErrors = (page: Page) => {
  const errors: string[] = [];
  const expectedResourceErrors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (message.text().startsWith('Failed to load resource:')) {
      expectedResourceErrors.push(message.text());
      return;
    }
    errors.push(`console: ${message.text()}`);
  });
  return { errors, expectedResourceErrors };
};

test('React DOM contains external card asset failures and recovers the stable card node', async ({
  page,
}, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const requestedUrls: string[] = [];
  await page.context().route(`${assetOrigin}/**`, async (route) => {
    const url = route.request().url();
    requestedUrls.push(url);
    if (url === missingUrl) {
      await route.fulfill({ status: 404, body: 'missing' });
      return;
    }
    if (url === corruptUrl) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('not a png'),
      });
      return;
    }
    if (url === directUrl) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'cache-control': 'public, max-age=3600' },
        body: onePixelPng,
      });
      return;
    }
    if (url === redirectUrl) {
      await route.fulfill({
        status: 302,
        headers: { location: redirectedUrl },
      });
      return;
    }
    await route.abort('failed');
  });

  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  const targetId = await page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    const target = scene?.cards.find((card) => card.interactive);
    if (!target) throw new Error('Missing interactive card fixture');
    return target.id;
  });
  const card = page.locator(`[data-card-id="${targetId}"]`);
  const image = card.locator('img');
  await expect
    .poll(() =>
      image.evaluate((node) => (node as HTMLImageElement).naturalWidth)
    )
    .toBeGreaterThan(0);
  await image.evaluate((node) => {
    node.dataset.assetIdentityWitness = 'stable';
  });

  let revision = 10_000;
  const installUrl = async (url: string) => {
    revision += 1;
    await page.evaluate(
      ({ targetId, url, revision }) => {
        const spike = window.__PTCG_RENDERER_SPIKE__;
        if (!spike) throw new Error('Missing renderer spike');
        spike.renderer.installScene(
          {
            ...spike.scene,
            revision,
            cards: spike.scene.cards.map((candidate) =>
              candidate.id === targetId
                ? { ...candidate, imageUrl: url }
                : candidate
            ),
          },
          [],
          'replace'
        );
      },
      { targetId, url, revision }
    );
    await expect(image).toHaveAttribute('src', url);
    await expect
      .poll(() => requestedUrls.filter((requested) => requested === url).length)
      .toBe(1);
  };

  await installUrl(missingUrl);
  await expect(image).toHaveAttribute('data-card-image-state', 'failed');
  await expect(image).toHaveCSS('visibility', 'hidden');
  await expect(card).toHaveCSS('background-color', 'rgb(119, 119, 119)');
  await expect(card).toBeEnabled();
  await card.click();
  await expect(page.locator('output')).toContainText('CardSelected');
  await testInfo.attach('missing-card-placeholder.png', {
    body: await card.screenshot(),
    contentType: 'image/png',
  });

  await installUrl(corruptUrl);
  await expect(image).toHaveAttribute('data-card-image-state', 'failed');
  await expect(image).toHaveCSS('visibility', 'hidden');
  await testInfo.attach('corrupt-card-placeholder.png', {
    body: await card.screenshot(),
    contentType: 'image/png',
  });

  await installUrl(directUrl);
  await expect(image).toHaveAttribute('data-card-image-state', 'ready');
  await expect(image).toHaveCSS('visibility', 'visible');
  await expect
    .poll(() =>
      image.evaluate((node) => (node as HTMLImageElement).naturalWidth)
    )
    .toBe(1);
  await expect(image).not.toHaveAttribute('crossorigin');

  const resolvedRedirect = page.waitForResponse(
    (response) => response.url() === redirectedUrl && response.ok()
  );
  await installUrl(redirectUrl);
  await resolvedRedirect;
  await expect(image).toHaveAttribute('data-card-image-state', 'ready');
  await expect(image).toHaveCSS('visibility', 'visible');
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).currentSrc))
    .toBe(redirectUrl);
  await expect(image).toHaveAttribute('data-asset-identity-witness', 'stable');
  await expect(card).toHaveAttribute('data-card-id', targetId);
  expect(requestedUrls).toEqual([
    missingUrl,
    corruptUrl,
    directUrl,
    redirectUrl,
  ]);
  expect(runtimeErrors.errors).toEqual([]);
  expect(runtimeErrors.expectedResourceErrors).toHaveLength(1);
  expect(runtimeErrors.expectedResourceErrors[0]).toContain('404');

  await testInfo.attach('external-card-asset-evidence.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          targetId,
          requestedUrls,
          finalImage: {
            corsAttribute: await image.getAttribute('crossorigin'),
            state: await image.getAttribute('data-card-image-state'),
            currentSrc: await image.evaluate(
              (node) => (node as HTMLImageElement).currentSrc
            ),
          },
          cardRemainedEnabled: await card.isEnabled(),
          expectedResourceErrors: runtimeErrors.expectedResourceErrors,
        },
        null,
        2
      )
    ),
    contentType: 'application/json',
  });
});
