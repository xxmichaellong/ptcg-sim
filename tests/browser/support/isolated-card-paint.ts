import type { Page } from '@playwright/test';

const settlePaint = (): Promise<void> =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

export const isolateLegacyIframeCardPaint = async (
  page: Page,
  cardSelector: string,
  options: { readonly rootCardSelector?: string } = {}
): Promise<void> => {
  const rootCardVisibility = options.rootCardSelector
    ? `${options.rootCardSelector} { visibility: visible !important; }`
    : '';
  await page.addStyleTag({
    content: `
      html, body { background: #fff !important; }
      body * { visibility: hidden !important; }
      #selfContainer, #oppContainer { visibility: visible !important; }
      ${rootCardVisibility}
    `,
  });
  for (const frameSelector of ['#selfContainer', '#oppContainer']) {
    await page
      .frameLocator(frameSelector)
      .locator('head')
      .evaluate((head, selector) => {
        const style = document.createElement('style');
        style.textContent = `
          html, body { background: transparent !important; }
          body * { visibility: hidden !important; }
          ${selector} { visibility: visible !important; }
          *, *::before, *::after {
            animation: none !important;
            caret-color: transparent !important;
            transition: none !important;
          }
        `;
        head.append(style);
      }, cardSelector);
  }
  await page.evaluate(settlePaint);
};

export const isolateCandidateCardPaint = async (
  page: Page,
  hostSelector: string,
  cardSelector: string
): Promise<void> => {
  await page.addStyleTag({
    content: `
      html, body { background: #fff !important; }
      body * { visibility: hidden !important; }
      ${hostSelector},
      ${hostSelector} ${cardSelector},
      ${hostSelector} ${cardSelector} * {
        visibility: visible !important;
      }
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        transition: none !important;
      }
    `,
  });
  await page
    .locator(`${hostSelector} ${cardSelector} img`)
    .evaluateAll(async (images) => {
      await Promise.all(
        images.map((image) => (image as HTMLImageElement).decode())
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    });
};
