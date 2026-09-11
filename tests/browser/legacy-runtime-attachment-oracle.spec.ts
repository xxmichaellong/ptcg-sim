import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

interface AttachedSample {
  readonly role: string;
  readonly left: string;
  readonly bottom: string;
  readonly position: string;
  readonly zIndex: string;
  readonly transform: string;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeIsBase: boolean;
  readonly domIndex: number;
}

interface AttachmentCapture {
  readonly baseClientWidth: number;
  readonly baseEnergyLayer: number;
  readonly baseLayer: number;
  readonly containerWidth: string;
  readonly containerMarginRight: string;
  readonly samples: readonly AttachedSample[];
}

/**
 * `attach-card.js` is the second pillar under the compound-rotation family, and
 * the source of the offset arithmetic that several thousand fixture lines
 * encode. Like rotation, every existing gate for it compares a TypeScript
 * re-implementation against fixtures derived from that same re-implementation.
 *
 * This drives the real `attachCard` and reads the resulting inline styles, so
 * the offsets become measurements of v1 rather than assertions about it.
 */
const captureAttachment = async (
  page: Page,
  attachments: readonly ('Energy' | 'Trainer' | 'Pokémon')[]
): Promise<AttachmentCapture> =>
  page.evaluate(async (attachmentTypes) => {
    const load = (specifier: string): Promise<Record<string, never>> =>
      import(/* @vite-ignore */ specifier);
    const [cardModule, placementModule, zoneModule, attachModule] =
      await Promise.all([
        load('/src/setup/deck-constructor/card.js'),
        load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
        load('/src/setup/zones/get-zone.js'),
        load('/src/actions/move-card-bundle/attach-card.js'),
      ]);
    const Card = (
      cardModule as unknown as {
        readonly Card: new (
          user: string,
          name: string,
          type: string,
          imageUrl: string
        ) => { readonly image: HTMLImageElement; type: string };
      }
    ).Card;
    const { initializeActiveBenchCard } = placementModule as unknown as {
      readonly initializeActiveBenchCard: (
        user: string,
        card: unknown,
        zoneId: string,
        zone: { readonly element: HTMLElement; readonly array: unknown[] }
      ) => void;
    };
    const { getZone } = zoneModule as unknown as {
      readonly getZone: (
        user: string,
        zoneId: string
      ) => {
        readonly element: HTMLElement;
        readonly array: { readonly image: HTMLImageElement; type: string }[];
        readonly getCount: () => number;
      };
    };
    const { attachCard } = attachModule as unknown as {
      readonly attachCard: (
        user: string,
        initiator: string,
        movingCard: unknown,
        targetCard: unknown,
        dZoneId: string,
        dZone: unknown
      ) => void;
    };

    const zone = getZone('self', 'active');
    zone.array.length = 0;
    zone.element.replaceChildren();

    const makeCard = (name: string, type: string) =>
      new Card(
        'self',
        name,
        type,
        `${location.origin}/src/assets/cardback.png`
      );
    const base = makeCard('base', 'Pokémon');
    await base.image.decode();
    zone.array.push(base);
    initializeActiveBenchCard('self', base, 'active', zone);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    // `attachCard` inspects the moving card's current parent to decide whether
    // this is an evolve or a re-attach, so the card has to already live
    // somewhere, exactly as it would coming out of hand.
    const hand = getZone('self', 'hand');
    hand.array.length = 0;
    hand.element.replaceChildren();

    const attached = attachmentTypes.map((type, index) =>
      makeCard(`attachment-${index}`, type)
    );
    await Promise.all(attached.map((card) => card.image.decode()));

    // All mutations and inline-style capture stay in one browser task. The
    // live v1 resize listener can otherwise run during the next image decode
    // and rescale an earlier attachment before this oracle records it.
    for (const card of attached) {
      hand.element.append(card.image);
      zone.array.push(card);
      attachCard('self', 'self', card, base, 'active', zone);
    }

    const container = base.image.parentElement as HTMLElement;
    const domOrder = [...container.querySelectorAll('img')];
    const baseImage = base.image as unknown as {
      energyLayer: number;
      layer: number;
    };
    return {
      baseClientWidth: base.image.clientWidth,
      baseEnergyLayer: baseImage.energyLayer,
      baseLayer: baseImage.layer,
      containerWidth: container.style.width,
      containerMarginRight: container.style.marginRight,
      samples: attached.map((card, index) => {
        const image = card.image as unknown as {
          attached: boolean;
          target: string;
          relative: unknown;
        };
        return {
          role: `${attachmentTypes[index]}-${index}`,
          left: card.image.style.left,
          bottom: card.image.style.bottom,
          position: card.image.style.position,
          zIndex: card.image.style.zIndex,
          transform: card.image.style.transform,
          attached: image.attached,
          target: image.target,
          relativeIsBase: image.relative === base.image,
          domIndex: domOrder.indexOf(card.image),
        };
      }),
    };
  }, attachments) as Promise<AttachmentCapture>;

