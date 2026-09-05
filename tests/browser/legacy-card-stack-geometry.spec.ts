import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/card-stack-layout-v1.json' with { type: 'json' };

import { captureLegacySourceCardFixture } from './support/legacy-source-board.js';

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

const expectAnchorWithin = (
  actual: Rect,
  expected: Rect,
  label: string
): void => {
  for (const key of ['x', 'y'] as const) {
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

const expectRectWithinPixels = (
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

const modularDegreesBetween = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

test('card/stack oracle pins every source and binary asset digest', async () => {
  const paths = new Set(oracle.provenance.map((entry) => entry.path));
  expect(paths.size).toBe(oracle.provenance.length);
  for (const claim of oracle.provenanceClaims) {
    expect(claim.sources.length).toBeGreaterThan(0);
    for (const source of claim.sources) expect(paths.has(source)).toBe(true);
  }
  for (const entry of oracle.provenance) {
    expect(['utf8', 'binary']).toContain(entry.encoding);
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

test('checked-in legacy sources retain the pinned card and active-stack geometry', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'This first source-characterization gate is Chromium-specific.'
  );
  await page.setViewportSize(oracle.input.viewport);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
    oracle.input.viewport.devicePixelRatio
  );
  const capture = await captureLegacySourceCardFixture(page);
  await testInfo.attach('legacy-source-card-stack-geometry.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });

  for (const side of ['local', 'opponent'] as const) {
    const expectedFrame = oracle.expected.frames[side];
    expectRectWithinPixels(
      capture.frames[side],
      expectedFrame,
      `${side}.frame`
    );
    expect(capture.frameRotationDegrees[side]).toBe(
      oracle.expected.frameRotationDegrees[side]
    );
    for (const key of ['a', 'b', 'c', 'd'] as const) {
      expect(capture.frameTransforms[side][key]).toBeCloseTo(
        oracle.expected.frameTransforms[side][key],
        10
      );
    }
    expect(
      modularDegreesBetween(
        capture.frameTransforms[side].rotationDegrees,
        oracle.expected.frameRotationDegrees[side]
      )
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
  }

  expect(capture.cards).toHaveLength(oracle.expected.cards.length);
  for (const expectedCard of oracle.expected.cards) {
    const actual = capture.cards.find((card) => card.id === expectedCard.id);
    if (!actual) throw new Error(`Missing captured card ${expectedCard.id}`);
    expectAnchorWithin(
      actual.physicalBounds,
      expectedCard.physicalBounds,
      expectedCard.id
    );
    expectCardSizeWithin(
      actual.physicalBounds,
      expectedCard.physicalBounds,
      expectedCard.id
    );
    const isSquare = expectedCard.id.endsWith('-square');
    const expectedAsset = isSquare
      ? oracle.input.assets.square
      : oracle.input.assets.portrait;
    const activeLayer = expectedCard.id.match(
      /-active-(pokemon|energy)-(\d)$/u
    );
    const expectedStackId = expectedCard.id.includes('-active-')
      ? `${actual.side}-active-stack`
      : null;
    const expectedRole = expectedCard.id.includes('-hand-')
      ? 'hand'
      : expectedCard.id.includes('-bench-')
        ? 'bench'
        : expectedCard.id.endsWith('-active-base')
          ? 'stackBase'
          : expectedCard.id.includes('-active-pokemon-')
            ? 'stackPokemonLayer'
            : 'stackEnergyLayer';
    const expectedZIndex = activeLayer ? -Number(activeLayer[2]) : 0;
    expect(actual).toMatchObject({
      naturalWidth: expectedAsset.naturalWidth,
      naturalHeight: expectedAsset.naturalHeight,
      sourcePath: expectedAsset.path,
      parentStackId: expectedStackId,
      role: expectedRole,
      zIndex: expectedZIndex,
    });
    expect(
      modularDegreesBetween(
        actual.effectiveRotationDegrees,
        actual.side === 'local' ? 0 : 180
      ),
      `${expectedCard.id}.effectiveRotationDegrees`
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
    if (activeLayer) {
      const layer = Number(activeLayer[2]);
      const stack = capture.stacks.find(
        (candidate) => candidate.id === expectedStackId
      );
      if (!stack) throw new Error(`Missing captured stack ${expectedStackId}`);
      const expectedInlineOffset =
        (layer * stack.baseClientWidth) /
        (activeLayer[1] === 'pokemon' ? 15 : 6);
      const actualInlineOffset =
        activeLayer[1] === 'pokemon'
          ? actual.inlineBottomPx
          : actual.inlineLeftPx;
      expect(
        Math.abs(actualInlineOffset - expectedInlineOffset),
        `${expectedCard.id}.inlineOffset`
      ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
      expect(
        activeLayer[1] === 'pokemon'
          ? actual.inlineLeftPx
          : actual.inlineBottomPx
      ).toBe(0);
    } else {
      expect(actual.inlineLeftPx).toBe(0);
      expect(actual.inlineBottomPx).toBe(0);
    }
    if (expectedStackId) {
      const expectedStack = oracle.expected.stacks.find(
        (stack) => stack.id === expectedStackId
      );
      expect(actual.domOrdinal).toBe(
        expectedStack?.childDomOrder.indexOf(expectedCard.id)
      );
    } else {
      expect(actual.domOrdinal).toBe(
        expectedCard.id.includes('-hand-square') ? 1 : 0
      );
    }
    expect(
      modularDegreesBetween(actual.localRotationDegrees, 0),
      `${expectedCard.id}.localRotationDegrees`
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
    const physicalFromFrame =
      actual.side === 'local'
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
    expect(
      Math.abs(physicalFromFrame.x - actual.physicalBounds.x)
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
    expect(
      Math.abs(physicalFromFrame.y - actual.physicalBounds.y)
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  }

  expect(capture.stacks).toHaveLength(oracle.expected.stacks.length);
  for (const expectedStack of oracle.expected.stacks) {
    const actual = capture.stacks.find(
      (stack) => stack.id === expectedStack.id
    );
    if (!actual) throw new Error(`Missing captured stack ${expectedStack.id}`);
    expectRectWithinPixels(
      actual.physicalBounds,
      expectedStack.physicalBounds,
      expectedStack.id
    );
    expect(actual.baseClientWidth).toBe(expectedStack.baseClientWidth);
    expect(actual.clientWidth).toBe(expectedStack.clientWidth);
    expect(
      Math.abs(actual.authoredWidthPx - expectedStack.authoredWidthPx)
    ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
    expect(actual.energyContainerClientWidthsBefore).toEqual(
      expectedStack.energyContainerClientWidthsBefore
    );
    expect(actual.energyAuthoredWidthsPx).toHaveLength(2);
    actual.energyAuthoredWidthsPx.forEach((width, index) => {
      const expectedWidth = expectedStack.energyAuthoredWidthsPx[index];
      const clientWidthBefore = actual.energyContainerClientWidthsBefore[index];
      if (expectedWidth === undefined || clientWidthBefore === undefined) {
        throw new Error(`Incomplete energy-width oracle for ${actual.id}`);
      }
      expect(Math.abs(width - expectedWidth)).toBeLessThanOrEqual(
        oracle.tolerances.structuredPixels
      );
      expect(
        Math.abs(width - (clientWidthBefore + actual.baseClientWidth / 6))
      ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
    });
    expect(actual.childDomOrder).toEqual(expectedStack.childDomOrder);
    expect(actual.hitOrder).toEqual(expectedStack.hitOrder);
  }

  expect(capture.sourceFulfillment.servedPaths).toEqual(
    expect.arrayContaining([
      '/src/assets/cardback.png',
      '/src/assets/blank-logo.png',
    ])
  );
  expect(capture.sourceFulfillment.blockedExternalOrigins).toContain(
    'https://cdn.socket.io'
  );
  expect(capture.sourceFulfillment.unexpectedSameOriginPaths).toEqual([]);
});
