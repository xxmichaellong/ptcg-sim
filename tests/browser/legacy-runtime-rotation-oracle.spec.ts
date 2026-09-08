import { expect, test } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

interface RotationSample {
  readonly step: number;
  readonly transform: string;
  readonly marginRight: string;
  readonly marginLeft: string;
  readonly pokemonBreak: boolean;
  readonly siblingTransforms: readonly string[];
}

/**
 * The first parity gate measured against the running v1 client rather than a
 * transcription of it.
 *
 * `rotate-card.js` is the rule the whole compound-rotation family rests on:
 * rotation accumulates from the parsed inline transform, bench containers take
 * a wider margin, half turns restore the narrow one, a group rotation carries
 * sibling Pokemon, and a single rotation toggles the `PokémonBreak` flag. Every
 * existing gate for that behaviour compares a TypeScript re-implementation
 * against fixtures derived from the same re-implementation, so a pass shows
 * only that the copy agrees with itself.
 *
 * This drives the real `rotateCard` through the same q0-q1-q2-q3-q0 cycle the
 * transcription pins, so the recorded numbers become measurements of v1.
 */
const rotateCycle = async (
  page: import('@playwright/test').Page,
  zoneId: 'active' | 'bench',
  single: boolean
): Promise<readonly RotationSample[]> =>
  page.evaluate(
    async ({ zoneId, single }) => {
      const load = (specifier: string): Promise<Record<string, never>> =>
        import(/* @vite-ignore */ specifier);
      const [cardModule, placementModule, zoneModule, rotateModule] =
        await Promise.all([
          load('/src/setup/deck-constructor/card.js'),
          load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
          load('/src/setup/zones/get-zone.js'),
          load('/src/actions/general/rotate-card.js'),
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
        ) => { readonly element: HTMLElement; readonly array: unknown[] };
      };
      const { rotateCard } = rotateModule as unknown as {
        readonly rotateCard: (
          user: string,
          zoneId: string,
          index: number,
          single?: boolean,
          emit?: boolean
        ) => void;
      };

      const zone = getZone('self', zoneId);
      zone.array.length = 0;
      zone.element.replaceChildren();

      const makeCard = (name: string) =>
        new Card(
          'self',
          name,
          'Pokémon',
          `${location.origin}/src/assets/cardback.png`
        );
      // Two evolution cards so a group rotation has a sibling to carry, which
      // is the branch the compound family depends on.
      const base = makeCard('base');
      const evolution = makeCard('evolution');
      await Promise.all([base.image.decode(), evolution.image.decode()]);

      // The same sequence move-card.js performs: the card enters the zone array
      // and then the DOM container is built for it.
      zone.array.push(base);
      initializeActiveBenchCard('self', base, zoneId, zone);
      zone.array.push(evolution);
      base.image.parentElement?.append(evolution.image);

      const waitFrames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      await waitFrames();

      const sample = (step: number): RotationSample => {
        const container = base.image.parentElement as HTMLElement;
        return {
          step,
          transform: base.image.style.transform,
          marginRight: container.style.marginRight,
          marginLeft: container.style.marginLeft,
          pokemonBreak: Boolean(
            (base.image as unknown as { PokémonBreak?: boolean })[
              'PokémonBreak'
            ]
          ),
          siblingTransforms: [...container.querySelectorAll('img')]
            .filter((image) => image !== base.image)
            .map((image) => image.style.transform),
        };
      };

      const samples: RotationSample[] = [sample(0)];
      for (let step = 1; step <= 4; step += 1) {
        rotateCard('self', zoneId, 0, single, false);
        await waitFrames();
        samples.push(sample(step));
      }
      return samples;
    },
    { zoneId, single }
  ) as Promise<readonly RotationSample[]>;

test('the real v1 runtime rotates an active group through a full turn cycle', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  let samples: readonly RotationSample[];
  try {
    await loadLegacyRuntime(page);
    samples = await rotateCycle(page, 'active', false);
  } finally {
    await page.close();
  }
  await testInfo.attach('active-group-rotation.json', {
    body: Buffer.from(JSON.stringify(samples, null, 2)),
    contentType: 'application/json',
  });

  expect(samples.map((sample) => sample.transform)).toEqual([
    // `Card` resets the inline transform on construction, so a fresh card
    // already carries an explicit zero rather than an empty string.
    'rotate(0deg)',
    'rotate(90deg)',
    'rotate(180deg)',
    'rotate(270deg)',
    'rotate(0deg)',
  ]);
  // A group rotation carries every sibling Pokemon by the same quarter turn.
  expect(samples.map((sample) => sample.siblingTransforms)).toEqual([
    ['rotate(0deg)'],
    ['rotate(90deg)'],
    ['rotate(180deg)'],
    ['rotate(270deg)'],
    ['rotate(0deg)'],
  ]);
  // Half turns restore the narrow container margin; quarter turns do not.
  expect(
    samples.map((sample) => `${sample.marginRight}|${sample.marginLeft}`)
  ).toEqual(['|', '|', '1%|0%', '1%|0%', '1%|0%']);
  // Group rotation never sets the BREAK flag.
  expect(samples.every((sample) => !sample.pokemonBreak)).toBe(true);
});

test('the real v1 runtime toggles the BREAK flag on single rotation', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  let samples: readonly RotationSample[];
  try {
    await loadLegacyRuntime(page);
    samples = await rotateCycle(page, 'active', true);
  } finally {
    await page.close();
  }
  await testInfo.attach('active-single-rotation.json', {
    body: Buffer.from(JSON.stringify(samples, null, 2)),
    contentType: 'application/json',
  });

  // A single rotation only holds a quarter turn; every other step collapses
  // back to zero, which is the asymmetry the compound histories encode.
  expect(samples.map((sample) => sample.transform)).toEqual([
    'rotate(0deg)',
    'rotate(90deg)',
    'rotate(0deg)',
    'rotate(90deg)',
    'rotate(0deg)',
  ]);
  expect(samples.map((sample) => sample.pokemonBreak)).toEqual([
    false,
    true,
    false,
    true,
    false,
  ]);
  // Siblings are never carried by a single rotation.
  expect(
    samples.every((sample) =>
      sample.siblingTransforms.every(
        (transform) => transform === 'rotate(0deg)'
      )
    )
  ).toBe(true);
});
