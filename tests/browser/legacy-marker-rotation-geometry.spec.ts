import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import {
  asViewCardId,
  type MatchViewState,
  type PlayerId,
} from '../../packages/game-core/src/index.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  createBoardScene,
  createRendererSpikeView,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
} from '../../packages/renderer-contract/src/index.js';

import oracle from '../legacy-fixtures/renderer/marker-rotation-v1.json' with { type: 'json' };

import {
  captureLegacySourceMarkerRotationFixture,
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
    throw new Error('Incomplete marker/rotation rectangle tuple');
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

const createCandidatePristineActiveMarkerScene = () => {
  const base = createRendererSpikeView();
  const localPlayerId = base.playerOrder[0];
  const opponentPlayerId = base.playerOrder[1];
  const pokemonDefinition = Object.values(base.definitions).find(
    (definition) => definition.category === 'Pokémon'
  );
  if (!localPlayerId || !opponentPlayerId || !pokemonDefinition) {
    throw new Error('Renderer spike fixture lacks active-marker scene inputs');
  }
  const makeCard = (id: string, ownerId: PlayerId) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId: pokemonDefinition.id,
    ownerId,
    category: 'Pokémon' as const,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: true,
  });
  const makeStack = (side: LegacyFixtureSide, boardPlayerId: PlayerId) => ({
    id: `${side}-active-marker-stack`,
    boardPlayerId,
    slot: 'active' as const,
    evolutionCards: [makeCard(`${side}-active-marker-card`, boardPlayerId)],
    attachmentCards: [],
    rotationQuarterTurns: 0 as const,
    damage: Number(oracle.input.damageUpdated),
    specialCondition: 'P',
    abilityUsed: true,
  });
  const local = makeStack('local', localPlayerId);
  const opponent = makeStack('opponent', opponentPlayerId);
  const view: MatchViewState = {
    ...base,
    revision: base.revision + 1,
    zones: Object.fromEntries(
      Object.entries(base.zones).map(([id, zone]) => [
        id,
        { ...zone, cards: [] },
      ])
    ),
    boards: {
      [localPlayerId]: { activeStackId: local.id, benchStackIds: [] },
      [opponentPlayerId]: {
        activeStackId: opponent.id,
        benchStackIds: [],
      },
    },
    stacks: { [local.id]: local, [opponent.id]: opponent },
  };
  return createBoardScene(
    view,
    createBoardLayoutSnapshot({
      geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
      viewport: oracle.input.viewport,
      playerIds: [localPlayerId, opponentPlayerId],
      bottomPlayerId: localPlayerId,
      shellMode: 'sidebar',
      vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
    })
  );
};

