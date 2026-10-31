import type { BrowserContext, Page } from '@playwright/test';

/** A one-pixel PNG: any picture the import can re-encode. */
export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

/** Where an uploaded card back is served from (ADR-041). */
export const STORED_CARD_BACK = /^\/v2\/images\/[0-9a-f]{64}$/u;

/**
 * Stands in for the Worker's fetch of an outside card-back picture (the
 * local server can't reach the internet): the browser's request to the
 * app's own import endpoint answers with a picture, which the page then
 * re-encodes and uploads to the real image store. Returns the URLs asked
 * for, in order.
 */
export const routeCardBackImport = async (
  target: Page | BrowserContext,
  picture: Buffer = ONE_PIXEL_PNG
): Promise<string[]> => {
  const asked: string[] = [];
  await target.route('**/v2/images/import', async (route) => {
    const body = route.request().postDataJSON() as { url?: string };
    asked.push(body.url ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: picture,
    });
  });
  return asked;
};
