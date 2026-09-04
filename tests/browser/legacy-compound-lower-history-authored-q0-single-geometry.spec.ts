import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import groupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json' with { type: 'json' };
import lowerQ0Oracle from '../legacy-fixtures/renderer/compound-lower-q0-single-v1.json' with { type: 'json' };
import oracle from '../legacy-fixtures/renderer/compound-lower-history-authored-q0-single-v1.json' with { type: 'json' };
import returnedQ0Oracle from '../legacy-fixtures/renderer/compound-lower-returned-q0-single-v1.json' with { type: 'json' };
import {
  captureLegacySourceCompoundLowerHistoryAuthoredQ0SingleFixture,
  type CapturedPoint,
  type CapturedRect,
  type LegacyCompoundRotationCase,
  type LegacyFixtureSide,
} from './support/legacy-source-board.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const roles = ['top', 'middle', 'base'] as const;
const slots = ['active', 'bench'] as const;
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

type Role = (typeof roles)[number];
type Slot = (typeof slots)[number];
type Scenario = keyof typeof oracle.expected.scenario;
type RectTuple = readonly [number, number, number, number];
type PointTuple = readonly [number, number] | null;
type PhaseEvidenceTuple = readonly [
  name: string,
  stackRect: RectTuple,
  paintedCardRects: readonly [RectTuple, RectTuple, RectTuple],
  authoredCardRects: readonly [RectTuple, RectTuple, RectTuple],
  hitPoints: readonly PointTuple[],
];

