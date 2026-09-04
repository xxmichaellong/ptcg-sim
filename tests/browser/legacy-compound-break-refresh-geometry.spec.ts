import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json' with { type: 'json' };
import oracle from '../legacy-fixtures/renderer/compound-break-refresh-q0-q2-v1.json' with { type: 'json' };

import {
  captureLegacySourceCompoundBreakRefreshFixture,
  type CapturedPoint,
  type CapturedRect,
  type LegacyCompoundRotationCase,
  type LegacyFixtureSide,
} from './support/legacy-source-board.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

type RectTuple = readonly [number, number, number, number];
type PointTuple = readonly [number, number];
type SizeTuple = readonly [number, number];
type MarginTuple = readonly [string, string];
type GeometryEvidence = {
  readonly stackRect: RectTuple;
  readonly clientSize: SizeTuple;
  readonly offsetSize: SizeTuple;
  readonly computedSize: SizeTuple;
  readonly authoredWidthPx: number;
  readonly inlineMargins: MarginTuple;
  readonly computedMarginsPx: SizeTuple;
  readonly paintedCardRects: readonly [RectTuple, RectTuple, RectTuple];
  readonly authoredCardRects: readonly [RectTuple, RectTuple, RectTuple];
  readonly hitPoints: readonly [
    PointTuple,
    PointTuple,
    PointTuple,
    PointTuple,
    PointTuple,
    PointTuple,
  ];
};
type RefreshScenario = keyof typeof oracle.expected.localQuarterTurnsByScenario;
type GeometryKey = keyof typeof oracle.expected.geometryEvidenceByKey;

const hitRegionNames = [
  'commonOverlap',
  'topOnly',
  'middleAndBaseOverlap',
  'baseOnly',
  'topPaintedOnly',
  'topAuthoredOnly',
] as const;
const roles = ['top', 'middle', 'base'] as const;

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

const pointFromTuple = ([x, y]: PointTuple): CapturedPoint => ({ x, y });

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

const phaseGeometry = (
  phase: LegacyCompoundRotationCase['phases'][number]
) => ({
  stack: {
    frameLocalBounds: phase.stack.frameLocalBounds,
    clientWidth: phase.stack.clientWidth,
    clientHeight: phase.stack.clientHeight,
    offsetWidth: phase.stack.offsetWidth,
    offsetHeight: phase.stack.offsetHeight,
    computedWidthPx: phase.stack.computedWidthPx,
    computedHeightPx: phase.stack.computedHeightPx,
    authoredWidthPx: phase.stack.authoredWidthPx,
    inlineMarginRight: phase.stack.inlineMarginRight,
    inlineMarginLeft: phase.stack.inlineMarginLeft,
    computedMarginRightPx: phase.stack.computedMarginRightPx,
    computedMarginLeftPx: phase.stack.computedMarginLeftPx,
    hitPointsFrameLocal: phase.stack.hitPointsFrameLocal,
  },
  cards: phase.cards.map((card) => ({
    role: card.role,
    frameLocalBounds: card.frameLocalBounds,
    untransformedFrameLocalBounds: card.untransformedFrameLocalBounds,
    localRotationDegrees: card.localRotationDegrees,
    pokemonBreak: card.pokemonBreak,
  })),
});

const geometryCatalog = oracle.expected
  .geometryEvidenceByKey as unknown as Record<GeometryKey, GeometryEvidence>;
const geometryMapping = oracle.expected
  .geometryKeyByScenarioAndSlot as unknown as Record<
  RefreshScenario,
  Record<'active' | 'bench', readonly GeometryKey[]>
>;
const oracleSides = oracle.input.sides as readonly LegacyFixtureSide[];
const oracleScenarios = oracle.input.scenarios as readonly RefreshScenario[];
const oracleSlots = oracle.input.slots as readonly ('active' | 'bench')[];

