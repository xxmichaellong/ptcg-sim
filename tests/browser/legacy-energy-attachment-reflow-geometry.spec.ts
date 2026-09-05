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

import oracle from '../legacy-fixtures/renderer/energy-attachment-reflow-v1.json' with { type: 'json' };

import { captureLegacySourceEnergyAttachmentReflowFixture } from './support/legacy-source-board.js';

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const expectRectWithin = (
  actual: Rect,
  expected: Rect,
  label: string
): void => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  }
};

const expectCardSizeWithin = (
  actual: Rect,
  expected: Rect,
  label: string
): void => {
  for (const key of ['width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]) / expected[key],
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.cardSizeRelative);
  }
};

const modularDegreesBetween = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

const expectStructuredNumber = (
  actual: number,
  expected: number,
  label: string
): void => {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected}, received ${actual}`
  ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
};

const createCandidateSingleEnergyScene = () => {
  const base = createRendererSpikeView();
  const localPlayerId = base.playerOrder[0];
  const opponentPlayerId = base.playerOrder[1];
  const definitions = Object.values(base.definitions);
  const pokemonDefinition = definitions.find(
    (definition) => definition.category === 'Pokémon'
  );
  const energyDefinition = definitions.find(
    (definition) => definition.category === 'Energy'
  );
  if (
    !localPlayerId ||
    !opponentPlayerId ||
    !pokemonDefinition ||
    !energyDefinition
  ) {
    throw new Error('Renderer spike fixture lacks one-Energy scene inputs');
  }
  const makeCard = (
    id: string,
    ownerId: PlayerId,
    category: 'Pokémon' | 'Energy'
  ) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId:
      category === 'Pokémon' ? pokemonDefinition.id : energyDefinition.id,
    ownerId,
    category,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: false,
  });
  const makeStack = (side: 'local' | 'opponent', boardPlayerId: PlayerId) => ({
    id: `${side}-canonical-attachment-stack`,
    boardPlayerId,
    slot: 'active' as const,
    evolutionCards: [
      makeCard(`${side}-attachment-base`, boardPlayerId, 'Pokémon'),
    ],
    attachmentCards: [
      makeCard(`${side}-attachment-energy`, boardPlayerId, 'Energy'),
    ],
    rotationQuarterTurns: 0 as const,
    damage: null,
    specialCondition: null,
    abilityUsed: false,
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

test('checked-in legacy sources and React DOM share stable one-Energy attachment reflow', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'This source-characterization gate is Chromium-specific.'
  );
  const candidateScene = createCandidateSingleEnergyScene();
  await page.setViewportSize(oracle.input.viewport);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
    oracle.input.viewport.devicePixelRatio
  );
  const capture = await captureLegacySourceEnergyAttachmentReflowFixture(page);
  await testInfo.attach('legacy-energy-attachment-reflow-geometry.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });

  expect(capture.cards).toHaveLength(4);
  expect(capture.stacks).toHaveLength(2);

  for (const side of ['local', 'opponent'] as const) {
    expectRectWithin(
      capture.frames[side],
      oracle.expected.frames[side],
      `${side}.frame`
    );
    for (const key of ['a', 'b', 'c', 'd', 'rotationDegrees'] as const) {
      expect(capture.frameTransforms[side][key]).toBeCloseTo(
        oracle.expected.frameTransforms[side][key],
        10
      );
    }
  }

  for (const expectedCard of oracle.expected.cards) {
    const actual = capture.cards.find((card) => card.id === expectedCard.id);
    if (!actual) throw new Error(`Missing captured card ${expectedCard.id}`);
    expect(actual).toMatchObject({
      id: expectedCard.id,
      role: expectedCard.role,
      side: expectedCard.side,
      naturalWidth: oracle.input.asset.naturalWidth,
      naturalHeight: oracle.input.asset.naturalHeight,
      clientWidth: 91,
      clientHeight: 126,
      localRotationDegrees: 0,
      zIndex: expectedCard.role === 'base' ? 0 : -1,
      inlineBottomPx: 0,
      attached: expectedCard.role === 'energy',
      target: expectedCard.role === 'base' ? 'off' : 'on',
      relativeId:
        expectedCard.role === 'base'
          ? null
          : `${expectedCard.side}-attachment-base`,
      energyLayer: expectedCard.role === 'base' ? 1 : 0,
      layer: 0,
      domOrdinal: expectedCard.role === 'base' ? 0 : 1,
      sourcePath: oracle.input.asset.path,
    });
    expectRectWithin(
      actual.physicalBounds,
      expectedCard.physicalBounds,
      expectedCard.id
    );
    expectCardSizeWithin(
      actual.physicalBounds,
      expectedCard.physicalBounds,
      expectedCard.id
    );
    expectStructuredNumber(
      actual.inlineLeftPx,
      expectedCard.role === 'base' ? 0 : actual.clientWidth / 6,
      `${expectedCard.id}.inlineLeftPx`
    );
    expect(
      modularDegreesBetween(
        actual.effectiveRotationDegrees,
        expectedCard.side === 'local' ? 0 : 180
      )
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
    const physicalFromFrame =
      expectedCard.side === 'local'
        ? {
            x: capture.frames.local.x + actual.frameLocalBounds.x,
            y: capture.frames.local.y + actual.frameLocalBounds.y,
          }
        : {
            x:
              capture.frames.opponent.x +
              capture.frames.opponent.width -
              actual.frameLocalBounds.x -
              actual.frameLocalBounds.width,
            y:
              capture.frames.opponent.y +
              capture.frames.opponent.height -
              actual.frameLocalBounds.y -
              actual.frameLocalBounds.height,
          };
    expectStructuredNumber(
      actual.physicalBounds.x,
      physicalFromFrame.x,
      `${expectedCard.id}.physicalFromFrame.x`
    );
    expectStructuredNumber(
      actual.physicalBounds.y,
      physicalFromFrame.y,
      `${expectedCard.id}.physicalFromFrame.y`
    );
  }

  expect(capture.stacks.map(({ id, side }) => ({ id, side }))).toEqual(
    oracle.expected.stacks.map(({ id, side }) => ({ id, side }))
  );
  expect(new Set(capture.stacks.map((stack) => stack.id)).size).toBe(
    capture.stacks.length
  );

  for (const expectedStack of oracle.expected.stacks) {
    const actual = capture.stacks.find(
      (stack) => stack.id === expectedStack.id
    );
    if (!actual) throw new Error(`Missing captured stack ${expectedStack.id}`);
    expectRectWithin(
      actual.physicalBounds,
      expectedStack.physicalBounds,
      expectedStack.id
    );
    expect(actual).toMatchObject({
      side: expectedStack.side,
      baseClientWidth: expectedStack.baseClientWidth,
      clientWidth: expectedStack.clientWidth,
      attachmentClientWidthsBefore: expectedStack.attachmentClientWidthsBefore,
      attachmentAuthoredWidthsPx: expectedStack.attachmentAuthoredWidthsPx,
      inlineMarginRight: expectedStack.inlineMarginRight,
      inlineMarginLeft: expectedStack.inlineMarginLeft,
      computedMarginRightPx: expectedStack.computedMarginRightPx,
      computedMarginLeftPx: expectedStack.computedMarginLeftPx,
      childDomOrder: expectedStack.childDomOrder,
      logicalOrder: expectedStack.logicalOrder,
      hitOrder: expectedStack.hitOrder,
      synchronousPostRefreshContainerCount:
        oracle.phaseInvariants.stablePostRefresh.synchronousWrapperCount,
      oldContainerConnectedImmediatelyAfterRefresh: true,
      stableContainerCount:
        oracle.phaseInvariants.stablePostRefresh.stableWrapperCount,
      oldContainerConnected: false,
    });
    expectStructuredNumber(
      actual.authoredWidthPx,
      expectedStack.authoredWidthPx,
      `${expectedStack.id}.authoredWidthPx`
    );
    expectStructuredNumber(
      actual.authoredWidthPx,
      actual.baseClientWidth + actual.baseClientWidth / 6,
      `${expectedStack.id}.adjustCardsWidth`
    );
    expect(actual.transientPostAttach).toEqual({
      logicalOrder: expectedStack.logicalOrder,
      domOrder: expectedStack.childDomOrder,
      clientWidth: oracle.phaseInvariants.transientPostAttach.clientWidth,
      authoredWidthPx:
        oracle.phaseInvariants.transientPostAttach.authoredWidthPx,
    });
  }

  expect(capture.sourceFulfillment.servedPaths).toContain(
    '/src/assets/cardback.png'
  );
  expect(capture.sourceFulfillment.blockedExternalOrigins).toContain(
    'https://cdn.socket.io'
  );
  expect(capture.sourceFulfillment.unexpectedSameOriginPaths).toEqual([]);

  expect(candidateScene.cards).toHaveLength(4);
  expect(new Set(candidateScene.cards.map((card) => card.id))).toEqual(
    new Set(capture.cards.map((card) => card.id))
  );
  expect(candidateScene.markers).toEqual([]);

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
  await page.evaluate(async (scene) => {
    const spike = window.__PTCG_RENDERER_SPIKE__;
    if (!spike?.createRenderer) {
      throw new Error('Missing renderer spike factory test seam');
    }
    const host = document.createElement('div');
    host.dataset.energyAttachmentCandidateHost = 'true';
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
        __PTCG_ENERGY_ATTACHMENT_CANDIDATE_RENDERER__?: { destroy(): void };
      }
    ).__PTCG_ENERGY_ATTACHMENT_CANDIDATE_RENDERER__ = renderer;
  }, candidateScene);
  const candidateHost = page.locator('[data-energy-attachment-candidate-host]');
  await expect(candidateHost).not.toHaveAttribute('data-renderer-error', /.+/u);
  await expect(
    candidateHost.locator('[data-card-id="local-attachment-base"]')
  ).toBeVisible();

  const candidateEvidence: {
    cards: Array<{
      id: string;
      sceneBounds: Rect;
      renderedBounds: Rect;
      rotationDegrees: number;
      zIndex: number;
    }>;
    stacks: Array<{
      id: string;
      domOrder: string[];
      hitOrder: { commonOverlap: string[]; energyOnly: string[] };
    }>;
  } = { cards: [], stacks: [] };
  for (const sourceCard of capture.cards) {
    const candidate = candidateScene.cards.find(
      (card) => card.id === sourceCard.id
    );
    if (!candidate) {
      throw new Error(`Missing candidate card ${sourceCard.id}`);
    }
    expect(candidate).toMatchObject({
      side: sourceCard.side,
      role: sourceCard.role === 'base' ? 'stackEvolution' : 'stackAttachment',
      zIndex: sourceCard.role === 'base' ? 300 : 299,
      rotationQuarterTurns: sourceCard.side === 'local' ? 0 : 2,
      interactive: true,
    });
    expectRectWithin(
      candidate.bounds,
      sourceCard.physicalBounds,
      `${sourceCard.id}.scene`
    );
    expectCardSizeWithin(
      candidate.bounds,
      sourceCard.physicalBounds,
      `${sourceCard.id}.scene`
    );
    const locator = candidateHost.locator(`[data-card-id="${sourceCard.id}"]`);
    const renderedBounds = await locator.boundingBox();
    if (!renderedBounds) {
      throw new Error(`Candidate card is not visible: ${sourceCard.id}`);
    }
    expectRectWithin(
      renderedBounds,
      sourceCard.physicalBounds,
      `${sourceCard.id}.rendered`
    );
    expectCardSizeWithin(
      renderedBounds,
      sourceCard.physicalBounds,
      `${sourceCard.id}.rendered`
    );
    const rendered = await locator.evaluate((element) => {
      const styles = getComputedStyle(element);
      const matrix = new DOMMatrixReadOnly(styles.transform);
      return {
        rotationDegrees:
          ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
        zIndex: Number.parseInt(styles.zIndex, 10),
      };
    });
    expect(
      modularDegreesBetween(
        rendered.rotationDegrees,
        sourceCard.effectiveRotationDegrees
      )
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
    expect(rendered.zIndex).toBe(sourceCard.role === 'base' ? 300 : 299);
    candidateEvidence.cards.push({
      id: sourceCard.id,
      sceneBounds: candidate.bounds,
      renderedBounds,
      ...rendered,
    });
  }

  for (const sourceStack of capture.stacks) {
    const result = await page.evaluate(
      ({ side }) => {
        const host = document.querySelector<HTMLElement>(
          '[data-energy-attachment-candidate-host]'
        );
        if (!host) throw new Error('Missing one-Energy candidate host');
        const prefix = `${side}-attachment-`;
        const requireCard = (role: 'base' | 'energy') => {
          const element = host.querySelector<HTMLElement>(
            `[data-card-id="${prefix}${role}"]`
          );
          if (!element) throw new Error(`Missing candidate ${side} ${role}`);
          return element.getBoundingClientRect();
        };
        const base = requireCard('base');
        const energy = requireCard('energy');
        const idsAt = (x: number, y: number) =>
          document
            .elementsFromPoint(x, y)
            .flatMap((element) => {
              const card = element.closest<HTMLElement>('[data-card-id]');
              return card && host.contains(card) && card.dataset.cardId
                ? [card.dataset.cardId]
                : [];
            })
            .filter(
              (id, index, ids) =>
                id.startsWith(prefix) && ids.indexOf(id) === index
            );
        const overlap = {
          left: Math.max(base.left, energy.left),
          top: Math.max(base.top, energy.top),
          right: Math.min(base.right, energy.right),
          bottom: Math.min(base.bottom, energy.bottom),
        };
        if (
          overlap.right - overlap.left <= 2 ||
          overlap.bottom - overlap.top <= 2
        ) {
          throw new Error('Candidate attachment overlap lacks a safe interior');
        }
        const energyOnly =
          side === 'local'
            ? { left: base.right + 2, right: energy.right }
            : { left: energy.left, right: base.left - 2 };
        if (energyOnly.right - energyOnly.left <= 2) {
          throw new Error('Candidate Energy-only strip lacks a safe interior');
        }
        const y = (overlap.top + overlap.bottom) / 2;
        return {
          domOrder: [
            ...host.querySelectorAll<HTMLElement>(
              `[data-card-id^="${prefix}"]`
            ),
          ].flatMap((card) =>
            card.dataset.cardId ? [card.dataset.cardId] : []
          ),
          hitOrder: {
            commonOverlap: idsAt((overlap.left + overlap.right) / 2, y),
            energyOnly: idsAt((energyOnly.left + energyOnly.right) / 2, y),
          },
        };
      },
      { side: sourceStack.side }
    );
    expect(result.hitOrder).toEqual(sourceStack.hitOrder);
    expect(result.domOrder).toEqual([
      `${sourceStack.side}-attachment-energy`,
      `${sourceStack.side}-attachment-base`,
    ]);
    expect(new Set(result.domOrder)).toEqual(
      new Set(sourceStack.childDomOrder)
    );
    candidateEvidence.stacks.push({ id: sourceStack.id, ...result });
  }
  await testInfo.attach('react-dom-energy-attachment-parity.json', {
    body: Buffer.from(JSON.stringify(candidateEvidence, null, 2)),
    contentType: 'application/json',
  });
  await expect(candidateHost).not.toHaveAttribute('data-renderer-error', /.+/u);
  const teardownError = await page.evaluate(async () => {
    const fixtureWindow = window as typeof window & {
      __PTCG_ENERGY_ATTACHMENT_CANDIDATE_RENDERER__?: { destroy(): void };
    };
    const host = document.querySelector<HTMLElement>(
      '[data-energy-attachment-candidate-host]'
    );
    fixtureWindow.__PTCG_ENERGY_ATTACHMENT_CANDIDATE_RENDERER__?.destroy();
    delete fixtureWindow.__PTCG_ENERGY_ATTACHMENT_CANDIDATE_RENDERER__;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const error = host?.dataset.rendererError ?? null;
    host?.remove();
    return error;
  });
  expect(teardownError).toBeNull();
  await page.waitForTimeout(0);
  expect(candidateRuntimeErrors).toEqual([]);
});
