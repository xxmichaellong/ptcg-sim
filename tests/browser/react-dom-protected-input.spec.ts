import {
  expect,
  test,
  type Dialog,
  type Locator,
  type Page,
} from '@playwright/test';

interface ProtectedInputFixture {
  readonly ownPlayerId: string;
  readonly opponentPlayerId: string;
  readonly sourceCardId: string;
  readonly sourceZoneId: string;
  readonly stadiumCardId: string;
  readonly ownBoardZoneId: string;
  readonly ownBoardCardIds: readonly string[];
  readonly ownDeckZoneId: string;
  readonly ownDeckCardId: string;
  readonly opponentDeckCardId: string;
  readonly ownDeckCount: number;
  readonly opponentDeckCount: number;
  readonly ownHandCount: number;
  readonly unsupportedCardId: string;
  readonly unsupportedStackCardIds: readonly string[];
  readonly activeTopCardId: string;
  readonly activeStackId: string;
  readonly activeAbilityUsed: boolean;
  readonly conditionlessActiveTopCardId: string;
  readonly conditionlessActiveStackId: string;
  readonly destinationZoneId: string;
  readonly destinationCardIds: readonly string[];
  readonly destinationSortedCardIds: readonly string[];
  readonly ownPrizeCardId: string;
  readonly ownPrizeCardIds: readonly string[];
  readonly opponentPrizeCardId: string;
  readonly opponentPrizeCardIds: readonly string[];
  readonly opponentHandCardId: string;
  readonly opponentHandCardIds: readonly string[];
  readonly replayLocalCardLabel: string;
}

interface ProtectedInputEvidence {
  readonly submissions: readonly unknown[];
  readonly submissionResults: readonly unknown[];
  readonly rejections: readonly unknown[];
  readonly overlayRejections: readonly unknown[];
  readonly overlayActions: readonly unknown[];
  readonly shortcutRejections: readonly unknown[];
  readonly shortcutActions: readonly unknown[];
  readonly mulliganDeclarations: number;
  readonly deckViewDeclarations: number;
  readonly boardFlips: number;
  readonly sceneRefreshes: number;
  readonly presentationDismissals: number;
  readonly presentation: {
    readonly selectedCardId: string | null;
    readonly drag: {
      readonly cardId: string;
      readonly targetId: string | null;
    } | null;
    readonly openedZoneId: string | null;
  };
  readonly overlays: {
    readonly contextMenuCardId: string | null;
    readonly input:
      | {
          readonly kind: 'damage' | 'specialCondition';
          readonly cardId: string;
          readonly initialValue: string;
        }
      | {
          readonly kind: 'count';
          readonly action: string;
          readonly cardId: string;
          readonly zoneId: string;
          readonly message: string;
          readonly initialValue: '0' | '1';
          readonly minimum: 0 | 1;
          readonly invalidMessage: string;
        }
      | {
          readonly kind: 'shortcutCount';
          readonly action: string;
          readonly playerId: string;
          readonly zoneId: string;
          readonly message: string;
          readonly initialValue: '0';
          readonly minimum: 0;
          readonly invalidMessage: string;
        }
      | null;
    readonly preview:
      | { readonly kind: 'card'; readonly cardId: string }
      | {
          readonly kind: 'stack';
          readonly stackId: string;
          readonly focusCardId: string;
        }
      | null;
  };
  readonly sourceKind: 'live' | 'replay' | null;
  readonly replayLocalZoneModes: Readonly<Partial<Record<string, string>>>;
  readonly replayLocalCardModes: Readonly<Partial<Record<string, string>>>;
  readonly reportedErrors: readonly string[];
}

interface ProtectedInputHarnessWindow extends Window {
  __PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__?: {
    readonly getFixture: () => ProtectedInputFixture;
    readonly getEvidence: () => ProtectedInputEvidence;
    readonly clearEvidence: () => void;
    readonly setDarkMode: (enabled: boolean) => void;
    readonly enterSoloReplay: () => void;
    readonly advanceSoloReplay: () => void;
    readonly seekSoloReplayStart: () => void;
    readonly exitSoloReplay: () => void;
    readonly dispose: () => void;
  };
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Rectangle extends Point {
  readonly width: number;
  readonly height: number;
}

const collectRuntimeErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
};

const mountHarness = async (page: Page): Promise<ProtectedInputFixture> => {
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  await page.evaluate(async () => {
    const specifier = '/src/dev/ReactDomProtectedInputHarness.ts';
    const module = (await import(/* @vite-ignore */ specifier)) as {
      readonly mountReactDomProtectedInputHarness: () => Promise<void>;
    };
    await module.mountReactDomProtectedInputHarness();
  });
  await expect(
    page.locator('[data-react-dom-protected-input-harness="true"]')
  ).toHaveCount(1);
  return page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    return harness.getFixture();
  });
};

const evidence = (page: Page): Promise<ProtectedInputEvidence> =>
  page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    return harness.getEvidence();
  });

const clearEvidence = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.clearEvidence();
  });

const answerNextPrompt = (
  page: Page,
  value: string | null
): Promise<{
  readonly type: string;
  readonly message: string;
  readonly defaultValue: string;
}> =>
  new Promise((resolve, reject) => {
    page.once('dialog', async (dialog) => {
      const result = {
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
      };
      try {
        if (value === null) await dialog.dismiss();
        else await dialog.accept(value);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });

const exposedCardPoint = (card: Locator): Promise<Point> =>
  card.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    for (let y = Math.ceil(bounds.top) + 1; y < bounds.bottom - 1; y += 1) {
      for (let x = Math.ceil(bounds.left) + 1; x < bounds.right - 1; x += 1) {
        const hit = document.elementFromPoint(x, y)?.closest('[data-card-id]');
        if (hit === element) return { x, y };
      }
    }
    throw new Error(`Card ${element.getAttribute('data-card-id')} is occluded`);
  });

const exposedZonePoint = (zone: Locator): Promise<Point> =>
  zone.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    for (let y = Math.ceil(bounds.top) + 2; y < bounds.bottom - 2; y += 2) {
      for (let x = Math.ceil(bounds.left) + 2; x < bounds.right - 2; x += 2) {
        const hit = document.elementFromPoint(x, y);
        if (
          hit?.closest('[data-card-id]') === null &&
          hit.closest('[data-zone-id]') === element
        ) {
          return { x, y };
        }
      }
    }
    throw new Error(`Zone ${element.getAttribute('data-zone-id')} is covered`);
  });

const drag = async (
  page: Page,
  source: Locator,
  destination: Point,
  expectedTargetId: string
): Promise<void> => {
  const before = await source.boundingBox();
  if (!before) throw new Error('Drag source has no authoritative geometry');
  const start = await exposedCardPoint(source);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 5 });
  await expect(
    page.locator(
      '[data-react-dom-protected-input-harness] .ptcgsim-board-surface'
    )
  ).toHaveAttribute('data-dragging', 'true');
  await expect
    .poll(async () => (await evidence(page)).presentation.drag?.targetId)
    .toBe(expectedTargetId);
  const during = await source.boundingBox();
  if (!during) throw new Error('Drag source lost its rendered geometry');
  expect(sameRectangle(during, before)).toBe(false);
  await page.mouse.up();
  await expect(
    page.locator(
      '[data-react-dom-protected-input-harness] .ptcgsim-board-surface'
    )
  ).toHaveAttribute('data-dragging', 'false');
  await expect.poll(() => source.boundingBox()).toEqual(before);
};

const sameRectangle = (left: Rectangle, right: Rectangle): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

