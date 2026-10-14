import { expect, test, type Page } from '@playwright/test';

import {
  chooseMoreAction,
  openActivity,
  openDeck,
} from './support/table-shell.js';

/**
 * A Pokémon moves whole (ADR-030 §4b, PX-042): grabbing it carries
 * everything under and attached to it, into play or into a pile; a drop that
 * would trade two Pokémon's places marks the other with ⇄; a long press
 * lifts the grabbed card off alone, to devolve it.
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

const box = async (page: Page, cardId: string) => {
  const found = await page.locator(`[data-card-id="${cardId}"]`).boundingBox();
  if (!found) throw new Error(`Missing card ${cardId}`);
  return found;
};

const count = (page: Page, kind: string): Promise<number | undefined> =>
  page.evaluate(
    (zoneKind) =>
      window.__PTCG_RENDERER_SPIKE__?.scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === zoneKind
      )?.count,
    kind
  );

/** The viewer's Active Pokémon with an Energy attached, and a Benched one. */
const activeWithEnergyAndBench = async (page: Page) => {
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
  return { active, benched, energy };
};

test('a grabbed Pokémon carries its Energy, and a swap is marked and made', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { active, benched, energy } = await activeWithEnergyAndBench(page);
  const activeStack = await parentOf(page, active.id);

  const from = await exposedPoint(page, active.id);
  const to = await exposedPoint(page, benched.id);
  const energyBefore = await box(page, energy.id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / 12,
      from.y + ((to.y - from.y) * step) / 12
    );
    await page.waitForTimeout(16);
  }
  // The Energy came along with its Pokémon...
  const energyHeld = await box(page, energy.id);
  expect(
    Math.hypot(energyHeld.x - energyBefore.x, energyHeld.y - energyBefore.y)
  ).toBeGreaterThan(Math.hypot(to.x - from.x, to.y - from.y) * 0.6);
  // ...and the held Pokémon says it would trade places, in plain view.
  const badge = page.locator(
    `[data-card-id="${active.id}"] [data-drop-action="swap"]`
  );
  await expect(badge).toBeVisible();
  const badgeBox = (await badge.boundingBox())!;
  // The badge ignores the pointer; the card carrying it is the one on top.
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-card-id]')
          ?.dataset.cardId,
      {
        x: badgeBox.x + badgeBox.width / 2,
        y: badgeBox.y + badgeBox.height / 2,
      }
    )
  ).toBe(active.id);
  await page.mouse.up();
  await expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1);
  await expect(page.locator('[data-drop-action]')).toHaveCount(0);
  // Swapped, each with its own cards.
  expect(await parentOf(page, active.id)).toBe(activeStack);
  expect(await parentOf(page, energy.id)).toBe(activeStack);
  const within = async (cardId: string, kind: string) => {
    const card = await box(page, cardId);
    const zone = await page
      .locator(`[data-zone-kind="${kind}"][data-zone-side="local"]`)
      .first()
      .boundingBox();
    const x = card.x + card.width / 2;
    const y = card.y + card.height / 2;
    return Boolean(
      zone &&
      x >= zone.x &&
      x <= zone.x + zone.width &&
      y >= zone.y &&
      y <= zone.y + zone.height
    );
  };
  const slots = {
    moved: (await within(active.id, 'bench')) ? 'bench' : 'elsewhere',
    other: (await within(benched.id, 'active')) ? 'active' : 'elsewhere',
  };
  expect(slots).toEqual({ moved: 'bench', other: 'active' });
  expect(errors).toEqual([]);
});

test('a whole Pokémon goes into the discard in one move, one line in the log', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const { active } = await activeWithEnergyAndBench(page);
  const before = (await count(page, 'discard')) ?? 0;
  await drag(
    page,
    await exposedPoint(page, active.id),
    await zoneCentre(page, 'discard')
  );
  await expect.poll(() => count(page, 'discard')).toBe(before + 2);
  // Nothing was left behind to resolve.
  await expect(
    page.locator('[data-zone-kind="attachmentResolution"]')
  ).toHaveCount(0);
  await openActivity(page);
  await expect(page.locator('#chatbox')).toContainText(
    'moved Main Mon from active to discard'
  );
  await expect(page.locator('#chatbox')).not.toContainText(
    'moved Main Energy from active to discard'
  );
});

test('a long press lifts only the top card off its Pokémon', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const { active, energy } = await activeWithEnergyAndBench(page);
  const from = await exposedPoint(page, active.id);
  const to = await zoneCentre(page, 'discard');
  const energyBefore = await box(page, energy.id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / 12,
      from.y + ((to.y - from.y) * step) / 12
    );
    await page.waitForTimeout(16);
  }
  // Only the top card is in the hand; the Energy stayed put.
  const energyHeld = await box(page, energy.id);
  expect(
    Math.hypot(energyHeld.x - energyBefore.x, energyHeld.y - energyBefore.y)
  ).toBeLessThan(8);
  await page.mouse.up();
  await expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1);
  // The Pokémon went alone; its Energy waits in the attached-cards window.
  await expect
    .poll(() => parentOf(page, energy.id))
    .not.toBe(await parentOf(page, active.id));
  await expect(
    page.locator('[data-zone-kind="attachmentResolution"]').first()
  ).toBeAttached();
});
