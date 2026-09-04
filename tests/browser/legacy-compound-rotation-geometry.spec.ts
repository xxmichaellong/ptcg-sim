import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json' with { type: 'json' };
import groupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json' with { type: 'json' };
import evolutionOracle from '../legacy-fixtures/renderer/evolution-reflow-v1.json' with { type: 'json' };

import {
  captureLegacySourceCompoundRotationFixture,
  type CapturedPoint,
  type CapturedRect,
  type LegacyCompoundRotationCase,
  type LegacyFixtureSide,
} from './support/legacy-source-board.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

const modularDegreesBetween = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

const expectRect = (
  actual: CapturedRect,
  expected: CapturedRect,
  label: string,
  tolerances: {
    readonly anchorPixels: number;
    readonly cardSizeRelative: number;
  }
): void => {
  for (const key of ['x', 'y'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(tolerances.anchorPixels);
  }
  for (const key of ['width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]) / expected[key],
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(tolerances.cardSizeRelative);
  }
};

const expectStructured = (
  actual: number,
  expected: number,
  label: string,
  structuredPixels: number
): void => {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected}, received ${actual}`
  ).toBeLessThanOrEqual(structuredPixels);
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
    const role = ['top', 'middle', 'base'].find((candidate) =>
      id.endsWith(`-${candidate}`)
    );
    if (!role) throw new Error(`Unrecognized compound card id: ${id}`);
    return role;
  }) ?? null;

const phaseMap = (entry: LegacyCompoundRotationCase) =>
  new Map(entry.phases.map((phase) => [phase.name, phase]));

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

const rectFromTuple = ([x, y, width, height]: RectTuple): CapturedRect => ({
  x,
  y,
  width,
  height,
});

const pointFromTuple = (point: PointTuple): CapturedPoint | null =>
  point ? { x: point[0], y: point[1] } : null;

const expectPoint = (
  actual: CapturedPoint,
  expected: CapturedPoint,
  label: string,
  anchorPixels: number
): void => {
  for (const key of ['x', 'y'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(anchorPixels);
  }
};

const hitRegionNames = [
  'commonOverlap',
  'topOnly',
  'middleAndBaseOverlap',
  'baseOnly',
  'topPaintedOnly',
  'topAuthoredOnly',
] as const;

test('compound rotation oracles pin every claimed legacy source and asset digest', async () => {
  for (const oracle of [groupOracle, breakOracle]) {
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
    const dependencyPaths = oracle.dependencies.map((entry) => entry.path);
    expect(new Set(dependencyPaths).size).toBe(dependencyPaths.length);
    for (const entry of oracle.dependencies) {
      const source = await readFile(`${repositoryRoot}${entry.path}`, 'utf8');
      expect(
        createHash('sha256')
          .update(source.replaceAll('\r\n', '\n'))
          .digest('hex'),
        entry.path
      ).toBe(entry.sha256);
    }
    expect(oracle.expected.frames).toEqual(evolutionOracle.expected.frames);
    expect(oracle.expected.frameTransforms).toEqual(
      evolutionOracle.expected.frameTransforms
    );
    for (const slot of ['active', 'bench'] as const) {
      const own = oracle.expected.slotMetrics[slot];
      const evolution = evolutionOracle.expected.slotMetrics[slot];
      expect(own).toMatchObject({
        clientWidth: evolution.topClientWidth,
        clientHeight: evolution.topClientHeight,
        paintedWidthQ0: evolution.cardWidth,
        paintedHeightQ0: evolution.cardHeight,
        middleBottomPx: evolution.middleBottomPx,
        baseBottomPx: evolution.baseBottomPx,
      });
    }
  }
});

test('checked-in legacy compound stacks preserve ordinary and BREAK rotation histories', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source compound-rotation checkpoint is Chromium-specific.'
  );
  await page.setViewportSize(groupOracle.input.viewport);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
    groupOracle.input.viewport.devicePixelRatio
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

  const capture = await captureLegacySourceCompoundRotationFixture(page);
  await testInfo.attach('legacy-source-compound-rotation.json', {
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
  expect(capture.ordinaryGroupCases.map((entry) => entry.id)).toEqual(
    groupOracle.input.cases
  );
  expect(capture.breakGroupCases.map((entry) => entry.id)).toEqual(
    breakOracle.input.cases
  );
  expect(capture.lowerGroupInitiatorCases).toEqual([]);
  expect(capture.lowerQ0SingleCases).toEqual([]);
  expect(capture.lowerReturnedQ0SingleCases).toEqual([]);
  expect(capture.lowerHistoryAuthoredQ0SingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupSingleCases).toEqual([]);
  expect(capture.nonzeroGroupSingleCases).toEqual([]);
  expect(capture.breakRefreshCases).toEqual([]);
  for (const side of ['local', 'opponent'] as const) {
    expectRect(
      capture.frames[side],
      groupOracle.expected.frames[side],
      `${side}.frame`,
      groupOracle.tolerances
    );
    const expectedTransform = groupOracle.expected.frameTransforms[side];
    for (const key of ['a', 'b', 'c', 'd'] as const) {
      expectStructured(
        capture.frameTransforms[side][key],
        expectedTransform[key],
        `${side}.frameTransform.${key}`,
        groupOracle.tolerances.structuredPixels
      );
    }
    expect(
      modularDegreesBetween(
        capture.frameTransforms[side].rotationDegrees,
        expectedTransform.rotationDegrees
      )
    ).toBeLessThanOrEqual(groupOracle.tolerances.rotationDegrees);
  }

  const assertCase = (
    entry: LegacyCompoundRotationCase,
    oracle: typeof groupOracle | typeof breakOracle
  ) => {
    const expectedQuarterTurns = oracle.expected.localQuarterTurns as Record<
      string,
      Record<'top' | 'middle' | 'base', number>
    >;
    const expectedMargins = oracle.expected.inlineMargins[
      entry.slot
    ] as unknown as Record<string, readonly [string, string]>;
    const expectedTopology = oracle.expected.topology;
    const slotMetrics = oracle.expected.slotMetrics[entry.slot];
    const expectOracleRect = (
      actual: CapturedRect,
      expected: CapturedRect,
      label: string
    ) => expectRect(actual, expected, label, oracle.tolerances);
    const expectOracleStructured = (
      actual: number,
      expected: number,
      label: string
    ) =>
      expectStructured(
        actual,
        expected,
        label,
        oracle.tolerances.structuredPixels
      );
    const expectOraclePoint = (
      actual: CapturedPoint,
      expected: CapturedPoint,
      label: string
    ) => expectPoint(actual, expected, label, oracle.tolerances.anchorPixels);
    const phaseEvidence = new Map(
      (
        oracle.expected.phaseEvidenceBySlot[
          entry.slot
        ] as unknown as readonly PhaseEvidenceTuple[]
      ).map((evidence) => [evidence[0], evidence])
    );
    expect(entry.phases.map((phase) => phase.name)).toEqual(
      oracle.input.phaseSequence
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
    ).toBeGreaterThanOrEqual(oracle.expected.refresh.observerPairsCreated);
    expect(entry.observers.resizeCallbacksAfterCardRemoval).toBeGreaterThan(
      entry.observers.resizeCallbacksBeforeCardRemoval
    );
    expect(entry.cleanup).toEqual({
      observedWrapperCount: 0,
      observedCardCount: 0,
      sinkConnected: false,
    });
    expect(
      entry.callTrace.map((call) => call.replaceAll(`${entry.id}-`, ''))
    ).toEqual(oracle.expected.operationTrace);
    expect(
      entry.callTrace.some((call) =>
        call.includes(
          `refresh:${entry.id}-top:break=${String(
            entry.scenario === 'breakGroup'
          )}:groupTurns=1`
        )
      )
    ).toBe(true);

    for (const phase of entry.phases) {
      const phaseRotations = expectedQuarterTurns[phase.name];
      const phaseMargins = expectedMargins[phase.name];
      const evidence = phaseEvidence.get(phase.name);
      if (!phaseRotations || !phaseMargins || !evidence) {
        throw new Error(`Missing ${entry.id} oracle phase ${phase.name}`);
      }
      const expectedStackRect = rectFromTuple(evidence[1]);
      expectOracleRect(
        phase.stack.frameLocalBounds,
        expectedStackRect,
        `${entry.id}.${phase.name}.goldenStack`
      );
      expect(phase.wrapperCount).toBe(1);
      expect([
        phase.stack.inlineMarginRight,
        phase.stack.inlineMarginLeft,
      ]).toEqual(phaseMargins);
      expect(phase.stack.clientWidth).toBe(slotMetrics.clientWidth);
      expect(phase.stack.clientHeight).toBe(slotMetrics.clientHeight);
      expect(phase.stack.offsetWidth).toBe(slotMetrics.clientWidth);
      expect(phase.stack.offsetHeight).toBe(slotMetrics.clientHeight);
      expect(phase.stack.authoredWidthPx).toBe(slotMetrics.clientWidth);
      expectOracleStructured(
        phase.stack.computedWidthPx,
        slotMetrics.clientWidth,
        `${entry.id}.${phase.name}.computedWidth`
      );
      expectOracleStructured(
        phase.stack.computedHeightPx,
        slotMetrics.paintedHeightQ0,
        `${entry.id}.${phase.name}.computedHeight`
      );
      const expectedRightMargin =
        phaseMargins[0] === '3%'
          ? oracle.expected.computedMarginPixels.benchThreePercentRight
          : entry.slot === 'active'
            ? phaseMargins[0] === '1%'
              ? oracle.expected.computedMarginPixels.activeOnePercentRight
              : oracle.expected.computedMarginPixels.activeDefaultRight
            : phaseMargins[0] === '1%'
              ? oracle.expected.computedMarginPixels.benchOnePercentRight
              : oracle.expected.computedMarginPixels.benchDefaultRight;
      const expectedLeftMargin =
        phaseMargins[1] === '2%'
          ? oracle.expected.computedMarginPixels.benchTwoPercentLeft
          : 0;
      expectOracleStructured(
        phase.stack.computedMarginRightPx,
        expectedRightMargin,
        `${entry.id}.${phase.name}.marginRight`
      );
      expectOracleStructured(
        phase.stack.computedMarginLeftPx,
        expectedLeftMargin,
        `${entry.id}.${phase.name}.marginLeft`
      );
      expect(roleOrder(phase.stack.logicalOrder)).toEqual(
        expectedTopology.logicalRoles
      );
      expect(phase.stack.transform).toBe(expectedTopology.wrapperTransform);
      expect(phase.stack.zIndex).toBe(expectedTopology.wrapperZIndex);
      expect(roleOrder(phase.stack.childDomOrder)).toEqual(
        expectedTopology.domRoles
      );
      expect(roleOrder(phase.stack.hitOrder.commonOverlap)).toEqual(
        expectedTopology.logicalRoles
      );
      expect(roleOrder(phase.stack.hitOrder.topOnly)).toEqual(['top']);
      expect(roleOrder(phase.stack.hitOrder.middleAndBaseOverlap)).toEqual([
        'middle',
        'base',
      ]);
      expect(roleOrder(phase.stack.hitOrder.baseOnly)).toEqual(['base']);
      expectOracleRect(
        phase.stack.physicalBounds,
        physicalRect(
          entry.side,
          oracle.expected.frames[entry.side],
          expectedStackRect
        ),
        `${entry.id}.${phase.name}.goldenStackPhysical`
      );
      for (const [index, key] of hitRegionNames.entries()) {
        const expectedPoint = pointFromTuple(evidence[3][index] ?? null);
        const actualPoint = phase.stack.hitPointsFrameLocal[key];
        const actualPhysicalPoint = phase.stack.hitPointsPhysical[key];
        if (expectedPoint === null) {
          expect(actualPoint, `${entry.id}.${phase.name}.${key}`).toBeNull();
          expect(
            actualPhysicalPoint,
            `${entry.id}.${phase.name}.${key}.physical`
          ).toBeNull();
        } else {
          if (!actualPoint || !actualPhysicalPoint) {
            throw new Error(
              `Missing ${entry.id}.${phase.name}.${key} captured hit point`
            );
          }
          expectOraclePoint(
            actualPoint,
            expectedPoint,
            `${entry.id}.${phase.name}.${key}.golden`
          );
          expectOraclePoint(
            actualPhysicalPoint,
            physicalPoint(
              entry.side,
              oracle.expected.frames[entry.side],
              expectedPoint
            ),
            `${entry.id}.${phase.name}.${key}.goldenPhysical`
          );
        }
      }

      const phaseHasAction = ![
        'pristine-q0',
        'q1-refreshed',
        'break-group-q1-refreshed',
      ].includes(phase.name);
      if (phaseHasAction) {
        expect(phase.action).toEqual({
          selectedCardId: `${entry.id}-top`,
          selectedRole: 'top',
          indexBefore: 0,
          single: phase.name === 'break-on-q0' || phase.name === 'break-off-q0',
        });
      } else {
        expect(phase.action).toBeNull();
      }
      const breakFlags =
        'topBreakFlag' in oracle.expected
          ? (oracle.expected.topBreakFlag as Record<string, boolean>)
          : null;
      for (const [cardIndex, card] of phase.cards.entries()) {
        const quarterTurns = phaseRotations[card.role];
        const degrees = quarterTurns * 90;
        expect(card.naturalWidth).toBe(oracle.input.asset.naturalWidth);
        expect(card.naturalHeight).toBe(oracle.input.asset.naturalHeight);
        expect(card.clientWidth).toBe(slotMetrics.clientWidth);
        expect(card.clientHeight).toBe(slotMetrics.clientHeight);
        expect(card.imageType).toBe('Pokémon');
        expect(card.sourcePath).toBe(oracle.input.asset.path);
        const transformOrigin = card.transformOrigin
          .split(' ')
          .map((value) => Number.parseFloat(value));
        expect(transformOrigin).toHaveLength(2);
        expectOracleStructured(
          transformOrigin[0] ?? Number.NaN,
          oracle.expected.slotMetrics[entry.slot].transformOriginPx[0],
          `${card.id}.${phase.name}.transformOriginX`
        );
        expectOracleStructured(
          transformOrigin[1] ?? Number.NaN,
          oracle.expected.slotMetrics[entry.slot].transformOriginPx[1],
          `${card.id}.${phase.name}.transformOriginY`
        );
        expect(card.inlineTransform).toBe(`rotate(${degrees}deg)`);
        expect(
          modularDegreesBetween(card.localRotationDegrees, degrees)
        ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
        expect(
          modularDegreesBetween(
            card.effectiveRotationDegrees,
            degrees + oracle.expected.frameRotationDegrees[entry.side]
          )
        ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
        expect(card.energyLayer).toBe(expectedTopology.energyLayer);
        const expectedRoleState = {
          top: {
            zIndex: expectedTopology.zByRole.top,
            layer: expectedTopology.topLayer,
            inlineBottomPx: 0,
            position: 'relative',
            attached: false,
            target: 'off',
            relativeId: null,
            domOrdinal: 0,
            logicalOrdinal: 0,
          },
          middle: {
            zIndex: expectedTopology.zByRole.middle,
            layer: 0,
            inlineBottomPx: slotMetrics.middleBottomPx,
            position: 'absolute',
            attached: true,
            target: 'on',
            relativeId: `${entry.id}-top`,
            domOrdinal: 2,
            logicalOrdinal: 1,
          },
          base: {
            zIndex: expectedTopology.zByRole.base,
            layer: 0,
            inlineBottomPx: slotMetrics.baseBottomPx,
            position: 'absolute',
            attached: true,
            target: 'on',
            relativeId: `${entry.id}-top`,
            domOrdinal: 1,
            logicalOrdinal: 2,
          },
        }[card.role];
        expect(card).toMatchObject({
          ...expectedRoleState,
          inlineLeftPx: 0,
          pokemonBreak:
            card.role === 'top' && breakFlags ? breakFlags[phase.name] : false,
        });
        expectOracleStructured(
          card.untransformedFrameLocalBounds.width,
          slotMetrics.paintedWidthQ0,
          `${card.id}.${phase.name}.authoredWidth`
        );
        expectOracleStructured(
          card.untransformedFrameLocalBounds.height,
          slotMetrics.paintedHeightQ0,
          `${card.id}.${phase.name}.authoredHeight`
        );
        const expectedCardTuple = evidence[2][cardIndex];
        if (!expectedCardTuple) {
          throw new Error(
            `Missing ${entry.id}.${phase.name}.${card.role} golden card rect`
          );
        }
        const expectedCardRect = rectFromTuple(expectedCardTuple);
        expectOracleRect(
          card.frameLocalBounds,
          expectedCardRect,
          `${card.id}.${phase.name}.goldenPainted`
        );
        const authored = card.untransformedFrameLocalBounds;
        const expectedPainted =
          quarterTurns % 2 === 0
            ? authored
            : {
                x: authored.x - (authored.height - authored.width) / 2,
                y: authored.y + (authored.height - authored.width) / 2,
                width: authored.height,
                height: authored.width,
              };
        expectOracleRect(
          card.frameLocalBounds,
          expectedPainted,
          `${card.id}.${phase.name}.paintedFormula`
        );
        expectOracleRect(
          card.physicalBounds,
          physicalRect(
            entry.side,
            oracle.expected.frames[entry.side],
            expectedCardRect
          ),
          `${card.id}.${phase.name}.goldenPhysical`
        );
      }
      const topQuarterTurns = phaseRotations.top;
      if (topQuarterTurns % 2 === 1) {
        expect(phase.stack.hitPointsFrameLocal.topPaintedOnly).not.toBeNull();
        expect(phase.stack.hitOrder.topPaintedOnly).toContain(
          `${entry.id}-top`
        );
        expect(phase.stack.hitPointsFrameLocal.topAuthoredOnly).not.toBeNull();
        expect(phase.stack.hitOrder.topAuthoredOnly).not.toContain(
          `${entry.id}-top`
        );
        const lowerCardsShareTopRotation =
          phaseRotations.middle === topQuarterTurns &&
          phaseRotations.base === topQuarterTurns;
        expect(roleOrder(phase.stack.hitOrder.topPaintedOnly)).toEqual(
          lowerCardsShareTopRotation ? ['top', 'middle', 'base'] : ['top']
        );
        expect(roleOrder(phase.stack.hitOrder.topAuthoredOnly)).toEqual(
          lowerCardsShareTopRotation ? ['base'] : ['middle', 'base']
        );
      } else {
        expect(phase.stack.hitPointsFrameLocal.topPaintedOnly).toBeNull();
        expect(phase.stack.hitPointsFrameLocal.topAuthoredOnly).toBeNull();
        expect(phase.stack.hitOrder.topPaintedOnly).toBeNull();
        expect(phase.stack.hitOrder.topAuthoredOnly).toBeNull();
      }
    }

    const phases = phaseMap(entry);
    const q1 = phases.get(
      entry.scenario === 'ordinaryGroup' ? 'q1' : 'break-group-q1'
    );
    const q1Refreshed = phases.get(
      entry.scenario === 'ordinaryGroup'
        ? 'q1-refreshed'
        : 'break-group-q1-refreshed'
    );
    if (!q1 || !q1Refreshed) throw new Error(`Missing q1 pair for ${entry.id}`);
    expect(q1Refreshed.cards).toEqual(q1.cards);
    expect(q1Refreshed.stack).toEqual(q1.stack);

    if (entry.scenario === 'breakGroup') {
      const firstBreak = phases.get('break-on-q0');
      const returnedBreak = phases.get('break-group-q0-return');
      if (!firstBreak || !returnedBreak) {
        throw new Error(`Missing BREAK q0 pair for ${entry.id}`);
      }
      expect(
        firstBreak.cards.map((card) => [
          card.role,
          card.localRotationDegrees,
          card.pokemonBreak,
        ])
      ).toEqual(
        returnedBreak.cards.map((card) => [
          card.role,
          card.localRotationDegrees,
          card.pokemonBreak,
        ])
      );
      if (entry.slot === 'active') {
        expect(
          Math.abs(
            firstBreak.stack.frameLocalBounds.x -
              returnedBreak.stack.frameLocalBounds.x
          )
        ).toBeGreaterThan(1);
      } else {
        expectOracleRect(
          returnedBreak.stack.frameLocalBounds,
          firstBreak.stack.frameLocalBounds,
          `${entry.id}.returnedBreakGeometry`
        );
      }
    }
  };

  for (const entry of capture.ordinaryGroupCases) {
    assertCase(entry, groupOracle);
  }
  for (const entry of capture.breakGroupCases) {
    assertCase(entry, breakOracle);
  }
  expect(runtimeErrors).toEqual([]);
});
