import { expect, test, type Page } from '@playwright/test';

import { chooseMoreAction, openDeck } from './support/table-shell.js';

/**
 * Every table control answers its press (PX-052): Attack and Pass, which
 * change nothing on the table, say so over it; a control the room refuses
 * says why; and Solo's both-sides actions wait until a side has a deck.
 */

const deckCsv = Buffer.from(
  [
    'QTY,Name,Type,URL',
    '30,Answer Mon,Pokémon,/v2/assets/cardback.png?answer-mon',
    '30,Answer Energy,Energy,/v2/assets/cardback.png?answer-energy',
  ].join('\n')
);

const openSoloTable = async (page: Page): Promise<string[]> => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?renderer=dom');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  return errors;
};

const loadAndSetUp = async (page: Page): Promise<void> => {
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'answer.csv',
    mimeType: 'text/csv',
    buffer: deckCsv,
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await page.locator('#setupButton').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__PTCG_RENDERER_SPIKE__?.scene.zones.find(
            (zone) => zone.side === 'local' && zone.kind === 'hand'
          )?.count
      )
    )
    .toBe(7);
};

const ticker = (page: Page) => page.locator('.ptcgsim-activity-ticker__line');

test('Attack and Pass answer over the table, and both-sides actions wait for a deck', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = await openSoloTable(page);
  // Nobody has a deck: nothing to set up or reset on either side.
  await expect(page.locator('#loadDeckButton')).toBeVisible();
  await expect(page.locator('#setupBothButton')).toHaveCount(0);
  await expect(page.locator('#resetBothButton')).toHaveCount(0);

  await loadAndSetUp(page);
  const before = Number(
    await page.locator('.ptcgsim-board-surface').getAttribute('data-revision')
  );
  // With a deck on a side they are back.
  await chooseMoreAction(page, 'resetBothButton');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    String(before + 2)
  );
  await chooseMoreAction(page, 'setupBothButton');
  await expect(page.locator('#attackButton')).toBeVisible();

  // The activity log is closed, so the line over the table is the answer.
  await expect(page.locator('#activityButton')).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await page.locator('#attackButton').click();
  await expect(ticker(page).filter({ hasText: /attacked$/u })).toHaveCount(1);
  await page.locator('#passButton').click();
  await expect(ticker(page).filter({ hasText: /passed$/u })).toHaveCount(1);
  // Both are in the log too, as v1 wrote them.
  await page.locator('#activityButton').click();
  await expect(
    page.locator('#chatbox [data-event-type="AttackDeclared"]')
  ).toHaveCount(1);
  await expect(
    page.locator('#chatbox [data-event-type="PassDeclared"]')
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a control the room refuses says why, without speaking of a card', async ({
  page,
}) => {
  test.setTimeout(60_000);
  // The room refuses the first Attack; everything else passes through.
  let refused = false;
  await page.routeWebSocket(/\/v2\/rooms\/[^/]+\/connect/u, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message)) as {
        type?: string;
        commandId?: string;
        clientSequence?: number;
        lastSeenRevision?: number;
        command?: { type?: string };
      };
      if (
        !refused &&
        frame.type === 'Command' &&
        frame.command?.type === 'DeclareAttack'
      ) {
        refused = true;
        socket.send(
          JSON.stringify({
            type: 'CommandResult',
            protocolVersion: 2,
            commandId: frame.commandId,
            clientSequence: frame.clientSequence,
            accepted: false,
            revision: frame.lastSeenRevision,
            code: 'precondition_failed',
          })
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await openSoloTable(page);
  await loadAndSetUp(page);

  await page.locator('#attackButton').click();
  const notice = page.locator('.ptcgsim-ui-toast[data-tone="warning"]');
  await expect(notice).toContainText("Didn't go through");
  await expect(notice).toContainText('The table changed before it arrived');
  await expect(notice).not.toContainText('card');
  expect(refused).toBe(true);
});
