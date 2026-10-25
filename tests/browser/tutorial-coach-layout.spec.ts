import { expect, test, type Locator } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { useFlatTable } from './support/table-shell.js';

const cases = [
  { locale: 'en', width: 320, height: 740 },
  { locale: 'es', width: 320, height: 740 },
  { locale: 'de', width: 320, height: 740 },
  { locale: 'ar', width: 320, height: 740 },
  { locale: 'fil', width: 320, height: 740 },
  { locale: 'de', width: 812, height: 375 },
];

test.use({ hasTouch: true, isMobile: true });

const expectFooterInside = async (panel: Locator) => {
  const actions = panel.locator('.tutorial-coach__actions button');
  await expect
    .poll(() =>
      panel.evaluate(
        (panel) =>
          panel
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === 'running').length
      )
    )
    .toBe(0);
  const bounds = await panel.evaluate((panel) => {
    const box = panel.getBoundingClientRect();
    return [...panel.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        inside:
          rect.left >= box.left &&
          rect.right <= box.right &&
          rect.top >= box.top &&
          rect.bottom <= box.bottom &&
          rect.right <= innerWidth &&
          rect.bottom <= innerHeight,
        height: rect.height,
        unclipped: button.scrollWidth <= button.clientWidth,
      };
    });
  });
  expect(bounds.every((button) => button.inside && button.unclipped)).toBe(
    true
  );
  const actionHeights = await actions.evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().height)
  );
  expect(
    actionHeights.every((height) => height >= 39.5),
    JSON.stringify(actionHeights)
  ).toBe(true);
};

for (const { locale, width, height } of cases) {
  test(`${locale} ${width}: lesson completion keeps both actions inside the coach and the next lesson usable`, async ({
    context,
    page,
  }) => {
    await ownRoomBudget(context);
    await useFlatTable(page);
    await page.setViewportSize({ width, height });
    await page.addInitScript((language) => {
      localStorage.setItem('ptcgsim.language.v1', JSON.stringify({ language }));
    }, locale);
    await page.goto('/?tutorial=attach&renderer=dom');
    const coach = page.locator('.tutorial-coach[data-tutorial-step]');
    // This regression concerns the completion layout. Skip each table task
    // through its ordinary UI, keeping the real lesson transition/deal.
    for (const step of ['energy', 'evolve', 'trainer', 'bench', 'undo']) {
      await expect(coach).toHaveAttribute(
        'data-tutorial-step',
        `attach:${step}`,
        { timeout: 20_000 }
      );
      await coach.locator('.tutorial-coach__skip').tap();
    }
    const done = page.locator('[data-tutorial-done="attach"]');
    await expect(done).toBeVisible();
    const actions = done.locator('.tutorial-coach__actions button');
    await expect(actions).toHaveCount(2);
    await expectFooterInside(done);
    // Wrapping preserves keyboard order and the focused next lesson.
    await expect(actions.last()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(actions.first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(actions.last()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(coach).toHaveAttribute('data-tutorial-step', 'damage:menu');
    const target = page
      .locator(
        '.ptcgsim-card[data-card-side="opponent"]:not([data-in-hand])[aria-label^="Kirlia"]'
      )
      .first();
    await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
      'data-motion',
      'idle'
    );
    await expect
      .poll(() =>
        target.evaluate((card) => {
          const rect = card.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2
          );
          return hit !== null && card.contains(hit);
        })
      )
      .toBe(true);
    await target.tap();
    await expect(page.locator('#touchCardActionsButton')).toBeVisible();
  });
}

for (const locale of ['en', 'ar', 'fil']) {
  test(`${locale} 320: the coach leaves the selected Pokémon's touch Actions reachable`, async ({
    context,
    page,
  }) => {
    await ownRoomBudget(context);
    await useFlatTable(page);
    await page.setViewportSize({ width: 320, height: 740 });
    await page.addInitScript((language) => {
      localStorage.setItem('ptcgsim.language.v1', JSON.stringify({ language }));
    }, locale);
    await page.goto('/?tutorial=damage&renderer=dom');
    const coach = page.locator('.tutorial-coach[data-tutorial-step]');
    await expect(coach).toHaveAttribute('data-tutorial-step', 'damage:menu', {
      timeout: 20_000,
    });
    await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
      'data-motion',
      'idle'
    );
    await page
      .locator(
        '.ptcgsim-card[data-card-side="opponent"]:not([data-in-hand])[aria-label^="Kirlia"]'
      )
      .first()
      .tap();
    await page.locator('#touchCardActionsButton').tap({ timeout: 5000 });
    await expect(coach).toHaveAttribute('data-tutorial-step', 'damage:counter');
    await page.locator('[data-context-action="setDamage"]').tap();
    await expect(coach).toHaveAttribute('data-tutorial-step', 'damage:sixty');
    const damage = page.locator('input.ptcgsim-marker-controls__value');
    await damage.fill('60');
    await page.keyboard.press('Enter');
    await expect(coach).toHaveAttribute('data-tutorial-step', 'damage:poison');
  });
}

