import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json' with { type: 'json' };
import refreshOracle from '../legacy-fixtures/renderer/compound-break-refresh-q0-q2-v1.json' with { type: 'json' };
import oracle from '../legacy-fixtures/renderer/compound-break-refresh-q3-v1.json' with { type: 'json' };

import {
  captureLegacySourceCompoundBreakRefreshQ3Fixture,
  type CapturedPoint,
  type CapturedRect,
  type LegacyCompoundRotationCase,
  type LegacyFixtureSide,
} from './support/legacy-source-board.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

type RectTuple = readonly [number, number, number, number];
type PointTuple = readonly [number, number] | null;
type StackTuple = readonly [
  x: number,
  y: number,
  width: number,
  height: number,
  clientWidth: number,
  clientHeight: number,
  offsetWidth: number,
  offsetHeight: number,
  computedWidth: number,
  computedHeight: number,
  authoredWidth: number,
  inlineRight: string,
  inlineLeft: string,
  computedRight: number,
  computedLeft: number,
];
type CardTuple = readonly [
  paintedX: number,
  paintedY: number,
  paintedWidth: number,
  paintedHeight: number,
  authoredX: number,
  authoredY: number,
  authoredWidth: number,
  authoredHeight: number,
];
type PhaseEvidenceTuple = readonly [
  name: string,
  stack: StackTuple,
  cards: readonly [CardTuple, CardTuple, CardTuple],
  hitPoints: readonly [
    PointTuple,
    PointTuple,
    PointTuple,
    PointTuple,
    PointTuple,
    PointTuple,
  ],
];

const roles = ['top', 'middle', 'base'] as const;
const hitRegionNames = [
  'commonOverlap',
  'topOnly',
  'middleAndBaseOverlap',
  'baseOnly',
  'topPaintedOnly',
  'topAuthoredOnly',
] as const;

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

const phaseEvidenceBySlot = oracle.expected
  .phaseEvidenceBySlot as unknown as Record<
  'active' | 'bench',
  readonly PhaseEvidenceTuple[]
>;

