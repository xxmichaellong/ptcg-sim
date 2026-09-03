import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { asPlayerId } from '../../packages/game-core/src/index.js';
import {
  createBoardLayoutSnapshot,
  findBoardLayoutRegion,
  LEGACY_BOARD_AFFORDANCES_V1,
  LEGACY_BOARD_Z_ORDER_V1,
  type BoardLayoutRegionKind,
  type BoardLayoutState,
  type BoardSide,
  type BoardVerticalLayoutState,
} from '../../packages/renderer-contract/src/index.js';
import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/board-layout-v1.json';

interface ExpectedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const expectRectWithin = (
  actual: ExpectedRect,
  expected: ExpectedRect,
  tolerance: number
): void => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(tolerance);
  }
};

const expectNullableRectWithin = (
  actual: ExpectedRect | null,
  expected: ExpectedRect | null,
  tolerance: number
): void => {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  expectRectWithin(actual!, expected, tolerance);
};

const layoutState = (input: (typeof oracle.cases)[number]['input']) => ({
  geometryVersion: 1 as const,
  viewport: input.viewport,
  playerIds: [
    asPlayerId(input.playerIds[0]),
    asPlayerId(input.playerIds[1]),
  ] as const,
  bottomPlayerId: asPlayerId(input.bottomPlayerId),
  shellMode: input.shellMode as BoardLayoutState['shellMode'],
  vertical: input.vertical as BoardVerticalLayoutState,
});

describe('source-pinned legacy board layout oracle', () => {
  it('invalidates the oracle when any recorded legacy source changes', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain('not generated');
    const sourcePaths = oracle.provenance.map((source) => source.path);
    expect(new Set(sourcePaths).size).toBe(sourcePaths.length);

    const claimedSourcePaths = new Set(
      oracle.provenanceClaims.flatMap((claim) => claim.sources)
    );
    expect([...claimedSourcePaths].sort()).toEqual([...sourcePaths].sort());
    for (const claim of oracle.provenanceClaims) {
      expect(claim.sources.length, claim.claim).toBeGreaterThan(0);
      expect(new Set(claim.sources).size, claim.claim).toBe(
        claim.sources.length
      );
      for (const path of claim.sources) {
        expect(sourcePaths, `${claim.claim}: ${path}`).toContain(path);
      }
    }

    for (const source of oracle.provenance) {
      // Canonical LF makes the source pin portable across Git autocrlf modes.
      const content = readFileSync(
        resolve(process.cwd(), source.path),
        'utf8'
      ).replaceAll('\r\n', '\n');
      const digest = createHash('sha256').update(content).digest('hex');
      expect(digest, source.path).toBe(source.sha256);
    }
  });

  it('pins source-observed semantic z ranks and interaction affordances', () => {
    expect(LEGACY_BOARD_Z_ORDER_V1).toEqual(
      oracle.interactionOracle.semanticZOrder
    );
    expect(LEGACY_BOARD_AFFORDANCES_V1).toEqual(
      oracle.interactionOracle.affordances
    );
  });

  for (const fixture of oracle.cases) {
    it(`matches independently recorded ideal CSS geometry: ${fixture.name}`, () => {
      const tolerance = oracle.tolerances.structuredPixels;
      const snapshot = createBoardLayoutSnapshot(layoutState(fixture.input));
      expectRectWithin(
        snapshot.playAreaBounds,
        fixture.expected.playAreaBounds,
        tolerance
      );
      expectNullableRectWithin(
        snapshot.shellGapBounds,
        fixture.expected.shellGapBounds,
        tolerance
      );
      expectNullableRectWithin(
        snapshot.sidebarBounds,
        fixture.expected.sidebarBounds,
        tolerance
      );
      expectNullableRectWithin(
        snapshot.tabsBounds,
        fixture.expected.tabsBounds,
        tolerance
      );

      expect(snapshot.players).toHaveLength(fixture.expected.players.length);
      fixture.expected.players.forEach((expectedPlayer, index) => {
        const actual = snapshot.players[index];
        expect(actual).toMatchObject({
          playerId: expectedPlayer.playerId,
          side: expectedPlayer.side,
          physicalSide: expectedPlayer.physicalSide,
          rotationQuarterTurns: expectedPlayer.rotationQuarterTurns,
        });
        expectRectWithin(
          actual!.frameBounds,
          expectedPlayer.frameBounds,
          tolerance
        );
      });

      expectRectWithin(
        snapshot.shared.stadium.physicalDeclaredBounds,
        fixture.expected.stadiumBounds,
        tolerance
      );
      expect(snapshot.shared.boardControlsAnchor.x).toBeCloseTo(
        fixture.expected.boardControlsAnchor.x,
        6
      );
      expect(snapshot.shared.boardControlsAnchor.y).toBeCloseTo(
        fixture.expected.boardControlsAnchor.y,
        6
      );
      expect(snapshot.shared.boardControlsAnchor.height).toBeCloseTo(
        fixture.expected.boardControlsAnchor.height,
        6
      );

      expect(snapshot.resizeHandles).toHaveLength(
        fixture.expected.resizeHandles.length
      );
      fixture.expected.resizeHandles.forEach((expectedHandle, index) => {
        const actual = snapshot.resizeHandles[index];
        expect(actual?.id).toBe(expectedHandle.id);
        expectRectWithin(actual!.bounds, expectedHandle.bounds, tolerance);
      });

      for (const expectedRegion of fixture.expected.regions) {
        const actual = findBoardLayoutRegion(
          snapshot,
          expectedRegion.side as BoardSide,
          expectedRegion.kind as BoardLayoutRegionKind
        );
        expectRectWithin(
          actual.physicalDeclaredBounds,
          expectedRegion.declaredBounds,
          tolerance
        );
        expectRectWithin(
          actual.physicalBorderBoxBounds,
          expectedRegion.borderBoxBounds,
          tolerance
        );
        expectRectWithin(
          actual.physicalContentBoxBounds,
          expectedRegion.contentBoxBounds,
          tolerance
        );
      }
    });
  }
});
