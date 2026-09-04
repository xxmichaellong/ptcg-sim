import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json' with { type: 'json' };
import groupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json' with { type: 'json' };
import oracle from '../legacy-fixtures/renderer/compound-nonzero-group-single-v1.json' with { type: 'json' };

import {
  captureLegacySourceCompoundNonzeroGroupSingleFixture,
  type CapturedPoint,
  type CapturedRect,
  type LegacyCompoundRotationCase,
  type LegacyFixtureSide,
} from './support/legacy-source-board.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const roles = ['top', 'middle', 'base'] as const;
const hitRegionNames = [
  'commonOverlap',
  'topOnly',
  'middleAndBaseOverlap',
  'baseOnly',
  'topPaintedOnly',
  'topAuthoredOnly',
] as const;

type Scenario = (typeof oracle.input.scenarioOrder)[number];
type Slot = 'active' | 'bench';
type RectTuple = readonly [number, number, number, number];
type PointTuple = readonly [number, number] | null;
type PhaseEvidenceTuple = readonly [
  name: string,
  stackRect: RectTuple,
  cardRects: readonly [RectTuple, RectTuple, RectTuple],
  hitPoints: readonly [
    PointTuple,
    PointTuple,
    PointTuple,
    PointTuple,
    PointTuple,
    PointTuple,
  ],
];

const evidenceByScenarioAndSlot = oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly PhaseEvidenceTuple[]
>;
const quarterTurnsByScenario = oracle.expected
  .quarterTurnsByScenario as unknown as Record<
  Scenario,
  readonly Record<(typeof roles)[number], number>[]
>;
const breakByScenario = oracle.expected.topBreakByScenario as unknown as Record<
  Scenario,
  readonly boolean[]
>;
const marginsByScenarioAndSlot = oracle.expected
  .inlineMarginsByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly (readonly [string, string])[]
>;
const operationTraceByScenario = oracle.expected
  .operationTraceByScenario as unknown as Record<Scenario, readonly string[]>;
const transitionTraceByScenario = oracle.expected
  .transitionTraceByScenario as unknown as Record<Scenario, string>;
const paintedAuthoredHitRolesByScenario = oracle.expected
  .paintedAuthoredHitRolesByScenario as unknown as Record<
  Scenario,
  readonly [
    readonly string[] | null,
    readonly string[] | null,
    readonly string[] | null,
    readonly string[] | null,
  ]
>;

const modularDegreesBetween = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

const rectFromTuple = ([x, y, width, height]: RectTuple): CapturedRect => ({
  x,
  y,
  width,
  height,
});

const pointFromTuple = (point: PointTuple): CapturedPoint | null =>
  point ? { x: point[0], y: point[1] } : null;

