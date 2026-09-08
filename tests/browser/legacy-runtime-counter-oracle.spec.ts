import { expect, test, type Browser, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

interface CounterSample {
  readonly kind: 'damage' | 'specialCondition' | 'ability';
  readonly className: string;
  readonly textContent: string;
  readonly display: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly backgroundColor: string;
  readonly parentIsZone: boolean;
}

interface CounterCapture {
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly cardLeftInZone: number;
  readonly cardTopInZone: number;
  readonly counters: readonly CounterSample[];
}

/**
 * Counter placement is the third behaviour the compound family composes, and
 * `rotateCard` refreshes every counter after it turns a stack, so the two rules
 * interact. The renderer contract models the same geometry in
 * `layoutLegacyActiveQ0Markers`, derived from the transcription rather than
 * from the running client.
 *
 * This drives the real `addDamageCounter`, `addSpecialCondition` and
 * `addAbilityCounter` and reads what they place.
 */
const captureCounters = async (page: Page): Promise<CounterCapture> =>
  page.evaluate(async () => {
    const load = (specifier: string): Promise<Record<string, never>> =>
      import(/* @vite-ignore */ specifier);
    const [
      cardModule,
      placementModule,
      zoneModule,
      damage,
      condition,
      ability,
    ] = await Promise.all([
      load('/src/setup/deck-constructor/card.js'),
      load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
      load('/src/setup/zones/get-zone.js'),
      load('/src/actions/counters/damage-counter.js'),
      load('/src/actions/counters/special-condition.js'),
      load('/src/actions/counters/ability-counter.js'),
    ]);
    const Card = (
      cardModule as unknown as {
        readonly Card: new (
          user: string,
          name: string,
          type: string,
          imageUrl: string
        ) => { readonly image: HTMLImageElement };
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
      ) => { readonly element: HTMLElement; readonly array: unknown[] };
    };
    const { addDamageCounter } = damage as unknown as {
      readonly addDamageCounter: (
        user: string,
        zoneId: string,
        index: number,
        amount: unknown,
        emit?: boolean
      ) => void;
    };
    const { addSpecialCondition } = condition as unknown as {
      readonly addSpecialCondition: (
        user: string,
        zoneId: string,
        index: number,
        emit?: boolean
      ) => void;
    };
    const { addAbilityCounter } = ability as unknown as {
      readonly addAbilityCounter: (
        user: string,
        zoneId: string,
        index: number,
        emit?: boolean
      ) => void;
    };

    const zone = getZone('self', 'active');
    zone.array.length = 0;
    zone.element.replaceChildren();
    const card = new Card(
      'self',
      'base',
      'Pokémon',
      `${location.origin}/src/assets/cardback.png`
    );
    await card.image.decode();
    zone.array.push(card);
    initializeActiveBenchCard('self', card, 'active', zone);
    let previousSize: readonly [number, number] | null = null;
    let stableFrames = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
      const rect = card.image.getBoundingClientRect();
      const size = [rect.width, rect.height] as const;
      stableFrames =
        rect.width > 0 &&
        rect.height > 0 &&
        previousSize?.[0] === size[0] &&
        previousSize[1] === size[1]
          ? stableFrames + 1
          : 0;
      previousSize = size;
      if (stableFrames >= 2) break;
    }
    if (stableFrames < 2) {
      throw new Error('Legacy card did not reach a stable nonzero painted box');
    }

    addDamageCounter('self', 'active', 0, '130', false);
    addSpecialCondition('self', 'active', 0, false);
    addAbilityCounter('self', 'active', 0, false);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    const image = card.image as unknown as {
      damageCounter?: HTMLElement;
      specialCondition?: HTMLElement;
      abilityCounter?: HTMLElement;
    };
    const cardRect = card.image.getBoundingClientRect();
    const zoneRect = zone.element.getBoundingClientRect();
    const sample = (
      kind: CounterSample['kind'],
      element: HTMLElement | undefined
    ): CounterSample => {
      if (!element)
        throw new Error(`Legacy did not create the ${kind} counter`);
      const style = getComputedStyle(element);
      return {
        kind,
        className: element.className,
        textContent: element.textContent ?? '',
        display: element.style.display,
        left: Number.parseFloat(element.style.left),
        top: Number.parseFloat(element.style.top),
        width: Number.parseFloat(element.style.width),
        height: Number.parseFloat(element.style.height || style.height),
        backgroundColor: style.backgroundColor,
        parentIsZone: element.parentElement === zone.element,
      };
    };
    return {
      cardWidth: cardRect.width,
      cardHeight: cardRect.height,
      cardLeftInZone: cardRect.left - zoneRect.left,
      cardTopInZone: cardRect.top - zoneRect.top,
      counters: [
        sample('damage', image.damageCounter),
        sample('specialCondition', image.specialCondition),
        sample('ability', image.abilityCounter),
      ],
    };
  }) as Promise<CounterCapture>;

const withRuntime = async (browser: Browser): Promise<CounterCapture> => {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  try {
    await loadLegacyRuntime(page);
    return await captureCounters(page);
  } finally {
    await page.close();
  }
};

test('the real v1 runtime places counters relative to the painted card box', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );
  const capture = await withRuntime(browser);
  await testInfo.attach('counter-placement.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });

  const byKind = new Map(
    capture.counters.map((counter) => [counter.kind, counter] as const)
  );
  const damage = byKind.get('damage')!;
  const condition = byKind.get('specialCondition')!;
  const ability = byKind.get('ability')!;

  // Every counter is a sibling of the card in the zone, not a child of the
  // play container, which is why rotation has to refresh them.
  expect(capture.counters.every((counter) => counter.parentIsZone)).toBe(true);

  // The circles sit two thirds across and a quarter down the painted box, and
  // are a third of its width. This is the geometry layoutLegacyActiveQ0Markers
  // reproduces from the transcription.
  for (const counter of [damage, condition]) {
    expect(counter.width, `${counter.kind} width`).toBeCloseTo(
      capture.cardWidth / 3,
      3
    );
    expect(counter.top, `${counter.kind} top`).toBeCloseTo(
      capture.cardTopInZone + capture.cardHeight / 4,
      3
    );
  }
  expect(damage.left).toBeCloseTo(
    capture.cardLeftInZone + capture.cardWidth / 1.5,
    3
  );
  // The condition circle takes the opposite horizontal edge.
  expect(condition.left).toBeCloseTo(capture.cardLeftInZone, 3);

  // The ability marker is a full-width tab at the vertical midpoint rather than
  // a circle, and carries no glyph.
  expect(ability.width).toBeCloseTo(capture.cardWidth, 3);
  expect(ability.top).toBeCloseTo(
    capture.cardTopInZone + capture.cardHeight / 2,
    3
  );

  expect(damage.textContent).toBe('130');
  expect(damage.className).toContain('circle');
  expect(condition.className).toContain('circle');
  expect(ability.className).toContain('tab');
});
