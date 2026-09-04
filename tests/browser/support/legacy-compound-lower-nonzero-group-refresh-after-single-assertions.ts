import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, type Page, type TestInfo } from '@playwright/test';

import predecessorOracle from '../../legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json' with { type: 'json' };
import oracle from '../../legacy-fixtures/renderer/compound-lower-nonzero-group-refresh-after-single-v1.json' with { type: 'json' };

import type {
  CapturedPoint,
  CapturedRect,
  LegacyCompoundRotationCase,
  LegacyFixtureSide,
  LegacySourceCompoundRotationFixture,
} from './legacy-source-board.js';

export type LowerNonzeroGroupRefreshComposition = 'ordinary' | 'break';

const roles = ['top', 'middle', 'base'] as const;
const slots = ['active', 'bench'] as const;
const sides = ['local', 'opponent'] as const;
const lowerRoles = ['middle', 'base'] as const;
const groupTurns = [1, 2, 3] as const;
const hitRegions = [
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

type Role = (typeof roles)[number];
type Slot = (typeof slots)[number];
type GroupTurns = (typeof groupTurns)[number];
type Scenario = keyof typeof oracle.expected.scenario;
type RectTuple = readonly [number, number, number, number];
type PointTuple = readonly [number, number] | null;
type PhaseTuple = readonly [
  string,
  RectTuple,
  readonly [RectTuple, RectTuple, RectTuple],
  readonly [RectTuple, RectTuple, RectTuple],
  readonly PointTuple[],
];
type Capture = (page: Page) => Promise<LegacySourceCompoundRotationFixture>;

interface Manifest {
  readonly schemaVersion: number;
  readonly provenance?: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly encoding?: string;
  }[];
  readonly dependencies?: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

const evidence = oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly [PhaseTuple, PhaseTuple, PhaseTuple]
>;
const turns = oracle.expected.quarterTurnsByScenario as unknown as Record<
  Scenario,
  readonly [Record<Role, number>, Record<Role, number>, Record<Role, number>]
>;
const flags = oracle.expected.breakFlagsByScenario as unknown as Record<
  Scenario,
  readonly [Record<Role, boolean>, Record<Role, boolean>, Record<Role, boolean>]
>;
const margins = oracle.expected
  .inlineMarginsByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly [
    readonly [string, string],
    readonly [string, string],
    readonly [string, string],
  ]
>;
const traces = oracle.expected.operationTraceByScenario as unknown as Record<
  Scenario,
  readonly string[]
>;
const transitionTraces = oracle.expected
  .transitionTraceByScenario as unknown as Record<Scenario, readonly string[]>;
const predecessorTraces = predecessorOracle.expected
  .operationTraceByScenario as unknown as Record<string, readonly string[]>;

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
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
};