test('BREAK q0/q2 refresh oracle pins direct sources and its inherited baseline', async () => {
  expect(oracle.schemaVersion).toBe(1);
  const sourcePaths = oracle.provenance.map((entry) => entry.path);
  expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
  const claimedPaths = new Set(
    oracle.provenanceClaims.flatMap((claim) => claim.sources)
  );
  expect([...claimedPaths].sort()).toEqual([...sourcePaths].sort());
  for (const entry of oracle.provenance) {
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
  expect(oracle.dependencies).toHaveLength(1);
  for (const entry of oracle.dependencies) {
    const source = await readFile(`${repositoryRoot}${entry.path}`, 'utf8');
    expect(
      createHash('sha256')
        .update(source.replaceAll('\r\n', '\n'))
        .digest('hex'),
      entry.path
    ).toBe(entry.sha256);
  }
  for (const entry of breakOracle.provenance) {
    const source = await readFile(`${repositoryRoot}${entry.path}`);
    const hashInput =
      entry.encoding === 'utf8'
        ? source.toString('utf8').replaceAll('\r\n', '\n')
        : source;
    expect(
      createHash('sha256').update(hashInput).digest('hex'),
      `inherited ${entry.path}`
    ).toBe(entry.sha256);
  }
  for (const entry of breakOracle.dependencies) {
    const source = await readFile(`${repositoryRoot}${entry.path}`, 'utf8');
    expect(
      createHash('sha256')
        .update(source.replaceAll('\r\n', '\n'))
        .digest('hex'),
      `inherited ${entry.path}`
    ).toBe(entry.sha256);
  }
  expect(oracle.expected.frames).toEqual(breakOracle.expected.frames);
  expect(oracle.expected.frameTransforms).toEqual(
    breakOracle.expected.frameTransforms
  );
});

test('checked-in legacy BREAK q0/q2 refreshes preserve their exact history-dependent geometry', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source BREAK refresh checkpoint is Chromium-specific.'
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

  const capture = await captureLegacySourceCompoundBreakRefreshFixture(page);
  await testInfo.attach('legacy-source-compound-break-refresh-q0-q2.json', {
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
  expect(capture.lowerReturnedQ0SingleCases).toEqual([]);
  expect(capture.lowerHistoryAuthoredQ0SingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupSingleCases).toEqual([]);
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
  expect(capture.nonzeroGroupSingleCases).toEqual([]);
  const scenarioId = {
    breakRefreshFreshQ0: 'fresh-q0',
    breakRefreshReturnedQ0: 'returned-q0',
    breakRefreshQ2: 'q2',
  } as const;
  const expectedIds = oracleSides.flatMap((side) =>
    oracleScenarios.flatMap((scenario) =>
      oracleSlots.map(
        (slot) =>
          `${side}-${slot}-compound-break-refresh-${scenarioId[scenario]}`
      )
    )
  );
  expect(capture.breakRefreshCases.map((entry) => entry.id)).toEqual(
    expectedIds
  );

  for (const side of oracleSides) {
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

  const topology = oracle.expected.topology;
  for (const entry of capture.breakRefreshCases) {
    const scenario = entry.scenario as RefreshScenario;
    expect(oracleScenarios).toContain(scenario);
    expect(entry.phases.map((phase) => phase.name)).toEqual(
      oracle.input.phaseSequence
    );
    expect(entry.phases.map((phase) => phase.wrapperCount)).toEqual(
      oracle.expected.refresh.wrapperCountsByPhase
    );
    expect(entry.refresh).toEqual({
      synchronousWrapperCount: oracle.expected.refresh.synchronousWrapperCount,
      oldWrapperConnectedImmediately:
        oracle.expected.refresh.oldWrapperConnectedImmediately,
      stableWrapperCount: oracle.expected.refresh.stableWrapperCount,
      oldWrapperConnectedAfterSettle:
        oracle.expected.refresh.oldWrapperConnectedAfterSettle,
      wrapperIdentityChanged: oracle.expected.refresh.wrapperIdentityChanged,
      cardNodeIdentityPreserved:
        oracle.expected.refresh.cardNodeIdentityPreserved,
    });
    expect(entry.observers).toMatchObject({
      mutationObserversCreated: oracle.expected.refresh.observerPairsCreated,
      resizeObserversCreated: oracle.expected.refresh.observerPairsCreated,
      transcribedSourceDisconnectCalls:
        oracle.expected.refresh.transcribedSourceDisconnectCalls,
      harnessRetainedSourceShapedObserverHandlesBeforeCleanup: true,
      harnessMutationDisconnectCalls:
        oracle.expected.refresh.harnessDisconnectCallsPerObserverKind,
      harnessResizeDisconnectCalls:
        oracle.expected.refresh.harnessDisconnectCallsPerObserverKind,
    });
    expect(
      entry.observers.resizeCallbacksBeforeCardRemoval
    ).toBeGreaterThanOrEqual(
      oracle.expected.refresh.minimumResizeCallbacksBeforeCardRemoval
    );
    expect(
      entry.observers.resizeCallbacksAfterCardRemoval -
        entry.observers.resizeCallbacksBeforeCardRemoval
    ).toBe(oracle.expected.refresh.resizeCallbacksAddedAfterCardRemoval);
    expect(entry.cleanup).toEqual({
      observedWrapperCount: 0,
      observedCardCount: 0,
      sinkConnected: false,
    });
    expect(normalizedTrace(entry, entry.callTrace)).toEqual(
      oracle.expected.operationTraceByScenario[scenario]
    );
    expect(normalizedTrace(entry, entry.transitionTrace)).toEqual(
      oracle.expected.transitionTraceByScenario[scenario]
    );

    const expectedQuarterTurns =
      oracle.expected.localQuarterTurnsByScenario[scenario];
    const geometryKeys = geometryMapping[scenario][entry.slot];
    for (const [phaseIndex, phase] of entry.phases.entries()) {
      const geometryKey = geometryKeys[phaseIndex];
      if (!geometryKey) {
        throw new Error(`Missing ${entry.id}.${phase.name} geometry key`);
      }
      const evidence = geometryCatalog[geometryKey];
      const expectedStackRect = rectFromTuple(evidence.stackRect);
      expect(phase.action).toBeNull();
      expectRect(
        phase.stack.frameLocalBounds,
        expectedStackRect,
        `${entry.id}.${phase.name}.stack`
      );
      expect([phase.stack.clientWidth, phase.stack.clientHeight]).toEqual(
        evidence.clientSize
      );
      expect([phase.stack.offsetWidth, phase.stack.offsetHeight]).toEqual(
        evidence.offsetSize
      );
      expectStructured(
        phase.stack.computedWidthPx,
        evidence.computedSize[0],
        `${entry.id}.${phase.name}.computedWidth`
      );
      expectStructured(
        phase.stack.computedHeightPx,
        evidence.computedSize[1],
        `${entry.id}.${phase.name}.computedHeight`
      );
      expect(phase.stack.authoredWidthPx).toBe(evidence.authoredWidthPx);
      expect([
        phase.stack.inlineMarginRight,
        phase.stack.inlineMarginLeft,
      ]).toEqual(evidence.inlineMargins);
      expectStructured(
        phase.stack.computedMarginRightPx,
        evidence.computedMarginsPx[0],
        `${entry.id}.${phase.name}.computedMarginRight`
      );
      expectStructured(
        phase.stack.computedMarginLeftPx,
        evidence.computedMarginsPx[1],
        `${entry.id}.${phase.name}.computedMarginLeft`
      );
      expect(phase.stack.transform).toBe(topology.wrapperTransform);
      expect(phase.stack.zIndex).toBe(topology.wrapperZIndex);
      expect(roleOrder(phase.stack.logicalOrder)).toEqual(
        topology.logicalRoles
      );
      expect(roleOrder(phase.stack.childDomOrder)).toEqual(topology.domRoles);
      for (const key of hitRegionNames) {
        expect(roleOrder(phase.stack.hitOrder[key])).toEqual(
          oracle.expected.hitOrder[key]
        );
      }
      expectRect(
        phase.stack.physicalBounds,
        physicalRect(
          entry.side,
          oracle.expected.frames[entry.side],
          expectedStackRect
        ),
        `${entry.id}.${phase.name}.stackPhysical`
      );

      for (const [hitIndex, key] of hitRegionNames.entries()) {
        const actualLocal = phase.stack.hitPointsFrameLocal[key];
        const actualPhysical = phase.stack.hitPointsPhysical[key];
        if (!actualLocal || !actualPhysical) {
          throw new Error(`Missing ${entry.id}.${phase.name}.${key} hit point`);
        }
        const expectedLocal = pointFromTuple(evidence.hitPoints[hitIndex]!);
        expectPoint(
          actualLocal,
          expectedLocal,
          `${entry.id}.${phase.name}.${key}`
        );
        expectPoint(
          actualPhysical,
          physicalPoint(
            entry.side,
            oracle.expected.frames[entry.side],
            expectedLocal
          ),
          `${entry.id}.${phase.name}.${key}.physical`
        );
      }

      for (const [cardIndex, card] of phase.cards.entries()) {
        const role = roles[cardIndex];
        if (!role) throw new Error(`Unexpected card ${card.id}`);
        const quarterTurns = expectedQuarterTurns[role];
        const degrees = quarterTurns * 90;
        const inlineBottomPx =
          role === 'top'
            ? 0
            : breakOracle.expected.slotMetrics[entry.slot][
                role === 'middle' ? 'middleBottomPx' : 'baseBottomPx'
              ];
        expect(card).toMatchObject({
          role,
          naturalWidth: oracle.input.asset.naturalWidth,
          naturalHeight: oracle.input.asset.naturalHeight,
          clientWidth: evidence.clientSize[0],
          clientHeight: evidence.clientSize[1],
          imageType: 'Pokémon',
          sourcePath: oracle.input.asset.path,
          inlineTransform: `rotate(${degrees}deg)`,
          energyLayer: topology.energyLayer,
          pokemonBreak: role === 'top',
          zIndex: topology.zByRole[role],
          layer: role === 'top' ? topology.topLayer : 0,
          position: role === 'top' ? 'relative' : 'absolute',
          attached: role !== 'top',
          target: role === 'top' ? 'off' : 'on',
          relativeId: role === 'top' ? null : `${entry.id}-top`,
          domOrdinal: { top: 0, middle: 2, base: 1 }[role],
          logicalOrdinal: { top: 0, middle: 1, base: 2 }[role],
          inlineLeftPx: 0,
          inlineBottomPx,
        });
        expect(
          modularDegreesBetween(card.localRotationDegrees, degrees)
        ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
        expect(
          modularDegreesBetween(
            card.effectiveRotationDegrees,
            degrees + oracle.expected.frameRotationDegrees[entry.side]
          )
        ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
        const transformOrigin = card.transformOrigin
          .split(' ')
          .map((value) => Number.parseFloat(value));
        expect(transformOrigin).toHaveLength(2);
        for (const [index, expected] of breakOracle.expected.slotMetrics[
          entry.slot
        ].transformOriginPx.entries()) {
          expectStructured(
            transformOrigin[index] ?? Number.NaN,
            expected,
            `${card.id}.${phase.name}.transformOrigin.${index}`
          );
        }
        const expectedPainted = rectFromTuple(
          evidence.paintedCardRects[cardIndex]!
        );
        const expectedAuthored = rectFromTuple(
          evidence.authoredCardRects[cardIndex]!
        );
        expectRect(
          card.frameLocalBounds,
          expectedPainted,
          `${card.id}.${phase.name}.painted`
        );
        expectRect(
          card.untransformedFrameLocalBounds,
          expectedAuthored,
          `${card.id}.${phase.name}.authored`
        );
        expectRect(
          card.physicalBounds,
          physicalRect(
            entry.side,
            oracle.expected.frames[entry.side],
            expectedPainted
          ),
          `${card.id}.${phase.name}.paintedPhysical`
        );
        const paintedFormula =
          quarterTurns % 2 === 0
            ? card.untransformedFrameLocalBounds
            : {
                x:
                  card.untransformedFrameLocalBounds.x -
                  (card.untransformedFrameLocalBounds.height -
                    card.untransformedFrameLocalBounds.width) /
                    2,
                y:
                  card.untransformedFrameLocalBounds.y +
                  (card.untransformedFrameLocalBounds.height -
                    card.untransformedFrameLocalBounds.width) /
                    2,
                width: card.untransformedFrameLocalBounds.height,
                height: card.untransformedFrameLocalBounds.width,
              };
        expectRect(
          card.frameLocalBounds,
          paintedFormula,
          `${card.id}.${phase.name}.paintedFormula`
        );
      }
    }
  }

  for (const side of oracleSides) {
    const find = (scenario: RefreshScenario, slot: 'active' | 'bench') => {
      const entry = capture.breakRefreshCases.find(
        (candidate) =>
          candidate.side === side &&
          candidate.slot === slot &&
          candidate.scenario === scenario
      );
      if (!entry) throw new Error(`Missing ${side}.${slot}.${scenario}`);
      return entry;
    };
    const freshActive = find('breakRefreshFreshQ0', 'active');
    const returnedActive = find('breakRefreshReturnedQ0', 'active');
    expect(
      freshActive.phases[0]?.cards.map((card) => card.localRotationDegrees)
    ).toEqual(
      returnedActive.phases[0]?.cards.map((card) => card.localRotationDegrees)
    );
    expect(
      Math.abs(
        freshActive.phases[0]!.stack.frameLocalBounds.x -
          returnedActive.phases[0]!.stack.frameLocalBounds.x
      )
    ).toBeGreaterThan(1);
    expect(phaseGeometry(freshActive.phases[2]!)).toEqual(
      phaseGeometry(returnedActive.phases[2]!)
    );
    const q2Active = find('breakRefreshQ2', 'active');
    expect(phaseGeometry(q2Active.phases[2]!)).toEqual(
      phaseGeometry(q2Active.phases[0]!)
    );
    for (const scenario of oracleScenarios) {
      const bench = find(scenario, 'bench');
      expect(phaseGeometry(bench.phases[2]!)).toEqual(
        phaseGeometry(bench.phases[0]!)
      );
    }
  }
  expect(runtimeErrors).toEqual([]);
});
