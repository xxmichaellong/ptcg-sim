import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json' with { type: 'json' };
import groupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json' with { type: 'json' };
import oracle from '../legacy-fixtures/renderer/compound-lower-group-rotation-v1.json' with { type: 'json' };

import {
  captureLegacySourceCompoundLowerGroupInitiatorFixture,
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
type Composition = 'ordinary' | 'break';
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

const scenarioMetadata = oracle.expected.scenario as unknown as Record<
  Scenario,
  {
    readonly composition: Composition;
    readonly selectedRole: 'middle' | 'base';
    readonly selectedIndex: 1 | 2;
    readonly selectedDomOrdinal: 1 | 2;
    readonly selectionHitRegion: 'middleAndBaseOverlap' | 'baseOnly';
  }
>;
const stackXByCompositionAndSlot = oracle.expected
  .stackXByCompositionAndSlot as unknown as Record<
  `${Composition}:${'active' | 'bench'}`,
  readonly number[]
>;
const marginsByCompositionAndSlot = oracle.expected
  .inlineMarginsByCompositionAndSlot as unknown as Record<
  `${Composition}:${'active' | 'bench'}`,
  readonly (readonly [string, string])[]
>;
const operationTraceByScenario = oracle.expected
  .operationTraceByScenario as unknown as Record<Scenario, readonly string[]>;

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

test('lower group-initiator oracle pins ingress, rotation, and compound dependencies', async () => {
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

test('checked-in legacy lower evolutions initiate coherent but history-sensitive group cycles', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-initiator checkpoint is Chromium-specific.'
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
    await captureLegacySourceCompoundLowerGroupInitiatorFixture(page);
  await testInfo.attach('legacy-source-compound-lower-group-initiator.json', {
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
  expect(capture.lowerQ0SingleCases).toEqual([]);
  expect(capture.lowerReturnedQ0SingleCases).toEqual([]);
  expect(capture.lowerHistoryAuthoredQ0SingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupSingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupSingleFollowupCases).toEqual([]);
  expect(capture.lowerNonzeroGroupRotationAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupRefreshAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroSameLowerGroupAfterSingleCases).toEqual([]);
  expect(capture.nonzeroGroupSingleCases).toEqual([]);
  expect(capture.breakRefreshCases).toEqual([]);
  expect(capture.lowerGroupInitiatorCases.map((entry) => entry.id)).toEqual(
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

  for (const entry of capture.lowerGroupInitiatorCases) {
    const scenario = entry.scenario as Scenario;
    const metadata = scenarioMetadata[scenario];
    const dependency =
      metadata.composition === 'ordinary' ? groupOracle : breakOracle;
    const expectedPhaseNames =
      oracle.input.phaseSequences[metadata.composition];
    const expectedTurns = dependency.expected.localQuarterTurns as Record<
      string,
      Record<(typeof roles)[number], number>
    >;
    const expectedBreakFlags =
      metadata.composition === 'break'
        ? (breakOracle.expected.topBreakFlag as Record<string, boolean>)
        : null;
    const expectedX =
      stackXByCompositionAndSlot[`${metadata.composition}:${entry.slot}`];
    const expectedMargins =
      marginsByCompositionAndSlot[`${metadata.composition}:${entry.slot}`];
    const dependencyEvidence = new Map(
      (
        dependency.expected.phaseEvidenceBySlot[
          entry.slot
        ] as unknown as readonly PhaseEvidenceTuple[]
      ).map((phase) => [phase[0], phase])
    );
    const slotMetrics = dependency.expected.slotMetrics[entry.slot];

    expect(entry.phases.map((phase) => phase.name)).toEqual(expectedPhaseNames);
    expect(normalizedTrace(entry, entry.callTrace)).toEqual(
      operationTraceByScenario[scenario]
    );
    expect(entry.transitionTrace).toEqual([]);
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

    const selectionPhase = entry.phases[0];
    if (!selectionPhase) throw new Error(`Missing ${entry.id} selection phase`);
    expect(
      roleOrder(selectionPhase.stack.hitOrder[metadata.selectionHitRegion])
    ).toContain(metadata.selectedRole);

    for (const [phaseIndex, phase] of entry.phases.entries()) {
      const evidence = dependencyEvidence.get(phase.name);
      const phaseTurns = expectedTurns[phase.name];
      const phaseX = expectedX[phaseIndex];
      const margins = expectedMargins[phaseIndex];
      if (!evidence || !phaseTurns || phaseX === undefined || !margins) {
        throw new Error(`Missing ${entry.id}.${phase.name} oracle evidence`);
      }
      const dependencyStack = rectFromTuple(evidence[1]);
      const expectedStack = { ...dependencyStack, x: phaseX };
      const xDelta = phaseX - dependencyStack.x;
      expectStructured(
        phase.stack.frameLocalBounds.x,
        phaseX,
        `${entry.id}.${phase.name}.stack.x`
      );
      expectRect(
        phase.stack.frameLocalBounds,
        expectedStack,
        `${entry.id}.${phase.name}.stack`
      );
      expectRect(
        phase.stack.physicalBounds,
        physicalRect(entry.side, capture.frames[entry.side], expectedStack),
        `${entry.id}.${phase.name}.stack.physical`
      );
      expect(phase.wrapperCount).toBe(1);
      expect([
        phase.stack.inlineMarginRight,
        phase.stack.inlineMarginLeft,
      ]).toEqual(margins);
      expect(phase.stack.clientWidth).toBe(slotMetrics.clientWidth);
      expect(phase.stack.clientHeight).toBe(slotMetrics.clientHeight);
      expect(phase.stack.offsetWidth).toBe(slotMetrics.clientWidth);
      expect(phase.stack.offsetHeight).toBe(slotMetrics.clientHeight);
      expect(phase.stack.authoredWidthPx).toBe(slotMetrics.clientWidth);
      expect(roleOrder(phase.stack.logicalOrder)).toEqual(
        oracle.expected.topology.logicalRoles
      );
      expect(roleOrder(phase.stack.childDomOrder)).toEqual(
        oracle.expected.topology.domRoles
      );
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

      for (const [hitIndex, hitName] of hitRegionNames.entries()) {
        const dependencyPoint = pointFromTuple(evidence[3][hitIndex]);
        const actualPoint = phase.stack.hitPointsFrameLocal[hitName];
        if (dependencyPoint === null) {
          expect(
            actualPoint,
            `${entry.id}.${phase.name}.${hitName}`
          ).toBeNull();
          expect(phase.stack.hitPointsPhysical[hitName]).toBeNull();
        } else {
          if (!actualPoint) {
            throw new Error(`Missing ${entry.id}.${phase.name}.${hitName}`);
          }
          const expectedPoint = {
            x: dependencyPoint.x + xDelta,
            y: dependencyPoint.y,
          };
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
            physicalPoint(entry.side, capture.frames[entry.side], actualPoint),
            `${entry.id}.${phase.name}.${hitName}.physical`
          );
        }
      }

      const isBreakToggle =
        phase.name === 'break-on-q0' || phase.name === 'break-off-q0';
      const isRefreshPhase =
        phase.name === 'q1-refreshed' ||
        phase.name === 'break-group-q1-refreshed';
      if (phase.name === 'pristine-q0' || isRefreshPhase) {
        expect(phase.action).toBeNull();
      } else {
        const selectedRole = isBreakToggle ? 'top' : metadata.selectedRole;
        expect(phase.action).toEqual({
          selectedCardId: `${entry.id}-${selectedRole}`,
          selectedRole,
          indexBefore: isBreakToggle ? 0 : metadata.selectedIndex,
          single: isBreakToggle,
        });
      }

      for (const [cardIndex, role] of roles.entries()) {
        const card = phase.cards.find((candidate) => candidate.role === role);
        const dependencyCard = evidence[2][cardIndex];
        if (!card || !dependencyCard) {
          throw new Error(`Missing ${entry.id}.${phase.name}.${role}`);
        }
        const dependencyCardRect = rectFromTuple(dependencyCard);
        const expectedCard = {
          ...dependencyCardRect,
          x: dependencyCardRect.x + xDelta,
        };
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expectStructured(
            card.frameLocalBounds[key],
            expectedCard[key],
            `${entry.id}.${phase.name}.${role}.${key}`
          );
        }
        expectRect(
          card.physicalBounds,
          physicalRect(entry.side, capture.frames[entry.side], expectedCard),
          `${entry.id}.${phase.name}.${role}.physical`
        );
        expect(card.localRotationDegrees / 90).toBe(phaseTurns[role]);
        expect(card.pokemonBreak).toBe(
          role === 'top' && expectedBreakFlags
            ? expectedBreakFlags[phase.name]
            : false
        );
        expect(card.naturalWidth).toBe(oracle.input.asset.naturalWidth);
        expect(card.naturalHeight).toBe(oracle.input.asset.naturalHeight);
        expect(card.sourcePath).toBe(oracle.input.asset.path);
        expect(card.imageType).toBe('Pokémon');
        expect(card.energyLayer).toBe(oracle.expected.topology.energyLayer);
        expect(card.zIndex).toBe(oracle.expected.topology.zByRole[role]);
        expect(card.layer).toBe(
          role === 'top' ? oracle.expected.topology.topLayer : 0
        );
        expect(card.domOrdinal).toBe(
          oracle.expected.topology.domRoles.indexOf(role)
        );
        expect(card.logicalOrdinal).toBe(
          oracle.expected.topology.logicalRoles.indexOf(role)
        );
        const lowerStep = slotMetrics.middleBottomPx;
        expectStructured(
          card.inlineBottomPx,
          lowerStep * oracle.expected.topology.bottomLayerMultipliers[role],
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
        expect(card).toMatchObject({
          ...expectedRoleState,
          inlineLeftPx: 0,
        });
      }

      const topTurns = phaseTurns.top;
      if (topTurns % 2 === 1) {
        const lowerShareTop =
          phaseTurns.middle === topTurns && phaseTurns.base === topTurns;
        expect(roleOrder(phase.stack.hitOrder.topPaintedOnly)).toEqual(
          lowerShareTop ? ['top', 'middle', 'base'] : ['top']
        );
        expect(roleOrder(phase.stack.hitOrder.topAuthoredOnly)).toEqual(
          lowerShareTop ? ['base'] : ['middle', 'base']
        );
      } else {
        expect(phase.stack.hitOrder.topPaintedOnly).toBeNull();
        expect(phase.stack.hitOrder.topAuthoredOnly).toBeNull();
      }
    }
  }

  expect(runtimeErrors).toEqual([]);
});
