import { expect, test } from '@playwright/test';

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

test('source-backed contained cards match the DOM candidate at legacy pile tops', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'This source-characterization gate is Chromium-specific.'
  );
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
});
