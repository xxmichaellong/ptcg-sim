import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/bench-marker-rotation-v1.json' with { type: 'json' };

import {
  captureLegacySourceBenchMarkerRotationFixture,
  type CapturedRect,
  type LegacyFixtureSide,
} from './support/legacy-source-board.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

const tupleRect = (values: readonly number[]): CapturedRect => {
  expect(values).toHaveLength(4);
  const [x, y, width, height] = values;
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    throw new Error('Incomplete bench marker/rotation rectangle tuple');
  }
  return { x, y, width, height };
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

const expectStructured = (
  actual: number | null,
  expected: number | null,
  label: string
): void => {
  if (expected === null) {
    expect(actual, label).toBeNull();
    return;
  }
  expect(actual, label).not.toBeNull();
  expect(
    Math.abs((actual as number) - expected),
    `${label}: expected ${expected}, received ${actual}`
  ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
};

const modularDegreesBetween = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

const physicalRect = (
  side: LegacyFixtureSide,
  bounds: CapturedRect
): CapturedRect => {
  const frame = oracle.expected.frames[side];
  return side === 'local'
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
};

test('bench marker/rotation oracle pins every claimed source and binary asset digest', async () => {
  expect(oracle.schemaVersion).toBe(1);
  const sourcePaths = oracle.provenance.map((entry) => entry.path);
  expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
  const claimedPaths = new Set(
    oracle.provenanceClaims.flatMap((claim) => claim.sources)
  );
  expect([...claimedPaths].sort()).toEqual([...sourcePaths].sort());
  for (const claim of oracle.provenanceClaims) {
    expect(claim.sources.length, claim.claim).toBeGreaterThan(0);
    expect(new Set(claim.sources).size, claim.claim).toBe(claim.sources.length);
  }
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
});

test('checked-in legacy bench markers reflow through q0-q1-q2-q3-q0 and clean up', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source bench marker/rotation checkpoint is Chromium-specific.'
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

  const capture = await captureLegacySourceBenchMarkerRotationFixture(page);
  await testInfo.attach('legacy-source-bench-marker-rotation-geometry.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });

  expect(capture.sourceFulfillment.servedPaths).toEqual([
    '/',
    '/opp-containers.html',
    '/self-containers.html',
    '/src/assets/cardback.png',
    '/src/css/index.css',
    '/src/css/opp-containers.css',
    '/src/css/self-containers.css',
    '/src/front-end.js',
  ]);
  expect(capture.sourceFulfillment.unexpectedSameOriginPaths).toEqual([]);
  expect(capture.sourceFulfillment.blockedExternalOrigins).toEqual([
    'https://cdn.socket.io',
    'https://static.cloudflareinsights.com',
    'https://upload.wikimedia.org',
    'https://www.svgrepo.com',
  ]);

  expect(capture.cases.map((entry) => entry.id)).toEqual(oracle.input.cases);
  for (const side of ['local', 'opponent'] as const) {
    const expectedFrameRotation = oracle.expected.frameRotationDegrees[side];
    expectRect(
      capture.frames[side],
      oracle.expected.frames[side],
      `${side}.frame`
    );
    const frameTransform = capture.frameTransforms[side];
    expect(
      modularDegreesBetween(
        frameTransform.rotationDegrees,
        expectedFrameRotation
      )
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
    expect(frameTransform.a).toBeCloseTo(side === 'local' ? 1 : -1, 10);
    expect(frameTransform.b).toBeCloseTo(0, 10);
    expect(frameTransform.c).toBeCloseTo(0, 10);
    expect(frameTransform.d).toBeCloseTo(side === 'local' ? 1 : -1, 10);

    const actualCase = capture.cases.find((entry) => entry.side === side);
    if (!actualCase) {
      throw new Error(`Missing ${side} bench marker/rotation case`);
    }
    const cardId = `${side}-bench-marker-card`;
    const wrapperId = `${side}-bench-marker-stack`;
    const damageId = `${side}-bench-damage-marker`;
    const abilityId = `${side}-bench-ability-marker`;
    expect(actualCase.id).toBe(`${side}-bench-marker-rotation`);
    expect(actualCase.initialCard).toMatchObject({
      id: cardId,
      clientWidth: oracle.expected.initialCard.clientWidth,
      clientHeight: oracle.expected.initialCard.clientHeight,
      naturalWidth: oracle.input.asset.naturalWidth,
      naturalHeight: oracle.input.asset.naturalHeight,
      localRotationDegrees: 0,
      effectiveRotationDegrees: expectedFrameRotation,
      inlineTransform: 'rotate(0deg)',
      zIndex: 0,
      pokemonBreak: false,
      domOrdinal: 0,
      sourcePath: oracle.input.asset.path,
    });
    const expectedInitialRect = tupleRect(
      oracle.expected.initialCard.frameLocalBounds
    );
    expectRect(
      actualCase.initialCard.frameLocalBounds,
      expectedInitialRect,
      `${side}.initialCard.frameLocalBounds`
    );
    expectRect(
      actualCase.initialCard.untransformedFrameLocalBounds,
      expectedInitialRect,
      `${side}.initialCard.untransformedFrameLocalBounds`
    );
    expectRect(
      actualCase.initialCard.physicalBounds,
      physicalRect(side, expectedInitialRect),
      `${side}.initialCard.physicalBounds`
    );
    expect(actualCase.initialWrapperMargins).toEqual({
      inlineRight: oracle.expected.initialCard.initialWrapperMargins[0],
      inlineLeft: oracle.expected.initialCard.initialWrapperMargins[1],
      computedRightPx: oracle.expected.initialCard.initialWrapperMargins[2],
      computedLeftPx: oracle.expected.initialCard.initialWrapperMargins[3],
    });
    expect(actualCase.callTrace).toEqual(oracle.expected.callTrace);
    expect(actualCase.phases.map((phase) => phase.name)).toEqual(
      oracle.expected.phases.map((phase) => phase.name)
    );

    const firstExpectedAbility = oracle.expected.phases[0]?.ability;
    if (!firstExpectedAbility) {
      throw new Error('Bench marker oracle has no initial phase');
    }
    const firstExpectedAbilityRect = tupleRect(
      firstExpectedAbility.slice(0, 4)
    );
    const firstExpectedAbilityLeft = firstExpectedAbility[4];
    if (firstExpectedAbilityLeft === undefined) {
      throw new Error('Bench marker oracle has no initial ability left offset');
    }
    const benchOrigin = {
      x: firstExpectedAbilityRect.x - firstExpectedAbilityLeft,
      y: expectedInitialRect.y,
    };

    for (const expectedPhase of oracle.expected.phases) {
      const phase = actualCase.phases.find(
        (candidate) => candidate.name === expectedPhase.name
      );
      if (!phase) throw new Error(`Missing ${side} ${expectedPhase.name}`);
      const expectedCard = tupleRect(expectedPhase.card);
      const expectedUntransformed = tupleRect(expectedPhase.untransformedCard);
      const expectedWrapper = tupleRect(expectedPhase.wrapper);
      expect(phase.card).toMatchObject({
        id: cardId,
        clientWidth: oracle.expected.initialCard.clientWidth,
        clientHeight: oracle.expected.initialCard.clientHeight,
        naturalWidth: oracle.input.asset.naturalWidth,
        naturalHeight: oracle.input.asset.naturalHeight,
        localRotationDegrees: expectedPhase.rotationDegrees,
        inlineTransform: `rotate(${expectedPhase.rotationDegrees}deg)`,
        zIndex: 0,
        pokemonBreak: false,
        domOrdinal: 0,
        sourcePath: oracle.input.asset.path,
      });
      expect(
        modularDegreesBetween(
          phase.card.effectiveRotationDegrees,
          (expectedPhase.rotationDegrees + expectedFrameRotation) % 360
        )
      ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
      expectRect(
        phase.card.frameLocalBounds,
        expectedCard,
        `${side}.${phase.name}.card.frameLocalBounds`
      );
      expectRect(
        phase.card.untransformedFrameLocalBounds,
        expectedUntransformed,
        `${side}.${phase.name}.card.untransformedFrameLocalBounds`
      );
      expectRect(
        phase.card.physicalBounds,
        physicalRect(side, expectedCard),
        `${side}.${phase.name}.card.physicalBounds`
      );
      expectRect(
        phase.wrapper.frameLocalBounds,
        expectedWrapper,
        `${side}.${phase.name}.wrapper.frameLocalBounds`
      );
      expectRect(
        phase.wrapper.physicalBounds,
        physicalRect(side, expectedWrapper),
        `${side}.${phase.name}.wrapper.physicalBounds`
      );
      expect(phase.wrapper).toMatchObject({
        id: wrapperId,
        clientWidth: oracle.expected.initialCard.clientWidth,
        clientHeight: oracle.expected.initialCard.clientHeight,
        authoredWidthPx: null,
        inlineMarginRight: expectedPhase.wrapperMargins[0],
        inlineMarginLeft: expectedPhase.wrapperMargins[1],
        childImageCount: 1,
      });
      expectStructured(
        phase.wrapper.computedMarginRightPx,
        Number(expectedPhase.wrapperMargins[2]),
        `${side}.${phase.name}.wrapper.computedMarginRightPx`
      );
      expectStructured(
        phase.wrapper.computedMarginLeftPx,
        Number(expectedPhase.wrapperMargins[3]),
        `${side}.${phase.name}.wrapper.computedMarginLeftPx`
      );

      expect(phase.specialConditionMarkerCount).toBe(0);
      expect(phase.markers.map((marker) => marker.kind)).toEqual([
        'damage',
        'ability',
      ]);
      expect(phase.markers.map((marker) => marker.id)).toEqual([
        damageId,
        abilityId,
      ]);
      const damage = phase.markers[0];
      const ability = phase.markers[1];
      if (!damage || !ability) {
        throw new Error(`Incomplete ${side} ${phase.name} bench markers`);
      }
      const expectedDamage = tupleRect(expectedPhase.damage.slice(0, 4));
      const expectedAbilityValues = [...expectedPhase.ability];
      if (side === 'opponent') {
        const expectedY = expectedAbilityValues[1];
        if (expectedY === undefined) {
          throw new Error(`Incomplete ${side} ${phase.name} ability tuple`);
        }
        expect(expectedPhase.opponentAbilityYDelta).toBe(
          [0, 180].includes(expectedPhase.rotationDegrees)
            ? oracle.expected.opponentAbilityFrameLocalYDelta
            : 0
        );
        expectedAbilityValues[1] =
          expectedY + expectedPhase.opponentAbilityYDelta;
      }
      const expectedAbility = tupleRect(expectedAbilityValues.slice(0, 4));

      for (const [marker, expected, kind, ordinal] of [
        [damage, expectedDamage, 'damage', 1],
        [ability, expectedAbility, 'ability', 2],
      ] as const) {
        expectRect(
          marker.frameLocalBounds,
          expected,
          `${side}.${phase.name}.${kind}.frameLocalBounds`
        );
        expectRect(
          marker.physicalBounds,
          physicalRect(side, expected),
          `${side}.${phase.name}.${kind}.physicalBounds`
        );
        expect(marker).toMatchObject({
          id: kind === 'damage' ? damageId : abilityId,
          kind,
          parentZoneId: 'bench',
          domOrdinal: ordinal,
          pointerEvents: 'auto',
          display: 'block',
          inlineDisplay: 'inline-block',
          zIndex: 1,
          hitOrder: [kind === 'damage' ? damageId : abilityId, cardId],
        });
      }

      const circleLocalRotation = side === 'local' ? 0 : 180;
      expect(damage).toMatchObject({
        className: side === 'local' ? 'self-circle' : 'opp-circle',
        textContent: oracle.input.damageUpdated,
        contentEditable: 'true',
        borderRadius: '50%',
        backgroundColor: 'rgb(255, 98, 0)',
        color: 'rgb(255, 255, 255)',
        localRotationDegrees: circleLocalRotation,
        effectiveRotationDegrees: 0,
      });
      expect(ability).toMatchObject({
        className: side === 'local' ? 'self-tab' : 'opp-tab',
        textContent: '',
        contentEditable: 'inherit',
        borderRadius: '10%',
        backgroundColor:
          side === 'local'
            ? 'rgba(59, 141, 173, 0.71)'
            : 'rgba(255, 60, 0, 0.392)',
        color: 'rgb(0, 0, 0)',
        localRotationDegrees: 0,
        effectiveRotationDegrees: expectedFrameRotation,
      });

      const [damageLeft, damageTop, damageFont] = expectedPhase.damage.slice(4);
      expectStructured(
        damageLeft ?? null,
        expectedCard.x - benchOrigin.x + expectedCard.width / 1.5,
        `${side}.${phase.name}.damage.leftFormula`
      );
      expectStructured(
        damageTop ?? null,
        expectedCard.y - benchOrigin.y + expectedCard.height / 4,
        `${side}.${phase.name}.damage.topFormula`
      );
      expectStructured(
        damage.inlineLeftPx,
        damageLeft ?? null,
        `${side}.${phase.name}.damage.left`
      );
      expectStructured(
        damage.inlineTopPx,
        damageTop ?? null,
        `${side}.${phase.name}.damage.top`
      );
      expectStructured(
        damage.inlineWidthPx,
        expectedCard.width / 3,
        `${side}.${phase.name}.damage.widthFormula`
      );
      expectStructured(
        damage.inlineHeightPx,
        expectedCard.width / 3,
        `${side}.${phase.name}.damage.heightFormula`
      );
      expectStructured(
        damage.inlineLineHeightPx,
        expectedCard.width / 3,
        `${side}.${phase.name}.damage.lineHeightFormula`
      );
      expectStructured(
        damageFont ?? null,
        expectedCard.width / 6,
        `${side}.${phase.name}.damage.fontFormula`
      );
      expectStructured(
        damage.inlineFontSizePx,
        damageFont ?? null,
        `${side}.${phase.name}.damage.font`
      );
      expect(damage.inlineRightPx).toBeNull();
      expect(damage.inlineBottomPx).toBeNull();

      const [abilityLeft, abilityTop, abilityBottom, abilityLineHeight] =
        expectedPhase.ability.slice(4);
      expectStructured(
        abilityLeft ?? null,
        expectedCard.x - benchOrigin.x,
        `${side}.${phase.name}.ability.leftFormula`
      );
      expectStructured(
        ability.inlineLeftPx,
        abilityLeft ?? null,
        `${side}.${phase.name}.ability.left`
      );
      if (side === 'local') {
        expectStructured(
          abilityTop ?? null,
          expectedCard.y - benchOrigin.y + expectedCard.height / 2,
          `${side}.${phase.name}.ability.topFormula`
        );
        expectStructured(
          ability.inlineTopPx,
          abilityTop ?? null,
          `${side}.${phase.name}.ability.top`
        );
        expect(ability.inlineBottomPx).toBeNull();
      } else {
        expectStructured(
          abilityBottom ?? null,
          expectedCard.y -
            benchOrigin.y +
            expectedCard.height / 2 -
            expectedCard.width / 5,
          `${side}.${phase.name}.ability.bottomFormula`
        );
        expectStructured(
          ability.inlineBottomPx,
          abilityBottom ?? null,
          `${side}.${phase.name}.ability.bottom`
        );
        expect(ability.inlineTopPx).toBeNull();
      }
      expect(ability.inlineRightPx).toBeNull();
      expectStructured(
        ability.inlineWidthPx,
        expectedCard.width,
        `${side}.${phase.name}.ability.widthFormula`
      );
      expectStructured(
        ability.inlineHeightPx,
        expectedCard.width / 5,
        `${side}.${phase.name}.ability.heightFormula`
      );
      expectStructured(
        abilityLineHeight ?? null,
        expectedCard.width / 3,
        `${side}.${phase.name}.ability.lineHeightFormula`
      );
      expectStructured(
        ability.inlineLineHeightPx,
        abilityLineHeight ?? null,
        `${side}.${phase.name}.ability.lineHeight`
      );
      expect(ability.inlineFontSizePx).toBeNull();

      expect(phase.cardOnlyHitOrder).toEqual([cardId]);
      const expectedOverlap = expectedPhase.markerOverlapOrder?.map((kind) => {
        if (kind === 'ability') return abilityId;
        if (kind === 'damage') return damageId;
        if (kind === 'card') return cardId;
        throw new Error(`Unexpected marker overlap kind: ${kind}`);
      });
      expect(phase.markerOverlapHitOrder).toEqual(expectedOverlap ?? null);
    }

    expect(actualCase.nativeBenchResizeObserver).toEqual(
      oracle.expected.nativeBenchResizeObserver
    );
    expect(actualCase.cleanup).toEqual({
      markerCount: oracle.expected.cleanup.markerCount,
      specialConditionMarkerCount:
        oracle.expected.cleanup.specialConditionMarkerCount,
      cardDamageCounterIsNull: oracle.expected.cleanup.cardPointersAreNull,
      cardAbilityCounterIsNull: oracle.expected.cleanup.cardPointersAreNull,
      liveResizeCallsBeforeDispatch:
        oracle.expected.cleanup.liveResizeCallsBeforeDispatch,
      liveResizeCallsAfterDispatch:
        oracle.expected.cleanup.liveResizeCallsAfterDispatch,
      liveMarkerCountAfterDispatch:
        oracle.expected.cleanup.liveMarkerCountAfterDispatch,
      resizeCallsBeforeCleanupDispatch:
        oracle.expected.cleanup.resizeCallsBeforeCleanupDispatch,
      resizeCallsAfterCleanupDispatch:
        oracle.expected.cleanup.resizeCallsAfterCleanupDispatch,
      wrapperCountAfterTwoFrames:
        oracle.expected.cleanup.wrapperCountAfterTwoFrames,
      cardCountAfterTwoFrames: oracle.expected.cleanup.cardCountAfterTwoFrames,
      benchZIndexAfterCleanup: oracle.expected.cleanup.benchZIndexAfterCleanup,
    });
  }

  expect(runtimeErrors).toEqual([]);
});
