import { expect, test } from '@playwright/test';
import type { MatchViewState } from '../../packages/game-core/src/index.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  createBoardScene,
  createRendererSpikeView,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
} from '../../packages/renderer-contract/src/index.js';

import oracle from '../legacy-fixtures/renderer/contained-card-layout-v1.json' with { type: 'json' };

import {
  captureLegacySourceContainedCardFixture,
  type CapturedRect,
  type LegacyContainedCardFixtureCard,
} from './support/legacy-source-board.js';

const anchorTolerancePixels = oracle.tolerances.anchorPixels;
const sizeToleranceRelative = oracle.tolerances.cardSizeRelative;
const rotationToleranceDegrees = oracle.tolerances.rotationDegrees;

const modularDegreesBetween = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

const expectAnchorWithin = (
  actual: CapturedRect,
  expected: CapturedRect,
  label: string
): void => {
  for (const key of ['x', 'y'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(anchorTolerancePixels);
  }
};

const expectSizeWithin = (
  actual: CapturedRect,
  expected: CapturedRect,
  label: string
): void => {
  for (const key of ['width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]) / expected[key],
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(sizeToleranceRelative);
  }
};

const cardKey = (
  card: Pick<LegacyContainedCardFixtureCard, 'side' | 'kind' | 'readableBy'>
): string =>
  card.kind === 'stadium'
    ? `shared-stadium-${card.readableBy}`
    : `${card.side}-${card.kind}`;

const createTopOwnerStadiumCandidateScene = () => {
  const base = createRendererSpikeView();
  const bottomPlayerId = base.playerOrder[0];
  const topPlayerId = base.playerOrder[1];
  const stadium = base.zones['zone:shared:stadium'];
  const stadiumCard = stadium?.cards[0];
  if (
    !bottomPlayerId ||
    !topPlayerId ||
    base.playerOrder.length !== 2 ||
    !stadium ||
    !stadiumCard ||
    stadiumCard.kind !== 'known'
  ) {
    throw new Error('Renderer spike fixture lacks top-owner stadium inputs');
  }
  const view: MatchViewState = {
    ...base,
    revision: base.revision + 1,
    zones: {
      ...base.zones,
      [stadium.id]: {
        ...stadium,
        cards: [
          {
            ...stadiumCard,
            ownerId: topPlayerId,
            face: 'up',
            orientationQuarterTurns: 0,
            abilityUsed: false,
          },
        ],
      },
    },
  };
  return createBoardScene(
    view,
    createBoardLayoutSnapshot({
      geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
      viewport: oracle.input.viewport,
      playerIds: [bottomPlayerId, topPlayerId],
      bottomPlayerId,
      shellMode: 'sidebar',
      vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
    })
  );
};

test('source-backed contained cards match the DOM candidate at legacy pile tops', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'This source-characterization gate is Chromium-specific.'
  );
  const topOwnerStadiumScene = createTopOwnerStadiumCandidateScene();
  await page.setViewportSize(oracle.input.viewport);
  const source = await captureLegacySourceContainedCardFixture(page);
  await testInfo.attach('legacy-contained-card-geometry.json', {
    body: Buffer.from(JSON.stringify(source, null, 2)),
    contentType: 'application/json',
  });

  expect(source.cards).toHaveLength(8);
  expect(source.sourceFulfillment.unexpectedSameOriginPaths).toEqual([]);
  expect(source.sourceFulfillment.servedPaths).toContain(
    '/src/assets/cardback.png'
  );
  expect(source.sourceFulfillment.blockedExternalOrigins).toContain(
    'https://cdn.socket.io'
  );
  const sourceByKey = new Map(
    source.cards.map((card) => [cardKey(card), card] as const)
  );
  expect(sourceByKey.size).toBe(source.cards.length);
  for (const card of source.cards) {
    expect(card).toMatchObject({
      naturalWidth: oracle.input.asset.naturalWidth,
      naturalHeight: oracle.input.asset.naturalHeight,
      maxWidth: '100%',
      maxHeight: '100%',
      sourcePath: oracle.input.asset.path,
      localRotationDegrees: 0,
    });
    expect(card.objectFit).toBe(card.kind === 'stadium' ? 'fill' : 'contain');
    expect(card.physicalBounds.x).toBeGreaterThanOrEqual(
      card.containerBounds.x - anchorTolerancePixels
    );
    expect(card.physicalBounds.y).toBeGreaterThanOrEqual(
      card.containerBounds.y - anchorTolerancePixels
    );
    expect(
      card.physicalBounds.x + card.physicalBounds.width
    ).toBeLessThanOrEqual(
      card.containerBounds.x +
        card.containerBounds.width +
        anchorTolerancePixels
    );
    expect(
      card.physicalBounds.y + card.physicalBounds.height
    ).toBeLessThanOrEqual(
      card.containerBounds.y +
        card.containerBounds.height +
        anchorTolerancePixels
    );
    expect(card.physicalBounds.x + card.physicalBounds.width / 2).toBeCloseTo(
      card.containerBounds.x + card.containerBounds.width / 2,
      1
    );
    expect(
      modularDegreesBetween(
        card.effectiveRotationDegrees,
        card.readableBy === 'local' ? 0 : 180
      )
    ).toBeLessThanOrEqual(rotationToleranceDegrees);
  }

  const localStadium = sourceByKey.get('shared-stadium-local');
  const opponentStadium = sourceByKey.get('shared-stadium-opponent');
  if (!localStadium || !opponentStadium) {
    throw new Error('Missing owner-readable legacy stadium states');
  }
  expect(localStadium.physicalBounds.y).toBeCloseTo(
    localStadium.containerBounds.y,
    1
  );
  expect(
    opponentStadium.physicalBounds.y + opponentStadium.physicalBounds.height
  ).toBeCloseTo(
    opponentStadium.containerBounds.y + opponentStadium.containerBounds.height,
    1
  );
  expectSizeWithin(
    opponentStadium.physicalBounds,
    localStadium.physicalBounds,
    'stadium owner flip'
  );

  await page.unrouteAll({ behavior: 'wait' });
  const candidateRuntimeErrors: string[] = [];
  page.on('pageerror', (error) => {
    candidateRuntimeErrors.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      candidateRuntimeErrors.push(`console: ${message.text()}`);
    }
  });
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );

  const candidates = await page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    if (!scene) throw new Error('Missing renderer spike scene');
    return scene.zones.flatMap((zone) => {
      if (
        zone.kind !== 'deck' &&
        zone.kind !== 'discard' &&
        zone.kind !== 'lostZone' &&
        zone.kind !== 'stadium'
      ) {
        return [];
      }
      const nodes = scene.cards.filter((card) => card.parentId === zone.id);
      const interactive = nodes.filter((card) => card.interactive);
      if (nodes.length === 0 || interactive.length !== 1) {
        throw new Error(`Expected one interactive pile top for ${zone.id}`);
      }
      const top = interactive[0]!;
      return [
        {
          key:
            zone.kind === 'stadium'
              ? 'shared-stadium-local'
              : `${zone.side}-${zone.kind}`,
          cardId: top.id,
          sceneBounds: top.bounds,
          rotationQuarterTurns: top.rotationQuarterTurns,
          nodeCount: nodes.length,
          nodeIds: nodes.map((node) => node.id),
          topZIndex: top.zIndex,
          maximumZIndex: Math.max(...nodes.map((node) => node.zIndex)),
        },
      ];
    });
  });
  expect(candidates).toHaveLength(7);

  for (const candidate of candidates) {
    const legacy = sourceByKey.get(candidate.key);
    if (!legacy) throw new Error(`Missing legacy source card ${candidate.key}`);
    expect(candidate.nodeCount).toBeGreaterThan(0);
    expect(candidate.topZIndex).toBe(candidate.maximumZIndex);
    const locator = page.locator(`[data-card-id="${candidate.cardId}"]`);
    await expect(locator).toBeEnabled();
    for (const cardId of candidate.nodeIds) {
      if (cardId !== candidate.cardId) {
        await expect(page.locator(`[data-card-id="${cardId}"]`)).toBeDisabled();
      }
    }
    const actual = await locator.boundingBox();
    if (!actual) throw new Error(`Missing candidate card ${candidate.cardId}`);
    expectAnchorWithin(actual, legacy.physicalBounds, candidate.key);
    expectSizeWithin(actual, legacy.physicalBounds, candidate.key);
    expectAnchorWithin(
      candidate.sceneBounds,
      legacy.physicalBounds,
      candidate.key
    );
    expectSizeWithin(
      candidate.sceneBounds,
      legacy.physicalBounds,
      candidate.key
    );
    const rendered = await locator.evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      const center = element.getBoundingClientRect();
      const topmost = document
        .elementsFromPoint(
          center.x + center.width / 2,
          center.y + center.height / 2
        )
        .find((candidateElement) => candidateElement.closest('[data-card-id]'))
        ?.closest<HTMLElement>('[data-card-id]');
      return {
        rotationDegrees:
          ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
        topmostCardId: topmost?.dataset.cardId ?? null,
      };
    });
    expect(
      modularDegreesBetween(
        rendered.rotationDegrees,
        legacy.effectiveRotationDegrees
      )
    ).toBeLessThanOrEqual(rotationToleranceDegrees);
    expect(rendered.topmostCardId).toBe(candidate.cardId);
  }

  const candidateStadiumZone = topOwnerStadiumScene.zones.find(
    (zone) => zone.kind === 'stadium'
  );
  if (!candidateStadiumZone) {
    throw new Error('Missing candidate stadium zone');
  }
  const candidateTopPlayer = topOwnerStadiumScene.layout.players.find(
    (player) => player.physicalSide === 'upper'
  );
  if (!candidateTopPlayer) {
    throw new Error('Missing candidate top player');
  }
  expect(topOwnerStadiumScene.layout).toMatchObject({
    outerViewport: oracle.input.viewport,
    shellMode: 'sidebar',
  });
  expect(topOwnerStadiumScene.viewport).toEqual({
    width: topOwnerStadiumScene.layout.playAreaBounds.width,
    height: topOwnerStadiumScene.layout.playAreaBounds.height,
    devicePixelRatio: oracle.input.viewport.devicePixelRatio,
  });
  expect(topOwnerStadiumScene.bottomPlayerId).not.toBe(
    candidateTopPlayer.playerId
  );
  expect(candidateStadiumZone).toMatchObject({
    playerId: null,
    side: 'shared',
    kind: 'stadium',
    surface: 'zone',
    count: 1,
    interactive: true,
  });
  const candidateStadiumCards = topOwnerStadiumScene.cards.filter(
    (card) => card.parentId === candidateStadiumZone.id
  );
  expect(candidateStadiumCards).toHaveLength(1);
  const candidateStadiumCard = candidateStadiumCards[0]!;
  const bottomOwnerCandidate = candidates.find(
    (candidate) => candidate.key === 'shared-stadium-local'
  );
  if (!bottomOwnerCandidate) {
    throw new Error('Missing bottom-owner stadium candidate control');
  }
  expect(candidateStadiumCard).toMatchObject({
    id: bottomOwnerCandidate.cardId,
    ownerId: candidateTopPlayer.playerId,
    parentId: candidateStadiumZone.id,
    side: 'shared',
    role: 'zone',
    rotationQuarterTurns: 2,
    concealed: false,
    interactive: true,
  });
  expect(candidateStadiumCard.zIndex).toBe(100);
  expect(candidateStadiumCard.zIndex).toBe(
    Math.max(...candidateStadiumCards.map((card) => card.zIndex))
  );
  expect(candidateStadiumZone.contentBounds).toEqual(
    candidateStadiumZone.bounds
  );
  expect(
    topOwnerStadiumScene.markers.filter(
      (marker) => marker.parentCardId === candidateStadiumCard.id
    )
  ).toEqual([]);
  expectAnchorWithin(
    candidateStadiumZone.contentBounds,
    opponentStadium.containerBounds,
    'shared-stadium-opponent.scene-container'
  );
  expectSizeWithin(
    candidateStadiumZone.contentBounds,
    opponentStadium.containerBounds,
    'shared-stadium-opponent.scene-container'
  );
  expectAnchorWithin(
    candidateStadiumCard.bounds,
    opponentStadium.physicalBounds,
    'shared-stadium-opponent.scene-card'
  );
  expectSizeWithin(
    candidateStadiumCard.bounds,
    opponentStadium.physicalBounds,
    'shared-stadium-opponent.scene-card'
  );
  expect(
    candidateStadiumCard.bounds.y + candidateStadiumCard.bounds.height
  ).toBeCloseTo(
    candidateStadiumZone.contentBounds.y +
      candidateStadiumZone.contentBounds.height
  );

  await page.evaluate(async (scene) => {
    const spike = window.__PTCG_RENDERER_SPIKE__;
    if (!spike?.createRenderer) {
      throw new Error('Missing renderer spike factory test seam');
    }
    const host = document.createElement('div');
    host.dataset.topOwnerStadiumCandidateHost = 'true';
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
        __PTCG_TOP_OWNER_STADIUM_CANDIDATE_RENDERER__?: { destroy(): void };
      }
    ).__PTCG_TOP_OWNER_STADIUM_CANDIDATE_RENDERER__ = renderer;
  }, topOwnerStadiumScene);

  const topOwnerHost = page.locator('[data-top-owner-stadium-candidate-host]');
  await expect(topOwnerHost).not.toHaveAttribute('data-renderer-error', /.+/u);
  const topOwnerLocator = topOwnerHost.locator(
    `[data-card-id="${candidateStadiumCard.id}"]`
  );
  await expect(topOwnerHost.locator('.ptcgsim-board-surface')).toHaveCount(1);
  await expect(topOwnerLocator).toHaveCount(1);
  await expect(topOwnerLocator).toHaveAttribute('data-card-role', 'zone');
  await expect(topOwnerLocator).toBeEnabled();
  const renderedStadiumBounds = await topOwnerLocator.boundingBox();
  const renderedStadiumContainerBounds = await topOwnerHost
    .locator(`[data-zone-content-id="${candidateStadiumZone.id}"]`)
    .boundingBox();
  if (!renderedStadiumBounds || !renderedStadiumContainerBounds) {
    throw new Error('Missing rendered top-owner stadium geometry');
  }
  expectAnchorWithin(
    renderedStadiumContainerBounds,
    opponentStadium.containerBounds,
    'shared-stadium-opponent.rendered-container'
  );
  expectSizeWithin(
    renderedStadiumContainerBounds,
    opponentStadium.containerBounds,
    'shared-stadium-opponent.rendered-container'
  );
  expectAnchorWithin(
    renderedStadiumBounds,
    opponentStadium.physicalBounds,
    'shared-stadium-opponent.rendered-card'
  );
  expectSizeWithin(
    renderedStadiumBounds,
    opponentStadium.physicalBounds,
    'shared-stadium-opponent.rendered-card'
  );
  expect(
    Math.abs(
      renderedStadiumBounds.y +
        renderedStadiumBounds.height -
        (renderedStadiumContainerBounds.y +
          renderedStadiumContainerBounds.height)
    )
  ).toBeLessThanOrEqual(anchorTolerancePixels);
  const renderedTopOwner = await topOwnerLocator.evaluate((element) => {
    const styles = getComputedStyle(element);
    const matrix = new DOMMatrixReadOnly(styles.transform);
    const bounds = element.getBoundingClientRect();
    const host = element.closest<HTMLElement>(
      '[data-top-owner-stadium-candidate-host]'
    );
    const topmost = document
      .elementsFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2
      )
      .find((candidateElement) => {
        const card = candidateElement.closest<HTMLElement>('[data-card-id]');
        return card && host?.contains(card);
      })
      ?.closest<HTMLElement>('[data-card-id]');
    return {
      rotationDegrees:
        ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
      zIndex: Number.parseInt(styles.zIndex, 10),
      topmostCardId: topmost?.dataset.cardId ?? null,
    };
  });
  expect(
    modularDegreesBetween(
      renderedTopOwner.rotationDegrees,
      opponentStadium.effectiveRotationDegrees
    )
  ).toBeLessThanOrEqual(rotationToleranceDegrees);
  expect(renderedTopOwner.zIndex).toBe(candidateStadiumCard.zIndex);
  expect(renderedTopOwner.topmostCardId).toBe(candidateStadiumCard.id);

  await testInfo.attach('react-dom-top-owner-stadium-parity.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          source: opponentStadium,
          candidate: {
            cardId: candidateStadiumCard.id,
            ownerId: candidateStadiumCard.ownerId,
            rotationQuarterTurns: candidateStadiumCard.rotationQuarterTurns,
            sceneCardBounds: candidateStadiumCard.bounds,
            sceneContainerBounds: candidateStadiumZone.contentBounds,
            renderedCardBounds: renderedStadiumBounds,
            renderedContainerBounds: renderedStadiumContainerBounds,
            ...renderedTopOwner,
          },
        },
        null,
        2
      )
    ),
    contentType: 'application/json',
  });
  const teardown = await page.evaluate(async () => {
    const fixtureWindow = window as typeof window & {
      __PTCG_TOP_OWNER_STADIUM_CANDIDATE_RENDERER__?: { destroy(): void };
    };
    const host = document.querySelector<HTMLElement>(
      '[data-top-owner-stadium-candidate-host]'
    );
    const rendererErrorBeforeDestroy = host?.dataset.rendererError ?? null;
    fixtureWindow.__PTCG_TOP_OWNER_STADIUM_CANDIDATE_RENDERER__?.destroy();
    delete fixtureWindow.__PTCG_TOP_OWNER_STADIUM_CANDIDATE_RENDERER__;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve())
    );
    const result = {
      rendererErrorBeforeDestroy,
      rendererErrorAfterDestroy: host?.dataset.rendererError ?? null,
      childElementCount: host?.childElementCount ?? null,
      renderedCardCount:
        host?.querySelectorAll('[data-card-id]').length ?? null,
      renderedZoneCount:
        host?.querySelectorAll('[data-zone-id]').length ?? null,
      renderedMarkerCount:
        host?.querySelectorAll('[data-marker-id]').length ?? null,
      renderedSurfaceCount:
        host?.querySelectorAll('.ptcgsim-board-surface').length ?? null,
      rendererSeamRetained:
        '__PTCG_TOP_OWNER_STADIUM_CANDIDATE_RENDERER__' in fixtureWindow,
    };
    host?.remove();
    return { ...result, hostConnectedAfterRemoval: host?.isConnected ?? null };
  });
  expect(teardown).toEqual({
    rendererErrorBeforeDestroy: null,
    rendererErrorAfterDestroy: null,
    childElementCount: 0,
    renderedCardCount: 0,
    renderedZoneCount: 0,
    renderedMarkerCount: 0,
    renderedSurfaceCount: 0,
    rendererSeamRetained: false,
    hostConnectedAfterRemoval: false,
  });
  await expect(topOwnerHost).toHaveCount(0);
  await page.waitForTimeout(0);
  expect(candidateRuntimeErrors).toEqual([]);
});