test('native DOM input reaches protected controller state, semantic drop rejection, and exactly-once submit', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const sourceCard = host.locator(`[data-card-id="${fixture.sourceCardId}"]`);
  const unsupportedCard = host.locator(
    `[data-card-id="${fixture.unsupportedCardId}"]`
  );
  const sourceZone = host.locator(`[data-zone-id="${fixture.sourceZoneId}"]`);
  const destinationZone = host.locator(
    `[data-zone-id="${fixture.destinationZoneId}"]`
  );
  await expect(sourceCard).toBeVisible();
  await expect(unsupportedCard).toBeVisible();
  const sourceZonePoint = await exposedZonePoint(sourceZone);
  const destinationZonePoint = await exposedZonePoint(destinationZone);

  await drag(page, sourceCard, sourceZonePoint, fixture.sourceZoneId);
  await expect
    .poll(async () => (await evidence(page)).rejections)
    .toEqual([
      {
        kind: 'IntentRejected',
        reason: 'no_op',
        intent: {
          kind: 'CardDropRequested',
          cardId: fixture.sourceCardId,
          targetId: fixture.sourceZoneId,
        },
      },
    ]);
  const noOpEvidence = await evidence(page);
  expect(noOpEvidence.submissions).toEqual([]);
  expect(noOpEvidence.submissionResults).toEqual([]);
  expect(noOpEvidence.presentation).toMatchObject({
    selectedCardId: null,
    drag: null,
  });
  expect(noOpEvidence.reportedErrors).toEqual([]);
  await expect(sourceCard).toHaveAttribute('aria-pressed', 'false');

  await clearEvidence(page);
  await drag(
    page,
    unsupportedCard,
    destinationZonePoint,
    fixture.destinationZoneId
  );
  await expect
    .poll(async () => (await evidence(page)).rejections)
    .toEqual([
      {
        kind: 'IntentRejected',
        reason: 'unsupported_source',
        intent: {
          kind: 'CardDropRequested',
          cardId: fixture.unsupportedCardId,
          targetId: fixture.destinationZoneId,
        },
      },
    ]);
  const unsupportedEvidence = await evidence(page);
  expect(unsupportedEvidence.submissions).toEqual([]);
  expect(unsupportedEvidence.submissionResults).toEqual([]);
  expect(unsupportedEvidence.presentation).toMatchObject({
    selectedCardId: null,
    drag: null,
  });
  expect(unsupportedEvidence.reportedErrors).toEqual([]);
  await expect(unsupportedCard).toHaveAttribute('aria-pressed', 'false');

  await clearEvidence(page);
  await drag(page, sourceCard, destinationZonePoint, fixture.destinationZoneId);
  await expect
    .poll(async () => (await evidence(page)).submissionResults)
    .toEqual([
      {
        queued: true,
        commandId: 'protected-input-command-1',
        clientSequence: 1,
      },
    ]);
  const submittedEvidence = await evidence(page);
  expect(submittedEvidence.submissions).toEqual([
    {
      type: 'MoveCard',
      cardId: fixture.sourceCardId,
      expectedSourceZoneId: fixture.sourceZoneId,
      destinationZoneId: fixture.destinationZoneId,
    },
  ]);
  expect(submittedEvidence.submissionResults).toEqual([
    {
      queued: true,
      commandId: 'protected-input-command-1',
      clientSequence: 1,
    },
  ]);
  expect(submittedEvidence.rejections).toEqual([]);
  expect(submittedEvidence.presentation).toMatchObject({
    selectedCardId: null,
    drag: null,
  });
  expect(submittedEvidence.reportedErrors).toEqual([]);

  await clearEvidence(page);
  const sourcePoint = await exposedCardPoint(sourceCard);
  await page.mouse.click(sourcePoint.x, sourcePoint.y);
  await expect
    .poll(async () => (await evidence(page)).presentation.selectedCardId)
    .toBe(fixture.sourceCardId);
  await expect(sourceCard).toHaveAttribute('aria-pressed', 'true');

  await page.mouse.dblclick(sourcePoint.x, sourcePoint.y);
  await expect
    .poll(() => evidence(page))
    .toMatchObject({
      submissions: [],
      rejections: [],
      presentation: { selectedCardId: null, drag: null },
      overlays: {
        contextMenuCardId: null,
        preview: { kind: 'card', cardId: fixture.sourceCardId },
      },
    });

  await page.mouse.dblclick(destinationZonePoint.x, destinationZonePoint.y);
  await expect
    .poll(async () => (await evidence(page)).presentation.openedZoneId)
    .toBe(fixture.destinationZoneId);
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await evidence(page)).presentation.openedZoneId)
    .toBeNull();

  await page.mouse.click(sourcePoint.x, sourcePoint.y, { button: 'right' });
  await expect
    .poll(() => evidence(page))
    .toMatchObject({
      submissions: [],
      rejections: [],
      presentation: {
        selectedCardId: null,
        drag: null,
        openedZoneId: null,
      },
      overlays: {
        contextMenuCardId: fixture.sourceCardId,
        preview: null,
      },
      reportedErrors: [],
    });

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('route-owned legacy overlays preserve native menu, preview, zone, keyboard, and focus boundaries', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const sourceCard = host.locator(`[data-card-id="${fixture.sourceCardId}"]`);
  const unsupportedCard = host.locator(
    `[data-card-id="${fixture.unsupportedCardId}"]`
  );
  const destinationZone = host.locator(
    `[data-zone-id="${fixture.destinationZoneId}"]`
  );
  await expect(
    host.locator('[data-react-dom-protected-input-overlays="true"]')
  ).toHaveCount(1);

  await sourceCard.focus();
  await sourceCard.press('Shift+F10');
  const menu = host.locator('[data-legacy-card-context-menu]');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute(
    'data-context-card-id',
    fixture.sourceCardId
  );
  await expect(
    menu.locator('[data-context-action="discardHand"]')
  ).toBeFocused();
  expect(
    await menu.locator(':scope > ul > li > [role="menuitem"]').allTextContents()
  ).toEqual([
    'Discard hand',
    'Shuffle hand to deck',
    'Shuffle hand to bottom',
    'Move card...',
    'Reveal/hide card',
  ]);
  const menuBounds = await menu.boundingBox();
  if (!menuBounds) throw new Error('Context menu has no rendered bounds');
  expect(menuBounds.x).toBeGreaterThanOrEqual(0);
  expect(menuBounds.y).toBeGreaterThanOrEqual(0);
  expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(1280);
  expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(720);
  await page.keyboard.press('ArrowDown');
  await expect(
    menu.locator('[data-context-action="shuffleHandToDeck"]')
  ).toBeFocused();
  await page.keyboard.press('End');
  await expect(
    menu.locator('[data-context-action="revealCard"]')
  ).toBeFocused();
  await page.keyboard.press('Home');
  await expect(
    menu.locator('[data-context-action="discardHand"]')
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(sourceCard).toBeFocused();
  await expect
    .poll(async () => (await evidence(page)).overlays.contextMenuCardId)
    .toBeNull();

  const sourcePoint = await exposedCardPoint(sourceCard);
  await page.mouse.click(sourcePoint.x, sourcePoint.y, { button: 'right' });
  await expect(menu).toBeVisible();
  const cancelledPrompt = answerNextPrompt(page, null);
  await menu.locator('[data-context-action="discardHand"]').click();
  expect(await cancelledPrompt).toEqual({
    type: 'prompt',
    message: 'Draw how many cards?',
    defaultValue: '0',
  });
  await expect(menu).toHaveCount(0);
  await expect
    .poll(async () => (await evidence(page)).overlayActions)
    .toEqual([
      {
        kind: 'context',
        action: 'discardHand',
        cardId: fixture.sourceCardId,
      },
    ]);
  const contextEvidence = await evidence(page);
  expect(contextEvidence.submissions).toEqual([]);
  expect(contextEvidence.submissionResults).toEqual([]);
  expect(contextEvidence.rejections).toEqual([]);
  expect(contextEvidence.overlayRejections).toEqual([]);
  expect(contextEvidence.overlays.input).toBeNull();
  expect(contextEvidence.reportedErrors).toEqual([]);

  await clearEvidence(page);
  await page.mouse.dblclick(sourcePoint.x, sourcePoint.y);
  const preview = host.locator(
    '[data-legacy-card-preview][data-preview-kind="card"]'
  );
  await expect(preview).toBeVisible();
  await expect(preview).toBeFocused();
  const sourceImage = await sourceCard.locator('img').getAttribute('src');
  if (!sourceImage) throw new Error('Source card has no rendered image');
  await expect(preview.locator('img')).toHaveAttribute('src', sourceImage);
  const previewBounds = await preview.boundingBox();
  expect(previewBounds).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  expect(
    await preview.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
  ).toBe('rgba(0, 0, 0, 0.5)');
  await page.keyboard.press('v');
  await expect(preview).toHaveCount(0);
  await expect(sourceCard).toBeFocused();

  await page.mouse.dblclick(sourcePoint.x, sourcePoint.y);
  await expect(preview).toBeVisible();
  await preview.locator('img').click();
  await expect(preview).toHaveCount(0);
  await expect(sourceCard).toBeFocused();

  const unsupportedPoint = await exposedCardPoint(unsupportedCard);
  await page.mouse.dblclick(unsupportedPoint.x, unsupportedPoint.y);
  const stackPreview = host.locator(
    '[data-legacy-card-preview][data-preview-kind="stack"]'
  );
  await expect(stackPreview).toBeVisible();
  await expect(stackPreview).toBeFocused();
  expect(
    await stackPreview
      .locator('[data-overlay-card-id]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-overlay-card-id'))
      )
  ).toEqual(fixture.unsupportedStackCardIds);
  await page.keyboard.press('Escape');
  await expect(stackPreview).toHaveCount(0);
  await expect(unsupportedCard).toBeFocused();

  await destinationZone.focus();
  await destinationZone.press('Enter');
  const zoneBrowser = host.locator('[data-legacy-zone-browser]');
  await expect(zoneBrowser).toBeVisible();
  await expect(zoneBrowser).toHaveAttribute(
    'data-zone-browser-id',
    fixture.destinationZoneId
  );
  await expect(zoneBrowser.locator('[data-zone-close]')).toBeFocused();
  expect(
    await zoneBrowser
      .locator('[data-overlay-card-id]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-overlay-card-id'))
      )
  ).toEqual(fixture.destinationCardIds);
  await page.keyboard.press('Escape');
  await expect(zoneBrowser).toHaveCount(0);
  await expect(destinationZone).toBeFocused();

  await destinationZone.press('Space');
  await expect(zoneBrowser).toBeVisible();
  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.setDarkMode(true);
  });
  await expect
    .poll(() =>
      zoneBrowser.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      )
    )
    .toBe('rgba(21, 21, 21, 0.87)');
  const zoneCard = zoneBrowser.locator('[data-overlay-card-id]').first();
  const zoneCardBounds = await zoneCard.boundingBox();
  if (!zoneCardBounds) throw new Error('Opened-zone card has no bounds');
  await zoneCard.dblclick();
  const zoneCardPreview = host.locator(
    '[data-legacy-card-preview][data-preview-kind="card"]'
  );
  await expect(zoneCardPreview).toBeVisible();
  await expect(zoneCardPreview).toBeFocused();
  await expect(zoneCardPreview.locator('img')).toHaveAttribute(
    'data-overlay-card-id',
    fixture.destinationCardIds[0]!
  );
  await zoneCardPreview.click();
  await expect(zoneCardPreview).toHaveCount(0);
  await expect(zoneBrowser).toBeVisible();
  await expect(zoneCard).toBeFocused();
  await zoneCard.click({ button: 'right' });
  await expect
    .poll(async () => (await evidence(page)).overlays.contextMenuCardId)
    .toBe(fixture.destinationCardIds[0]);
  await expect(menu).toBeVisible();
  expect(
    await menu.evaluate((element) => getComputedStyle(element).backgroundColor)
  ).toBe('rgb(0, 0, 0)');
  const zoneMenuBounds = await menu.boundingBox();
  if (!zoneMenuBounds) throw new Error('Opened-zone menu has no bounds');
  expect(zoneMenuBounds.x).toBeCloseTo(
    Math.min(zoneCardBounds.x + zoneCardBounds.width, 1280 - 180),
    0
  );
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(zoneBrowser).toBeVisible();
  await expect(zoneCard).toBeFocused();
  expect((await evidence(page)).presentation.openedZoneId).toBe(
    fixture.destinationZoneId
  );
  await zoneBrowser.locator('[data-zone-action="sortZone"]').check();
  await expect
    .poll(() =>
      zoneBrowser
        .locator('[data-overlay-card-id]')
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-overlay-card-id'))
        )
    )
    .toEqual(fixture.destinationSortedCardIds);
  await expect
    .poll(async () => (await evidence(page)).overlayActions)
    .toEqual([]);
  await zoneBrowser.locator('[data-zone-action="sortZone"]').uncheck();
  await expect
    .poll(() =>
      zoneBrowser
        .locator('[data-overlay-card-id]')
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-overlay-card-id'))
        )
    )
    .toEqual(fixture.destinationCardIds);
  await zoneBrowser.locator('[data-zone-close]').click();
  await expect(zoneBrowser).toHaveCount(0);
  await expect(destinationZone).toBeFocused();
  const zoneEvidence = await evidence(page);
  expect(zoneEvidence.submissions).toEqual([]);
  expect(zoneEvidence.submissionResults).toEqual([]);
  expect(zoneEvidence.rejections).toEqual([]);
  expect(zoneEvidence.overlayRejections).toEqual([]);
  expect(zoneEvidence.reportedErrors).toEqual([]);

  await clearEvidence(page);
  const activeTopCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  const activePoint = await exposedCardPoint(activeTopCard);
  await page.mouse.click(activePoint.x, activePoint.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await menu.locator('[data-context-action="setDamage"]').click();
  const damageEditor = host.locator('[data-legacy-marker-editor="damage"]');
  await expect(damageEditor).toBeVisible();
  await expect(damageEditor).toHaveText('120');
  const renderedDamage = host.locator(
    `[data-marker-id="${fixture.activeTopCardId}:damage"]`
  );
  await expect(renderedDamage).toBeVisible();
  expect(await damageEditor.boundingBox()).toEqual(
    await renderedDamage.boundingBox()
  );
  expect(
    await damageEditor.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    })
  ).toEqual(
    await renderedDamage.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    })
  );
  await expect
    .poll(() => evidence(page))
    .toMatchObject({
      submissions: [],
      overlayRejections: [],
      overlayActions: [
        {
          kind: 'context',
          action: 'setDamage',
          cardId: fixture.activeTopCardId,
        },
      ],
      overlays: {
        contextMenuCardId: null,
        input: {
          kind: 'damage',
          cardId: fixture.activeTopCardId,
          initialValue: '120',
        },
      },
    });
  await damageEditor.fill('70.5');
  await damageEditor.press('Enter');
  await expect(damageEditor).toHaveAttribute('aria-invalid', 'true');
  await expect(damageEditor).toBeFocused();
  expect((await evidence(page)).submissions).toEqual([]);
  expect((await evidence(page)).overlayActions).toHaveLength(1);

  await damageEditor.fill('70');
  await damageEditor.press('Enter');
  await expect(damageEditor).toHaveCount(0);
  await expect
    .poll(async () => (await evidence(page)).submissions)
    .toEqual([
      {
        type: 'SetDamage',
        stackId: fixture.activeStackId,
        damage: 70,
      },
    ]);
  const damageEvidence = await evidence(page);
  expect(damageEvidence.submissionResults).toEqual([
    {
      queued: true,
      commandId: 'protected-input-command-1',
      clientSequence: 1,
    },
  ]);
  expect(damageEvidence.overlayActions).toEqual([
    {
      kind: 'context',
      action: 'setDamage',
      cardId: fixture.activeTopCardId,
    },
    {
      kind: 'context',
      action: 'setDamage',
      cardId: fixture.activeTopCardId,
      value: '70',
    },
  ]);
  expect(damageEvidence.overlayRejections).toEqual([]);
  expect(damageEvidence.reportedErrors).toEqual([]);

  await clearEvidence(page);
  await page.mouse.click(activePoint.x, activePoint.y, { button: 'right' });
  await menu.locator('[data-context-action="setDamage"]').click();
  await damageEditor.fill('0');
  await damageEditor.press('Enter');
  await expect
    .poll(async () => (await evidence(page)).submissions)
    .toEqual([
      {
        type: 'SetDamage',
        stackId: fixture.activeStackId,
        damage: null,
      },
    ]);
  expect((await evidence(page)).submissionResults).toEqual([
    {
      queued: true,
      commandId: 'protected-input-command-2',
      clientSequence: 2,
    },
  ]);

  await clearEvidence(page);
  await page.mouse.click(activePoint.x, activePoint.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await menu.locator('[data-context-action="setSpecialCondition"]').click();
  const conditionEditor = host.locator(
    '[data-legacy-marker-editor="specialCondition"]'
  );
  await expect(conditionEditor).toBeVisible();
  await expect(conditionEditor).toHaveText('Poisoned');
  const renderedCondition = host.locator(
    `[data-marker-id="${fixture.activeTopCardId}:specialCondition"]`
  );
  await expect(renderedCondition).toBeVisible();
  expect(await conditionEditor.boundingBox()).toEqual(
    await renderedCondition.boundingBox()
  );
  expect(
    await conditionEditor.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    })
  ).toEqual(
    await renderedCondition.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    })
  );
  await conditionEditor.fill('condition text too long');
  await conditionEditor.press('Enter');
  await expect(conditionEditor).toHaveAttribute('aria-invalid', 'true');
  await expect(conditionEditor).toBeFocused();
  expect((await evidence(page)).submissions).toEqual([]);
  expect((await evidence(page)).overlayActions).toHaveLength(1);

  await conditionEditor.fill('Pa');
  await expect(conditionEditor).toHaveCSS(
    'background-color',
    'rgb(255, 255, 0)'
  );
  await expect(conditionEditor).toHaveCSS('color', 'rgb(0, 0, 0)');
  await conditionEditor.press('Enter');
  await expect(conditionEditor).toHaveCount(0);
  await expect
    .poll(async () => (await evidence(page)).submissions)
    .toEqual([
      {
        type: 'SetSpecialCondition',
        stackId: fixture.activeStackId,
        condition: 'Pa',
      },
    ]);
  const conditionEvidence = await evidence(page);
  expect(conditionEvidence.submissionResults).toEqual([
    {
      queued: true,
      commandId: 'protected-input-command-3',
      clientSequence: 3,
    },
  ]);
  expect(conditionEvidence.overlayActions).toEqual([
    {
      kind: 'context',
      action: 'setSpecialCondition',
      cardId: fixture.activeTopCardId,
    },
    {
      kind: 'context',
      action: 'setSpecialCondition',
      cardId: fixture.activeTopCardId,
      value: 'Pa',
    },
  ]);
  expect(conditionEvidence.overlayRejections).toEqual([]);
  expect(conditionEvidence.reportedErrors).toEqual([]);

  await clearEvidence(page);
  await page.mouse.click(activePoint.x, activePoint.y, { button: 'right' });
  await menu.locator('[data-context-action="setSpecialCondition"]').click();
  await conditionEditor.fill('0');
  await conditionEditor.press('Enter');
  await expect
    .poll(async () => (await evidence(page)).submissions)
    .toEqual([
      {
        type: 'SetSpecialCondition',
        stackId: fixture.activeStackId,
        condition: null,
      },
    ]);
  expect((await evidence(page)).submissionResults).toEqual([
    {
      queued: true,
      commandId: 'protected-input-command-4',
      clientSequence: 4,
    },
  ]);

  await clearEvidence(page);
  await page.mouse.click(activePoint.x, activePoint.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await menu.locator('[data-context-action="toggleAbility"]').click();
  await expect
    .poll(async () => (await evidence(page)).submissions)
    .toEqual([
      {
        type: 'SetAbilityUsed',
        stackId: fixture.activeStackId,
        used: !fixture.activeAbilityUsed,
      },
    ]);
  const commandEvidence = await evidence(page);
  expect(commandEvidence.submissionResults).toEqual([
    {
      queued: true,
      commandId: 'protected-input-command-5',
      clientSequence: 5,
    },
  ]);
  expect(commandEvidence.overlayActions).toEqual([
    {
      kind: 'context',
      action: 'toggleAbility',
      cardId: fixture.activeTopCardId,
    },
  ]);
  expect(commandEvidence.overlayRejections).toEqual([]);
  expect(commandEvidence.reportedErrors).toEqual([]);

  const countCases = [
    {
      cardId: fixture.sourceCardId,
      action: 'discardHand',
      value: '999',
      message: 'Draw how many cards?',
      defaultValue: '0',
      command: {
        type: 'DiscardHandAndDraw',
        count: fixture.ownDeckCount,
      },
    },
    {
      cardId: fixture.sourceCardId,
      action: 'shuffleHandToDeck',
      value: '999',
      message: 'Draw how many cards?',
      defaultValue: '0',
      command: {
        type: 'ShuffleHandIntoDeckAndDraw',
        count: fixture.ownDeckCount + fixture.ownHandCount,
      },
    },
    {
      cardId: fixture.sourceCardId,
      action: 'shuffleHandToDeckBottom',
      value: '0',
      message: 'Draw how many cards?',
      defaultValue: '0',
      command: {
        type: 'ShuffleHandToDeckBottomAndDraw',
        count: 0,
      },
    },
    {
      cardId: fixture.ownDeckCardId,
      action: 'drawCards',
      value: '999',
      message: 'Draw how many cards?',
      defaultValue: '1',
      command: { type: 'DrawCards', count: fixture.ownDeckCount },
    },
    {
      cardId: fixture.ownDeckCardId,
      action: 'viewDeckTop',
      value: '2',
      message: 'How many cards do you want to look at?',
      defaultValue: '1',
      command: {
        type: 'ExtractDeckCardsForInspection',
        ownerPlayerId: fixture.ownPlayerId,
        count: 2,
        edge: 'top',
        visibility: 'private',
      },
    },
    {
      cardId: fixture.opponentDeckCardId,
      action: 'viewDeckBottom',
      value: '999',
      message: 'How many cards do you want to look at?',
      defaultValue: '1',
      command: {
        type: 'ExtractDeckCardsForInspection',
        ownerPlayerId: fixture.opponentPlayerId,
        count: fixture.opponentDeckCount,
        edge: 'bottom',
        visibility: 'public',
      },
    },
  ] as const;

  for (const [index, countCase] of countCases.entries()) {
    await clearEvidence(page);
    const card = host.locator(`[data-card-id="${countCase.cardId}"]`);
    const point = await exposedCardPoint(card);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect(menu).toBeVisible();
    const prompt = answerNextPrompt(page, countCase.value);
    await menu.locator(`[data-context-action="${countCase.action}"]`).click();
    expect(await prompt).toEqual({
      type: 'prompt',
      message: countCase.message,
      defaultValue: countCase.defaultValue,
    });
    await expect
      .poll(async () => (await evidence(page)).submissions)
      .toEqual([countCase.command]);
    const countEvidence = await evidence(page);
    const clientSequence = index + 6;
    expect(countEvidence.submissionResults).toEqual([
      {
        queued: true,
        commandId: `protected-input-command-${clientSequence}`,
        clientSequence,
      },
    ]);
    expect(countEvidence.overlayActions).toEqual([
      {
        kind: 'context',
        action: countCase.action,
        cardId: countCase.cardId,
      },
      {
        kind: 'context',
        action: countCase.action,
        cardId: countCase.cardId,
        value: countCase.value,
      },
    ]);
    expect(countEvidence.overlayRejections).toEqual([]);
    expect(countEvidence.overlays.input).toBeNull();
    expect(countEvidence.reportedErrors).toEqual([]);
  }

  const categoryCases = [
    ['Energy', 'to Energy'],
    ['Trainer', 'to Tool'],
    ['Pokémon', 'to Pokémon'],
  ] as const;
  for (const [index, [category, label]] of categoryCases.entries()) {
    await clearEvidence(page);
    await page.mouse.click(activePoint.x, activePoint.y, { button: 'right' });
    await expect(menu).toBeVisible();
    const trigger = menu.locator('[data-context-action="changeCardType"]');
    const submenu = menu.locator(
      '[role="menu"][aria-label="Change card type"]'
    );
    if (index === 0) {
      await trigger.focus();
      await trigger.press('ArrowRight');
      await expect(submenu).toBeVisible();
      await expect(
        submenu.locator('[data-category-choice="Energy"]')
      ).toBeFocused();
      await submenu.locator('[data-category-choice="Energy"]').press('End');
      await expect(
        submenu.locator('[data-category-choice="Pokémon"]')
      ).toBeFocused();
      await submenu
        .locator('[data-category-choice="Pokémon"]')
        .press('ArrowLeft');
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    }
    await trigger.hover();
    await expect(submenu).toBeVisible();
    expect(
      await submenu.locator('[data-category-choice]').allTextContents()
    ).toEqual(['to Energy', 'to Tool', 'to Pokémon']);
    const choice = submenu.locator(`[data-category-choice="${category}"]`);
    await expect(choice).toHaveText(label);
    await choice.click();
    await expect(menu).toHaveCount(0);
    await expect
      .poll(async () => (await evidence(page)).submissions)
      .toEqual([
        {
          type: 'ChangeCardCategory',
          cardId: fixture.activeTopCardId,
          expectedSourceId: fixture.activeStackId,
          category,
        },
      ]);
    const categoryEvidence = await evidence(page);
    const clientSequence = index + 12;
    expect(categoryEvidence.submissionResults).toEqual([
      {
        queued: true,
        commandId: `protected-input-command-${clientSequence}`,
        clientSequence,
      },
    ]);
    expect(categoryEvidence.overlayActions).toEqual([
      {
        kind: 'context',
        action: 'changeCardType',
        cardId: fixture.activeTopCardId,
        category,
      },
    ]);
    expect(categoryEvidence.overlayRejections).toEqual([]);
    expect(categoryEvidence.reportedErrors).toEqual([]);
  }

  const moveCases = [
    [
      'board',
      'to Board',
      {
        type: 'MoveCard',
        cardId: fixture.sourceCardId,
        expectedSourceZoneId: fixture.sourceZoneId,
        destinationZoneId: fixture.ownBoardZoneId,
      },
    ],
    [
      'deckTop',
      'to Deck (top)',
      {
        type: 'MoveCardToDeckTop',
        cardId: fixture.sourceCardId,
        expectedSourceId: fixture.sourceZoneId,
      },
    ],
    [
      'deckBottom',
      'to Deck (bottom)',
      {
        type: 'MoveCardToDeckBottom',
        cardId: fixture.sourceCardId,
        expectedSourceId: fixture.sourceZoneId,
      },
    ],
    [
      'deckSwitch',
      'to Deck (switch)',
      {
        type: 'SwapCardWithDeckTop',
        cardId: fixture.sourceCardId,
        expectedSourceId: fixture.sourceZoneId,
      },
    ],
    [
      'deckShuffle',
      'to Deck (shuffle)',
      {
        type: 'ShuffleCardIntoDeck',
        cardId: fixture.sourceCardId,
        expectedSourceId: fixture.sourceZoneId,
      },
    ],
  ] as const;
  for (const [index, [destination, label, command]] of moveCases.entries()) {
    await clearEvidence(page);
    await page.mouse.click(sourcePoint.x, sourcePoint.y, { button: 'right' });
    await expect(menu).toBeVisible();
    const trigger = menu.locator('[data-context-action="moveCard"]');
    const submenu = menu.locator('[role="menu"][aria-label="Move card"]');
    if (index === 0) {
      await trigger.focus();
      await trigger.press('ArrowRight');
      await expect(submenu).toBeVisible();
      await expect(submenu.locator('[data-move-choice="board"]')).toBeFocused();
      await submenu.locator('[data-move-choice="board"]').press('End');
      await expect(
        submenu.locator('[data-move-choice="deckShuffle"]')
      ).toBeFocused();
      await submenu.locator('[data-move-choice="deckShuffle"]').press('Escape');
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    }
    await trigger.hover();
    await expect(submenu).toBeVisible();
    expect(
      await submenu.locator('[data-move-choice]').allTextContents()
    ).toEqual([
      'to Board',
      'to Deck (top)',
      'to Deck (bottom)',
      'to Deck (switch)',
      'to Deck (shuffle)',
    ]);
    const choice = submenu.locator(`[data-move-choice="${destination}"]`);
    await expect(choice).toHaveText(label);
    if (destination === 'deckShuffle') {
      // The source-faithful fifth row extends below this 720px fixture; exercise
      // its supported keyboard path without changing or scrolling menu paint.
      await choice.press('Enter');
    } else {
      await choice.click();
    }
    await expect(menu).toHaveCount(0);
    await expect
      .poll(async () => (await evidence(page)).submissions)
      .toEqual([command]);
    const moveEvidence = await evidence(page);
    const clientSequence = index + 15;
    expect(moveEvidence.submissionResults).toEqual([
      {
        queued: true,
        commandId: `protected-input-command-${clientSequence}`,
        clientSequence,
      },
    ]);
    expect(moveEvidence.overlayActions).toEqual([
      {
        kind: 'context',
        action: 'moveCard',
        cardId: fixture.sourceCardId,
        destination,
      },
    ]);
    expect(moveEvidence.overlayRejections).toEqual([]);
    expect(moveEvidence.reportedErrors).toEqual([]);
  }

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('selected-card marker, category, visibility, deck, zone, and play shortcuts stay protected and suppress editable targets', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const ownCard = host.locator(`[data-card-id="${fixture.activeTopCardId}"]`);
  const conditionlessCard = host.locator(
    `[data-card-id="${fixture.conditionlessActiveTopCardId}"]`
  );
  const ownPrizeCard = host.locator(
    `[data-card-id="${fixture.ownPrizeCardId}"]`
  );
  const sourceCard = host.locator(`[data-card-id="${fixture.sourceCardId}"]`);
  const selectCard = async (card: Locator, cardId: string): Promise<void> => {
    const point = await exposedCardPoint(card);
    await page.mouse.click(point.x, point.y);
    await expect
      .poll(async () => (await evidence(page)).presentation.selectedCardId)
      .toBe(cardId);
  };
  const cases = [
    {
      key: 'Digit3',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'adjustDamage',
        cardId: fixture.activeTopCardId,
        delta: 30,
      },
      command: {
        type: 'SetDamage',
        stackId: fixture.activeStackId,
        damage: 150,
      },
      retained: true,
    },
    {
      key: 'Alt+Digit9',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'adjustDamage',
        cardId: fixture.activeTopCardId,
        delta: -90,
      },
      command: {
        type: 'SetDamage',
        stackId: fixture.activeStackId,
        damage: 30,
      },
      retained: true,
    },
    {
      key: 'Digit0',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'removeDamage',
        cardId: fixture.activeTopCardId,
      },
      command: {
        type: 'SetDamage',
        stackId: fixture.activeStackId,
        damage: null,
      },
      retained: false,
    },
    {
      key: 'KeyW',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'toggleAbility',
        cardId: fixture.activeTopCardId,
      },
      command: {
        type: 'SetAbilityUsed',
        stackId: fixture.activeStackId,
        used: !fixture.activeAbilityUsed,
      },
      retained: false,
    },
    {
      key: 'Alt+KeyY',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'cycleSpecialCondition',
        cardId: fixture.activeTopCardId,
        remove: true,
      },
      command: {
        type: 'SetSpecialCondition',
        stackId: fixture.activeStackId,
        condition: null,
      },
      retained: false,
    },
    {
      key: 'Alt+KeyE',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'changeCardType',
        cardId: fixture.activeTopCardId,
        category: 'Energy',
      },
      command: {
        type: 'ChangeCardCategory',
        cardId: fixture.activeTopCardId,
        expectedSourceId: fixture.activeStackId,
        category: 'Energy',
      },
      retained: false,
    },
    {
      key: 'Alt+KeyT',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'changeCardType',
        cardId: fixture.activeTopCardId,
        category: 'Trainer',
      },
      command: {
        type: 'ChangeCardCategory',
        cardId: fixture.activeTopCardId,
        expectedSourceId: fixture.activeStackId,
        category: 'Trainer',
      },
      retained: false,
    },
    {
      key: 'Alt+KeyP',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'changeCardType',
        cardId: fixture.activeTopCardId,
        category: 'Pokémon',
      },
      command: {
        type: 'ChangeCardCategory',
        cardId: fixture.activeTopCardId,
        expectedSourceId: fixture.activeStackId,
        category: 'Pokémon',
      },
      retained: false,
    },
    {
      key: 'KeyY',
      card: conditionlessCard,
      cardId: fixture.conditionlessActiveTopCardId,
      request: {
        action: 'cycleSpecialCondition',
        cardId: fixture.conditionlessActiveTopCardId,
        remove: false,
      },
      command: {
        type: 'SetSpecialCondition',
        stackId: fixture.conditionlessActiveStackId,
        condition: 'P',
      },
      retained: true,
    },
    {
      key: 'KeyC',
      card: ownPrizeCard,
      cardId: fixture.ownPrizeCardId,
      request: {
        action: 'togglePrivateInspection',
        cardId: fixture.ownPrizeCardId,
      },
      command: {
        type: 'BeginCardInspection',
        cardId: fixture.ownPrizeCardId,
        expectedSourceId: `zone:${fixture.ownPlayerId}:prizes`,
      },
      retained: true,
    },
    {
      key: 'KeyZ',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'setPublicReveal',
        cardId: fixture.activeTopCardId,
        revealed: false,
      },
      command: {
        type: 'SetPublicReveal',
        cardId: fixture.activeTopCardId,
        expectedSourceId: fixture.activeStackId,
        revealed: false,
      },
      retained: true,
    },
    {
      key: 'Alt+KeyZ',
      card: ownPrizeCard,
      cardId: fixture.ownPrizeCardId,
      request: {
        action: 'setPublicReveal',
        cardId: fixture.ownPrizeCardId,
        revealed: true,
      },
      command: {
        type: 'SetPublicReveal',
        cardId: fixture.ownPrizeCardId,
        expectedSourceId: `zone:${fixture.ownPlayerId}:prizes`,
        revealed: true,
      },
      retained: true,
    },
    {
      key: 'ArrowUp',
      card: sourceCard,
      cardId: fixture.sourceCardId,
      request: {
        action: 'moveCardRelativeToDeck',
        cardId: fixture.sourceCardId,
        deckAction: 'moveToTop',
      },
      command: {
        type: 'MoveCardToDeckTop',
        cardId: fixture.sourceCardId,
        expectedSourceId: fixture.sourceZoneId,
      },
      retained: false,
    },
    {
      key: 'ArrowDown',
      card: sourceCard,
      cardId: fixture.sourceCardId,
      request: {
        action: 'moveCardRelativeToDeck',
        cardId: fixture.sourceCardId,
        deckAction: 'moveToBottom',
      },
      command: {
        type: 'MoveCardToDeckBottom',
        cardId: fixture.sourceCardId,
        expectedSourceId: fixture.sourceZoneId,
      },
      retained: false,
    },
    {
      key: 'ArrowRight',
      card: sourceCard,
      cardId: fixture.sourceCardId,
      request: {
        action: 'moveCardRelativeToDeck',
        cardId: fixture.sourceCardId,
        deckAction: 'swapWithTop',
      },
      command: {
        type: 'SwapCardWithDeckTop',
        cardId: fixture.sourceCardId,
        expectedSourceId: fixture.sourceZoneId,
      },
      retained: false,
    },
    {
      key: 'KeyS',
      card: sourceCard,
      cardId: fixture.sourceCardId,
      request: {
        action: 'moveCardRelativeToDeck',
        cardId: fixture.sourceCardId,
        deckAction: 'shuffleIntoDeck',
      },
      command: {
        type: 'ShuffleCardIntoDeck',
        cardId: fixture.sourceCardId,
        expectedSourceId: fixture.sourceZoneId,
      },
      retained: false,
    },
    {
      key: 'KeyH',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'moveCardToZone',
        cardId: fixture.activeTopCardId,
        destination: 'hand',
      },
      command: {
        type: 'MoveCardFromStack',
        cardId: fixture.activeTopCardId,
        expectedStackId: fixture.activeStackId,
        destinationZoneId: `zone:${fixture.ownPlayerId}:hand`,
      },
      retained: false,
    },
    {
      key: 'KeyD',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'moveCardToZone',
        cardId: fixture.activeTopCardId,
        destination: 'discard',
      },
      command: {
        type: 'MoveCardFromStack',
        cardId: fixture.activeTopCardId,
        expectedStackId: fixture.activeStackId,
        destinationZoneId: fixture.destinationZoneId,
      },
      retained: false,
    },
    {
      key: 'KeyL',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'moveCardToZone',
        cardId: fixture.activeTopCardId,
        destination: 'lostZone',
      },
      command: {
        type: 'MoveCardFromStack',
        cardId: fixture.activeTopCardId,
        expectedStackId: fixture.activeStackId,
        destinationZoneId: `zone:${fixture.ownPlayerId}:lostZone`,
      },
      retained: false,
    },
    {
      key: 'Space',
      card: ownCard,
      cardId: fixture.activeTopCardId,
      request: {
        action: 'moveCardToZone',
        cardId: fixture.activeTopCardId,
        destination: 'board',
      },
      command: {
        type: 'MoveCardFromStack',
        cardId: fixture.activeTopCardId,
        expectedStackId: fixture.activeStackId,
        destinationZoneId: fixture.ownBoardZoneId,
      },
      retained: false,
    },
    {
      key: 'KeyA',
      card: sourceCard,
      cardId: fixture.sourceCardId,
      request: {
        action: 'moveCardToPlay',
        cardId: fixture.sourceCardId,
        slot: 'active',
      },
      command: {
        type: 'MoveCardToPlay',
        cardId: fixture.sourceCardId,
        expectedSourceZoneId: fixture.sourceZoneId,
        boardPlayerId: fixture.ownPlayerId,
        slot: 'active',
      },
      retained: false,
    },
    {
      key: 'KeyB',
      card: sourceCard,
      cardId: fixture.sourceCardId,
      request: {
        action: 'moveCardToPlay',
        cardId: fixture.sourceCardId,
        slot: 'bench',
      },
      command: {
        type: 'MoveCardToPlay',
        cardId: fixture.sourceCardId,
        expectedSourceZoneId: fixture.sourceZoneId,
        boardPlayerId: fixture.ownPlayerId,
        slot: 'bench',
      },
      retained: false,
    },
    {
      key: 'KeyG',
      card: sourceCard,
      cardId: fixture.sourceCardId,
      request: {
        action: 'moveCardToStadium',
        cardId: fixture.sourceCardId,
      },
      command: {
        type: 'MoveCardToStadium',
        cardId: fixture.sourceCardId,
        expectedSourceId: fixture.sourceZoneId,
        expectedStadiumCardId: fixture.stadiumCardId,
      },
      retained: false,
    },
    {
      key: 'KeyP',
      card: sourceCard,
      cardId: fixture.sourceCardId,
      request: {
        action: 'moveCardToZone',
        cardId: fixture.sourceCardId,
        destination: 'prizes',
      },
      command: {
        type: 'MoveCard',
        cardId: fixture.sourceCardId,
        expectedSourceZoneId: fixture.sourceZoneId,
        destinationZoneId: `zone:${fixture.ownPlayerId}:prizes`,
      },
      retained: false,
    },
  ] as const;

  for (const [index, shortcut] of cases.entries()) {
    await clearEvidence(page);
    await selectCard(shortcut.card, shortcut.cardId);
    await page.keyboard.press(shortcut.key);
    await expect
      .poll(async () => (await evidence(page)).submissions)
      .toEqual([shortcut.command]);
    const shortcutEvidence = await evidence(page);
    const clientSequence = index + 1;
    expect(shortcutEvidence.submissionResults).toEqual([
      {
        queued: true,
        commandId: `protected-input-command-${clientSequence}`,
        clientSequence,
      },
    ]);
    expect(shortcutEvidence.shortcutActions).toEqual([shortcut.request]);
    expect(shortcutEvidence.shortcutRejections).toEqual([]);
    expect(shortcutEvidence.overlayActions).toEqual([]);
    expect(shortcutEvidence.reportedErrors).toEqual([]);
    expect(shortcutEvidence.presentation.selectedCardId).toBe(
      shortcut.retained ? shortcut.cardId : null
    );
  }

  await clearEvidence(page);
  await selectCard(ownCard, fixture.activeTopCardId);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.dataset.shortcutEditableProbe = 'true';
    document
      .querySelector('[data-react-dom-protected-input-harness]')
      ?.append(input);
    input.focus();
  });
  await page.keyboard.press('Digit4');
  await page.keyboard.press('KeyH');
  await page.keyboard.press('KeyA');
  await page.keyboard.press('KeyG');
  await page.keyboard.press('KeyP');
  const suppressed = await evidence(page);
  expect(suppressed.submissions).toEqual([]);
  expect(suppressed.shortcutActions).toEqual([]);
  expect(suppressed.shortcutRejections).toEqual([]);
  expect(suppressed.presentation.selectedCardId).toBe(fixture.activeTopCardId);
  await page
    .locator('[data-shortcut-editable-probe]')
    .evaluate((element) => element.remove());

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('global loose-board shortcuts stay viewer-owned and suppress editable targets', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const cases = [
    { key: 'Enter', destination: 'discard' },
    { key: 'Alt+Enter', destination: 'hand' },
    { key: 'Slash', destination: 'shuffleIntoDeck' },
  ] as const;

  for (const [index, scenario] of cases.entries()) {
    await clearEvidence(page);
    await page.keyboard.press(scenario.key);
    const command = {
      type: 'ResolveLooseBoardCards',
      targetPlayerId: fixture.ownPlayerId,
      expectedBoardCardIds: fixture.ownBoardCardIds,
      destination: scenario.destination,
    };
    await expect
      .poll(async () => (await evidence(page)).submissions)
      .toEqual([command]);
    const current = await evidence(page);
    expect(current.submissionResults).toEqual([
      {
        queued: true,
        commandId: `protected-input-command-${index + 1}`,
        clientSequence: index + 1,
      },
    ]);
    expect(current.shortcutActions).toEqual([
      {
        action: 'resolveOwnLooseBoard',
        destination: scenario.destination,
      },
    ]);
    expect(current.shortcutRejections).toEqual([]);
    expect(current.presentation.selectedCardId).toBeNull();
    expect(current.reportedErrors).toEqual([]);
  }

  await clearEvidence(page);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.dataset.globalShortcutEditor = 'true';
    document.body.append(input);
    input.focus();
  });
  for (const scenario of cases) await page.keyboard.press(scenario.key);
  const editableEvidence = await evidence(page);
  expect(editableEvidence.submissions).toEqual([]);
  expect(editableEvidence.shortcutActions).toEqual([]);
  expect(editableEvidence.shortcutRejections).toEqual([]);
  await page.evaluate(() => {
    document.querySelector('[data-global-shortcut-editor]')?.remove();
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(
    page.locator('[data-react-dom-protected-input-harness]')
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('unselected deck shortcuts stay viewer-owned and reject the ambiguous dual-inspection chord', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const cases = [
    {
      key: 'Digit9',
      action: { action: 'drawOwnDeck', count: 9 },
      command: { type: 'DrawCards', count: fixture.ownDeckCount },
    },
    {
      key: 'Alt+Digit9',
      action: { action: 'inspectOwnDeck', count: 9, edge: 'top' },
      command: {
        type: 'ExtractDeckCardsForInspection',
        ownerPlayerId: fixture.ownPlayerId,
        count: fixture.ownDeckCount,
        edge: 'top',
        visibility: 'private',
      },
    },
    {
      key: 'Control+Digit9',
      action: { action: 'inspectOwnDeck', count: 9, edge: 'bottom' },
      command: {
        type: 'ExtractDeckCardsForInspection',
        ownerPlayerId: fixture.ownPlayerId,
        count: fixture.ownDeckCount,
        edge: 'bottom',
        visibility: 'private',
      },
    },
    {
      key: 'KeyS',
      action: { action: 'shuffleOwnDeck' },
      command: { type: 'ShuffleZone', zoneId: fixture.ownDeckZoneId },
    },
  ] as const;

  for (const [index, scenario] of cases.entries()) {
    await clearEvidence(page);
    await page.keyboard.press(scenario.key);
    await expect
      .poll(async () => (await evidence(page)).submissions)
      .toEqual([scenario.command]);
    const current = await evidence(page);
    expect(current.submissionResults).toEqual([
      {
        queued: true,
        commandId: `protected-input-command-${index + 1}`,
        clientSequence: index + 1,
      },
    ]);
    expect(current.shortcutActions).toEqual([scenario.action]);
    expect(current.shortcutRejections).toEqual([]);
    expect(current.presentation.selectedCardId).toBeNull();
    expect(current.reportedErrors).toEqual([]);
  }

  await clearEvidence(page);
  await page.keyboard.press('Alt+Control+Digit2');
  let suppressed = await evidence(page);
  expect(suppressed.submissions).toEqual([]);
  expect(suppressed.shortcutActions).toEqual([]);
  expect(suppressed.shortcutRejections).toEqual([]);

  await page.evaluate(() => {
    const input = document.createElement('input');
    input.dataset.globalDeckShortcutEditor = 'true';
    document.body.append(input);
    input.focus();
  });
  for (const scenario of cases) await page.keyboard.press(scenario.key);
  suppressed = await evidence(page);
  expect(suppressed.submissions).toEqual([]);
  expect(suppressed.shortcutActions).toEqual([]);
  expect(suppressed.shortcutRejections).toEqual([]);

  await page.evaluate(() => {
    document.querySelector('[data-global-deck-shortcut-editor]')?.remove();
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(
    page.locator('[data-react-dom-protected-input-harness]')
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('global coin shortcut stays authority-owned across selection and read-only boundaries', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const selectedCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  const point = await exposedCardPoint(selectedCard);
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await evidence(page)).presentation.selectedCardId)
    .toBe(fixture.activeTopCardId);

  await clearEvidence(page);
  await page.keyboard.press('KeyF');
  await expect
    .poll(async () => (await evidence(page)).submissions)
    .toEqual([{ type: 'FlipCoin' }]);
  let current = await evidence(page);
  expect(current.submissionResults).toEqual([
    {
      queued: true,
      commandId: 'protected-input-command-1',
      clientSequence: 1,
    },
  ]);
  expect(current.shortcutActions).toEqual([{ action: 'flipCoin' }]);
  expect(current.shortcutRejections).toEqual([]);
  expect(current.presentation.selectedCardId).toBe(fixture.activeTopCardId);

  await clearEvidence(page);
  await page.keyboard.press('Alt+KeyF');
  current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.shortcutRejections).toEqual([]);
  expect(current.presentation.selectedCardId).toBe(fixture.activeTopCardId);

  await page.evaluate(() => {
    const input = document.createElement('input');
    input.dataset.globalCoinShortcutEditor = 'true';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('KeyF');
  current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.shortcutRejections).toEqual([]);

  await page.evaluate(() => {
    document.querySelector('[data-global-coin-shortcut-editor]')?.remove();
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.enterSoloReplay();
  });
  await expect
    .poll(async () => (await evidence(page)).sourceKind)
    .toBe('replay');
  await clearEvidence(page);
  await page.keyboard.press('KeyF');
  await expect
    .poll(async () => (await evidence(page)).shortcutRejections)
    .toEqual([
      {
        kind: 'ShortcutActionRejected',
        request: { action: 'flipCoin' },
        reason: 'read_only',
      },
    ]);
  current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([{ action: 'flipCoin' }]);
  expect(current.presentation.selectedCardId).toBeNull();
  expect(current.reportedErrors).toEqual([]);

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('unselected lifecycle shortcuts derive the viewer and reject replay atomically', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const cases = [
    {
      key: 'Alt+KeyN',
      action: { action: 'setupOwnPlayer' },
      command: {
        type: 'SetupPlayer',
        targetPlayerId: fixture.ownPlayerId,
      },
    },
    {
      key: 'Alt+KeyR',
      action: { action: 'resetOwnPlayer' },
      command: {
        type: 'ResetPlayer',
        targetPlayerId: fixture.ownPlayerId,
      },
    },
    {
      key: 'Alt+KeyT',
      action: { action: 'startOwnTurn' },
      command: {
        type: 'StartTurn',
        targetPlayerId: fixture.ownPlayerId,
      },
    },
  ] as const;

  for (const [index, scenario] of cases.entries()) {
    await clearEvidence(page);
    await page.keyboard.press(scenario.key);
    await expect
      .poll(async () => (await evidence(page)).submissions)
      .toEqual([scenario.command]);
    const current = await evidence(page);
    expect(current.submissionResults).toEqual([
      {
        queued: true,
        commandId: `protected-input-command-${index + 1}`,
        clientSequence: index + 1,
      },
    ]);
    expect(current.shortcutActions).toEqual([scenario.action]);
    expect(current.shortcutRejections).toEqual([]);
    expect(current.sceneRefreshes).toBe(
      scenario.action.action === 'resetOwnPlayer' ? 1 : 0
    );
    expect(current.presentation.selectedCardId).toBeNull();
    expect(current.reportedErrors).toEqual([]);
  }

  const selectedCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  const point = await exposedCardPoint(selectedCard);
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await evidence(page)).presentation.selectedCardId)
    .toBe(fixture.activeTopCardId);
  await clearEvidence(page);
  await page.keyboard.press('Alt+KeyN');
  let current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.shortcutRejections).toEqual([]);
  expect(current.presentation.selectedCardId).toBe(fixture.activeTopCardId);

  await page.evaluate(() => {
    const input = document.createElement('input');
    input.dataset.lifecycleShortcutEditor = 'true';
    document.body.append(input);
    input.focus();
  });
  for (const scenario of cases) await page.keyboard.press(scenario.key);
  current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.shortcutRejections).toEqual([]);

  await page.evaluate(() => {
    document.querySelector('[data-lifecycle-shortcut-editor]')?.remove();
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.enterSoloReplay();
  });
  await expect
    .poll(async () => (await evidence(page)).sourceKind)
    .toBe('replay');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  for (const scenario of cases) {
    await clearEvidence(page);
    await page.keyboard.press(scenario.key);
    await expect
      .poll(async () => (await evidence(page)).shortcutRejections)
      .toEqual([
        {
          kind: 'ShortcutActionRejected',
          request: scenario.action,
          reason: 'read_only',
        },
      ]);
    current = await evidence(page);
    expect(current.submissions).toEqual([]);
    expect(current.shortcutActions).toEqual([scenario.action]);
    expect(current.sceneRefreshes).toBe(
      scenario.action.action === 'resetOwnPlayer' ? 1 : 0
    );
    expect(current.presentation.selectedCardId).toBeNull();
    expect(current.reportedErrors).toEqual([]);
  }

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('unselected hand shortcuts stage native counts before atomic authority commands', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const cases = [
    {
      key: 'Alt+KeyD',
      action: 'discardOwnHandAndDraw',
      command: { type: 'DiscardHandAndDraw', count: 2 },
    },
    {
      key: 'Alt+KeyS',
      action: 'shuffleOwnHandAndDraw',
      command: { type: 'ShuffleHandIntoDeckAndDraw', count: 2 },
    },
    {
      key: 'Alt+ArrowDown',
      action: 'shuffleOwnHandToDeckBottomAndDraw',
      command: { type: 'ShuffleHandToDeckBottomAndDraw', count: 2 },
    },
  ] as const;

  for (const [index, scenario] of cases.entries()) {
    await clearEvidence(page);
    const prompt = answerNextPrompt(page, '2');
    await page.keyboard.press(scenario.key);
    expect(await prompt).toEqual({
      type: 'prompt',
      message: 'Draw how many cards?',
      defaultValue: '0',
    });
    await expect
      .poll(async () => (await evidence(page)).submissions)
      .toEqual([scenario.command]);
    const current = await evidence(page);
    expect(current.submissionResults).toEqual([
      {
        queued: true,
        commandId: `protected-input-command-${index + 1}`,
        clientSequence: index + 1,
      },
    ]);
    expect(current.shortcutActions).toEqual([
      { action: scenario.action },
      { action: scenario.action, value: '2' },
    ]);
    expect(current.shortcutRejections).toEqual([]);
    expect(current.overlays.input).toBeNull();
    expect(current.presentation.selectedCardId).toBeNull();
    expect(current.reportedErrors).toEqual([]);
  }

  await clearEvidence(page);
  const cancelDialogs: {
    type: string;
    message: string;
    defaultValue: string;
  }[] = [];
  const handleCancelDialog = async (dialog: Dialog) => {
    cancelDialogs.push({
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
    });
    await dialog.dismiss();
  };
  page.on('dialog', handleCancelDialog);
  await page.keyboard.press('Alt+KeyD');
  await expect
    .poll(() => cancelDialogs)
    .toEqual([
      {
        type: 'prompt',
        message: 'Draw how many cards?',
        defaultValue: '0',
      },
      {
        type: 'alert',
        message: 'Please enter a valid number for the draw amount.',
        defaultValue: '',
      },
    ]);
  page.off('dialog', handleCancelDialog);
  await expect
    .poll(async () => (await evidence(page)).overlays.input)
    .toBeNull();
  let current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([
    { action: 'discardOwnHandAndDraw' },
  ]);
  expect(current.shortcutRejections).toEqual([]);

  await clearEvidence(page);
  const dialogs: {
    type: string;
    message: string;
    defaultValue: string;
  }[] = [];
  const handleInvalidDialog = async (dialog: Dialog) => {
    dialogs.push({
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
    });
    if (dialog.type() === 'prompt') await dialog.accept('invalid');
    else await dialog.dismiss();
  };
  page.on('dialog', handleInvalidDialog);
  await page.keyboard.press('Alt+KeyS');
  await expect
    .poll(() => dialogs)
    .toEqual([
      {
        type: 'prompt',
        message: 'Draw how many cards?',
        defaultValue: '0',
      },
      {
        type: 'alert',
        message: 'Please enter a valid number for the draw amount.',
        defaultValue: '',
      },
    ]);
  page.off('dialog', handleInvalidDialog);
  current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([
    { action: 'shuffleOwnHandAndDraw' },
  ]);
  expect(current.shortcutRejections).toEqual([]);
  expect(current.overlays.input).toBeNull();

  const selectedCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  const point = await exposedCardPoint(selectedCard);
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await evidence(page)).presentation.selectedCardId)
    .toBe(fixture.activeTopCardId);
  await clearEvidence(page);
  for (const scenario of cases) await page.keyboard.press(scenario.key);
  current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.shortcutRejections).toEqual([]);
  expect(current.presentation.selectedCardId).toBe(fixture.activeTopCardId);

  await page.evaluate(() => {
    const input = document.createElement('input');
    input.dataset.handShortcutEditor = 'true';
    document.body.append(input);
    input.focus();
  });
  for (const scenario of cases) await page.keyboard.press(scenario.key);
  current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.shortcutRejections).toEqual([]);

  await page.evaluate(() => {
    document.querySelector('[data-hand-shortcut-editor]')?.remove();
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.enterSoloReplay();
  });
  await expect
    .poll(async () => (await evidence(page)).sourceKind)
    .toBe('replay');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  const unexpectedDialogs: string[] = [];
  const dismissUnexpectedDialog = async (dialog: Dialog) => {
    unexpectedDialogs.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', dismissUnexpectedDialog);
  for (const scenario of cases) {
    await clearEvidence(page);
    await page.keyboard.press(scenario.key);
    await expect
      .poll(async () => (await evidence(page)).shortcutRejections)
      .toEqual([
        {
          kind: 'ShortcutActionRejected',
          request: { action: scenario.action },
          reason: 'read_only',
        },
      ]);
    current = await evidence(page);
    expect(current.submissions).toEqual([]);
    expect(current.shortcutActions).toEqual([{ action: scenario.action }]);
    expect(current.overlays.input).toBeNull();
    expect(current.reportedErrors).toEqual([]);
  }
  page.off('dialog', dismissUnexpectedDialog);
  expect(unexpectedDialogs).toEqual([]);

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('solo U submits one viewer-derived undo while repeat, selection, and replay stay bounded', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');

  await page.evaluate(() => {
    const input = {
      key: 'u',
      code: 'KeyU',
      bubbles: true,
      cancelable: true,
    };
    document.body.dispatchEvent(new KeyboardEvent('keydown', input));
    document.body.dispatchEvent(new KeyboardEvent('keydown', input));
  });
  await expect
    .poll(async () => (await evidence(page)).submissionResults)
    .toEqual([
      {
        queued: true,
        commandId: 'protected-input-command-1',
        clientSequence: 1,
      },
      { queued: false, reason: 'command_pending' },
    ]);
  let current = await evidence(page);
  expect(current.submissions).toEqual([
    {
      type: 'ApplySoloUndo',
      targetPlayerId: fixture.ownPlayerId,
    },
  ]);
  expect(current.shortcutActions).toEqual([
    { action: 'undoOwnLastMove' },
    { action: 'undoOwnLastMove' },
  ]);
  expect(current.shortcutRejections).toEqual([]);
  expect(current.presentation.selectedCardId).toBeNull();
  expect(current.reportedErrors).toEqual([]);

  const selectedCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  const point = await exposedCardPoint(selectedCard);
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await evidence(page)).presentation.selectedCardId)
    .toBe(fixture.activeTopCardId);
  await clearEvidence(page);
  await page.keyboard.press('KeyU');
  current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.submissionResults).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.presentation.selectedCardId).toBe(fixture.activeTopCardId);

  await page.evaluate(() => {
    const input = document.createElement('input');
    input.dataset.undoShortcutEditor = 'true';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('KeyU');
  current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.submissionResults).toEqual([]);
  expect(current.shortcutActions).toEqual([]);

  await page.evaluate(() => {
    document.querySelector('[data-undo-shortcut-editor]')?.remove();
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.enterSoloReplay();
  });
  await expect
    .poll(async () => (await evidence(page)).sourceKind)
    .toBe('replay');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await clearEvidence(page);
  await page.keyboard.press('KeyU');
  await expect
    .poll(async () => (await evidence(page)).shortcutRejections)
    .toEqual([
      {
        kind: 'ShortcutActionRejected',
        request: { action: 'undoOwnLastMove' },
        reason: 'read_only',
      },
    ]);
  current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.submissionResults).toEqual([]);
  expect(current.shortcutActions).toEqual([{ action: 'undoOwnLastMove' }]);
  expect(current.overlays.input).toBeNull();
  expect(current.reportedErrors).toEqual([]);

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('M emits only ephemeral live-player mulligan declarations and preserves protected inputs', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');

  await page.evaluate(() => {
    const init = {
      key: 'm',
      code: 'KeyM',
      bubbles: true,
      cancelable: true,
    };
    document.body.dispatchEvent(new KeyboardEvent('keydown', init));
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { ...init, altKey: true })
    );
  });
  await expect
    .poll(async () => (await evidence(page)).mulliganDeclarations)
    .toBe(2);
  let current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.submissionResults).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.shortcutRejections).toEqual([]);

  const selectedCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  const point = await exposedCardPoint(selectedCard);
  await page.mouse.click(point.x, point.y);
  await clearEvidence(page);
  await page.keyboard.press('KeyM');
  current = await evidence(page);
  expect(current.mulliganDeclarations).toBe(0);
  expect(current.presentation.selectedCardId).toBe(fixture.activeTopCardId);

  await page.evaluate(() => {
    const input = document.createElement('input');
    input.dataset.mulliganShortcutEditor = 'true';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('KeyM');
  current = await evidence(page);
  expect(current.mulliganDeclarations).toBe(0);
  await expect(page.locator('[data-mulligan-shortcut-editor]')).toHaveValue(
    'm'
  );

  await page.evaluate(() => {
    document.querySelector('[data-mulligan-shortcut-editor]')?.remove();
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.enterSoloReplay();
  });
  await expect
    .poll(async () => (await evidence(page)).sourceKind)
    .toBe('replay');
  await clearEvidence(page);
  await page.keyboard.press('KeyM');
  current = await evidence(page);
  expect(current.mulliganDeclarations).toBe(0);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.reportedErrors).toEqual([]);

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('R separates local scene refresh from protected group and single-card rotation', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');

  await page.evaluate(() => {
    const init = {
      key: 'r',
      code: 'KeyR',
      bubbles: true,
      cancelable: true,
    };
    document.body.dispatchEvent(new KeyboardEvent('keydown', init));
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { ...init, ctrlKey: true })
    );
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { ...init, key: 'R', shiftKey: true })
    );
  });
  await expect.poll(async () => (await evidence(page)).sceneRefreshes).toBe(3);
  let current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.shortcutRejections).toEqual([]);

  const selectedCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  const point = await exposedCardPoint(selectedCard);
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await evidence(page)).presentation.selectedCardId)
    .toBe(fixture.activeTopCardId);
  await clearEvidence(page);
  await page.keyboard.press('KeyR');
  await page.keyboard.press('Alt+KeyR');
  current = await evidence(page);
  expect(current.sceneRefreshes).toBe(0);
  expect(current.shortcutActions).toEqual([
    {
      action: 'rotateSelectedCard',
      cardId: fixture.activeTopCardId,
      single: false,
    },
    {
      action: 'rotateSelectedCard',
      cardId: fixture.activeTopCardId,
      single: true,
    },
  ]);
  expect(current.submissions).toEqual([
    {
      type: 'RotateStack',
      stackId: fixture.activeStackId,
      rotationQuarterTurns: 1,
    },
    {
      type: 'SetCardOrientation',
      cardId: fixture.activeTopCardId,
      orientationQuarterTurns: 1,
    },
  ]);
  expect(current.shortcutRejections).toEqual([]);
  expect(current.presentation.selectedCardId).toBe(fixture.activeTopCardId);

  await page.mouse.dblclick(point.x, point.y);
  await expect
    .poll(async () => (await evidence(page)).overlays.preview)
    .not.toBeNull();
  await clearEvidence(page);
  await page.keyboard.press('KeyR');
  await page.keyboard.press('Alt+KeyR');
  current = await evidence(page);
  expect(current.sceneRefreshes).toBe(0);
  expect(current.shortcutActions).toEqual([]);
  expect(current.submissions).toEqual([]);

  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.dataset.rotationShortcutEditor = 'true';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('KeyR');
  current = await evidence(page);
  expect(current.sceneRefreshes).toBe(0);
  expect(current.shortcutActions).toEqual([]);
  await expect(page.locator('[data-rotation-shortcut-editor]')).toHaveValue(
    'r'
  );

  await page.evaluate(() => {
    document.querySelector('[data-rotation-shortcut-editor]')?.remove();
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.enterSoloReplay();
  });
  await expect
    .poll(async () => (await evidence(page)).sourceKind)
    .toBe('replay');
  const replayCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  const replayPoint = await exposedCardPoint(replayCard);
  await page.mouse.click(replayPoint.x, replayPoint.y);
  await clearEvidence(page);
  await page.keyboard.press('KeyR');
  current = await evidence(page);
  expect(current.sceneRefreshes).toBe(0);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([
    {
      action: 'rotateSelectedCard',
      cardId: fixture.activeTopCardId,
      single: false,
    },
  ]);
  expect(current.shortcutRejections).toEqual([
    {
      kind: 'ShortcutActionRejected',
      request: {
        action: 'rotateSelectedCard',
        cardId: fixture.activeTopCardId,
        single: false,
      },
      reason: 'read_only',
    },
  ]);
  expect(current.reportedErrors).toEqual([]);

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Alt-F flips only the local board perspective across selection and replay', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const ownFrame = host.locator(
    `[data-player-frame-id="${fixture.ownPlayerId}"]`
  );
  await expect(ownFrame).toHaveAttribute('data-player-physical-side', 'lower');

  await clearEvidence(page);
  await page.keyboard.press('Alt+KeyF');
  await expect.poll(async () => (await evidence(page)).boardFlips).toBe(1);
  await expect(ownFrame).toHaveAttribute('data-player-physical-side', 'upper');
  let current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.shortcutRejections).toEqual([]);

  await page.keyboard.press('Control+Alt+KeyF');
  await expect.poll(async () => (await evidence(page)).boardFlips).toBe(2);
  await expect(ownFrame).toHaveAttribute('data-player-physical-side', 'lower');

  const selectedCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  const point = await exposedCardPoint(selectedCard);
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await evidence(page)).presentation.selectedCardId)
    .toBe(fixture.activeTopCardId);
  await clearEvidence(page);
  await page.keyboard.press('Shift+Alt+KeyF');
  await expect.poll(async () => (await evidence(page)).boardFlips).toBe(1);
  await expect(ownFrame).toHaveAttribute('data-player-physical-side', 'upper');
  current = await evidence(page);
  expect(current.presentation.selectedCardId).toBe(fixture.activeTopCardId);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([]);

  expect(
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.dataset.flipShortcutEditor = 'true';
      document.body.append(input);
      return input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          code: 'KeyF',
          altKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    })
  ).toBe(true);
  expect((await evidence(page)).boardFlips).toBe(1);

  await page.evaluate(() => {
    document.querySelector('[data-flip-shortcut-editor]')?.remove();
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.enterSoloReplay();
  });
  await expect
    .poll(async () => (await evidence(page)).sourceKind)
    .toBe('replay');
  await clearEvidence(page);
  await page.keyboard.press('Alt+KeyF');
  await expect.poll(async () => (await evidence(page)).boardFlips).toBe(1);
  await expect(ownFrame).toHaveAttribute('data-player-physical-side', 'lower');
  current = await evidence(page);
  expect(current.submissions).toEqual([]);
  expect(current.shortcutActions).toEqual([]);
  expect(current.reportedErrors).toEqual([]);

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Escape globally dismisses local board presentation without command traffic', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const selectedCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  const selectedPoint = await exposedCardPoint(selectedCard);
  const dispatchBodyEscape = (
    modifiers: {
      readonly altKey?: boolean;
      readonly ctrlKey?: boolean;
      readonly shiftKey?: boolean;
    } = {}
  ): Promise<boolean> =>
    page.evaluate(
      (init) =>
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true,
            cancelable: true,
            ...init,
          })
        ),
      modifiers
    );
  const expectOnlyLocalDismissal = async (): Promise<void> => {
    await expect
      .poll(async () => (await evidence(page)).presentationDismissals)
      .toBe(1);
    const current = await evidence(page);
    expect(current).toMatchObject({
      submissions: [],
      submissionResults: [],
      rejections: [],
      overlayRejections: [],
      overlayActions: [],
      shortcutRejections: [],
      shortcutActions: [],
      presentation: { selectedCardId: null, openedZoneId: null },
      overlays: { contextMenuCardId: null, input: null, preview: null },
      reportedErrors: [],
    });
  };

  await page.mouse.click(selectedPoint.x, selectedPoint.y);
  await expect
    .poll(async () => (await evidence(page)).presentation.selectedCardId)
    .toBe(fixture.activeTopCardId);
  await clearEvidence(page);
  expect(await dispatchBodyEscape()).toBe(true);
  await expectOnlyLocalDismissal();

  await page.mouse.click(selectedPoint.x, selectedPoint.y, { button: 'right' });
  await expect
    .poll(async () => (await evidence(page)).overlays.contextMenuCardId)
    .toBe(fixture.activeTopCardId);
  await clearEvidence(page);
  expect(await dispatchBodyEscape({ ctrlKey: true })).toBe(true);
  await expectOnlyLocalDismissal();
  await expect(host.locator('[data-legacy-card-context-menu]')).toHaveCount(0);

  await page.keyboard.press('KeyV');
  await expect
    .poll(async () => (await evidence(page)).presentation.openedZoneId)
    .toBe(fixture.ownDeckZoneId);
  await clearEvidence(page);
  expect(await dispatchBodyEscape({ altKey: true })).toBe(true);
  await expectOnlyLocalDismissal();
  await expect(host.locator('[data-legacy-zone-browser]')).toHaveCount(0);

  await page.mouse.click(selectedPoint.x, selectedPoint.y);
  await page.keyboard.press('KeyV');
  await expect
    .poll(async () => (await evidence(page)).overlays.preview)
    .toMatchObject({
      kind: 'stack',
      stackId: fixture.activeStackId,
      focusCardId: fixture.activeTopCardId,
    });
  await clearEvidence(page);
  expect(await dispatchBodyEscape({ shiftKey: true })).toBe(true);
  await expectOnlyLocalDismissal();
  await expect(host.locator('[data-legacy-card-preview]')).toHaveCount(0);

  await page.mouse.click(selectedPoint.x, selectedPoint.y, { button: 'right' });
  await expect
    .poll(async () => (await evidence(page)).overlays.contextMenuCardId)
    .toBe(fixture.activeTopCardId);
  await clearEvidence(page);
  expect(
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.dataset.escapeShortcutEditor = 'true';
      document.body.append(input);
      return input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true,
        })
      );
    })
  ).toBe(true);
  expect((await evidence(page)).presentationDismissals).toBe(0);
  expect((await evidence(page)).overlays.contextMenuCardId).toBe(
    fixture.activeTopCardId
  );
  expect(await dispatchBodyEscape()).toBe(true);
  await expectOnlyLocalDismissal();
  await page
    .locator('[data-escape-shortcut-editor]')
    .evaluate((element) => element.remove());

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.enterSoloReplay();
  });
  await expect
    .poll(async () => (await evidence(page)).sourceKind)
    .toBe('replay');
  await page.mouse.click(selectedPoint.x, selectedPoint.y);
  await expect
    .poll(async () => (await evidence(page)).presentation.selectedCardId)
    .toBe(fixture.activeTopCardId);
  await clearEvidence(page);
  expect(await dispatchBodyEscape({ ctrlKey: true, shiftKey: true })).toBe(
    true
  );
  await expectOnlyLocalDismissal();

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('V opens the local deck or selected-card preview without replay mutation', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');

  await clearEvidence(page);
  await page.keyboard.press('KeyV');
  await expect
    .poll(() => evidence(page))
    .toMatchObject({
      deckViewDeclarations: 1,
      submissions: [],
      shortcutActions: [],
      presentation: {
        selectedCardId: null,
        openedZoneId: fixture.ownDeckZoneId,
      },
    });
  const zoneBrowser = host.locator('[data-legacy-zone-browser]');
  await expect(zoneBrowser).toBeVisible();
  await expect(zoneBrowser).toHaveAttribute(
    'data-zone-browser-id',
    fixture.ownDeckZoneId
  );
  await page.keyboard.press('Escape');
  await expect(zoneBrowser).toHaveCount(0);

  const selectedCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  const point = await exposedCardPoint(selectedCard);
  await page.mouse.click(point.x, point.y);
  await clearEvidence(page);
  await page.keyboard.press('Alt+KeyV');
  await expect
    .poll(() => evidence(page))
    .toMatchObject({
      deckViewDeclarations: 0,
      submissions: [],
      shortcutActions: [],
      presentation: { selectedCardId: null, openedZoneId: null },
      overlays: {
        preview: {
          kind: 'stack',
          stackId: fixture.activeStackId,
          focusCardId: fixture.activeTopCardId,
        },
      },
    });
  await page.keyboard.press('KeyV');
  await expect(host.locator('[data-legacy-card-preview]')).toHaveCount(0);
  expect((await evidence(page)).deckViewDeclarations).toBe(0);

  await page.evaluate(() => {
    const input = document.createElement('input');
    input.dataset.viewShortcutEditor = 'true';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('KeyV');
  await expect(page.locator('[data-view-shortcut-editor]')).toHaveValue('v');
  expect((await evidence(page)).deckViewDeclarations).toBe(0);

  await page.evaluate(() => {
    document.querySelector('[data-view-shortcut-editor]')?.remove();
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.enterSoloReplay();
  });
  await expect
    .poll(async () => (await evidence(page)).sourceKind)
    .toBe('replay');
  await clearEvidence(page);
  await page.keyboard.press('KeyV');
  await expect
    .poll(async () => (await evidence(page)).presentation.openedZoneId)
    .toBe(fixture.ownDeckZoneId);
  const replayEvidence = await evidence(page);
  expect(replayEvidence.deckViewDeclarations).toBe(0);
  expect(replayEvidence.submissions).toEqual([]);
  expect(replayEvidence.shortcutActions).toEqual([]);
  expect(replayEvidence.reportedErrors).toEqual([]);

  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('solo replay disclosure changes only local DOM card faces and never submits', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const fixture = await mountHarness(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const menu = host.locator('[data-legacy-card-context-menu]');
  const labelsFor = (cardIds: readonly string[]) =>
    Promise.all(
      cardIds.map((cardId) =>
        host.locator(`[data-card-id="${cardId}"]`).getAttribute('aria-label')
      )
    );
  const callHarness = (
    method:
      | 'enterSoloReplay'
      | 'advanceSoloReplay'
      | 'seekSoloReplayStart'
      | 'exitSoloReplay'
  ) =>
    page.evaluate((name) => {
      const harness = (window as ProtectedInputHarnessWindow)
        .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
      if (!harness) throw new Error('Missing protected-input harness');
      harness[name]();
    }, method);
  const openMenu = async (cardId: string): Promise<void> => {
    const card = host.locator(`[data-card-id="${cardId}"]`);
    await card.focus();
    await card.press('Shift+F10');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('data-context-card-id', cardId);
  };

  await callHarness('enterSoloReplay');
  await expect
    .poll(async () => (await evidence(page)).sourceKind)
    .toBe('replay');
  expect(await labelsFor(fixture.ownPrizeCardIds)).toEqual(
    fixture.ownPrizeCardIds.map(() => 'Face-down card')
  );

  await openMenu(fixture.ownPrizeCardId);
  expect(
    await menu.locator(':scope > ul > li > [role="menuitem"]').allTextContents()
  ).toEqual(['Reveal/hide prizes', 'Look/cover prizes', 'Reveal/hide card']);
  await menu.locator('[data-context-action="togglePrizes"]').click();
  await expect(menu).toHaveCount(0);
  await expect
    .poll(() => labelsFor(fixture.ownPrizeCardIds))
    .toEqual(fixture.ownPrizeCardIds.map(() => fixture.replayLocalCardLabel));

  await openMenu(fixture.ownPrizeCardId);
  await menu.locator('[data-context-action="revealPrizes"]').click();
  await expect
    .poll(() => labelsFor(fixture.ownPrizeCardIds))
    .toEqual(fixture.ownPrizeCardIds.map(() => 'Face-down card'));

  await openMenu(fixture.opponentHandCardId);
  expect(
    await menu.locator(':scope > ul > li > [role="menuitem"]').allTextContents()
  ).toEqual(['Look/cover hand', 'Reveal/hide card']);
  await menu.locator('[data-context-action="toggleOpponentHand"]').click();
  await expect
    .poll(() => labelsFor(fixture.opponentHandCardIds))
    .toEqual(
      fixture.opponentHandCardIds.map(() => fixture.replayLocalCardLabel)
    );

  await openMenu(fixture.ownPrizeCardId);
  await menu.locator('[data-context-action="togglePrizes"]').click();
  await expect
    .poll(() => labelsFor(fixture.ownPrizeCardIds))
    .toEqual(fixture.ownPrizeCardIds.map(() => fixture.replayLocalCardLabel));
  await callHarness('advanceSoloReplay');
  await expect
    .poll(() => labelsFor(fixture.ownPrizeCardIds))
    .toEqual(fixture.ownPrizeCardIds.map(() => fixture.replayLocalCardLabel));
  await callHarness('seekSoloReplayStart');
  await expect
    .poll(() => labelsFor(fixture.ownPrizeCardIds))
    .toEqual(fixture.ownPrizeCardIds.map(() => 'Face-down card'));
  await expect
    .poll(() => labelsFor(fixture.opponentHandCardIds))
    .toEqual(fixture.opponentHandCardIds.map(() => 'Face-down card'));

  const replayEvidence = await evidence(page);
  expect(replayEvidence.submissions).toEqual([]);
  expect(replayEvidence.submissionResults).toEqual([]);
  expect(replayEvidence.rejections).toEqual([]);
  expect(replayEvidence.overlayRejections).toEqual([]);
  expect(replayEvidence.overlayActions).toEqual([
    {
      kind: 'context',
      action: 'togglePrizes',
      cardId: fixture.ownPrizeCardId,
    },
    {
      kind: 'context',
      action: 'revealPrizes',
      cardId: fixture.ownPrizeCardId,
    },
    {
      kind: 'context',
      action: 'toggleOpponentHand',
      cardId: fixture.opponentHandCardId,
    },
    {
      kind: 'context',
      action: 'togglePrizes',
      cardId: fixture.ownPrizeCardId,
    },
  ]);
  expect(replayEvidence.shortcutActions).toEqual([]);
  expect(replayEvidence.shortcutRejections).toEqual([]);
  expect(replayEvidence.replayLocalZoneModes).toEqual({});
  expect(replayEvidence.replayLocalCardModes).toEqual({});
  expect(replayEvidence.reportedErrors).toEqual([]);

  await callHarness('exitSoloReplay');
  await expect.poll(async () => (await evidence(page)).sourceKind).toBe('live');
  expect(await labelsFor(fixture.ownPrizeCardIds)).toEqual(
    fixture.ownPrizeCardIds.map(() => 'Face-down card')
  );
  await page.evaluate(() => {
    const harness = (window as ProtectedInputHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing protected-input harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});