for (const locale of ['de', 'fr']) {
  for (const width of [320, 812]) {
    test(`${locale} ${width}: drag-step footer fits and evolution remains reachable`, async ({
      context,
      page,
    }) => {
      await ownRoomBudget(context);
      await useFlatTable(page);
      await page.setViewportSize({ width, height: width === 320 ? 740 : 375 });
      await page.addInitScript(
        (language) =>
          localStorage.setItem(
            'ptcgsim.language.v1',
            JSON.stringify({ language })
          ),
        locale
      );
      await page.goto('/?tutorial=attach&renderer=dom');
      const coach = page.locator('.tutorial-coach[data-tutorial-step]');
      await expect(coach).toHaveAttribute(
        'data-tutorial-step',
        'attach:energy',
        {
          timeout: 20_000,
        }
      );
      await coach.locator('.tutorial-coach__skip').tap();
      await expect(coach).toHaveAttribute(
        'data-tutorial-step',
        'attach:evolve'
      );
      await expectFooterInside(coach);
      await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
        'data-motion',
        'idle'
      );
      const source = page
        .locator(
          '.ptcgsim-card[data-card-side="local"][data-in-hand][aria-label^="Charmeleon"]'
        )
        .first();
      const grip = await source.evaluate((card) => {
        const r = card.getBoundingClientRect();
        for (
          let y = r.top + 6;
          y < Math.min(innerHeight - 2, r.bottom - 2);
          y += 4
        )
          for (
            let x = r.left + 6;
            x < Math.min(innerWidth - 2, r.right - 2);
            x += 4
          ) {
            const hit = document.elementFromPoint(x, y);
            if (hit && card.contains(hit)) return { x, y };
          }
        throw new Error('Evolution card is covered');
      });
      const target = page
        .locator(
          '.ptcgsim-card[data-card-side="local"]:not([data-in-hand])[aria-label^="Charmander"]'
        )
        .first();
      const box = (await target.boundingBox())!;
      // A native drag also exercises the newly taller coach's avoidance.
      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
        steps: 14,
      });
      await page.mouse.up();
      await expect(coach).toHaveAttribute(
        'data-tutorial-step',
        'attach:trainer'
      );
    });
  }
}

test('German landscape: the taller coach leaves its highlighted Prize drag usable', async ({
  context,
  page,
}) => {
  await ownRoomBudget(context);
  await useFlatTable(page);
  await page.setViewportSize({ width: 812, height: 375 });
  await page.addInitScript(() =>
    localStorage.setItem(
      'ptcgsim.language.v1',
      JSON.stringify({ language: 'de' })
    )
  );
  await page.goto('/?tutorial=knock-out&renderer=dom');
  const coach = page.locator('.tutorial-coach[data-tutorial-step]');
  const surface = page.locator('.ptcgsim-board-surface');
  const centre = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const drag = async (
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 14; step += 1) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * step) / 14,
        from.y + ((to.y - from.y) * step) / 14
      );
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  };
  await expect(coach).toHaveAttribute(
    'data-tutorial-step',
    'knock-out:discard',
    { timeout: 20_000 }
  );
  await expect(surface).toHaveAttribute('data-motion', 'idle');
  await drag(
    await centre(
      page
        .locator(
          '.ptcgsim-card[data-card-side="opponent"]:not([data-in-hand])[aria-label^="Kirlia"]'
        )
        .first()
    ),
    await centre(
      page.locator(
        '.ptcgsim-zone[data-zone-kind="discard"][data-zone-side="opponent"]'
      )
    )
  );
  await expect(coach).toHaveAttribute('data-tutorial-step', 'knock-out:prize');
  await expect(surface).toHaveAttribute('data-motion', 'idle');
  await expectFooterInside(coach);
  // Use the exact card the ring and demonstration ask the player to pick up.
  await drag(
    await centre(page.locator('.tutorial-ring--from')),
    await centre(
      page.locator(
        '.ptcgsim-zone[data-zone-kind="hand"][data-zone-side="local"]'
      )
    )
  );
  await expect(coach).toHaveAttribute(
    'data-tutorial-step',
    'knock-out:promote',
    { timeout: 20_000 }
  );
});
