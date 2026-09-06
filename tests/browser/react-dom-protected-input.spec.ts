import { expect, test, type Locator, type Page } from '@playwright/test';

interface ProtectedInputFixture {
  readonly ownPlayerId: string;
  readonly opponentPlayerId: string;
  readonly sourceCardId: string;
  readonly sourceZoneId: string;
  readonly ownBoardZoneId: string;
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

test('selected-card marker, category, and visibility shortcuts stay protected and suppress editable targets', async ({
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
  ).toEqual(['Reveal/hide prizes', 'Look/cover prizes']);
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
  ).toEqual(['Look/cover hand']);
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
