import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, type Page, type TestInfo } from '@playwright/test';

import breakOracle from '../../legacy-fixtures/renderer/compound-break-rotation-v1.json' with { type: 'json' };
import groupOracle from '../../legacy-fixtures/renderer/compound-group-rotation-v1.json' with { type: 'json' };
import lowerGroupOracle from '../../legacy-fixtures/renderer/compound-lower-group-rotation-v1.json' with { type: 'json' };
import lowerQ0Oracle from '../../legacy-fixtures/renderer/compound-lower-q0-single-v1.json' with { type: 'json' };
import oracle from '../../legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json' with { type: 'json' };
import nonzeroOracle from '../../legacy-fixtures/renderer/compound-nonzero-group-single-v1.json' with { type: 'json' };

import type {
  CapturedPoint,
  CapturedRect,
  LegacyCompoundRotationCase,
  LegacyFixtureSide,
  LegacySourceCompoundRotationFixture,
} from './legacy-source-board.js';

export type LowerNonzeroComposition = 'ordinary' | 'break';

type Role = (typeof roles)[number];
type Scenario = keyof typeof oracle.expected.scenario;
type Slot = 'active' | 'bench';
type RectTuple = readonly [number, number, number, number];
type PointTuple = readonly [number, number] | null;
type PhaseEvidenceTuple = readonly [
  name: string,
  stackRect: RectTuple,
  paintedCardRects: readonly [RectTuple, RectTuple, RectTuple],
  authoredCardRects: readonly [RectTuple, RectTuple, RectTuple],
  hitPoints: readonly PointTuple[],
];
type Capture = (page: Page) => Promise<LegacySourceCompoundRotationFixture>;

