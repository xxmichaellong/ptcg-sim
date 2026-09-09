import { expect, test, type Browser, type Page } from '@playwright/test';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json' with { type: 'json' };
import groupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json' with { type: 'json' };
import { loadLegacyRuntime } from './support/legacy-runtime.js';

type Slot = 'active' | 'bench';
type Role = 'base' | 'middle' | 'top';

interface PhaseSample {
  readonly phase: string;
  readonly quarterTurns: Readonly<Record<Role, number>>;
  readonly inlineMargins: readonly string[];
  readonly topBreakFlag: boolean;
}

interface CapturedPhaseSample {
  readonly phase: string;
  readonly transforms: Readonly<Record<Role, string>>;
  readonly inlineMargins: readonly [string, string];
  readonly topBreakFlag: boolean;
}

/** One rotation applied to the top card, single or carrying the group. */
type RotationOperation = 'single' | 'group';

interface CompoundHistory {
  readonly name: string;
  /** Phases in capture order; the initial sample precedes every operation. */
  readonly phases: readonly string[];
  readonly operations: readonly RotationOperation[];
  readonly expected: {
    readonly localQuarterTurns: Readonly<
      Record<string, Readonly<Record<Role, number>>>
    >;
    // JSON widens the recorded pairs to string arrays; compared by value.
    readonly inlineMargins: Readonly<
      Record<Slot, Readonly<Record<string, readonly string[]>>>
    >;
    readonly topBreakFlag?: Readonly<Record<string, boolean>>;
  };
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
const HISTORIES: readonly CompoundHistory[] = [
  {
    name: 'group rotation',
    phases: ['pristine-q0', 'q1', 'q2', 'q3', 'q0-return'],
    operations: ['group', 'group', 'group', 'group'],
    expected: groupOracle.expected as CompoundHistory['expected'],
  },
  {
    // A single rotation sets BREAK and turns only the top card; the group
    // rotations then carry the whole stack, so the top stays a quarter ahead
    // until a second single rotation collapses it and clears the flag. The
    // fixture's `-refreshed` phase is a reconstruct rather than a rotation and
    // is therefore not part of this operation sequence.
    name: 'BREAK rotation',
    phases: [
      'pristine-q0',
      'break-on-q0',
      'break-group-q1',
      'break-group-q2',
      'break-group-q3',
      'break-group-q0-return',
      'break-off-q0',
    ],
    operations: ['single', 'group', 'group', 'group', 'group', 'single'],
    expected: breakOracle.expected as CompoundHistory['expected'],
  },
];

const quarterTurnsFromTransform = (transform: string): number => {
  const degrees = Number.parseInt(transform.replace(/[^0-9-]/gu, ''), 10) || 0;
  return (((degrees / 90) % 4) + 4) % 4;
};

const captureRotationHistory = async (
  page: Page,
  slot: Slot,
  history: CompoundHistory
): Promise<readonly CapturedPhaseSample[]> =>
  page.evaluate(
    async ({ zoneId, operations, phases }) => {
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
        topBreakFlag: Boolean(
          (roles.top.image as unknown as { PokémonBreak?: boolean })[
            'PokémonBreak'
          ]
        ),
      });

      const samples = [sample(phases[0]!)];
      for (const [index, operation] of operations.entries()) {
        // Every history rotates the top-selected card; only the single/group
        // choice varies between them.
        rotateCard(
          'self',
          zoneId,
          zone.array.indexOf(top),
          operation === 'single',
          false
        );
        await frames();
        samples.push(sample(phases[index + 1]!));
      }
      return samples;
    },
    { zoneId: slot, operations: history.operations, phases: history.phases }
  );

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

for (const history of HISTORIES) {
  for (const slot of ['active', 'bench'] as const) {
    test(`the recorded compound ${history.name} oracle matches the real v1 runtime in the ${slot} slot`, async ({
      browser,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== 'chromium',
        'Source-characterization gates are Chromium-specific.'
      );
      const raw = await withRuntime(browser, (page) =>
        captureRotationHistory(page, slot, history)
      );
      const samples: readonly PhaseSample[] = raw.map((entry) => ({
        phase: entry.phase,
        quarterTurns: {
          base: quarterTurnsFromTransform(entry.transforms.base),
          middle: quarterTurnsFromTransform(entry.transforms.middle),
          top: quarterTurnsFromTransform(entry.transforms.top),
        },
        inlineMargins: entry.inlineMargins,
        topBreakFlag: entry.topBreakFlag,
      }));
      await testInfo.attach(`compound-${history.name}-${slot}.json`, {
        body: Buffer.from(JSON.stringify(samples, null, 2)),
        contentType: 'application/json',
      });

      const recordedTurns = history.expected.localQuarterTurns;
      const recordedMargins = history.expected.inlineMargins[slot];
      const recordedBreak = history.expected.topBreakFlag;

      expect(samples).toHaveLength(history.phases.length);
      for (const [index, phase] of history.phases.entries()) {
        const sample = samples[index];
        expect(sample?.phase, `phase ${phase} was captured`).toBe(phase);

        // A group rotation carries every Pokemon in the stack; a single
        // rotation moves only the selected card. The fixture records one value
        // per role for exactly that distinction.
        expect(sample?.quarterTurns, `${slot} ${phase} quarter turns`).toEqual(
          recordedTurns[phase]
        );
        expect(
          sample?.inlineMargins,
          `${slot} ${phase} inline margins`
        ).toEqual(recordedMargins[phase]);
        if (recordedBreak) {
          expect(sample?.topBreakFlag, `${slot} ${phase} BREAK flag`).toBe(
            recordedBreak[phase]
          );
        }
      }
    });
  }
}
