import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/marker-movement-v1.json' with { type: 'json' };

import {
  captureLegacySourceMarkerMovementFixture,
  type CapturedRect,
} from './support/legacy-source-board.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

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

test('marker movement oracle pins every claimed source and binary asset digest', async () => {
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

test('legacy movement reparents stable marker nodes while reconstructing stack wrappers', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The source marker-movement checkpoint is Chromium-specific.'
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
    ) {
      return;
    }
    runtimeErrors.push(`console.error: ${text}`);
  });

  const capture = await captureLegacySourceMarkerMovementFixture(page);
  await testInfo.attach('legacy-source-marker-movement-geometry.json', {
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
  expect(capture.cases.map(({ id }) => id)).toEqual(oracle.input.cases);

  for (const side of ['local', 'opponent'] as const) {
    expectRect(
      capture.frames[side],
      oracle.expected.frames[side],
      `${side}.frame`
    );
    const movement = capture.cases.find((entry) => entry.side === side);
    if (!movement) throw new Error(`Missing ${side} marker movement case`);
    expect(movement.phases.map(({ name }) => name)).toEqual(
      oracle.expected.phaseNames
    );
    expect(movement.phases.map(({ zoneId }) => zoneId)).toEqual(
      oracle.expected.phaseZones
    );
    expect(
      movement.phases.map((phase) => phase.markers.map(({ kind }) => kind))
    ).toEqual(oracle.expected.phaseMarkerKinds);
    expect(
      movement.phases.map(
        ({ activeWrapperCountAfterSettle }) => activeWrapperCountAfterSettle
      )
    ).toEqual(oracle.expected.activeWrapperCounts);
    expect(
      movement.phases.map(
        ({ benchWrapperCountAfterSettle }) => benchWrapperCountAfterSettle
      )
    ).toEqual(oracle.expected.benchWrapperCounts);
    expect(movement.callTrace).toEqual(oracle.expected.callTrace);
    expect(movement.cleanup).toEqual(oracle.expected.cleanup);

    const [initial, demoted, refreshed, promoted] = movement.phases;
    if (!initial || !demoted || !refreshed || !promoted) {
      throw new Error(`Incomplete ${side} marker movement phases`);
    }
    expect(movement.phases.every(({ cardNodeStable }) => cardNodeStable)).toBe(
      true
    );
    expect(
      movement.phases.map(({ wrapperNodeStable }) => wrapperNodeStable)
    ).toEqual([true, false, false, false]);
    expect(
      new Set(movement.phases.map(({ wrapperId }) => wrapperId)).size
    ).toBe(movement.phases.length);
    expect(initial).toMatchObject({
      priorWrapperId: null,
      sameWrapperAsPrior: null,
      wrapperCountImmediately: 1,
      priorWrapperConnectedImmediately: null,
      priorWrapperConnectedAfterSettle: null,
    });
    for (const [prior, phase] of [
      [initial, demoted],
      [demoted, refreshed],
      [refreshed, promoted],
    ] as const) {
      expect(phase).toMatchObject({
        priorWrapperId: prior.wrapperId,
        sameWrapperAsPrior: false,
        wrapperCountImmediately: 2,
        priorWrapperConnectedImmediately: true,
        priorWrapperConnectedAfterSettle: false,
      });
    }

    expectRect(
      promoted.cardFrameLocalBounds,
      initial.cardFrameLocalBounds,
      `${side}.returned-active.card`
    );
    expectRect(
      refreshed.cardFrameLocalBounds,
      demoted.cardFrameLocalBounds,
      `${side}.refreshed-bench.card`
    );
    expectRect(
      promoted.cardPhysicalBounds,
      initial.cardPhysicalBounds,
      `${side}.returned-active.cardPhysical`
    );
    expectRect(
      refreshed.cardPhysicalBounds,
      demoted.cardPhysicalBounds,
      `${side}.refreshed-bench.cardPhysical`
    );

    const expectedMarkerIds = {
      damage: `${side}-marker-movement-damage`,
      specialCondition: `${side}-marker-movement-specialCondition`,
      ability: `${side}-marker-movement-ability`,
    } as const;
    for (const phase of movement.phases) {
      expect(phase.cardDamageCounterId).toBe(expectedMarkerIds.damage);
      expect(phase.cardAbilityCounterId).toBe(expectedMarkerIds.ability);
      expect(phase.cardSpecialConditionId).toBe(
        phase.name === 'initial-active'
          ? expectedMarkerIds.specialCondition
          : null
      );
      expect(phase.markers.every(({ nodeStable }) => nodeStable)).toBe(true);
      expect(
        phase.markers.every(({ parentZoneId }) => parentZoneId === phase.zoneId)
      ).toBe(true);
      expect(
        phase.markers.every(({ pointerEvents }) => pointerEvents === 'auto')
      ).toBe(true);
      expect(phase.markers.every(({ zIndex }) => zIndex === 1)).toBe(true);

      const damage = phase.markers.find(({ kind }) => kind === 'damage');
      const ability = phase.markers.find(({ kind }) => kind === 'ability');
      if (!damage || !ability) {
        throw new Error(`Missing ${side} ${phase.name} surviving markers`);
      }
      expect(damage).toMatchObject({
        id: expectedMarkerIds.damage,
        textContent: oracle.input.damage,
        contentEditable: 'true',
        backgroundColor: 'rgb(255, 98, 0)',
        color: 'rgb(255, 255, 255)',
      });
      expect(ability).toMatchObject({
        id: expectedMarkerIds.ability,
        textContent: '',
        contentEditable: 'inherit',
        backgroundColor:
          side === 'local'
            ? 'rgba(59, 141, 173, 0.71)'
            : 'rgba(255, 60, 0, 0.392)',
        color: 'rgb(0, 0, 0)',
      });
      expect(damage.frameLocalBounds.width).toBeCloseTo(
        phase.cardFrameLocalBounds.width / 3,
        3
      );
      expect(ability.frameLocalBounds.width).toBeCloseTo(
        phase.cardFrameLocalBounds.width,
        3
      );
    }

    const condition = initial.markers.find(
      ({ kind }) => kind === 'specialCondition'
    );
    expect(condition).toMatchObject({
      id: expectedMarkerIds.specialCondition,
      textContent: oracle.input.specialCondition,
      contentEditable: 'true',
      backgroundColor: 'rgb(128, 0, 128)',
      color: 'rgb(255, 255, 255)',
    });
    expect(
      movement.phases
        .slice(1)
        .every((phase) =>
          phase.markers.every(({ kind }) => kind !== 'specialCondition')
        )
    ).toBe(true);

    for (const kind of ['damage', 'ability'] as const) {
      const initialMarker = initial.markers.find(
        (marker) => marker.kind === kind
      );
      const promotedMarker = promoted.markers.find(
        (marker) => marker.kind === kind
      );
      const demotedMarker = demoted.markers.find(
        (marker) => marker.kind === kind
      );
      const refreshedMarker = refreshed.markers.find(
        (marker) => marker.kind === kind
      );
      if (
        !initialMarker ||
        !promotedMarker ||
        !demotedMarker ||
        !refreshedMarker
      ) {
        throw new Error(`Missing ${side} ${kind} movement geometry`);
      }
      expectRect(
        promotedMarker.frameLocalBounds,
        initialMarker.frameLocalBounds,
        `${side}.returned-active.${kind}`
      );
      expectRect(
        refreshedMarker.frameLocalBounds,
        demotedMarker.frameLocalBounds,
        `${side}.settled-refreshed-bench.${kind}`
      );
      const refreshedImmediateBounds =
        refreshed.markerFrameLocalBoundsImmediately[kind];
      if (!refreshedImmediateBounds) {
        throw new Error(`Missing ${side} ${kind} immediate refresh geometry`);
      }
      expect(
        refreshedImmediateBounds.x - demotedMarker.frameLocalBounds.x
      ).toBeCloseTo(oracle.expected.benchRefreshTransientMarkerXDrift, 6);
      expect(refreshedImmediateBounds.y).toBeCloseTo(
        demotedMarker.frameLocalBounds.y,
        6
      );
      expect(refreshedImmediateBounds.width).toBeCloseTo(
        demotedMarker.frameLocalBounds.width,
        6
      );
      expect(refreshedImmediateBounds.height).toBeCloseTo(
        demotedMarker.frameLocalBounds.height,
        6
      );
    }
  }

  expect(runtimeErrors).toEqual([]);
});
