import { expect, test, type Page } from '@playwright/test';

import {
  chooseMoreAction,
  openActivity,
  openDeck,
} from './support/table-shell.js';

/**
 * Handling the cards of a Pokémon in a real Solo room: an attached card moves
 * to another Pokémon by drag, as in v1, and a Pokémon's attached cards never
 * paint over it while the whole stack moves, in every table depth.
 */

/** A deck of Pokémon and Energy only, so a hand holds both. */
const deckCsv = (prefix: string): Buffer =>
  Buffer.from(
    [
      'QTY,Name,Type,URL',
      `30,${prefix} Mon,Pokémon,/v2/assets/cardback.png?${prefix}-mon`,
      `30,${prefix} Energy,Energy,/v2/assets/cardback.png?${prefix}-energy`,
    ].join('\n')
  );

const openSoloTable = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    buffer: deckCsv('Main'),
  });
  await page.locator('#nativeDeckBuilderTargetAlt').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'alt.csv',
    mimeType: 'text/csv',
    buffer: deckCsv('Alt'),
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  // Both decks are installed (one revision each) before Set up both.
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    '2'
  );
  const before = Number(
    await page.locator('.ptcgsim-board-surface').getAttribute('data-revision')
  );
  await chooseMoreAction(page, 'setupBothButton');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    String(before + 2)
  );
  await expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1);
};

interface HandCard {
  readonly id: string;
  readonly label: string;
}

/** Draws until the viewer's hand holds two Pokémon and an Energy. */
const handWithTwoPokemonAndEnergy = async (
  page: Page
): Promise<{ readonly pokemon: HandCard[]; readonly energy: HandCard }> => {
  const read = (): Promise<HandCard[]> =>
    page.locator('[data-in-hand]').evaluateAll((nodes) =>
      nodes
        .filter((node) => node.getBoundingClientRect().top > 600)
        .map((node) => ({
          id: (node as HTMLElement).dataset.cardId!,
          label: node.getAttribute('aria-label') ?? '',
        }))
    );
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const hand = await read();
    const pokemon = hand.filter((card) => /Mon$/u.test(card.label));
    const energy = hand.find((card) => /Energy$/u.test(card.label));
    if (pokemon.length >= 2 && energy) return { pokemon, energy };
    await page.mouse.click(700, 330);
    await page.keyboard.press('2');
    await expect(
      page.locator('.ptcgsim-board-surface[data-motion="idle"]')
    ).toHaveCount(1);
  }
  throw new Error('Could not draw two Pokémon and an Energy');
};

/** A visible point on a card, found by hit-testing like a real pointer. */
const exposedPoint = (
  page: Page,
  cardId: string
): Promise<{ readonly x: number; readonly y: number }> =>
  page.evaluate((id) => {
    const element = document.querySelector(`[data-card-id="${id}"]`);
    if (!element) throw new Error(`Missing card ${id}`);
    const box = element.getBoundingClientRect();
    for (let y = box.top + 4; y < box.bottom - 4; y += 3) {
      for (let x = box.right - 4; x > box.left + 4; x -= 3) {
        if (
          document.elementFromPoint(x, y)?.closest('[data-card-id]') === element
        ) {
          return { x, y };
        }
      }
    }
    throw new Error(`Card ${id} is covered`);
  }, cardId);

const zoneCentre = async (
  page: Page,
  kind: string
): Promise<{ readonly x: number; readonly y: number }> => {
  const box = await page
    .locator(`[data-zone-kind="${kind}"][data-zone-side="local"]`)
    .first()
    .boundingBox();
  if (!box) throw new Error(`Missing ${kind} zone`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const drag = async (
  page: Page,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number }
): Promise<void> => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / 12,
      from.y + ((to.y - from.y) * step) / 12
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1);
};

const parentOf = (page: Page, cardId: string): Promise<string | undefined> =>
  page.evaluate(
    (id) =>
      (
        window as unknown as {
          readonly __PTCG_RENDERER_SPIKE__?: {
            readonly scene: {
              readonly cards: readonly {
                readonly id: string;
                readonly parentId: string;
              }[];
            };
          };
        }
      ).__PTCG_RENDERER_SPIKE__?.scene.cards.find((card) => card.id === id)
        ?.parentId,
    cardId
  );