interface ProvenanceManifest {
  readonly schemaVersion: number;
  readonly provenance: readonly {
    readonly path: string;
    readonly encoding: string;
    readonly sha256: string;
  }[];
  readonly provenanceClaims: readonly {
    readonly claim: string;
    readonly sources: readonly string[];
  }[];
  readonly dependencies: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const roles = ['top', 'middle', 'base'] as const;
const hitRegionNames = [
  'commonOverlap',
  'topOnly',
  'middleAndBaseOverlap',
  'baseOnly',
  'topPaintedOnly',
  'topAuthoredOnly',
  'middlePaintedOnly',
  'middleAuthoredOnly',
  'basePaintedOnly',
  'baseAuthoredOnly',
] as const;

const scenarioMetadata = oracle.expected.scenario as unknown as Record<
  Scenario,
  {
    readonly composition: LowerNonzeroComposition;
    readonly selectedRole: 'middle' | 'base';
    readonly selectedIndex: 1 | 2;
    readonly selectedDomOrdinal: 1 | 2;
    readonly groupTurns: 1 | 2 | 3;
    readonly selectionHitRegion: 'middleAndBaseOverlap' | 'baseOnly';
  }
>;
const phaseEvidence = oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly PhaseEvidenceTuple[]
>;
const quarterTurns = oracle.expected
  .quarterTurnsByScenario as unknown as Record<
  Scenario,
  readonly Record<Role, number>[]
>;
const breakFlags = oracle.expected.breakFlagsByScenario as unknown as Record<
  Scenario,
  readonly Record<Role, boolean>[]
>;
const margins = oracle.expected
  .inlineMarginsByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly (readonly [string, string])[]
>;
const operationTraces = oracle.expected
  .operationTraceByScenario as unknown as Record<Scenario, readonly string[]>;
const transitionTraces = oracle.expected
  .transitionTraceByScenario as unknown as Record<Scenario, string>;

const rectFromTuple = ([x, y, width, height]: RectTuple): CapturedRect => ({
  x,
  y,
  width,
  height,
});

const pointFromTuple = (point: PointTuple): CapturedPoint | null =>
  point ? { x: point[0], y: point[1] } : null;

const modularDegreesBetween = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

const expectStructured = (
  actual: number,
  expected: number,
  label: string
): void => {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected}, received ${actual}`
  ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
};

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

const roleOrder = (ids: readonly string[] | null): readonly Role[] | null =>
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

const pointInside = (point: CapturedPoint, bounds: CapturedRect): boolean =>
  point.x >= bounds.x &&
  point.x <= bounds.x + bounds.width &&
  point.y >= bounds.y &&
  point.y <= bounds.y + bounds.height;

const expectedHitRoles = (
  point: CapturedPoint,
  cardRects: readonly [RectTuple, RectTuple, RectTuple]
): readonly Role[] =>
  roles.filter((_, index) => {
    const tuple = cardRects[index];
    if (!tuple) throw new Error(`Missing expected card rectangle ${index}`);
    return pointInside(point, rectFromTuple(tuple));
  });

const paintedFromAuthored = (
  authored: CapturedRect,
  quarterTurn: number
): CapturedRect =>
  quarterTurn % 2 === 0
    ? authored
    : {
        x: authored.x + (authored.width - authored.height) / 2,
        y: authored.y + (authored.height - authored.width) / 2,
        width: authored.height,
        height: authored.width,
      };

const manifests = [
  oracle,
  nonzeroOracle,
  lowerQ0Oracle,
  groupOracle,
  breakOracle,
  lowerGroupOracle,
] as unknown as readonly ProvenanceManifest[];

const expectedFulfillment = {
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
} as const;

export const assertLowerNonzeroOracleIntegrity = async (
  composition: LowerNonzeroComposition
): Promise<void> => {
  for (const manifest of manifests) {
    expect(manifest.schemaVersion).toBe(1);
    const sourcePaths = manifest.provenance.map((entry) => entry.path);
    expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
    const claimedPaths = new Set(
      manifest.provenanceClaims.flatMap((claim) => claim.sources)
    );
    expect([...claimedPaths].sort()).toEqual([...sourcePaths].sort());
    for (const claim of manifest.provenanceClaims) {
      expect(claim.sources.length, claim.claim).toBeGreaterThan(0);
      expect(new Set(claim.sources).size, claim.claim).toBe(
        claim.sources.length
      );
    }
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

  expect(oracle.dependencies.map((entry) => entry.path)).toEqual([
    'tests/legacy-fixtures/renderer/compound-nonzero-group-single-v1.json',
    'tests/legacy-fixtures/renderer/compound-lower-q0-single-v1.json',
  ]);
  expect(oracle.expected.frames).toEqual(nonzeroOracle.expected.frames);
  expect(oracle.expected.frames).toEqual(lowerQ0Oracle.expected.frames);
  expect(oracle.expected.frameTransforms).toEqual(
    nonzeroOracle.expected.frameTransforms
  );
  expect(oracle.expected.frameTransforms).toEqual(
    lowerQ0Oracle.expected.frameTransforms
  );

  const ordinaryCases = oracle.input.casesByComposition.ordinary;
  const breakCases = oracle.input.casesByComposition.break;
  const allCases = [...ordinaryCases, ...breakCases];
  expect(ordinaryCases).toHaveLength(24);
  expect(breakCases).toHaveLength(24);
  expect(new Set(ordinaryCases).size).toBe(ordinaryCases.length);
  expect(new Set(breakCases).size).toBe(breakCases.length);
  expect(ordinaryCases.filter((id) => breakCases.includes(id))).toEqual([]);
  expect(allCases).toEqual(oracle.input.cases);
  expect(new Set(allCases).size).toBe(48);

  const scenarios = oracle.input.scenarioOrderByComposition[
    composition
  ] as readonly Scenario[];
  expect(scenarios).toHaveLength(6);
  expect(new Set(scenarios).size).toBe(scenarios.length);
  expect(oracle.input.casesByComposition[composition]).toHaveLength(24);
  for (const scenario of scenarios) {
    expect(scenarioMetadata[scenario].composition).toBe(composition);
    for (const slot of ['active', 'bench'] as const) {
      expect(
        phaseEvidence[`${scenario}:${slot}`].map((phase) => phase[0])
      ).toEqual(oracle.input.phaseSequence);
    }
  }
  expect(oracle.expected.hitRegionOrder).toEqual(hitRegionNames);
  expect(oracle.expected.phaseEvidenceTupleSchema).toEqual([
    'phase name',
    'stack frame-local rect [x,y,width,height]',
    'painted card rects [top,middle,base], each [x,y,width,height]',
    'authored/untransformed card rects [top,middle,base], each [x,y,width,height]',
    'hit points in expected.hitRegionOrder, each [x,y] or null',
  ]);
};

export const assertLowerNonzeroLiveCapture = async (
  page: Page,
  testInfo: TestInfo,
  composition: LowerNonzeroComposition,
  captureFixture: Capture
): Promise<void> => {
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
    ) {
      return;
    }
    runtimeErrors.push(`console.error: ${text}`);
  });

  const capture = await captureFixture(page);
  await testInfo.attach(
    `legacy-source-compound-lower-nonzero-${composition}.json`,
    {
      body: Buffer.from(JSON.stringify(capture, null, 2)),
      contentType: 'application/json',
    }
  );

  expect(capture.sourceFulfillment).toEqual(expectedFulfillment);
  expect(capture.ordinaryGroupCases).toEqual([]);
  expect(capture.breakGroupCases).toEqual([]);
  expect(capture.lowerGroupInitiatorCases).toEqual([]);
  expect(capture.lowerQ0SingleCases).toEqual([]);
  expect(capture.lowerReturnedQ0SingleCases).toEqual([]);
  expect(capture.lowerHistoryAuthoredQ0SingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupSingleFollowupCases).toEqual([]);
  expect(capture.lowerNonzeroGroupRotationAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupRefreshAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroSameLowerGroupAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroDifferentLowerGroupAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroSameLowerSecondGroupAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroDifferentLowerSecondGroupAfterSingleCases).toEqual(
    []
  );
  expect(capture.lowerNonzeroTopSecondGroupAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroTopThenPriorLowerGroupAfterSingleCases).toEqual(
    []
  );
  expect(capture.lowerNonzeroTopThenOtherLowerGroupAfterSingleCases).toEqual(
    []
  );
  expect(capture.lowerNonzeroTopThirdGroupAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroTopFourthGroupAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroSameLowerThirdGroupAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroDifferentLowerThirdGroupAfterSingleCases).toEqual(
    []
  );
  expect(capture.nonzeroGroupSingleCases).toEqual([]);
  expect(capture.breakRefreshCases).toEqual([]);
  expect(capture.lowerNonzeroGroupSingleCases.map((entry) => entry.id)).toEqual(
    oracle.input.casesByComposition[composition]
  );

  for (const side of ['local', 'opponent'] as const) {
    expectRect(
      capture.frames[side],
      oracle.expected.frames[side],
      `${side}.frame`
    );
    const expectedTransform = oracle.expected.frameTransforms[side];
    for (const key of ['a', 'b', 'c', 'd'] as const) {
      expectStructured(
        capture.frameTransforms[side][key],
        expectedTransform[key],
        `${side}.frameTransform.${key}`
      );
    }
    expect(
      modularDegreesBetween(
        capture.frameTransforms[side].rotationDegrees,
        expectedTransform.rotationDegrees
      )
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
  }

  for (const entry of capture.lowerNonzeroGroupSingleCases) {
    const scenario = entry.scenario as Scenario;
    const metadata = scenarioMetadata[scenario];
    expect(metadata.composition).toBe(composition);
    const evidence = phaseEvidence[`${scenario}:${entry.slot}`];
    const expectedMargins = margins[`${scenario}:${entry.slot}`];
    if (!evidence || !expectedMargins) {
      throw new Error(`Missing ${entry.id} oracle evidence`);
    }

    expect(entry.phases.map((phase) => phase.name)).toEqual(
      oracle.input.phaseSequence
    );
    expect(normalizedTrace(entry, entry.callTrace)).toEqual(
      operationTraces[scenario]
    );
    expect(normalizedTrace(entry, entry.transitionTrace)).toEqual([
      transitionTraces[scenario],
    ]);
    expect(entry.refresh).toBe(oracle.expected.lifecycle.refreshEvidence);
    expect(entry.phases.map((phase) => phase.wrapperCount)).toEqual(
      oracle.expected.lifecycle.wrapperCountsByPhase
    );
    expect(new Set(entry.phases.map((phase) => phase.stack.id)).size).toBe(1);
    for (const role of roles) {
      expect(
        new Set(
          entry.phases.map(
            (phase) =>
              phase.cards.find((candidate) => candidate.role === role)?.id
          )
        ).size,
        `${entry.id}.${role}.stable-id`
      ).toBe(1);
    }
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

    const prePhase = entry.phases[0];
    if (!prePhase) throw new Error(`Missing ${entry.id}.pre-single`);
    expect(
      roleOrder(prePhase.stack.hitOrder[metadata.selectionHitRegion])
    ).toContain(metadata.selectedRole);
    const selectedPreCard = prePhase.cards.find(
      (card) => card.role === metadata.selectedRole
    );
    expect(selectedPreCard).toMatchObject({
      domOrdinal: metadata.selectedDomOrdinal,
      logicalOrdinal: metadata.selectedIndex,
    });

    for (const [phaseIndex, phase] of entry.phases.entries()) {
      const expectedPhase = evidence[phaseIndex];
      const expectedTurns = quarterTurns[scenario][phaseIndex];
      const expectedBreaks = breakFlags[scenario][phaseIndex];
      const expectedMargin = expectedMargins[phaseIndex];
      if (
        !expectedPhase ||
        !expectedTurns ||
        !expectedBreaks ||
        !expectedMargin
      ) {
        throw new Error(`Missing ${entry.id}.${phase.name} phase evidence`);
      }
      expect(phase.name).toBe(expectedPhase[0]);
      const expectedStack = rectFromTuple(expectedPhase[1]);
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expectStructured(
          phase.stack.frameLocalBounds[key],
          expectedStack[key],
          `${entry.id}.${phase.name}.stack.${key}`
        );
      }
      expectRect(
        phase.stack.physicalBounds,
        physicalRect(
          entry.side,
          oracle.expected.frames[entry.side],
          expectedStack
        ),
        `${entry.id}.${phase.name}.stack.physical`
      );
      expect([
        phase.stack.inlineMarginRight,
        phase.stack.inlineMarginLeft,
      ]).toEqual(expectedMargin);
      const slotMetrics = groupOracle.expected.slotMetrics[entry.slot];
      expect(phase.stack).toMatchObject({
        clientWidth: slotMetrics.clientWidth,
        clientHeight: slotMetrics.clientHeight,
        offsetWidth: slotMetrics.clientWidth,
        offsetHeight: slotMetrics.clientHeight,
        authoredWidthPx: slotMetrics.clientWidth,
        transform: oracle.expected.topology.wrapperTransform,
        zIndex: oracle.expected.topology.wrapperZIndex,
      });
      expect(roleOrder(phase.stack.logicalOrder)).toEqual(
        oracle.expected.topology.logicalRoles
      );
      expect(roleOrder(phase.stack.childDomOrder)).toEqual(
        oracle.expected.topology.domRoles
      );

      if (phaseIndex === 0) {
        expect(phase.action).toBeNull();
      } else {
        expect(phase.action).toEqual({
          selectedCardId: `${entry.id}-${metadata.selectedRole}`,
          selectedRole: metadata.selectedRole,
          indexBefore: metadata.selectedIndex,
          single: true,
        });
      }

      for (const [cardIndex, role] of roles.entries()) {
        const card = phase.cards.find((candidate) => candidate.role === role);
        const paintedTuple = expectedPhase[2][cardIndex];
        const authoredTuple = expectedPhase[3][cardIndex];
        if (!card || !paintedTuple || !authoredTuple) {
          throw new Error(`Missing ${entry.id}.${phase.name}.${role}`);
        }
        const expectedPainted = rectFromTuple(paintedTuple);
        const expectedAuthored = rectFromTuple(authoredTuple);
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expectStructured(
            card.frameLocalBounds[key],
            expectedPainted[key],
            `${entry.id}.${phase.name}.${role}.painted.${key}`
          );
          expectStructured(
            card.untransformedFrameLocalBounds[key],
            expectedAuthored[key],
            `${entry.id}.${phase.name}.${role}.authored.${key}`
          );
          expectStructured(
            expectedPainted[key],
            paintedFromAuthored(expectedAuthored, expectedTurns[role])[key],
            `${entry.id}.${phase.name}.${role}.painted-from-authored.${key}`
          );
        }
        expectRect(
          card.physicalBounds,
          physicalRect(
            entry.side,
            oracle.expected.frames[entry.side],
            expectedPainted
          ),
          `${entry.id}.${phase.name}.${role}.physical`
        );
        expect(card.localRotationDegrees / 90).toBe(expectedTurns[role]);
        expect(card.inlineTransform).toBe(
          `rotate(${expectedTurns[role] * 90}deg)`
        );
        const transformOrigin = card.transformOrigin
          .split(' ')
          .map((value) => Number.parseFloat(value));
        expect(transformOrigin).toHaveLength(2);
        for (const [
          index,
          expected,
        ] of slotMetrics.transformOriginPx.entries()) {
          expectStructured(
            transformOrigin[index] ?? Number.NaN,
            expected,
            `${entry.id}.${phase.name}.${role}.transformOrigin.${index}`
          );
        }
        expect(card.pokemonBreak).toBe(expectedBreaks[role]);
        expect(
          modularDegreesBetween(
            card.effectiveRotationDegrees,
            (expectedTurns[role] * 90 +
              oracle.expected.frameTransforms[entry.side].rotationDegrees) %
              360
          )
        ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
        expect(card).toMatchObject({
          naturalWidth: oracle.input.asset.naturalWidth,
          naturalHeight: oracle.input.asset.naturalHeight,
          clientWidth: slotMetrics.clientWidth,
          clientHeight: slotMetrics.clientHeight,
          sourcePath: oracle.input.asset.path,
          imageType: 'Pokémon',
          energyLayer: oracle.expected.topology.energyLayer,
          zIndex: oracle.expected.topology.zByRole[role],
          layer: role === 'top' ? oracle.expected.topology.topLayer : 0,
          domOrdinal: oracle.expected.topology.domRoles.indexOf(role),
          logicalOrdinal: oracle.expected.topology.logicalRoles.indexOf(role),
          inlineLeftPx: 0,
        });
        expectStructured(
          card.inlineBottomPx,
          slotMetrics.middleBottomPx *
            oracle.expected.topology.bottomLayerMultipliers[role],
          `${entry.id}.${phase.name}.${role}.bottom`
        );
        const expectedRoleState = {
          top: {
            position: 'relative',
            attached: false,
            target: 'off',
            relativeId: null,
          },
          middle: {
            position: 'absolute',
            attached: true,
            target: 'on',
            relativeId: `${entry.id}-top`,
          },
          base: {
            position: 'absolute',
            attached: true,
            target: 'on',
            relativeId: `${entry.id}-top`,
          },
        }[role];
        expect(card).toMatchObject(expectedRoleState);
      }

      for (const [hitIndex, hitName] of hitRegionNames.entries()) {
        const expectedPoint = pointFromTuple(
          expectedPhase[4][hitIndex] ?? null
        );
        const actualPoint = phase.stack.hitPointsFrameLocal[hitName];
        if (expectedPoint === null) {
          expect(
            actualPoint,
            `${entry.id}.${phase.name}.${hitName}`
          ).toBeNull();
          expect(phase.stack.hitPointsPhysical[hitName]).toBeNull();
          expect(phase.stack.hitOrder[hitName]).toBeNull();
          continue;
        }
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
            `Missing ${entry.id}.${phase.name}.${hitName}.physical`
          );
        }
        expectPoint(
          actualPhysical,
          physicalPoint(
            entry.side,
            oracle.expected.frames[entry.side],
            expectedPoint
          ),
          `${entry.id}.${phase.name}.${hitName}.physical`
        );
        expect(roleOrder(phase.stack.hitOrder[hitName])).toEqual(
          expectedHitRoles(expectedPoint, expectedPhase[2])
        );
      }

      const selectedPaintedName = `${metadata.selectedRole}PaintedOnly` as
        'middlePaintedOnly' | 'basePaintedOnly';
      const selectedAuthoredName = `${metadata.selectedRole}AuthoredOnly` as
        'middleAuthoredOnly' | 'baseAuthoredOnly';
      const selectedCard = phase.cards.find(
        (card) => card.role === metadata.selectedRole
      );
      if (!selectedCard) {
        throw new Error(`Missing ${entry.id}.${phase.name}.selected-card`);
      }
      const selectedPaintedPoint =
        phase.stack.hitPointsFrameLocal[selectedPaintedName];
      const selectedAuthoredPoint =
        phase.stack.hitPointsFrameLocal[selectedAuthoredName];

      if (phaseIndex === 0 && metadata.groupTurns % 2 === 1) {
        if (!selectedPaintedPoint || !selectedAuthoredPoint) {
          throw new Error(
            `Missing ${entry.id}.${phase.name}.selected painted/authored probes`
          );
        }
        expect(
          pointInside(selectedPaintedPoint, selectedCard.frameLocalBounds)
        ).toBe(true);
        expect(
          pointInside(
            selectedPaintedPoint,
            selectedCard.untransformedFrameLocalBounds
          )
        ).toBe(false);
        expect(
          phase.stack.hitOrder[selectedPaintedName]?.includes(selectedCard.id)
        ).toBe(true);
        expect(
          pointInside(
            selectedAuthoredPoint,
            selectedCard.untransformedFrameLocalBounds
          )
        ).toBe(true);
        expect(
          pointInside(selectedAuthoredPoint, selectedCard.frameLocalBounds)
        ).toBe(false);
        expect(
          phase.stack.hitOrder[selectedAuthoredName]?.includes(selectedCard.id)
        ).toBe(false);
      } else if (
        (phaseIndex === 0 && metadata.groupTurns === 2) ||
        phaseIndex === 1
      ) {
        expect(selectedPaintedPoint).toBeNull();
        expect(selectedAuthoredPoint).toBeNull();
        expect(phase.stack.hitOrder[selectedPaintedName]).toBeNull();
        expect(phase.stack.hitOrder[selectedAuthoredName]).toBeNull();
      }
    }
  }

  expect(runtimeErrors).toEqual([]);
};
