import { expect, test, type Locator, type Page } from '@playwright/test';

interface ProtectedInputFixture {
  readonly sourceCardId: string;
  readonly sourceZoneId: string;
  readonly unsupportedCardId: string;
  readonly destinationZoneId: string;
}

interface ProtectedInputEvidence {
  readonly submissions: readonly unknown[];
  readonly submissionResults: readonly unknown[];
  readonly rejections: readonly unknown[];
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
    readonly preview:
      | { readonly kind: 'card'; readonly cardId: string }
      | {
          readonly kind: 'stack';
          readonly stackId: string;
          readonly focusCardId: string;
        }
      | null;
  };
  readonly reportedErrors: readonly string[];
}

interface ProtectedInputHarnessWindow extends Window {
  __PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__?: {
    readonly getFixture: () => ProtectedInputFixture;
    readonly getEvidence: () => ProtectedInputEvidence;
    readonly clearEvidence: () => void;
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
        openedZoneId: fixture.destinationZoneId,
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