/**
 * Chromium serializes inline lengths to roughly six significant figures, so
 * `clientWidth / 6` is stored as `15.1667px` rather than its full float. The
 * rule is the arithmetic; the serialization is the browser's. Comparing
 * numerically records the rule without re-implementing CSSOM rounding.
 */
const pixels = (value: string): number => Number.parseFloat(value);

const withRuntime = async (
  browser: import('@playwright/test').Browser,
  run: (page: Page) => Promise<AttachmentCapture>
): Promise<AttachmentCapture> => {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  try {
    await loadLegacyRuntime(page);
    return await run(page);
  } finally {
    await page.close();
  }
};

test('the real v1 runtime offsets Energy attachments by a sixth of the base width', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );
  const capture = await withRuntime(browser, (page) =>
    captureAttachment(page, ['Energy', 'Energy'])
  );
  await testInfo.attach('energy-attachment.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });

  const adjustment = capture.baseClientWidth / 6;
  expect(capture.baseEnergyLayer).toBe(2);
  expect(capture.baseLayer).toBe(0);
  // Each non-Pokemon attachment steps one adjustment further left and pushes
  // the container out by the same amount.
  for (const [index, sample] of capture.samples.entries()) {
    expect(pixels(sample.left), `energy ${index} left`).toBeCloseTo(
      adjustment * (index + 1),
      3
    );
  }
  expect(capture.samples.map((sample) => sample.position)).toEqual([
    'absolute',
    'absolute',
  ]);
  // zIndex starts at the reset zero and drops by the layer it was given.
  expect(capture.samples.map((sample) => sample.zIndex)).toEqual(['-1', '-2']);
  expect(
    capture.samples.every(
      (sample) =>
        sample.attached && sample.target === 'on' && sample.relativeIsBase
    )
  ).toBe(true);
  // Energy inherits the base orientation with no offset of its own.
  expect(capture.samples.map((sample) => sample.transform)).toEqual([
    'rotate(0deg)',
    'rotate(0deg)',
  ]);
});

test('the real v1 runtime rotates a Trainer-as-Tool attachment a quarter turn', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );
  const capture = await withRuntime(browser, (page) =>
    captureAttachment(page, ['Trainer'])
  );
  await testInfo.attach('tool-attachment.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });

  const adjustment = capture.baseClientWidth / 6;
  expect(capture.baseEnergyLayer).toBe(1);
  expect(pixels(capture.samples[0]?.left ?? '')).toBeCloseTo(adjustment, 3);
  // syncRotation subtracts a negative offset for Trainer, so a Tool paints a
  // quarter turn away from its base, and claims a wider container margin.
  expect(capture.samples[0]?.transform).toBe('rotate(90deg)');
  expect(capture.containerMarginRight).toBe('2%');
});

test('the real v1 runtime stacks evolutions by a fifteenth of the base width', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );
  const capture = await withRuntime(browser, (page) =>
    captureAttachment(page, ['Pokémon', 'Pokémon'])
  );
  await testInfo.attach('evolution-attachment.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });

  const adjustment = capture.baseClientWidth / 15;
  // Evolutions take the separate `layer` counter and rise instead of shifting.
  expect(capture.baseLayer).toBe(2);
  expect(capture.baseEnergyLayer).toBe(0);
  for (const [index, sample] of capture.samples.entries()) {
    expect(pixels(sample.bottom), `evolution ${index} bottom`).toBeCloseTo(
      adjustment * (index + 1),
      3
    );
  }
  expect(capture.samples.map((sample) => sample.left)).toEqual(['0px', '0px']);
  expect(capture.samples.map((sample) => sample.zIndex)).toEqual(['-1', '-2']);
  // An evolution stays square with its base, unlike a Tool.
  expect(capture.samples.map((sample) => sample.transform)).toEqual([
    'rotate(0deg)',
    'rotate(0deg)',
  ]);
});
