import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { routeCardCatalog } from './support/card-catalog-fixture.js';
import {
  idle,
  logLines,
  nextRevision,
  revision,
  zoneCount,
} from './support/multi-select.js';
import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome, openDeck } from './support/table-shell.js';

/**
 * The Pokémon window (ADR-043): a Pokémon in play opens in a window of its
 * cards, status and moves, its text from the catalog by its print; an
 * Ability or attack pressed there is told in the log by name.
 */

const LIST = `Pokémon: 4
1 Charmander PAF 7
1 Charmeleon OBF 27
1 Charizard ex OBF 125
1 Pidgey OBF 162

Trainer: 1
1 Bravery Charm PAL 173

Energy: 4
3 Fire Energy MEE 2
1 Jet Energy PAL 190

Total Cards: 9`;

const centre = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Drags a hand card by its middle onto a zone's or a card's middle. */
const dragTo = async (page: Page, cardId: string, target: string) => {
  const from = await centre(
    page,
    `.ptcgsim-board-surface [data-card-id="${cardId}"]`
  );
  const to = await centre(page, target);
  const before = await revision(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
  await nextRevision(page, before);
  await idle(page);
};

const handCardsNamed = (page: Page, name: string) =>
  page.evaluate((wanted) => {
    const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
    const hand = scene.zones.find(
      (zone) => zone.side === 'local' && zone.kind === 'hand'
    )!;
    return scene.cards
      .filter((card) => card.parentId === hand.id && card.label === wanted)
      .map((card) => card.id);
  }, name);

const zoneId = (page: Page, kind: string) =>
  page.evaluate(
    (kind) =>
      window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === kind
      )!.id,
    kind
  );

const onCard = (cardId: string) =>
  `.ptcgsim-board-surface [data-card-id="${cardId}"]`;

/** Paste the list, play it, draw it all, and put the line in play. */
const setUp = async (page: Page) => {
  await routeCardCatalog(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'ptcgsim.table-depth.v1',
      JSON.stringify({ mode: 'flat' })
    )
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
  await openDeck(page);
  await page.locator('.deck-home').click({ position: { x: 4, y: 4 } });
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.activeElement?.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  }, LIST);
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '9'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await idle(page);
  await expect.poll(() => zoneCount(page, 'local', 'deck')).toBe(9);
  await page.locator('.ptcgsim-board-surface').focus();
  await page.keyboard.press('9');
  await expect.poll(() => zoneCount(page, 'local', 'hand')).toBe(9);
  await idle(page);

  const active = await zoneId(page, 'active');
  const bench = await zoneId(page, 'bench');
  const [charmander] = await handCardsNamed(page, 'Charmander');
  await dragTo(page, charmander!, `[data-zone-id="${active}"]`);
  const [charmeleon] = await handCardsNamed(page, 'Charmeleon');
  await dragTo(page, charmeleon!, onCard(charmander!));
  const [charizard] = await handCardsNamed(page, 'Charizard ex');
  await dragTo(page, charizard!, onCard(charmeleon!));
  const [pidgey] = await handCardsNamed(page, 'Pidgey');
  await dragTo(page, pidgey!, `[data-zone-id="${bench}"]`);
  for (const name of ['Fire Energy', 'Fire Energy', 'Jet Energy']) {
    const [energy] = await handCardsNamed(page, name);
    await dragTo(page, energy!, onCard(charizard!));
  }
  const [charm] = await handCardsNamed(page, 'Bravery Charm');
  await dragTo(page, charm!, onCard(charizard!));
  return { charizard: charizard!, pidgey: pidgey! };
};