test('BREAK q3 refresh oracle pins direct sources and its complete dependency chain', async () => {
  for (const manifest of [oracle, refreshOracle, breakOracle]) {
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
  expect(oracle.expected.frames).toEqual(refreshOracle.expected.frames);
  expect(oracle.expected.frameTransforms).toEqual(
    refreshOracle.expected.frameTransforms
  );
});

test('checked-in legacy BREAK q3 refresh synchronously collapses the group orientation', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source BREAK q3 refresh checkpoint is Chromium-specific.'
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

  const capture = await captureLegacySourceCompoundBreakRefreshQ3Fixture(page);
  await testInfo.attach('legacy-source-compound-break-refresh-q3.json', {
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
  expect(capture.breakRefreshCases.map((entry) => entry.id)).toEqual(
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
    expect(entry.scenario).toBe('breakRefreshQ3');
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
      oracle.expected.operationTrace
    );
    expect(normalizedTrace(entry, entry.transitionTrace)).toEqual(
      oracle.expected.transitionTrace
    );
    expect(
      entry.transitionTrace.filter((trace) => trace.includes('replay-rotate:'))
    ).toEqual([]);

    const expectedPhases = phaseEvidenceBySlot[entry.slot];
    for (const [phaseIndex, phase] of entry.phases.entries()) {
      const evidence = expectedPhases[phaseIndex];
      if (!evidence || evidence[0] !== phase.name) {
        throw new Error(`Missing ${entry.id}.${phase.name} oracle evidence`);
      }
      const stack = evidence[1];
      const expectedStackRect = rectFromTuple(
        stack.slice(0, 4) as unknown as RectTuple
      );
      expect(phase.action).toBeNull();
      expectRect(
        phase.stack.frameLocalBounds,
        expectedStackRect,
        `${entry.id}.${phase.name}.stack`
      );
      expect([phase.stack.clientWidth, phase.stack.clientHeight]).toEqual(
        stack.slice(4, 6)
      );
      expect([phase.stack.offsetWidth, phase.stack.offsetHeight]).toEqual(
        stack.slice(6, 8)
      );
      expectStructured(
        phase.stack.computedWidthPx,
        stack[8],
        `${entry.id}.${phase.name}.computedWidth`
      );
      expectStructured(
        phase.stack.computedHeightPx,
        stack[9],
        `${entry.id}.${phase.name}.computedHeight`
      );
      expect(phase.stack.authoredWidthPx).toBe(stack[10]);
      expect([
        phase.stack.inlineMarginRight,
        phase.stack.inlineMarginLeft,
      ]).toEqual(stack.slice(11, 13));
      expectStructured(
        phase.stack.computedMarginRightPx,
        stack[13],
        `${entry.id}.${phase.name}.computedMarginRight`
      );
      expectStructured(
        phase.stack.computedMarginLeftPx,
        stack[14],
        `${entry.id}.${phase.name}.computedMarginLeft`
      );
      expect(phase.stack.transform).toBe(topology.wrapperTransform);
      expect(phase.stack.zIndex).toBe(topology.wrapperZIndex);
      expect(roleOrder(phase.stack.logicalOrder)).toEqual(
        topology.logicalRoles
      );
      expect(roleOrder(phase.stack.childDomOrder)).toEqual(topology.domRoles);
      const expectedHitOrder =
        oracle.expected.hitOrderByPhase[
          phase.name as keyof typeof oracle.expected.hitOrderByPhase
        ];
      for (const key of hitRegionNames) {
        expect(roleOrder(phase.stack.hitOrder[key])).toEqual(
          expectedHitOrder[key]
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
        const expectedPointTuple = evidence[3][hitIndex];
        const actualLocal = phase.stack.hitPointsFrameLocal[key];
        const actualPhysical = phase.stack.hitPointsPhysical[key];
        if (expectedPointTuple === null) {
          expect(actualLocal, `${entry.id}.${phase.name}.${key}`).toBeNull();
          expect(
            actualPhysical,
            `${entry.id}.${phase.name}.${key}.physical`
          ).toBeNull();
          continue;
        }
        if (!actualLocal || !actualPhysical) {
          throw new Error(`Missing ${entry.id}.${phase.name}.${key} hit point`);
        }
        const expectedLocal = {
          x: expectedPointTuple[0],
          y: expectedPointTuple[1],
        };
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

      const expectedQuarterTurns =
        oracle.expected.localQuarterTurnsByPhase[
          phase.name as keyof typeof oracle.expected.localQuarterTurnsByPhase
        ];
      for (const [cardIndex, card] of phase.cards.entries()) {
        const role = roles[cardIndex];
        if (!role) throw new Error(`Unexpected card ${card.id}`);
        const quarterTurns = expectedQuarterTurns[role];
        const degrees = quarterTurns * 90;
        const inlineBottomPx =
          breakOracle.expected.slotMetrics[entry.slot].middleBottomPx *
          topology.bottomLayerMultipliers[role];
        expect(card).toMatchObject({
          role,
          naturalWidth: oracle.input.asset.naturalWidth,
          naturalHeight: oracle.input.asset.naturalHeight,
          clientWidth: stack[4],
          clientHeight: stack[5],
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
        });
        expectStructured(
          card.inlineBottomPx,
          inlineBottomPx,
          `${card.id}.${phase.name}.inlineBottom`
        );
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
        const cardTuple = evidence[2][cardIndex];
        const expectedPainted = rectFromTuple(
          cardTuple.slice(0, 4) as unknown as RectTuple
        );
        const expectedAuthored = rectFromTuple(
          cardTuple.slice(4, 8) as unknown as RectTuple
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

    expect(
      entry.phases.map((phase) =>
        phase.cards.map((card) => card.localRotationDegrees)
      )
    ).toEqual([
      [0, 270, 270],
      [90, 0, 0],
      [90, 0, 0],
    ]);
    expect(
      entry.phases[0]!.stack.hitPointsFrameLocal.topPaintedOnly
    ).toBeNull();
    expect(
      entry.phases[1]!.stack.hitPointsFrameLocal.topPaintedOnly
    ).not.toBeNull();
  }
  expect(runtimeErrors).toEqual([]);
});
