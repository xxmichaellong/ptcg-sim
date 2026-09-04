import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json' with { type: 'json' };
import groupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json' with { type: 'json' };
import lowerGroupOracle from '../legacy-fixtures/renderer/compound-lower-group-rotation-v1.json' with { type: 'json' };
import oracle from '../legacy-fixtures/renderer/compound-lower-q0-single-v1.json' with { type: 'json' };

import {
  captureLegacySourceCompoundLowerQ0SingleFixture,
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
  'middlePaintedOnly',
  'middleAuthoredOnly',
  'basePaintedOnly',
  'baseAuthoredOnly',
] as const;

type Scenario = (typeof oracle.input.scenarioOrder)[number];
type Composition = 'ordinary' | 'break';
type Role = (typeof roles)[number];
type RectTuple = readonly [number, number, number, number];
type PointTuple = readonly [number, number] | null;
type PhaseEvidenceTuple = readonly [
  name: string,
  stackRect: RectTuple,
  cardRects: readonly [RectTuple, RectTuple, RectTuple],
  hitPoints: readonly PointTuple[],
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
const phaseEvidence = oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${Scenario}:${'active' | 'bench'}`,
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
const operationTraces = oracle.expected
  .operationTraceByScenario as unknown as Record<Scenario, readonly string[]>;
const transitionTraces = oracle.expected
  .transitionTraceByScenario as unknown as Record<Scenario, string>;
const margins = oracle.expected
  .inlineMarginsByCompositionAndSlot as unknown as Record<
  `${Composition}:${'active' | 'bench'}`,
  readonly (readonly [string, string])[]
>;
const authoredCardRects = oracle.expected
  .authoredCardRectsByCompositionAndSlot as unknown as Record<
  `${Composition}:${'active' | 'bench'}`,
  readonly (readonly [RectTuple, RectTuple, RectTuple])[]
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

const expectedHitRoles = (
  point: CapturedPoint,
  cardRects: readonly [RectTuple, RectTuple, RectTuple]
): readonly Role[] =>
  roles.filter((_, index) => {
    const tuple = cardRects[index];
    if (!tuple) throw new Error(`Missing expected card rectangle ${index}`);
    const bounds = rectFromTuple(tuple);
    return (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    );
  });

const pointInside = (point: CapturedPoint, bounds: CapturedRect): boolean =>
  point.x >= bounds.x &&
  point.x <= bounds.x + bounds.width &&
  point.y >= bounds.y &&
  point.y <= bounds.y + bounds.height;

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

test('lower q0 single-card oracle pins ingress, rotation, and compound dependencies', async () => {
  const manifests = [
    oracle,
    groupOracle,
    breakOracle,
    lowerGroupOracle,
  ] as const;
  for (const manifest of manifests) {
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
  expect(oracle.expected.frames).toEqual(breakOracle.expected.frames);
  expect(oracle.expected.frames).toEqual(lowerGroupOracle.expected.frames);
  expect(oracle.expected.frameTransforms).toEqual(
    groupOracle.expected.frameTransforms
  );
});

test('checked-in legacy lower q0 Alt-R assigns BREAK to the selected attached evolution', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source lower-q0 single-card checkpoint is Chromium-specific.'
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

  const capture = await captureLegacySourceCompoundLowerQ0SingleFixture(page);
  await testInfo.attach('legacy-source-compound-lower-q0-single.json', {
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
  expect(capture.lowerReturnedQ0SingleCases).toEqual([]);
  expect(capture.lowerHistoryAuthoredQ0SingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupSingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupSingleFollowupCases).toEqual([]);
  expect(capture.lowerNonzeroGroupRotationAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroGroupRefreshAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroSameLowerGroupAfterSingleCases).toEqual([]);
  expect(capture.nonzeroGroupSingleCases).toEqual([]);
  expect(capture.breakRefreshCases).toEqual([]);
  expect(capture.lowerQ0SingleCases.map((entry) => entry.id)).toEqual(
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

  for (const entry of capture.lowerQ0SingleCases) {
    const scenario = entry.scenario as Scenario;
    const metadata = scenarioMetadata[scenario];
    const evidence = phaseEvidence[`${scenario}:${entry.slot}`];
    const expectedMargins = margins[`${metadata.composition}:${entry.slot}`];
    const expectedAuthoredPhases =
      authoredCardRects[`${metadata.composition}:${entry.slot}`];
    const slotMetrics = groupOracle.expected.slotMetrics[entry.slot];
    if (!evidence || !expectedMargins || !expectedAuthoredPhases) {
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
    expect(entry.refresh).toBeNull();
    expect(entry.phases.map((phase) => phase.wrapperCount)).toEqual(
      oracle.expected.lifecycle.wrapperCountsByPhase
    );
    expect(new Set(entry.phases.map((phase) => phase.stack.id)).size).toBe(1);
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

    const selectionPhase = entry.phases[0];
    if (!selectionPhase)
      throw new Error(`Missing ${entry.id} pre-single phase`);
    expect(
      roleOrder(selectionPhase.stack.hitOrder[metadata.selectionHitRegion])
    ).toContain(metadata.selectedRole);

    for (const [phaseIndex, phase] of entry.phases.entries()) {
      const expectedPhase = evidence[phaseIndex];
      const expectedTurns = quarterTurns[scenario][phaseIndex];
      const expectedBreaks = breakFlags[scenario][phaseIndex];
      const expectedMargin = expectedMargins[phaseIndex];
      const expectedAuthoredCards = expectedAuthoredPhases[phaseIndex];
      if (
        !expectedPhase ||
        !expectedTurns ||
        !expectedBreaks ||
        !expectedMargin ||
        !expectedAuthoredCards
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
        physicalRect(entry.side, capture.frames[entry.side], expectedStack),
        `${entry.id}.${phase.name}.stack.physical`
      );
      expect([
        phase.stack.inlineMarginRight,
        phase.stack.inlineMarginLeft,
      ]).toEqual(expectedMargin);
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
        const cardTuple = expectedPhase[2][cardIndex];
        const authoredTuple = expectedAuthoredCards[cardIndex];
        if (!card || !cardTuple || !authoredTuple) {
          throw new Error(`Missing ${entry.id}.${phase.name}.${role}`);
        }
        const expectedCard = rectFromTuple(cardTuple);
        const expectedAuthored = rectFromTuple(authoredTuple);
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
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expectStructured(
            card.untransformedFrameLocalBounds[key],
            expectedAuthored[key],
            `${entry.id}.${phase.name}.${role}.authored.${key}`
          );
          expectStructured(
            card.frameLocalBounds[key],
            paintedFromAuthored(expectedAuthored, expectedTurns[role])[key],
            `${entry.id}.${phase.name}.${role}.painted-from-authored.${key}`
          );
        }
        expect(card.localRotationDegrees / 90).toBe(expectedTurns[role]);
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
          sourcePath: oracle.input.asset.path,
          imageType: 'Pokémon',
          energyLayer: oracle.expected.topology.energyLayer,
          zIndex: oracle.expected.topology.zByRole[role],
          layer: role === 'top' ? oracle.expected.topology.topLayer : 0,
          domOrdinal: oracle.expected.topology.domRoles.indexOf(role),
          logicalOrdinal: oracle.expected.topology.logicalRoles.indexOf(role),
          inlineLeftPx: 0,
        });
        expect(card.inlineTransform).toBe(
          `rotate(${expectedTurns[role] * 90}deg)`
        );
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
          expectedPhase[3][hitIndex] ?? null
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
          physicalPoint(entry.side, capture.frames[entry.side], actualPoint),
          `${entry.id}.${phase.name}.${hitName}.physical`
        );
        expect(roleOrder(phase.stack.hitOrder[hitName])).toEqual(
          expectedHitRoles(expectedPoint, expectedPhase[2])
        );
      }

      if (phaseIndex === 1) {
        const selectedPrefix = metadata.selectedRole;
        const otherPrefix = selectedPrefix === 'middle' ? 'base' : 'middle';
        for (const suffix of ['PaintedOnly', 'AuthoredOnly'] as const) {
          const selectedName = `${selectedPrefix}${suffix}` as
            | 'middlePaintedOnly'
            | 'middleAuthoredOnly'
            | 'basePaintedOnly'
            | 'baseAuthoredOnly';
          const otherName = `${otherPrefix}${suffix}` as typeof selectedName;
          expect(phase.stack.hitPointsFrameLocal[selectedName]).not.toBeNull();
          expect(phase.stack.hitPointsFrameLocal[otherName]).toBeNull();
        }
        const selectedCard = phase.cards.find(
          (card) => card.role === metadata.selectedRole
        );
        const selectedPaintedName = `${metadata.selectedRole}PaintedOnly` as
          'middlePaintedOnly' | 'basePaintedOnly';
        const selectedAuthoredName = `${metadata.selectedRole}AuthoredOnly` as
          'middleAuthoredOnly' | 'baseAuthoredOnly';
        const selectedPaintedPoint =
          phase.stack.hitPointsFrameLocal[selectedPaintedName];
        const selectedAuthoredPoint =
          phase.stack.hitPointsFrameLocal[selectedAuthoredName];
        if (!selectedCard || !selectedPaintedPoint || !selectedAuthoredPoint) {
          throw new Error(`Missing ${entry.id} selected lower hit evidence`);
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
      }
    }
  }

  expect(runtimeErrors).toEqual([]);
});