test('a Pokémon opens in its window: its cards, its status and its moves, each told by name', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(150_000);
  await ownRoomBudget(context);
  const { charizard, pidgey } = await setUp(page);

  await page.locator(onCard(charizard)).dblclick();
  const window = page.locator('[data-pokemon-window]');
  await expect(window).toBeVisible();
  await expect(window).toHaveAccessibleName('Charizard ex');
  await expect(window).toBeFocused();
  // Its cards: the Pokémon over the two Stages under it, and what is
  // attached, Energy (fanned) and the Tool apart.
  await expect(
    window.locator('.pokemon-window__hero [data-stack-preview-card-id]')
  ).toHaveCount(1);
  await expect(
    window.locator('.pokemon-window__stages [data-stack-preview-card-id]')
  ).toHaveCount(2);
  await expect(
    window.locator('[data-group="energy"] [data-stack-preview-card-id]')
  ).toHaveCount(3);
  await expect(
    window.locator('[data-group="tools"] [data-stack-preview-card-id]')
  ).toHaveCount(1);
  // Its text, from the catalog by its print: HP, the Ability and the attack.
  await expect(window.locator('.pokemon-window__hp-value')).toHaveText(
    '330/330'
  );
  const ability = window.locator('[data-pokemon-window-move="ability"]');
  await expect(ability).toHaveAccessibleName('Use Infernal Reign');
  const attack = window.locator('[data-pokemon-window-move="attack"]');
  await expect(attack).toHaveCount(1);
  await expect(attack).toContainText('Burning Darkness');
  await expect(attack).toContainText('180+');
  await testInfo.attach('pokemon-window.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  // A card read large from it, and back: the window answers as before.
  await window
    .locator('.pokemon-window__stages [data-stack-preview-card-id]')
    .first()
    .click();
  await expect(page.locator('[data-preview-kind="card"]')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(window).toBeVisible();

  // Damage, stepped here: the window stays open and the HP goes down.
  await window.getByRole('button', { name: '10 more damage' }).click();
  await window.getByRole('button', { name: '10 more damage' }).click();
  await expect(window.locator('.pokemon-window__hp-value')).toHaveText(
    '310/330'
  );
  await expect(window).toBeVisible();
  // A condition, on and off.
  const burned = window.getByRole('button', { name: 'Burned' });
  await burned.click();
  await expect(burned).toHaveAttribute('aria-pressed', 'true');
  await burned.click();
  await expect(burned).toHaveAttribute('aria-pressed', 'false');

  // The Ability, used: told by name, marked used, and the window is done.
  await ability.click();
  await expect(window).toHaveCount(0);
  await expect
    .poll(async () => (await logLines(page)).join('\n'))
    .toContain("used Charizard ex's Infernal Reign");

  // The attack, declared from it.
  await idle(page);
  await page.keyboard.press('Escape');
  await page.locator(onCard(charizard)).dblclick();
  await expect(window).toBeVisible();
  await expect(
    window.getByRole('button', { name: 'Ability used' })
  ).toHaveAttribute('aria-pressed', 'true');
  await window.locator('[data-pokemon-window-move="attack"]').click();
  await expect(window).toHaveCount(0);
  await expect
    .poll(async () => (await logLines(page)).join('\n'))
    .toContain("attacked with Charizard ex's Burning Darkness");

  // A Benched Pokémon's attacks are read, not declared.
  await page.keyboard.press('Escape');
  await idle(page);
  await page.locator(onCard(pidgey)).dblclick();
  await expect(window).toBeVisible();
  await expect(window).toHaveAccessibleName('Pidgey');
  await expect(window.locator('.pokemon-window__move.is-attack')).toHaveCount(
    1
  );
  await expect(
    window.locator('[data-pokemon-window-move="attack"]')
  ).toHaveCount(0);
  await expect(window.locator('.pokemon-window__stages')).toHaveCount(0);
  await expect(window.locator('.pokemon-window__attached')).toContainText(
    'Nothing attached'
  );
  await page.keyboard.press('Escape');
  await expect(window).toHaveCount(0);
});

const PICTURE = readFileSync(
  fileURLToPath(
    new URL('../../apps/web/public/v2/assets/cardback.png', import.meta.url)
  )
);

test('a card’s own text plays on the table: a Pokémon made by hand, and a printed one edited', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await ownRoomBudget(context);
  await routeCardCatalog(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
  await openDeck(page);
  await page.locator('.deck-home').click({ position: { x: 4, y: 4 } });
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.activeElement?.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  }, 'Pokémon: 1\n1 Charizard ex OBF 125\n\nTotal Cards: 1');
  await page.getByRole('button', { name: 'Edit Charizard ex' }).click();

  // The printed card's attack, renamed for this deck.
  await page
    .locator('[data-deck-card="OBF 125"] .deck-row__card')
    .first()
    .click();
  await page.locator('[data-card-text-edit]').click();
  const attackName = page.getByRole('textbox', { name: 'Attack name' });
  await expect(attackName).toHaveValue('Burning Darkness');
  await attackName.fill('Inferno Overdrive');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const sheet = page.locator('.deck-card-details');
  await expect(sheet).toContainText('Inferno Overdrive');
  await expect(sheet).toContainText('Edited');
  // Taken out and put back from the sheet, it keeps its edit.
  await sheet.getByRole('button', { name: 'Remove one Charizard ex' }).click();
  await sheet.getByRole('button', { name: 'Add one Charizard ex' }).click();
  await expect(sheet.locator('[aria-label="1 in deck"]')).toBeVisible();
  await expect(sheet).toContainText('Inferno Overdrive');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // A Pokémon made by hand, its attack written in the card dialog.
  await page.locator('#nativeDeckBuilderAddCustomCard').click();
  // Opened, it starts empty, then takes the name.
  await expect(page.locator('#nativeCustomCardName')).toBeFocused();
  await page.locator('#nativeCustomCardName').fill('Homebrew');
  await page.locator('#nativeCustomCardImageFile-0').setInputFiles({
    name: 'homebrew.png',
    mimeType: 'image/png',
    buffer: PICTURE,
  });
  await expect(
    page.locator('.custom-card-slot[data-status="ready"]')
  ).toHaveCount(1, { timeout: 20_000 });
  await page.locator('#nativeCustomCardTextToggle').click();
  const dialog = page.locator('#nativeDeckBuilderCustomCardModal');
  await dialog.getByRole('spinbutton', { name: 'HP' }).fill('90');
  await dialog.getByRole('button', { name: 'Attack', exact: true }).click();
  await dialog
    .getByRole('combobox', { name: 'Add an Energy to the cost' })
    .selectOption('Water');
  await dialog.getByRole('textbox', { name: 'Attack name' }).fill('Splash');
  await dialog.getByRole('textbox', { name: 'Damage' }).fill('30');
  await page.locator('#nativeCustomCardSubmit').click();
  await expect(dialog).toBeHidden();

  // Another card with the same picture and other text: two cards.
  await page.locator('#nativeDeckBuilderAddCustomCard').click();
  // Opened, it starts empty, then takes the name.
  await expect(page.locator('#nativeCustomCardName')).toBeFocused();
  await page.locator('#nativeCustomCardName').fill('Homebrew');
  await page.locator('#nativeCustomCardImageFile-0').setInputFiles({
    name: 'homebrew.png',
    mimeType: 'image/png',
    buffer: PICTURE,
  });
  await expect(
    page.locator('.custom-card-slot[data-status="ready"]')
  ).toHaveCount(1, { timeout: 20_000 });
  await page.locator('#nativeCustomCardTextToggle').click();
  await dialog.getByRole('spinbutton', { name: 'HP' }).fill('110');
  await page.locator('#nativeCustomCardSubmit').click();
  await expect(dialog).toBeHidden();
  const homebrews = page.locator('.deck-row__card[aria-label*="Homebrew"]');
  await expect(homebrews).toHaveCount(2);

  // One's text edited, then the edit undone: the sheet stays on the card
  // (another card while it said other things, the same one back), though
  // another has its picture.
  await homebrews.first().click();
  const hp = await sheet.locator('.deck-card-details__hp').textContent();
  await page.locator('[data-card-text-edit]').click();
  await page.getByRole('spinbutton', { name: 'HP' }).fill('100');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toContainText('100 HP');
  await page.keyboard.press('Control+z');
  await expect(sheet.locator('.deck-card-details__hp')).toHaveText(hp!);
  await expect(sheet.locator('[aria-label="1 in deck"]')).toBeVisible();
  await expect(sheet.locator('[data-card-text-edit]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  // The 110 HP one goes again, for the table.
  for (const index of [0, 1]) {
    await homebrews.nth(index).click();
    if (((await sheet.textContent()) ?? '').includes('110 HP')) {
      await sheet.getByRole('button', { name: 'Remove one Homebrew' }).click();
      break;
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
  await expect(homebrews).toHaveCount(1);
  // Its last copy gone, its Remove is disabled and the focus has left the
  // sheet: closed by its button (Esc would leave the deck screen).
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toBeHidden();

  // On the table: each opens in its window with its own text.
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await idle(page);
  await expect.poll(() => zoneCount(page, 'local', 'deck')).toBe(2);
  await page.locator('.ptcgsim-board-surface').focus();
  await page.keyboard.press('2');
  await expect.poll(() => zoneCount(page, 'local', 'hand')).toBe(2);
  await idle(page);
  const active = await zoneId(page, 'active');
  const bench = await zoneId(page, 'bench');
  const [charizard] = await handCardsNamed(page, 'Charizard ex');
  await dragTo(page, charizard!, `[data-zone-id="${active}"]`);
  const [homebrew] = await handCardsNamed(page, 'Homebrew');
  await dragTo(page, homebrew!, `[data-zone-id="${bench}"]`);

  const window = page.locator('[data-pokemon-window]');
  await page.locator(onCard(charizard!)).dblclick();
  await expect(window).toBeVisible();
  const attack = window.locator('[data-pokemon-window-move="attack"]');
  await expect(attack).toContainText('Inferno Overdrive');
  await attack.click();
  await expect
    .poll(async () => (await logLines(page)).join('\n'))
    .toContain("attacked with Charizard ex's Inferno Overdrive");

  await page.keyboard.press('Escape');
  await idle(page);
  await page.locator(onCard(homebrew!)).dblclick();
  await expect(window).toHaveAccessibleName('Homebrew');
  await expect(window.locator('.pokemon-window__hp-value')).toHaveText('90/90');
  await expect(window.locator('.pokemon-window__move.is-attack')).toContainText(
    'Splash'
  );
  await expect(window.locator('.pokemon-window__move.is-attack')).toContainText(
    '30'
  );
});