const expectRect = (
  actual: CapturedRect,
  expected: CapturedRect,
  label: string
): void => {
  for (const key of ['x', 'y'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  }
  for (const key of ['width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]) / expected[key],
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.cardSizeRelative);
  }
};

const expectPoint = (
  actual: CapturedPoint,
  expected: CapturedPoint,
  label: string
): void => {
  for (const key of ['x', 'y'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  }
};

const physicalRect = (
  side: LegacyFixtureSide,
  frame: CapturedRect,
  bounds: CapturedRect
): CapturedRect =>
  side === 'local'
    ? {
        x: frame.x + bounds.x,
        y: frame.y + bounds.y,
        width: bounds.width,
        height: bounds.height,
      }
    : {
        x: frame.x + frame.width - bounds.x - bounds.width,
        y: frame.y + frame.height - bounds.y - bounds.height,
        width: bounds.width,
        height: bounds.height,
      };

const physicalPoint = (
  side: LegacyFixtureSide,
  frame: CapturedRect,
  point: CapturedPoint
): CapturedPoint =>
  side === 'local'
    ? { x: frame.x + point.x, y: frame.y + point.y }
    : {
        x: frame.x + frame.width - point.x,
        y: frame.y + frame.height - point.y,
      };

const roleOrder = (ids: readonly string[] | null): readonly string[] | null =>
  ids?.map((id) => {
    const role = roles.find((candidate) => id.endsWith(`-${candidate}`));
    if (!role) throw new Error(`Unrecognized compound card id: ${id}`);
    return role;
  }) ?? null;

const normalizedTrace = (
  entry: LegacyCompoundRotationCase,
  trace: readonly string[]
): readonly string[] =>
  trace.map((call) => call.replaceAll(`${entry.id}-`, ''));

test('nonzero-group single-card oracle pins direct source and compound dependencies', async () => {
  for (const manifest of [oracle, groupOracle, breakOracle]) {
    expect(manifest.schemaVersion).toBe(1);
    const sourcePaths = manifest.provenance.map((entry) => entry.path);
    expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
    const claimedPaths = new Set(
      manifest.provenanceClaims.flatMap((claim) => claim.sources)
    );
    expect([...claimedPaths].sort()).toEqual([...sourcePaths].sort());
    for (const entry of manifest.provenance) {
      const source = await readFile(`${repositoryRoot}${entry.path}`);
      const hashInput =
        entry.encoding === 'utf8'
          ? source.toString('utf8').replaceAll('\r\n', '\n')
          : source;
      expect(
        createHash('sha256').update(hashInput).digest('hex'),
        entry.path
      ).toBe(entry.sha256);
    }
    for (const entry of manifest.dependencies) {
      const source = await readFile(`${repositoryRoot}${entry.path}`, 'utf8');
      expect(
        createHash('sha256')
          .update(source.replaceAll('\r\n', '\n'))
          .digest('hex'),
        entry.path
      ).toBe(entry.sha256);
    }
  }
  expect(oracle.expected.frames).toEqual(groupOracle.expected.frames);
  expect(oracle.expected.frameTransforms).toEqual(
    groupOracle.expected.frameTransforms
  );
});

test('checked-in legacy Alt-R pins the clean nonzero-group entry matrix', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source nonzero-group single-card checkpoint is Chromium-specific.'
  );
  await page.setViewportSize(oracle.input.viewport);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
    oracle.input.viewport.devicePixelRatio
  );
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) =>
    runtimeErrors.push(`pageerror: ${error.message}`)
  );
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (
      text === 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector'
    )
      return;
    runtimeErrors.push(`console.error: ${text}`);
  });

  const capture =
    await captureLegacySourceCompoundNonzeroGroupSingleFixture(page);
  await testInfo.attach('legacy-source-compound-nonzero-group-single.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });

  expect(capture.sourceFulfillment).toEqual({
    servedPaths: [
      '/',
      '/opp-containers.html',
      '/self-containers.html',
      '/src/assets/cardback.png',
      '/src/css/index.css',
      '/src/css/opp-containers.css',
      '/src/css/self-containers.css',
      '/src/front-end.js',
    ],
    blockedExternalOrigins: [
      'https://cdn.socket.io',
      'https://static.cloudflareinsights.com',
      'https://upload.wikimedia.org',
      'https://www.svgrepo.com',
    ],
    unexpectedSameOriginPaths: [],
  });
  expect(capture.ordinaryGroupCases).toEqual([]);
  expect(capture.breakGroupCases).toEqual([]);
  expect(capture.lowerGroupInitiatorCases).toEqual([]);
  expect(capture.lowerQ0SingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupSingleCases).toEqual([]);
  expect(capture.breakRefreshCases).toEqual([]);
  expect(capture.nonzeroGroupSingleCases.map((entry) => entry.id)).toEqual(
    oracle.input.cases
  );

  for (const side of ['local', 'opponent'] as const) {
    expectRect(
      capture.frames[side],
      oracle.expected.frames[side],
      `${side}.frame`
    );
    const expectedTransform = oracle.expected.frameTransforms[side];
    for (const key of ['a', 'b', 'c', 'd'] as const) {
      expect(capture.frameTransforms[side][key]).toBe(expectedTransform[key]);
    }
    expect(
      modularDegreesBetween(
        capture.frameTransforms[side].rotationDegrees,
        expectedTransform.rotationDegrees
      )
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
  }

  for (const entry of capture.nonzeroGroupSingleCases) {
    const scenario = entry.scenario as Scenario;
    const key = `${scenario}:${entry.slot}` as const;
    const evidence = evidenceByScenarioAndSlot[key];
    const expectedTurns = quarterTurnsByScenario[scenario];
    const expectedBreak = breakByScenario[scenario];
    const expectedMargins = marginsByScenarioAndSlot[key];
    expect(entry.phases.map((phase) => phase.name)).toEqual(
      oracle.input.phaseSequence
    );
    expect(entry.phases.map((phase) => phase.wrapperCount)).toEqual(
      oracle.expected.lifecycle.wrapperCountsByPhase
    );
    expect(entry.refresh).toBe(oracle.expected.lifecycle.refreshEvidence);
    expect(normalizedTrace(entry, entry.callTrace)).toEqual(
      operationTraceByScenario[scenario]
    );
    expect(normalizedTrace(entry, entry.transitionTrace)).toEqual([
      transitionTraceByScenario[scenario],
    ]);
    expect(entry.observers).toMatchObject({
      mutationObserversCreated: oracle.expected.lifecycle.observerPairsCreated,
      resizeObserversCreated: oracle.expected.lifecycle.observerPairsCreated,
      transcribedSourceDisconnectCalls:
        oracle.expected.lifecycle.transcribedSourceDisconnectCalls,
      harnessRetainedSourceShapedObserverHandlesBeforeCleanup: true,
      harnessMutationDisconnectCalls:
        oracle.expected.lifecycle.harnessDisconnectCallsPerObserverKind,
      harnessResizeDisconnectCalls:
        oracle.expected.lifecycle.harnessDisconnectCallsPerObserverKind,
    });
    expect(
      entry.observers.resizeCallbacksBeforeCardRemoval
    ).toBeGreaterThanOrEqual(
      oracle.expected.lifecycle.minimumResizeCallbacksBeforeCardRemoval
    );
    expect(
      entry.observers.resizeCallbacksAfterCardRemoval -
        entry.observers.resizeCallbacksBeforeCardRemoval
    ).toBe(oracle.expected.lifecycle.resizeCallbacksAddedAfterCardRemoval);
    expect(entry.cleanup).toEqual({
      observedWrapperCount: 0,
      observedCardCount: 0,
      sinkConnected: false,
    });

    for (const [phaseIndex, phase] of entry.phases.entries()) {
      const phaseEvidence = evidence[phaseIndex];
      const turns = expectedTurns[phaseIndex];
      const margins = expectedMargins[phaseIndex];
      if (!phaseEvidence || !turns || !margins) {
        throw new Error(`Missing ${entry.id}.${phase.name} oracle evidence`);
      }
      expect(phaseEvidence[0]).toBe(phase.name);
      expectRect(
        phase.stack.frameLocalBounds,
        rectFromTuple(phaseEvidence[1]),
        `${entry.id}.${phase.name}.stack`
      );
      expectRect(
        phase.stack.physicalBounds,
        physicalRect(
          entry.side,
          capture.frames[entry.side],
          phase.stack.frameLocalBounds
        ),
        `${entry.id}.${phase.name}.physicalStack`
      );
      expect([
        phase.stack.inlineMarginRight,
        phase.stack.inlineMarginLeft,
      ]).toEqual(margins);
      expect(
        phase.stack.childDomOrder.map((id) => roleOrder([id])?.[0])
      ).toEqual(oracle.expected.topology.domRoles);
      expect(
        phase.stack.logicalOrder.map((id) => roleOrder([id])?.[0])
      ).toEqual(oracle.expected.topology.logicalRoles);
      expect(phase.stack.transform).toBe(
        oracle.expected.topology.wrapperTransform
      );
      expect(phase.stack.zIndex).toBe(oracle.expected.topology.wrapperZIndex);
      expect(roleOrder(phase.stack.hitOrder.commonOverlap)).toEqual(
        oracle.expected.topology.logicalRoles
      );
      expect(roleOrder(phase.stack.hitOrder.topOnly)).toEqual(['top']);
      expect(roleOrder(phase.stack.hitOrder.middleAndBaseOverlap)).toEqual([
        'middle',
        'base',
      ]);
      expect(roleOrder(phase.stack.hitOrder.baseOnly)).toEqual(['base']);
      const specialHitRoles = paintedAuthoredHitRolesByScenario[scenario];
      expect(roleOrder(phase.stack.hitOrder.topPaintedOnly)).toEqual(
        specialHitRoles[phaseIndex * 2]
      );
      expect(roleOrder(phase.stack.hitOrder.topAuthoredOnly)).toEqual(
        specialHitRoles[phaseIndex * 2 + 1]
      );

      for (const [hitIndex, hitName] of hitRegionNames.entries()) {
        const expectedPoint = pointFromTuple(phaseEvidence[3][hitIndex]);
        const actualPoint = phase.stack.hitPointsFrameLocal[hitName];
        if (expectedPoint === null) {
          expect(
            actualPoint,
            `${entry.id}.${phase.name}.${hitName}`
          ).toBeNull();
          expect(
            phase.stack.hitPointsPhysical[hitName],
            `${entry.id}.${phase.name}.physical.${hitName}`
          ).toBeNull();
        } else {
          if (!actualPoint) {
            throw new Error(`Missing ${entry.id}.${phase.name}.${hitName}`);
          }
          expectPoint(
            actualPoint,
            expectedPoint,
            `${entry.id}.${phase.name}.${hitName}`
          );
          const actualPhysical = phase.stack.hitPointsPhysical[hitName];
          if (!actualPhysical) {
            throw new Error(
              `Missing ${entry.id}.${phase.name}.physical.${hitName}`
            );
          }
          expectPoint(
            actualPhysical,
            physicalPoint(entry.side, capture.frames[entry.side], actualPoint),
            `${entry.id}.${phase.name}.physical.${hitName}`
          );
        }
      }

      for (const [roleIndex, role] of roles.entries()) {
        const card = phase.cards.find((candidate) => candidate.role === role);
        if (!card) throw new Error(`Missing ${entry.id}.${phase.name}.${role}`);
        expectRect(
          card.frameLocalBounds,
          rectFromTuple(phaseEvidence[2][roleIndex] as RectTuple),
          `${entry.id}.${phase.name}.${role}`
        );
        expectRect(
          card.physicalBounds,
          physicalRect(
            entry.side,
            capture.frames[entry.side],
            card.frameLocalBounds
          ),
          `${entry.id}.${phase.name}.${role}.physical`
        );
        expect(card.localRotationDegrees / 90).toBe(turns[role]);
        expect(
          modularDegreesBetween(
            card.effectiveRotationDegrees,
            card.localRotationDegrees +
              capture.frameTransforms[entry.side].rotationDegrees
          )
        ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
        expect(card.pokemonBreak).toBe(
          role === 'top' ? expectedBreak[phaseIndex] : false
        );
        expect(card.naturalWidth).toBe(oracle.input.asset.naturalWidth);
        expect(card.naturalHeight).toBe(oracle.input.asset.naturalHeight);
        expect(card.sourcePath).toBe(oracle.input.asset.path);
        expect(card.imageType).toBe('Pokémon');
        expect(card.layer).toBe(
          role === 'top' ? oracle.expected.topology.topLayer : 0
        );
        expect(card.energyLayer).toBe(oracle.expected.topology.energyLayer);
        expect(card.zIndex).toBe(oracle.expected.topology.zByRole[role]);
        const lowerStep =
          entry.slot === 'active'
            ? groupOracle.expected.slotMetrics.active.middleBottomPx
            : groupOracle.expected.slotMetrics.bench.middleBottomPx;
        expect(card.inlineBottomPx).toBeCloseTo(
          lowerStep * oracle.expected.topology.bottomLayerMultipliers[role],
          4
        );
      }

      if (phaseIndex === 0) {
        expect(phase.action).toBeNull();
      } else {
        expect(phase.action).toEqual({
          selectedCardId: `${entry.id}-top`,
          selectedRole: 'top',
          indexBefore: 0,
          single: true,
        });
      }
    }
  }

  expect(runtimeErrors).toEqual([]);
});
