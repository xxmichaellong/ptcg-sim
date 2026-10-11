import { expect, test, type Locator, type Page } from '@playwright/test';

// Geometry tests are independent of the external art host. Real art is checked
// separately in the visual research captures.
test.beforeEach(async ({ page }) => {
  await page.route('https://assets.tcgdex.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="630" height="880"><rect width="630" height="880" rx="20" fill="#569eae"/></svg>',
    })
  );
});
const start = async (page: Page) => {
  await page.goto('/?depth-lab=1');
  await expect(page.locator('[data-card="local-deck"]')).toBeVisible();
};
const card = (page: Page, id: string) => page.locator(`[data-card="${id}"]`);
const point = (element: Locator, u = 0.5, v = 0.5) =>
  element.evaluate(
    (node, { u, v }) => {
      const matrix = new DOMMatrix(getComputedStyle(node).transform);
      const p = matrix.transformPoint(
        new DOMPoint(
          parseFloat(getComputedStyle(node).width) * u,
          parseFloat(getComputedStyle(node).height) * v
        )
      );
      const root = document
        .querySelector('[data-testid="depth-board"]')!
        .getBoundingClientRect();
      return { x: root.left + p.x / p.w, y: root.top + p.y / p.w };
    },
    { u, v }
  );
const height = async (element: Locator) =>
  Number(await element.getAttribute('data-height'));
const range = async (page: Page, name: string, value: string) => {
  await page.getByRole('slider', { name, exact: true }).fill(value);
};

test('pile height follows the count, empty piles vanish, and mode persists', async ({
  page,
}) => {
  await start(page);
  const deck = card(page, 'local-deck');
  const initial = await height(deck);
  await page.getByRole('button', { name: 'Draw one', exact: true }).click();
  await expect(page.locator('[data-count-for="local-deck"]')).toHaveText('46');
  await expect.poll(() => height(deck)).toBeLessThan(initial);
  await range(page, 'Your deck size', '1');
  await expect.poll(() => height(deck)).toBeLessThan(1);
  await range(page, 'Your deck size', '0');
  await expect(deck).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Draw one', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Reset scene' }).click();
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  await expect.poll(() => height(deck)).toBe(0);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Flat', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 'local-deck')).toHaveAttribute(
    'data-height',
    '0.0000'
  );
});

test('a lifted card keeps its grip under the pointer at the steepest camera angle', async ({
  page,
}) => {
  await start(page);
  await range(page, 'Camera tilt', '18');
  const selected = card(page, 'local-bench-b');
  const original = await point(selected, 0.27, 0.61);
  const destination = { x: original.x - 110, y: original.y - 60 };
  await page.mouse.move(original.x, original.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 8 });
  await expect(selected).toHaveAttribute('data-dragging', 'true');
  const lifted = await point(selected, 0.27, 0.61);
  expect(
    Math.hypot(lifted.x - destination.x, lifted.y - destination.y)
  ).toBeLessThan(1);
  expect(Number(await selected.getAttribute('data-lift'))).toBeGreaterThan(0);
  await page.mouse.up();
  const resting = await point(selected, 0.27, 0.61);
  expect(
    Math.hypot(resting.x - destination.x, resting.y - destination.y)
  ).toBeLessThan(1);
  await expect(selected).toHaveAttribute('data-lift', '0');
});

test('V-UNION remains on one plane and moves as a complete joined object', async ({
  page,
}) => {
  await start(page);
  const pieces = [0, 1, 2, 3].map((index) => card(page, `union-${index}`));
  // Initial measurement can resize the lab and ease the heights. Read all
  // pieces in one frame, after they have settled onto their shared plane.
  await expect
    .poll(() =>
      page
        .locator('[data-card^="union-"]')
        .evaluateAll(
          (nodes) =>
            new Set(nodes.map((node) => node.getAttribute('data-height'))).size
        )
    )
    .toBe(1);
  const before = await Promise.all(pieces.map((piece) => point(piece)));
  await page.mouse.move(before[0]!.x, before[0]!.y);
  await page.mouse.down();
  await page.mouse.move(before[0]!.x + 90, before[0]!.y - 60, { steps: 5 });
  for (const piece of pieces)
    await expect(piece).toHaveAttribute('data-dragging', 'true');
  const rightEdge = await point(pieces[0]!, 1, 0.5);
  const leftEdge = await point(pieces[1]!, 0, 0.5);
  expect(
    Math.hypot(rightEdge.x - leftEdge.x, rightEdge.y - leftEdge.y)
  ).toBeLessThan(1);
  await page.mouse.up();
  for (const [index, piece] of pieces.entries())
    expect((await point(piece)).x).toBeGreaterThan(before[index]!.x + 75);
});

test('Escape and resizing cancel drags; keyboard movement and card reading work', async ({
  page,
}) => {
  await start(page);
  const selected = card(page, 'local-bench-b');
  const original = await point(selected);
  await page.mouse.move(original.x, original.y);
  await page.mouse.down();
  await page.mouse.move(original.x - 100, original.y - 30);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await point(selected)).x).toBeCloseTo(original.x, 1);
  await selected.focus();
  await page.keyboard.press('ArrowLeft');
  expect((await point(selected)).x).toBeLessThan(original.x - 3);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Head Ringer' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(selected).toBeFocused();
  const current = await point(selected);
  await page.mouse.move(current.x, current.y);
  await page.mouse.down();
  await page.mouse.move(current.x - 50, current.y - 30);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(selected).toHaveAttribute('data-dragging', 'false');
  await expect(selected).toHaveAttribute('data-lift', '0');
  await page.mouse.up();
  await card(page, 'active-break').dblclick();
  await expect(
    page.getByRole('dialog', { name: 'Greninja BREAK' })
  ).toBeVisible();
  await expect(page.locator('.depth-lab__preview-art')).toHaveAttribute(
    'data-landscape',
    'true'
  );
});

test('reduced motion preserves static depth but disables easing and drag lift', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  await expect(page.locator('[data-height-motion]')).toHaveAttribute(
    'data-height-motion',
    'false'
  );
  expect(await height(card(page, 'local-deck'))).toBeGreaterThan(5);
  const selected = card(page, 'local-bench-b');
  const startPoint = await point(selected);
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.move(startPoint.x - 75, startPoint.y - 30);
  await expect(selected).toHaveAttribute('data-dragging', 'true');
  await expect(selected).toHaveAttribute('data-lift', '0');
  await page.mouse.up();
  await range(page, 'Your deck size', '1');
  expect(await height(card(page, 'local-deck'))).toBeLessThan(1);
});

test('both seats, joined cards and hand fit in each camera mode at desktop sizes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page);
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 768 },
    { width: 724, height: 768 },
  ]) {
    await page.setViewportSize(size);
    for (const mode of ['Flat', 'Raised', 'Tabletop']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      if (mode === 'Tabletop') await range(page, 'Camera tilt', '18');
      const overflow = await page
        .locator('[data-card]')
        .evaluateAll((nodes) => {
          const root = document
            .querySelector('[data-testid="depth-board"]')!
            .getBoundingClientRect();
          return nodes
            .filter((node) => {
              const r = node.getBoundingClientRect();
              return (
                r.left < root.left - 1 ||
                r.top < root.top - 1 ||
                r.right > root.right + 1 ||
                r.bottom > root.bottom + 1
              );
            })
            .map((node) => (node as HTMLElement).dataset['card']);
        });
      expect(overflow).toEqual([]);
    }
  }
  expect(errors).toEqual([]);
});
