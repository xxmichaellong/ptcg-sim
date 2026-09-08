import { expect, test, type Browser, type Page } from '@playwright/test';

import groupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json' with { type: 'json' };
import { loadLegacyRuntime } from './support/legacy-runtime.js';

type Slot = 'active' | 'bench';
type Role = 'base' | 'middle' | 'top';

interface PhaseSample {
  readonly phase: string;
  readonly quarterTurns: Readonly<Record<Role, number>>;
  readonly inlineMargins: readonly [string, string];
}

interface CapturedPhaseSample {
  readonly phase: string;
  readonly transforms: Readonly<Record<Role, string>>;
  readonly inlineMargins: readonly [string, string];
}

/**
 * The compound-rotation family is the largest block of characterized fixtures
 * in the repository, and every gate over it compares a TypeScript
 * re-implementation against JSON recorded from that same re-implementation. The
 * recorded numbers are therefore unfalsifiable by their own tests.
 *
 * This drives the real client through the history
 * `compound-group-rotation-v1.json` describes — a three-Pokemon evolution stack
 * taken through a full group-rotation cycle in both the active and sole-bench
 * slots — and holds the recorded fixture to what v1 actually does.
 *
 * It asserts against the checked-in oracle rather than against fresh
 * expectations, so a pass is evidence about the fixture the other 22 compound
 * specs depend on, not merely about this gate.
 */
const ROTATION_PHASES = ['pristine-q0', 'q1', 'q2', 'q3', 'q0-return'] as const;

const quarterTurnsFromTransform = (transform: string): number => {
  const degrees = Number.parseInt(transform.replace(/[^0-9-]/gu, ''), 10) || 0;
  return (((degrees / 90) % 4) + 4) % 4;
};

const captureGroupRotation = async (
  page: Page,
  slot: Slot
): Promise<readonly CapturedPhaseSample[]> =>
  page.evaluate(async (zoneId) => {
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

    const make = (name: string) =>
      new Card(
        'self',
        name,
        'Pokémon',
        `${location.origin}/src/assets/cardback.png`
      );
    // The fixture's evolution order: base placed, then middle and top stacked
    // onto it inside the same play container.
    const base = make('base');
    const middle = make('middle');
    const top = make('top');
    await Promise.all([
      base.image.decode(),
      middle.image.decode(),
      top.image.decode(),
    ]);
    zone.array.push(base);
    initializeActiveBenchCard('self', base, zoneId, zone);
    const container = base.image.parentElement as HTMLElement;
    for (const card of [middle, top]) {
      zone.array.push(card);
      container.append(card.image);
    }

    const frames = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
    await frames();

    const roles = { base, middle, top } as const;
    const sample = (phase: string): CapturedPhaseSample => ({
      phase,
      transforms: {
        base: roles.base.image.style.transform,
        middle: roles.middle.image.style.transform,
        top: roles.top.image.style.transform,
      },
      inlineMargins: [
        container.style.marginRight,
        container.style.marginLeft,
      ] as const,
    });

    const samples = [sample('pristine-q0')];
    for (const phase of ['q1', 'q2', 'q3', 'q0-return']) {
      // The fixture rotates the top-selected card as a group.
      rotateCard('self', zoneId, zone.array.indexOf(top), false, false);
      await frames();
      samples.push(sample(phase));
    }
    return samples;
  }, slot);

const withRuntime = async <Value>(
  browser: Browser,
  run: (page: Page) => Promise<Value>
): Promise<Value> => {
  const page = await browser.newPage({
    viewport: {
      width: groupOracle.input.viewport.width,
      height: groupOracle.input.viewport.height,
    },
    deviceScaleFactor: groupOracle.input.viewport.devicePixelRatio,
  });
  try {
    await loadLegacyRuntime(page);
    return await run(page);
  } finally {
    await page.close();
  }
};

for (const slot of ['active', 'bench'] as const) {
  test(`the recorded compound group oracle matches the real v1 runtime in the ${slot} slot`, async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );
    const raw = await withRuntime(browser, (page) =>
      captureGroupRotation(page, slot)
    );
    const samples: readonly PhaseSample[] = raw.map((entry) => ({
      phase: entry.phase,
      quarterTurns: {
        base: quarterTurnsFromTransform(entry.transforms.base),
        middle: quarterTurnsFromTransform(entry.transforms.middle),
        top: quarterTurnsFromTransform(entry.transforms.top),
      },
      inlineMargins: entry.inlineMargins,
    }));
    await testInfo.attach(`compound-group-${slot}.json`, {
      body: Buffer.from(JSON.stringify(samples, null, 2)),
      contentType: 'application/json',
    });

    const recordedTurns = groupOracle.expected.localQuarterTurns as Readonly<
      Record<string, Readonly<Record<Role, number>>>
    >;
    const recordedMargins = (
      groupOracle.expected.inlineMargins as unknown as Readonly<
        Record<Slot, Readonly<Record<string, readonly [string, string]>>>
      >
    )[slot];

    for (const [index, phase] of ROTATION_PHASES.entries()) {
      const sample = samples[index];
      expect(sample?.phase, `phase ${phase} was captured`).toBe(phase);

      // A group rotation must carry every Pokemon in the stack by the same
      // quarter turn; the fixture records one value per role for exactly that.
      expect(sample?.quarterTurns, `${slot} ${phase} quarter turns`).toEqual(
        recordedTurns[phase]
      );
      expect(sample?.inlineMargins, `${slot} ${phase} inline margins`).toEqual(
        recordedMargins[phase]
      );
    }
  });
}