test('an attached Energy moves to another Pokémon by drag, as in v1', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSoloTable(page);
  const { pokemon, energy } = await handWithTwoPokemonAndEnergy(page);
  const [active, benched] = [pokemon[0]!, pokemon[1]!];
  await drag(
    page,
    await exposedPoint(page, active.id),
    await zoneCentre(page, 'active')
  );
  await drag(
    page,
    await exposedPoint(page, benched.id),
    await zoneCentre(page, 'bench')
  );
  await drag(
    page,
    await exposedPoint(page, energy.id),
    await exposedPoint(page, active.id)
  );
  expect(await parentOf(page, energy.id)).toBe(await parentOf(page, active.id));

  // From the Active Pokémon onto the Benched one.
  await drag(
    page,
    await exposedPoint(page, energy.id),
    await exposedPoint(page, benched.id)
  );
  expect(await parentOf(page, energy.id)).toBe(
    await parentOf(page, benched.id)
  );
  await openActivity(page);
  await expect(page.locator('#chatbox')).toContainText(
    'attached Main Energy from active to Main Mon'
  );
  expect(errors).toEqual([]);
});

for (const depthMode of ['flat', 'depth', 'table'] as const) {
  test(`a Pokémon's Energy stays behind it while the stack moves (${depthMode})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.addInitScript((mode) => {
      // Slower flights give more frames to check.
      localStorage.setItem(
        'ptcgsim.motion.v1',
        JSON.stringify({ reduceMotion: 'full', animationSpeed: 'relaxed' })
      );
      localStorage.setItem(
        'ptcgsim.table-depth.v1',
        JSON.stringify({
          mode,
          tilt: 12,
          strength: 1,
          lift: true,
          animate: true,
        })
      );
    }, depthMode);
    await openSoloTable(page);
    const { pokemon, energy } = await handWithTwoPokemonAndEnergy(page);
    const active = pokemon[0]!;
    await drag(
      page,
      await exposedPoint(page, active.id),
      await zoneCentre(page, 'active')
    );
    await drag(
      page,
      await exposedPoint(page, energy.id),
      await exposedPoint(page, active.id)
    );

    // Every frame of the move, wherever the two overlap, the Pokémon must be
    // what paints on top. Sampling runs until the move has settled, however
    // long the drag takes to perform.
    await page.evaluate(
      ({ pokemonId, energyId }) => {
        const samples: string[] = [];
        const state = window as unknown as {
          __layering: string[];
          __layeringStop?: boolean;
        };
        state.__layering = samples;
        const tick = (): void => {
          const card = document.querySelector(`[data-card-id="${pokemonId}"]`);
          const attached = document.querySelector(
            `[data-card-id="${energyId}"]`
          );
          if (card && attached) {
            const a = card.getBoundingClientRect();
            const b = attached.getBoundingClientRect();
            const left = Math.max(a.left, b.left);
            const right = Math.min(a.right, b.right);
            const top = Math.max(a.top, b.top);
            const bottom = Math.min(a.bottom, b.bottom);
            if (right - left > 4 && bottom - top > 4) {
              const hit = document
                .elementFromPoint((left + right) / 2, (top + bottom) / 2)
                ?.closest<HTMLElement>('[data-card-id]');
              const moving =
                card.hasAttribute('data-flying') ||
                attached.hasAttribute('data-flying');
              samples.push(
                `${moving ? 'moving' : 'still'}:${
                  hit?.dataset.cardId === energyId
                    ? 'energy-on-top'
                    : hit?.dataset.cardId === pokemonId
                      ? 'pokemon-on-top'
                      : 'other'
                }`
              );
            }
          }
          if (!state.__layeringStop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { pokemonId: active.id, energyId: energy.id }
    );
    await drag(
      page,
      await exposedPoint(page, active.id),
      await zoneCentre(page, 'bench')
    );
    await page.waitForTimeout(2_600);
    const samples = await page.evaluate(() => {
      const state = window as unknown as {
        __layering: string[];
        __layeringStop?: boolean;
      };
      state.__layeringStop = true;
      return state.__layering;
    });
    await testInfo.attach(`layering-${depthMode}.json`, {
      body: Buffer.from(JSON.stringify(samples)),
      contentType: 'application/json',
    });
    expect(samples.some((sample) => sample.startsWith('moving'))).toBe(true);
    expect(
      samples.filter((sample) => sample.endsWith('energy-on-top'))
    ).toEqual([]);
  });
}