interface DigestManifest {
  readonly schemaVersion: number;
  readonly provenance?: readonly {
    readonly path: string;
    readonly encoding: string;
    readonly sha256: string;
  }[];
  readonly provenanceClaims?: readonly {
    readonly claim: string;
    readonly sources: readonly string[];
  }[];
  readonly dependencies?: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

const scenarioMetadata = oracle.expected.scenario as unknown as Record<
  Scenario,
  {
    readonly composition: 'ordinary' | 'break';
    readonly selectedRole: 'middle' | 'base';
    readonly selectedIndex: 1 | 2;
    readonly selectedDomOrdinal: 1 | 2;
    readonly setupSingleCount: 2;
    readonly measuredSingleOrdinal: 3;
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
const returnedEvidence = returnedQ0Oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  string,
  readonly PhaseEvidenceTuple[]
>;

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

const required = <Value>(value: Value, label: string): NonNullable<Value> => {
  if (value === undefined || value === null)
    throw new Error(`Missing ${label}`);
  return value;
};

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
      `${label}.${key}`
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  }
  for (const key of ['width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]) / expected[key],
      `${label}.${key}`
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
      `${label}.${key}`
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
  roles.filter((_, index) =>
    pointInside(point, rectFromTuple(cardRects[index]))
  );

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

test('history-authored q0 oracle pins recursive source, dependencies, and its exact 16-case matrix', async () => {
  const visited = new Set<string>();
  const visit = async (
    manifest: DigestManifest,
    manifestPath: string
  ): Promise<void> => {
    if (visited.has(manifestPath)) return;
    visited.add(manifestPath);
    expect(manifest.schemaVersion, manifestPath).toBe(1);
    const provenance = manifest.provenance ?? [];
    const claims = manifest.provenanceClaims ?? [];
    const sourcePaths = provenance.map((entry) => entry.path);
    expect(new Set(sourcePaths).size, manifestPath).toBe(sourcePaths.length);
    expect(
      [...new Set(claims.flatMap((claim) => claim.sources))].sort(),
      `${manifestPath}: claim closure`
    ).toEqual([...sourcePaths].sort());
    for (const claim of claims) {
      expect(claim.sources.length, claim.claim).toBeGreaterThan(0);
      expect(new Set(claim.sources).size, claim.claim).toBe(
        claim.sources.length
      );
    }
    for (const entry of provenance) {
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
    for (const dependency of manifest.dependencies ?? []) {
      const source = (
        await readFile(`${repositoryRoot}${dependency.path}`, 'utf8')
      ).replaceAll('\r\n', '\n');
      expect(
        createHash('sha256').update(source).digest('hex'),
        dependency.path
      ).toBe(dependency.sha256);
      await visit(JSON.parse(source) as DigestManifest, dependency.path);
    }
  };

  await visit(
    oracle as unknown as DigestManifest,
    'tests/legacy-fixtures/renderer/compound-lower-history-authored-q0-single-v1.json'
  );
  expect(visited.size).toBeGreaterThan(2);
  expect(oracle.dependencies.map((entry) => entry.path)).toEqual([
    'tests/legacy-fixtures/renderer/compound-lower-q0-single-v1.json',
    'tests/legacy-fixtures/renderer/compound-lower-returned-q0-single-v1.json',
  ]);
  expect(oracle.input).toMatchObject({
    viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
    asset: {
      path: '/src/assets/cardback.png',
      naturalWidth: 736,
      naturalHeight: 1024,
    },
    evolutionOrder: ['base', 'middle', 'top'],
    setupSingleCount: 2,
    measuredSingleOrdinal: 3,
    phaseSequence: ['pre-single', 'post-single'],
    scenarioOrder: [
      'ordinaryMiddleThirdSingleAtHistoryQ0',
      'ordinaryBaseThirdSingleAtHistoryQ0',
      'breakMiddleThirdSingleAtHistoryQ0',
      'breakBaseThirdSingleAtHistoryQ0',
    ],
  });
  expect(oracle.input.cases).toHaveLength(16);
  expect(new Set(oracle.input.cases).size).toBe(16);

  const expectedCaseIds: string[] = [];
  for (const side of ['local', 'opponent'] as const) {
    for (const scenario of oracle.input.scenarioOrder as readonly Scenario[]) {
      const metadata = required(
        scenarioMetadata[scenario],
        `${scenario}.metadata`
      );
      for (const slot of slots) {
        expectedCaseIds.push(
          `${side}-${slot}-compound${metadata.composition === 'break' ? '-break' : ''}-history-q0-${metadata.selectedRole}-third-single`
        );
      }
    }
  }
  expect(oracle.input.cases).toEqual(expectedCaseIds);

  const scenarioKeys = [...oracle.input.scenarioOrder].sort();
  for (const actual of [
    Object.keys(scenarioMetadata),
    Object.keys(quarterTurns),
    Object.keys(breakFlags),
    Object.keys(operationTraces),
    Object.keys(transitionTraces),
  ]) {
    expect(actual.sort()).toEqual(scenarioKeys);
  }
  const phaseKeys = (oracle.input.scenarioOrder as readonly Scenario[])
    .flatMap((scenario) => slots.map((slot) => `${scenario}:${slot}`))
    .sort();
  expect(Object.keys(phaseEvidence).sort()).toEqual(phaseKeys);
  expect(Object.keys(margins).sort()).toEqual(phaseKeys);
  expect(oracle.expected.frames).toEqual(returnedQ0Oracle.expected.frames);
  expect(oracle.expected.frameTransforms).toEqual(
    returnedQ0Oracle.expected.frameTransforms
  );
  expect(oracle.expected.topology).toEqual(returnedQ0Oracle.expected.topology);
  expect(oracle.expected.lifecycle).toEqual(lowerQ0Oracle.expected.lifecycle);
  expect(oracle.expected.hitRegionOrder).toEqual(hitRegionNames);
  expect(oracle.expected.phaseEvidenceTupleSchema).toEqual([
    'phase name',
    'stack frame-local rect [x,y,width,height]',
    'painted card rects [top,middle,base], each [x,y,width,height]',
    'authored/untransformed card rects [top,middle,base], each [x,y,width,height]',
    'hit points in expected.hitRegionOrder, each [x,y] or null',
  ]);

  for (const scenario of oracle.input.scenarioOrder as readonly Scenario[]) {
    const metadata = required(
      scenarioMetadata[scenario],
      `${scenario}.metadata`
    );
    expect(metadata).toMatchObject({
      selectedIndex: metadata.selectedRole === 'middle' ? 1 : 2,
      selectedDomOrdinal: metadata.selectedRole === 'middle' ? 2 : 1,
      setupSingleCount: 2,
      measuredSingleOrdinal: 3,
      selectionHitRegion:
        metadata.selectedRole === 'middle'
          ? 'middleAndBaseOverlap'
          : 'baseOnly',
    });
    const template = `${metadata.composition === 'ordinary' ? 'ordinaryReturnedFromTop' : 'breakReturnedFromMiddle'}${metadata.selectedRole === 'middle' ? 'Middle' : 'Base'}Single`;
    for (const slot of slots) {
      const key = `${scenario}:${slot}` as const;
      expect(phaseEvidence[key]).toEqual(
        returnedEvidence[`${template}:${slot}`]
      );
      expect(phaseEvidence[key].map((phase) => phase[0])).toEqual(
        oracle.input.phaseSequence
      );
      expect(margins[key]).toEqual(
        slot === 'active'
          ? [
              ['1%', '0%'],
              ['1%', '0%'],
            ]
          : [
              ['1%', '0%'],
              ['3%', '2%'],
            ]
      );
    }
    const selected = metadata.selectedRole;
    const transition = `rotate:${selected}:index=${metadata.selectedIndex}:single=true:0->90:break=false->true`;
    expect(transitionTraces[scenario]).toBe(transition);
    expect(operationTraces[scenario].slice(-3)).toEqual([
      transition,
      `rotate:${selected}:index=${metadata.selectedIndex}:single=true:90->0:break=true->false`,
      transition,
    ]);
  }
});

test('checked-in legacy lower Alt-R pins the combined history-authored q0 matrix', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower history-authored q0 checkpoint is Chromium-specific.'
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
    ) {
      return;
    }
    runtimeErrors.push(`console.error: ${text}`);
  });

  const capture =
    await captureLegacySourceCompoundLowerHistoryAuthoredQ0SingleFixture(page);
  await testInfo.attach(
    'legacy-source-compound-lower-history-authored-q0.json',
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
  expect(capture.lowerNonzeroGroupSingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupSingleFollowupCases).toEqual([]);
  expect(capture.nonzeroGroupSingleCases).toEqual([]);
  expect(capture.breakRefreshCases).toEqual([]);
  expect(
    capture.lowerHistoryAuthoredQ0SingleCases.map((entry) => entry.id)
  ).toEqual(oracle.input.cases);

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

  for (const entry of capture.lowerHistoryAuthoredQ0SingleCases) {
    const scenario = entry.scenario as Scenario;
    const metadata = required(
      scenarioMetadata[scenario],
      `${entry.id}.metadata`
    );
    const evidence = required(
      phaseEvidence[`${scenario}:${entry.slot}`],
      `${entry.id}.evidence`
    );
    const expectedMargins = required(
      margins[`${scenario}:${entry.slot}`],
      `${entry.id}.margins`
    );
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
            (phase) => phase.cards.find((card) => card.role === role)?.id
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

    const prePhase = required(entry.phases[0], `${entry.id}.pre-single`);
    expect(
      roleOrder(prePhase.stack.hitOrder[metadata.selectionHitRegion])
    ).toContain(metadata.selectedRole);
    expect(
      prePhase.cards.find((card) => card.role === metadata.selectedRole)
    ).toMatchObject({
      domOrdinal: metadata.selectedDomOrdinal,
      logicalOrdinal: metadata.selectedIndex,
    });

    for (const [phaseIndex, phase] of entry.phases.entries()) {
      const expectedPhase = required(
        evidence[phaseIndex],
        `${entry.id}.${phase.name}.phase`
      );
      const expectedTurns = required(
        quarterTurns[scenario][phaseIndex],
        `${entry.id}.${phase.name}.turns`
      );
      const expectedBreaks = required(
        breakFlags[scenario][phaseIndex],
        `${entry.id}.${phase.name}.breaks`
      );
      const expectedMargin = required(
        expectedMargins[phaseIndex],
        `${entry.id}.${phase.name}.margin`
      );
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
      expect(phase.action).toEqual(
        phaseIndex === 0
          ? null
          : {
              selectedCardId: `${entry.id}-${metadata.selectedRole}`,
              selectedRole: metadata.selectedRole,
              indexBefore: metadata.selectedIndex,
              single: true,
            }
      );

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
        expect(card).toMatchObject(
          role === 'top'
            ? {
                position: 'relative',
                attached: false,
                target: 'off',
                relativeId: null,
              }
            : {
                position: 'absolute',
                attached: true,
                target: 'on',
                relativeId: `${entry.id}-top`,
              }
        );
      }

      for (const [hitIndex, hitName] of hitRegionNames.entries()) {
        const expectedPoint = pointFromTuple(
          expectedPhase[4][hitIndex] ?? null
        );
        const actualPoint = phase.stack.hitPointsFrameLocal[hitName];
        if (!expectedPoint) {
          expect(
            actualPoint,
            `${entry.id}.${phase.name}.${hitName}`
          ).toBeNull();
          expect(phase.stack.hitPointsPhysical[hitName]).toBeNull();
          expect(phase.stack.hitOrder[hitName]).toBeNull();
          continue;
        }
        if (!actualPoint)
          throw new Error(`Missing ${entry.id}.${phase.name}.${hitName}`);
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
      const selectedCard = required(
        phase.cards.find((card) => card.role === metadata.selectedRole),
        `${entry.id}.${phase.name}.selected-card`
      );
      const paintedProbe = phase.stack.hitPointsFrameLocal[selectedPaintedName];
      const authoredProbe =
        phase.stack.hitPointsFrameLocal[selectedAuthoredName];
      if (phaseIndex === 0) {
        expect(paintedProbe).toBeNull();
        expect(authoredProbe).toBeNull();
        expect(phase.stack.hitOrder[selectedPaintedName]).toBeNull();
        expect(phase.stack.hitOrder[selectedAuthoredName]).toBeNull();
      } else {
        const requiredPaintedProbe = required(
          paintedProbe,
          `${entry.id}.${phase.name}.selected-painted-probe`
        );
        const requiredAuthoredProbe = required(
          authoredProbe,
          `${entry.id}.${phase.name}.selected-authored-probe`
        );
        expect(
          pointInside(requiredPaintedProbe, selectedCard.frameLocalBounds)
        ).toBe(true);
        expect(
          pointInside(
            requiredPaintedProbe,
            selectedCard.untransformedFrameLocalBounds
          )
        ).toBe(false);
        expect(
          phase.stack.hitOrder[selectedPaintedName]?.includes(selectedCard.id)
        ).toBe(true);
        expect(
          pointInside(
            requiredAuthoredProbe,
            selectedCard.untransformedFrameLocalBounds
          )
        ).toBe(true);
        expect(
          pointInside(requiredAuthoredProbe, selectedCard.frameLocalBounds)
        ).toBe(false);
        expect(
          phase.stack.hitOrder[selectedAuthoredName]?.includes(selectedCard.id)
        ).toBe(false);
      }
    }
  }

  expect(runtimeErrors).toEqual([]);
});