test('marker/rotation oracle pins every claimed source and binary asset digest', async () => {
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

test('checked-in legacy active markers reflow through q0-q1-q2-q3-q0 and clean up', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source marker/rotation checkpoint is Chromium-specific.'
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

  const capture = await captureLegacySourceMarkerRotationFixture(page);
  await testInfo.attach('legacy-source-marker-rotation-geometry.json', {
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
    expectRect(
      capture.frames[side],
      oracle.expected.frames[side],
      `${side}.frame`
    );
    const frameTransform = capture.frameTransforms[side];
    const expectedFrameRotation = oracle.expected.frameRotationDegrees[side];
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
    if (!actualCase) throw new Error(`Missing ${side} marker/rotation case`);
    const cardId = `${side}-active-marker-card`;
    expect(actualCase.id).toBe(`${side}-active-marker-rotation`);
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
    const expectedInitialRect = oracle.expected.initialCard.frameLocalBounds;
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
      inlineRight: oracle.expected.initialCard.initialInlineMargins.right,
      inlineLeft: oracle.expected.initialCard.initialInlineMargins.left,
      computedRightPx: 0,
      computedLeftPx: 0,
    });
    expect(
      actualCase.paletteTrace.map((entry) => [
        entry.input,
        entry.textContent,
        entry.backgroundColor,
        entry.color,
      ])
    ).toEqual(oracle.expected.paletteTrace);
    expect(actualCase.callTrace).toEqual(oracle.expected.callTrace);
    expect(actualCase.phases.map((phase) => phase.name)).toEqual(
      oracle.expected.phases.map((phase) => phase.name)
    );

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
        id: `${side}-active-marker-stack`,
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

      expect(phase.markers.map((marker) => marker.kind)).toEqual([
        'damage',
        'specialCondition',
        'ability',
      ]);
      const damage = phase.markers[0];
      const condition = phase.markers[1];
      const ability = phase.markers[2];
      if (!damage || !condition || !ability) {
        throw new Error(`Incomplete ${side} ${phase.name} markers`);
      }
      const expectedDamage = tupleRect(expectedPhase.damage.slice(0, 4));
      const expectedCondition = tupleRect(
        expectedPhase.specialCondition.slice(0, 4)
      );
      const expectedAbilityValues = [...expectedPhase.ability];
      if (side === 'opponent') {
        const expectedY = expectedAbilityValues[1];
        if (expectedY === undefined) {
          throw new Error(`Incomplete ${side} ${phase.name} ability tuple`);
        }
        expectedAbilityValues[1] =
          expectedY + oracle.expected.opponentAbilityFrameLocalYDelta;
      }
      const expectedAbility = tupleRect(expectedAbilityValues.slice(0, 4));
      for (const [marker, expected, kind, ordinal] of [
        [damage, expectedDamage, 'damage', 1],
        [condition, expectedCondition, 'specialCondition', 2],
        [ability, expectedAbility, 'ability', 3],
      ] as const) {
        const markerId = `${side}-active-${kind}-marker`;
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
          id: markerId,
          kind,
          parentZoneId: 'active',
          domOrdinal: ordinal,
          pointerEvents: 'auto',
          display: 'block',
          inlineDisplay: 'inline-block',
          zIndex: 1,
          hitOrder: [markerId, cardId],
        });
      }
      const circleClass = side === 'local' ? 'self-circle' : 'opp-circle';
      const circleLocalRotation = side === 'local' ? 0 : 180;
      for (const marker of [damage, condition]) {
        expect(marker.className).toBe(circleClass);
        expect(marker.contentEditable).toBe('true');
        expect(marker.borderRadius).toBe('50%');
        expect(marker.localRotationDegrees).toBe(circleLocalRotation);
        expect(marker.effectiveRotationDegrees).toBe(0);
      }
      expect(damage).toMatchObject({
        textContent: oracle.input.damageUpdated,
        backgroundColor: 'rgb(255, 98, 0)',
        color: 'rgb(255, 255, 255)',
      });
      expect(condition).toMatchObject({
        textContent: 'P',
        backgroundColor: 'rgb(0, 128, 0)',
        color: 'rgb(255, 255, 255)',
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
      expect(phase.cardOnlyHitOrder).toEqual([cardId]);

      const [damageLeft, damageTop, damageFont] = expectedPhase.damage.slice(4);
      expectStructured(damage.inlineLeftPx, damageLeft ?? null, 'damage.left');
      expectStructured(damage.inlineTopPx, damageTop ?? null, 'damage.top');
      expectStructured(
        damage.inlineWidthPx,
        expectedDamage.width,
        'damage.width'
      );
      expectStructured(
        damage.inlineHeightPx,
        expectedDamage.width,
        'damage.height'
      );
      expectStructured(
        damage.inlineLineHeightPx,
        expectedDamage.width,
        'damage.lineHeight'
      );
      expectStructured(
        damage.inlineFontSizePx,
        damageFont ?? null,
        'damage.font'
      );
      expect(damage.inlineRightPx).toBeNull();
      expect(damage.inlineBottomPx).toBeNull();

      const [conditionLeft, conditionTop, conditionFont] =
        expectedPhase.specialCondition.slice(4);
      expectStructured(
        condition.inlineLeftPx,
        conditionLeft ?? null,
        'condition.left'
      );
      expectStructured(
        condition.inlineTopPx,
        conditionTop ?? null,
        'condition.top'
      );
      expectStructured(
        condition.inlineWidthPx,
        expectedCondition.width,
        'condition.width'
      );
      expectStructured(
        condition.inlineHeightPx,
        expectedCondition.width,
        'condition.height'
      );
      expectStructured(
        condition.inlineLineHeightPx,
        expectedCondition.width,
        'condition.lineHeight'
      );
      expectStructured(
        condition.inlineFontSizePx,
        conditionFont ?? null,
        'condition.font'
      );
      expect(condition.inlineRightPx).toBeNull();
      expect(condition.inlineBottomPx).toBeNull();

      expectStructured(
        ability.inlineLeftPx,
        expectedPhase.ability[4] ?? null,
        'ability.left'
      );
      expectStructured(
        ability.inlineTopPx,
        side === 'local' ? (expectedPhase.ability[5] ?? null) : null,
        'ability.top'
      );
      expectStructured(
        ability.inlineBottomPx,
        side === 'opponent' ? (expectedPhase.ability[6] ?? null) : null,
        'ability.bottom'
      );
      expect(ability.inlineRightPx).toBeNull();
      expectStructured(
        ability.inlineWidthPx,
        expectedAbility.width,
        'ability.width'
      );
      expectStructured(
        ability.inlineHeightPx,
        expectedAbility.width / 5,
        'ability.height'
      );
      expectStructured(
        ability.inlineLineHeightPx,
        expectedPhase.ability[7] ?? null,
        'ability.lineHeight'
      );
      expect(ability.inlineFontSizePx).toBeNull();
    }

    expect(actualCase.cleanup).toEqual({
      markerCount: oracle.expected.cleanup.markerCount,
      cardDamageCounterIsNull: oracle.expected.cleanup.cardPointersAreNull,
      cardSpecialConditionIsNull: oracle.expected.cleanup.cardPointersAreNull,
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
    });
  }

  expect(runtimeErrors).toEqual([]);
});