const title = (value: string) =>
  `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
const scenarioFor = (
  composition: LowerNonzeroGroupRefreshComposition,
  lowerRole: 'middle' | 'base',
  turns: GroupTurns
) =>
  `${composition}RefreshAfter${title(lowerRole)}SingleAtGroupQ${turns}` as Scenario;
const scenariosFor = (composition: LowerNonzeroGroupRefreshComposition) =>
  lowerRoles.flatMap((lowerRole) =>
    groupTurns.map((turnCount) =>
      scenarioFor(composition, lowerRole, turnCount)
    )
  );
const expectedIds = (composition: LowerNonzeroGroupRefreshComposition) => {
  const marker = composition === 'break' ? '-break' : '';
  return sides.flatMap((side) =>
    scenariosFor(composition).flatMap((scenario) => {
      const metadata = oracle.expected.scenario[scenario];
      return slots.map(
        (slot) =>
          `${side}-${slot}-compound${marker}-group-q${metadata.originalGroupTurns}-${metadata.priorLowerRole}-single-refresh`
      );
    })
  );
};
const required = <Value>(value: Value | undefined, label: string): Value => {
  expect(value, label).toBeDefined();
  return value as Value;
};
const expectStructured = (actual: number, expected: number, label: string) => {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected}, received ${actual}`
  ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
};
const expectRotation = (actual: number, expected: number, label: string) => {
  const distance = Math.abs(actual - expected) % 360;
  expect(
    Math.min(distance, 360 - distance),
    `${label}: expected ${expected}, received ${actual}`
  ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
};
const expectRect = (
  actual: CapturedRect,
  expected: RectTuple | CapturedRect,
  label: string
) => {
  const objectRect = expected as CapturedRect;
  const tuple: RectTuple = Array.isArray(expected)
    ? (expected as RectTuple)
    : [objectRect.x, objectRect.y, objectRect.width, objectRect.height];
  for (const [index, key] of ['x', 'y'].entries()) {
    const actualValue = actual[key as 'x' | 'y'];
    expect(
      Math.abs(actualValue - tuple[index]!),
      `${label}.${key}: expected ${tuple[index]}, received ${actualValue}`
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  }
  for (const [index, key] of ['width', 'height'].entries()) {
    const tupleIndex = index + 2;
    const actualValue = actual[key as 'width' | 'height'];
    expect(
      Math.abs(actualValue - tuple[tupleIndex]!) / tuple[tupleIndex]!,
      `${label}.${key}: expected ${tuple[tupleIndex]}, received ${actualValue}`
    ).toBeLessThanOrEqual(oracle.tolerances.cardSizeRelative);
  }
};
const expectPoint = (
  actual: CapturedPoint,
  expected: CapturedPoint,
  label: string
) => {
  for (const key of ['x', 'y'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  }
};
const normalizeTrace = (
  entry: LegacyCompoundRotationCase,
  trace: readonly string[]
) => trace.map((call) => call.replaceAll(`${entry.id}-`, ''));
const roleOrder = (ids: readonly string[] | null): readonly Role[] | null =>
  ids?.map((id) => {
    const role = roles.find((candidate) => id.endsWith(`-${candidate}`));
    if (!role) throw new Error(`unrecognized compound card id: ${id}`);
    return role;
  }) ?? null;
const pointInside = (point: PointTuple, bounds: RectTuple) =>
  point !== null &&
  point[0] >= bounds[0] &&
  point[0] <= bounds[0] + bounds[2] &&
  point[1] >= bounds[1] &&
  point[1] <= bounds[1] + bounds[3];
const expectedHitRoles = (point: PointTuple, rects: readonly RectTuple[]) =>
  roles.filter((_, index) => pointInside(point, rects[index]!));
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

const verifyManifest = async (
  manifest: Manifest,
  identity: string,
  visited: Set<string>
): Promise<void> => {
  if (visited.has(identity)) return;
  visited.add(identity);
  expect(manifest.schemaVersion, identity).toBe(1);
  for (const entry of manifest.provenance ?? []) {
    const source = await readFile(`${repositoryRoot}${entry.path}`);
    const value =
      entry.encoding === 'utf8'
        ? source.toString('utf8').replaceAll('\r\n', '\n')
        : source;
    expect(createHash('sha256').update(value).digest('hex'), entry.path).toBe(
      entry.sha256
    );
  }
  for (const dependency of manifest.dependencies ?? []) {
    const source = (
      await readFile(`${repositoryRoot}${dependency.path}`, 'utf8')
    ).replaceAll('\r\n', '\n');
    expect(
      createHash('sha256').update(source).digest('hex'),
      dependency.path
    ).toBe(dependency.sha256);
    await verifyManifest(
      JSON.parse(source) as Manifest,
      dependency.path,
      visited
    );
  }
};

export const assertLowerNonzeroGroupRefreshOracleIntegrity = async (
  composition: LowerNonzeroGroupRefreshComposition
): Promise<void> => {
  const visited = new Set<string>();
  await verifyManifest(
    oracle as unknown as Manifest,
    'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-refresh-after-single-v1.json',
    visited
  );
  expect(visited.size).toBeGreaterThanOrEqual(10);
  expect(oracle.input).toMatchObject({
    viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
    asset: {
      path: '/src/assets/cardback.png',
      naturalWidth: 736,
      naturalHeight: 1024,
    },
    phaseSequence: [
      'pre-refresh',
      'synchronous-post-refresh',
      'settled-post-refresh',
    ],
  });
  const ids = expectedIds(composition);
  expect(ids).toHaveLength(24);
  expect(new Set(ids).size).toBe(24);
  expect(oracle.input.casesByComposition[composition]).toEqual(ids);
  for (const scenario of scenariosFor(composition)) {
    const metadata = oracle.expected.scenario[scenario];
    const predecessor = oracle.expected.predecessorScenarioByScenario[scenario];
    expect(
      traces[scenario].slice(0, -transitionTraces[scenario].length)
    ).toEqual(predecessorTraces[predecessor]);
    for (const slot of slots) {
      const phases = evidence[`${scenario}:${slot}`];
      expect(phases.map((phase) => phase[0])).toEqual(
        oracle.input.phaseSequence
      );
      expect(phases.every((phase) => phase[4].length === 10)).toBe(true);
      expect(metadata.composition).toBe(composition);
    }
  }
};

const assertPhase = (
  entry: LegacyCompoundRotationCase,
  phaseIndex: number,
  expected: PhaseTuple,
  frame: CapturedRect,
  frameRotation: number
) => {
  const phase = required(entry.phases[phaseIndex], `${entry.id}.phase`);
  expect(phase.name).toBe(expected[0]);
  expect(phase.action).toBeNull();
  expect(phase.wrapperCount).toBe(
    oracle.expected.lifecycle.wrapperCountsByPhase[phaseIndex]
  );
  expectRect(phase.stack.frameLocalBounds, expected[1], `${entry.id}.stack`);
  expectRect(
    phase.stack.physicalBounds,
    physicalRect(entry.side, frame, phase.stack.frameLocalBounds),
    `${entry.id}.stack.physical`
  );
  expect(
    phase.stack.childDomOrder.map((id) => id.replace(`${entry.id}-`, ''))
  ).toEqual(oracle.expected.topology.domRoles);
  expect(
    phase.stack.logicalOrder.map((id) => id.replace(`${entry.id}-`, ''))
  ).toEqual(oracle.expected.topology.logicalRoles);
  expect(phase.stack.transform).toBe(oracle.expected.topology.wrapperTransform);
  expect(phase.stack.zIndex).toBe(oracle.expected.topology.wrapperZIndex);
  expect(phase.stack.inlineMarginRight).toBe(
    margins[`${entry.scenario as Scenario}:${entry.slot}`][phaseIndex][0]
  );
  expect(phase.stack.inlineMarginLeft).toBe(
    margins[`${entry.scenario as Scenario}:${entry.slot}`][phaseIndex][1]
  );

  for (const [roleIndex, role] of roles.entries()) {
    const card = required(
      phase.cards.find((candidate) => candidate.role === role),
      `${entry.id}.${role}`
    );
    expectRect(
      card.frameLocalBounds,
      expected[2][roleIndex],
      `${entry.id}.${role}.painted`
    );
    expectRect(
      card.untransformedFrameLocalBounds,
      expected[3][roleIndex],
      `${entry.id}.${role}.authored`
    );
    expectRect(
      card.physicalBounds,
      physicalRect(entry.side, frame, card.frameLocalBounds),
      `${entry.id}.${role}.physical`
    );
    const expectedTurn = turns[entry.scenario as Scenario][phaseIndex][role];
    expectRotation(
      card.localRotationDegrees,
      expectedTurn * 90,
      `${entry.id}.${role}.turn`
    );
    expectRotation(
      card.effectiveRotationDegrees,
      (expectedTurn * 90 + frameRotation) % 360,
      `${entry.id}.${role}.effective-turn`
    );
    expect(card.inlineTransform).toBe(`rotate(${expectedTurn * 90}deg)`);
    expect(card.pokemonBreak).toBe(
      flags[entry.scenario as Scenario][phaseIndex][role]
    );
    expect(card.naturalWidth).toBe(oracle.input.asset.naturalWidth);
    expect(card.naturalHeight).toBe(oracle.input.asset.naturalHeight);
    expect(card.sourcePath).toBe(oracle.input.asset.path);
    expect(card.imageType).toBe('Pokémon');
    expect(card.logicalOrdinal).toBe(roleIndex);
    expect(card.domOrdinal).toBe(role === 'top' ? 0 : role === 'base' ? 1 : 2);
    expect(card.zIndex).toBe(oracle.expected.topology.zByRole[role]);
    expect(card.layer).toBe(
      role === 'top' ? oracle.expected.topology.topLayer : 0
    );
    expect(card.energyLayer).toBe(oracle.expected.topology.energyLayer);
    expect(card.inlineLeftPx).toBe(0);
    expectStructured(
      card.inlineBottomPx,
      (role === 'top' ? 0 : role === 'middle' ? 1 : 2) *
        (card.clientWidth / 15),
      `${entry.id}.${role}.bottom`
    );
    expect(card.attached).toBe(role !== 'top');
    expect(card.target).toBe(role === 'top' ? 'off' : 'on');
    expect(card.relativeId).toBe(role === 'top' ? null : `${entry.id}-top`);
  }

  for (const [regionIndex, region] of hitRegions.entries()) {
    const point = expected[4][regionIndex];
    const actualPoint = phase.stack.hitPointsFrameLocal[region];
    const actualPhysical = phase.stack.hitPointsPhysical[region];
    if (point === null) {
      expect(actualPoint, `${entry.id}.${region}`).toBeNull();
      expect(actualPhysical, `${entry.id}.${region}.physical`).toBeNull();
      expect(roleOrder(phase.stack.hitOrder[region])).toBeNull();
      continue;
    }
    expect(actualPoint, `${entry.id}.${region}`).not.toBeNull();
    expectPoint(
      actualPoint!,
      { x: point[0], y: point[1] },
      `${entry.id}.${region}`
    );
    const physical = physicalPoint(entry.side, frame, actualPoint!);
    expectPoint(actualPhysical!, physical, `${entry.id}.${region}.physical`);
    expect(roleOrder(phase.stack.hitOrder[region])).toEqual(
      expectedHitRoles(point, expected[2])
    );
  }
};

export const assertLowerNonzeroGroupRefreshLiveCapture = async (
  page: Page,
  testInfo: TestInfo,
  composition: LowerNonzeroGroupRefreshComposition,
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
    )
      return;
    runtimeErrors.push(`console.error: ${text}`);
  });

  const capture = await captureFixture(page);
  await testInfo.attach(
    `legacy-source-compound-lower-nonzero-group-refresh-after-single-${composition}.json`,
    {
      body: Buffer.from(JSON.stringify(capture, null, 2)),
      contentType: 'application/json',
    }
  );
  expect(capture.sourceFulfillment).toEqual(expectedFulfillment);
  for (const bucket of [
    capture.ordinaryGroupCases,
    capture.breakGroupCases,
    capture.lowerGroupInitiatorCases,
    capture.lowerQ0SingleCases,
    capture.lowerReturnedQ0SingleCases,
    capture.lowerHistoryAuthoredQ0SingleCases,
    capture.lowerNonzeroGroupSingleCases,
    capture.lowerNonzeroGroupSingleFollowupCases,
    capture.lowerNonzeroGroupRotationAfterSingleCases,
    capture.lowerNonzeroSameLowerGroupAfterSingleCases,
    capture.lowerNonzeroDifferentLowerGroupAfterSingleCases,
    capture.lowerNonzeroSameLowerSecondGroupAfterSingleCases,
    capture.lowerNonzeroDifferentLowerSecondGroupAfterSingleCases,
    capture.nonzeroGroupSingleCases,
    capture.breakRefreshCases,
  ]) {
    expect(bucket).toEqual([]);
  }
  expect(
    capture.lowerNonzeroGroupRefreshAfterSingleCases.map((entry) => entry.id)
  ).toEqual(expectedIds(composition));

  for (const side of sides) {
    expectRect(
      capture.frames[side],
      oracle.expected.frames[side],
      `${side}.frame`
    );
    for (const key of ['a', 'b', 'c', 'd'] as const) {
      expectStructured(
        capture.frameTransforms[side][key],
        oracle.expected.frameTransforms[side][key],
        `${side}.transform.${key}`
      );
    }
    expectRotation(
      capture.frameTransforms[side].rotationDegrees,
      oracle.expected.frameTransforms[side].rotationDegrees,
      `${side}.rotation`
    );
  }

  for (const entry of capture.lowerNonzeroGroupRefreshAfterSingleCases) {
    const scenario = entry.scenario as Scenario;
    const key = `${scenario}:${entry.slot}` as const;
    expect(normalizeTrace(entry, entry.callTrace)).toEqual(traces[scenario]);
    expect(normalizeTrace(entry, entry.transitionTrace)).toEqual(
      transitionTraces[scenario]
    );
    expect(entry.phases).toHaveLength(3);
    expect(entry.phases.map((phase) => phase.name)).toEqual(
      oracle.input.phaseSequence
    );
    for (let phaseIndex = 0; phaseIndex < 3; phaseIndex += 1) {
      assertPhase(
        entry,
        phaseIndex,
        evidence[key][phaseIndex],
        capture.frames[entry.side],
        capture.frameTransforms[entry.side].rotationDegrees
      );
    }
    expect(entry.refresh).toEqual(oracle.expected.lifecycle.refreshEvidence);
    expect(entry.observers.mutationObserversCreated).toBe(
      oracle.expected.lifecycle.observerPairsCreated
    );
    expect(entry.observers.resizeObserversCreated).toBe(
      oracle.expected.lifecycle.observerPairsCreated
    );
    expect(
      entry.observers.resizeCallbacksBeforeCardRemoval
    ).toBeGreaterThanOrEqual(
      oracle.expected.lifecycle.minimumResizeCallbacksBeforeCardRemoval
    );
    expect(
      entry.observers.resizeCallbacksAfterCardRemoval -
        entry.observers.resizeCallbacksBeforeCardRemoval
    ).toBe(oracle.expected.lifecycle.resizeCallbacksAddedAfterCardRemoval);
    expect(entry.observers.transcribedSourceDisconnectCalls).toBe(0);
    expect(
      entry.observers.harnessRetainedSourceShapedObserverHandlesBeforeCleanup
    ).toBe(true);
    expect(entry.observers.harnessMutationDisconnectCalls).toBe(4);
    expect(entry.observers.harnessResizeDisconnectCalls).toBe(4);
    expect(entry.cleanup).toEqual({
      observedWrapperCount: 0,
      observedCardCount: 0,
      sinkConnected: false,
    });
  }
  expect(runtimeErrors).toEqual([]);
};