test('pristine source active markers match the strict React DOM candidate', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source-to-React active-marker checkpoint is Chromium-specific.'
  );
  const candidateScene = createCandidatePristineActiveMarkerScene();
  await page.setViewportSize(oracle.input.viewport);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
    oracle.input.viewport.devicePixelRatio
  );
  const capture = await captureLegacySourceMarkerRotationFixture(page);
  await testInfo.attach('legacy-source-to-react-active-marker-geometry.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });
  expect(capture.sourceFulfillment.unexpectedSameOriginPaths).toEqual([]);
  expect(candidateScene.cards).toHaveLength(2);
  expect(candidateScene.markers).toHaveLength(6);

  const sourceBySide = Object.fromEntries(
    capture.cases.map((entry) => {
      const phase = entry.phases.find(
        (candidate) => candidate.name === 'marked-q0'
      );
      if (!phase) throw new Error(`Missing ${entry.side} marked-q0 phase`);
      return [entry.side, phase] as const;
    })
  ) as Record<
    LegacyFixtureSide,
    (typeof capture.cases)[number]['phases'][number]
  >;

  for (const side of ['local', 'opponent'] as const) {
    const source = sourceBySide[side];
    const cardId = asViewCardId(`${side}-active-marker-card`);
    const card = candidateScene.cards.find((entry) => entry.id === cardId);
    if (!card) throw new Error(`Missing ${side} candidate active card`);
    expect(card).toMatchObject({
      side,
      role: 'stackEvolution',
      rotationQuarterTurns: side === 'local' ? 0 : 2,
      interactive: true,
    });
    expectRect(card.bounds, source.card.physicalBounds, `${side}.card.scene`);

    for (const [sourceKind, candidateKind] of [
      ['damage', 'damage'],
      ['specialCondition', 'specialCondition'],
      ['ability', 'abilityUsed'],
    ] as const) {
      const sourceMarker = source.markers.find(
        (marker) => marker.kind === sourceKind
      );
      const marker = candidateScene.markers.find(
        (entry) => entry.parentCardId === cardId && entry.kind === candidateKind
      );
      if (!sourceMarker || !marker) {
        throw new Error(`Missing ${side} ${candidateKind} marker`);
      }
      expect(marker).toMatchObject({
        parentCardId: cardId,
        kind: candidateKind,
        value:
          candidateKind === 'damage'
            ? oracle.input.damageUpdated
            : candidateKind === 'specialCondition'
              ? 'P'
              : 'used',
        side,
        presentation: 'legacyActiveQ0',
      });
      expect(marker.zIndex).toBe(card.zIndex + 1);
      expectRect(
        marker.bounds,
        sourceMarker.physicalBounds,
        `${side}.${candidateKind}.scene`
      );
    }
  }

  await page.unrouteAll({ behavior: 'wait' });
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) =>
    runtimeErrors.push(`pageerror: ${error.message}`)
  );
  page.on('console', (message) => {
    if (message.type() === 'error') {
      runtimeErrors.push(`console.error: ${message.text()}`);
    }
  });
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  await page.evaluate(async (scene) => {
    const spike = (
      window as typeof window & {
        __PTCG_RENDERER_SPIKE__?: {
          createRenderer(adapters: {
            emitIntent(): void;
            emitPresentationUpdate(): void;
            reportError(error: unknown): void;
          }): {
            mount(
              host: HTMLElement,
              candidateScene: typeof scene,
              presentation: {
                selectedCardId: null;
                hoveredCardId: null;
                drag: null;
                openedZoneId: null;
              }
            ): Promise<void>;
            destroy(): void;
          };
        };
      }
    ).__PTCG_RENDERER_SPIKE__;
    if (!spike?.createRenderer) {
      throw new Error('Missing renderer spike factory test seam');
    }
    const host = document.createElement('div');
    host.dataset.activeMarkerCandidateHost = 'true';
    Object.assign(host.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: `${scene.viewport.width}px`,
      height: `${scene.viewport.height}px`,
      zIndex: '20000',
    });
    document.body.append(host);
    const renderer = spike.createRenderer({
      emitIntent: () => undefined,
      emitPresentationUpdate: () => undefined,
      reportError: (error) => {
        host.dataset.rendererError = String(error);
      },
    });
    await renderer.mount(host, scene, {
      selectedCardId: null,
      hoveredCardId: null,
      drag: null,
      openedZoneId: null,
    });
    (
      window as typeof window & {
        __PTCG_ACTIVE_MARKER_CANDIDATE_RENDERER__?: { destroy(): void };
      }
    ).__PTCG_ACTIVE_MARKER_CANDIDATE_RENDERER__ = renderer;
  }, candidateScene);

  const candidateHost = page.locator('[data-active-marker-candidate-host]');
  await expect(candidateHost).not.toHaveAttribute('data-renderer-error', /.+/u);
  await expect(candidateHost.locator('[data-marker-id]')).toHaveCount(6);
  for (const side of ['local', 'opponent'] as const) {
    const source = sourceBySide[side];
    const cardId = `${side}-active-marker-card`;
    const renderedCard = await candidateHost
      .locator(`[data-card-id="${cardId}"]`)
      .boundingBox();
    if (!renderedCard) throw new Error(`Missing rendered ${side} active card`);
    expectRect(renderedCard, source.card.physicalBounds, `${side}.card.dom`);

    for (const [sourceKind, candidateKind] of [
      ['damage', 'damage'],
      ['specialCondition', 'specialCondition'],
      ['ability', 'abilityUsed'],
    ] as const) {
      const sourceMarker = source.markers.find(
        (marker) => marker.kind === sourceKind
      );
      const sceneMarker = candidateScene.markers.find(
        (marker) =>
          marker.parentCardId === cardId && marker.kind === candidateKind
      );
      if (!sourceMarker || !sceneMarker) {
        throw new Error(`Missing rendered ${side} ${candidateKind} marker`);
      }
      const locator = candidateHost.locator(
        `[data-marker-id="${sceneMarker.id}"]`
      );
      const rendered = await locator.boundingBox();
      if (!rendered) {
        throw new Error(`Invisible rendered ${side} ${candidateKind} marker`);
      }
      expectRect(
        rendered,
        sourceMarker.physicalBounds,
        `${side}.${candidateKind}.dom`
      );
      await expect(locator).toHaveAttribute(
        'data-marker-presentation',
        'legacyActiveQ0'
      );
      await expect(locator).toHaveAttribute('data-marker-side', side);
      const style = await locator.evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          backgroundColor: computed.backgroundColor,
          borderRadius: computed.borderRadius,
          color: computed.color,
          display: computed.display,
          fontSize: Number.parseFloat(computed.fontSize),
          fontWeight: computed.fontWeight,
          lineHeight: Number.parseFloat(computed.lineHeight),
          pointerEvents: computed.pointerEvents,
          position: computed.position,
          textAlign: computed.textAlign,
          textContent: element.textContent ?? '',
          zIndex: computed.zIndex,
        };
      });
      expect(style).toMatchObject({
        backgroundColor: sourceMarker.backgroundColor,
        borderRadius: sourceMarker.borderRadius,
        color: sourceMarker.color,
        display: 'block',
        fontWeight: '400',
        pointerEvents: 'none',
        position: 'absolute',
        textAlign: 'center',
        textContent: sourceMarker.textContent,
        zIndex: String(sceneMarker.zIndex),
      });
      const expectedCandidateLineHeight =
        candidateKind === 'abilityUsed'
          ? sceneMarker.bounds.width / 3
          : sceneMarker.bounds.width;
      expectStructured(
        style.lineHeight,
        expectedCandidateLineHeight,
        `${side}.${candidateKind}.candidateLineHeight`
      );
      expect(sourceMarker.inlineLineHeightPx).not.toBeNull();
      expect(
        Math.abs(
          style.lineHeight - (sourceMarker.inlineLineHeightPx as number)
        ) / (sourceMarker.inlineLineHeightPx as number),
        `${side}.${candidateKind}.sourceLineHeight`
      ).toBeLessThanOrEqual(oracle.tolerances.cardSizeRelative);
      if (sourceMarker.inlineFontSizePx !== null) {
        const expectedCandidateFontSize =
          candidateKind === 'damage'
            ? sceneMarker.bounds.width / 2
            : sceneMarker.bounds.width * 0.75;
        expectStructured(
          style.fontSize,
          expectedCandidateFontSize,
          `${side}.${candidateKind}.candidateFontSize`
        );
        expect(
          Math.abs(style.fontSize - sourceMarker.inlineFontSizePx) /
            sourceMarker.inlineFontSizePx,
          `${side}.${candidateKind}.sourceFontSize`
        ).toBeLessThanOrEqual(oracle.tolerances.cardSizeRelative);
      }
    }
  }

  await page.evaluate(async () => {
    const candidateWindow = window as typeof window & {
      __PTCG_ACTIVE_MARKER_CANDIDATE_RENDERER__?: { destroy(): void };
    };
    const host = document.querySelector<HTMLElement>(
      '[data-active-marker-candidate-host]'
    );
    candidateWindow.__PTCG_ACTIVE_MARKER_CANDIDATE_RENDERER__?.destroy();
    delete candidateWindow.__PTCG_ACTIVE_MARKER_CANDIDATE_RENDERER__;
    await Promise.resolve();
    const rendererError = host?.dataset.rendererError;
    host?.remove();
    if (rendererError) {
      throw new Error(`Candidate teardown failed: ${rendererError}`);
    }
  });
  expect(runtimeErrors).toEqual([]);
});
