import { expect, test } from '@playwright/test';

import { asPlayerId } from '../../packages/game-core/src/ids.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  findBoardLayoutRegion,
  layoutLegacyPlaySlotCards,
  type BoardLayoutState,
} from '../../packages/renderer-contract/src/layout.js';

import boardOracle from '../legacy-fixtures/renderer/board-layout-v1.json' with { type: 'json' };
import cardOracle from '../legacy-fixtures/renderer/card-stack-layout-v1.json' with { type: 'json' };
import { loadLegacyRuntime } from './support/legacy-runtime.js';

const fixture = boardOracle.cases.find(
  (candidate) => candidate.name === 'desktop-sidebar-css-default'
);
if (!fixture) throw new Error('Missing desktop legacy geometry fixture');

const portrait = cardOracle.input.assets.portrait;
const tolerance = boardOracle.tolerances.browserPixels;

const layoutState: BoardLayoutState = {
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport: {
    width: fixture.input.viewport.width,
    height: fixture.input.viewport.height,
    devicePixelRatio: fixture.input.viewport.devicePixelRatio,
  },
  playerIds: [asPlayerId('blue'), asPlayerId('red')],
  bottomPlayerId: asPlayerId('blue'),
  shellMode: 'sidebar',
  vertical: fixture.input.vertical as BoardLayoutState['vertical'],
};

/**
 * Every other legacy gate stubs `front-end.js` and compares against a
 * TypeScript re-implementation of it, so a pass says the transcription agrees
 * with itself. This one runs the checked-in v1 modules and measures what they
 * actually do.
 *
 * It is deliberately narrow: one card placed on the active slot through the
 * real `Card` and `initializeActiveBenchCard`. The point is not coverage but
 * establishing that the real runtime is usable as the oracle, and that the
 * recorded numbers the transcription is built on describe v1 rather than the
 * transcription's own arithmetic.
 */
test('the real v1 runtime places an active card where the recorded oracle says', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );

  const page = await browser.newPage({
    viewport: {
      width: fixture.input.viewport.width,
      height: fixture.input.viewport.height,
    },
    deviceScaleFactor: fixture.input.viewport.devicePixelRatio,
  });

  let loaded: Awaited<ReturnType<typeof loadLegacyRuntime>>;
  let placement: {
    readonly clientWidth: number;
    readonly clientHeight: number;
    readonly naturalWidth: number;
    readonly naturalHeight: number;
    readonly frameLocal: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    readonly complete: boolean;
    readonly zoneChildren: number;
    readonly containerClassName: string;
  };
  try {
    loaded = await loadLegacyRuntime(page);
    placement = await page.evaluate(async () => {
      // Indirected through variables so TypeScript does not try to resolve
      // these browser-only specifiers against the Node module graph.
      const load = (specifier: string): Promise<Record<string, never>> =>
        import(/* @vite-ignore */ specifier);
      const [cardModule, placementModule, zoneModule] = await Promise.all([
        load('/src/setup/deck-constructor/card.js'),
        load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
        load('/src/setup/zones/get-zone.js'),
      ]);
      const Card = (
        cardModule as unknown as {
          readonly Card: new (
            user: string,
            name: string,
            type: string,
            imageUrl: string
          ) => { readonly image: HTMLImageElement };
        }
      ).Card;
      const { initializeActiveBenchCard } = placementModule as unknown as {
        readonly initializeActiveBenchCard: (
          user: string,
          card: unknown,
          zoneId: string,
          zone: { readonly element: HTMLElement }
        ) => void;
      };
      const { getZone } = zoneModule as unknown as {
        readonly getZone: (
          user: string,
          zoneId: string
        ) => { readonly element: HTMLElement };
      };
      const zone = getZone('self', 'active');
      const card = new Card(
        'self',
        'cardback',
        'Pokémon',
        `${location.origin}/src/assets/cardback.png`
      );
      await card.image.decode();
      initializeActiveBenchCard('self', card, 'active', zone);
      // The card image is created in the top document and then appended into
      // the player iframe. Adopting it across documents restarts the image
      // load, so the decode above no longer applies and intrinsic size is 0
      // until the refetch lands. Wait for the element itself rather than a
      // fixed number of frames, which only holds on an idle machine.
      const deadline = Date.now() + 10_000;
      while (
        !(card.image.complete && card.image.naturalWidth > 0) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const rect = card.image.getBoundingClientRect();
      return {
        clientWidth: card.image.clientWidth,
        clientHeight: card.image.clientHeight,
        naturalWidth: card.image.naturalWidth,
        naturalHeight: card.image.naturalHeight,
        frameLocal: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        complete: card.image.complete,
        zoneChildren: zone.element.children.length,
        containerClassName: card.image.parentElement?.className ?? '',
      };
    });
  } finally {
    await page.close();
  }

  await testInfo.attach('legacy-runtime-placement.json', {
    body: Buffer.from(JSON.stringify({ loaded, placement }, null, 2)),
    contentType: 'application/json',
  });

  // Nothing may reach the network, and every requested path must exist.
  expect(loaded.missingPaths).toEqual([]);
  expect(loaded.blockedOrigins).not.toContain(
    new URL('http://ptcgsim-legacy-runtime.test').origin
  );
  expect(loaded.servedPaths).toContain('/src/front-end.js');
  expect(loaded.servedPaths).toContain('/src/assets/cardback.png');
  // The real module graph ran, not a stub of it.
  expect(
    loaded.servedPaths.filter((path) => path.endsWith('.js')).length
  ).toBeGreaterThan(100);

  // The asset the transcription's fixtures record.
  expect(placement.complete).toBe(true);
  expect(placement.naturalWidth).toBe(portrait.naturalWidth);
  expect(placement.naturalHeight).toBe(portrait.naturalHeight);
  expect(placement.containerClassName).toBe('play-container');
  expect(placement.zoneChildren).toBe(1);

  // v1 sizes the card by the slot height and lets the browser derive width
  // from the asset. This is the rule the recorded card oracle encodes.
  const snapshot = createBoardLayoutSnapshot(layoutState);
  const region = findBoardLayoutRegion(snapshot, 'local', 'active');
  const slotHeight = region.physicalDeclaredBounds.height;
  expect(placement.clientHeight).toBeCloseTo(slotHeight, 0);
  expect(placement.clientWidth).toBe(
    Math.round((slotHeight * portrait.naturalWidth) / portrait.naturalHeight)
  );
  expect(placement.frameLocal.width).toBeCloseTo(
    (slotHeight * portrait.naturalWidth) / portrait.naturalHeight,
    2
  );

  // The renderer-neutral helper centres a single card in the same slot. The
  // production helper uses the canonical 63/88 ratio by deliberate choice, so
  // the widths differ slightly; placement must still agree within the
  // documented browser tolerance.
  const modelled = layoutLegacyPlaySlotCards(region, [
    portrait.naturalWidth / portrait.naturalHeight,
  ]);
  expect(modelled).not.toBeNull();
  const modelledCard = modelled![0]!;
  expect(
    Math.abs(modelledCard.width - placement.frameLocal.width)
  ).toBeLessThan(0.01);
  expect(modelledCard.height).toBeCloseTo(placement.frameLocal.height, 2);
  // The measured rect is viewport-relative and the slot sits in the lower
  // frame, so compare the offset within that frame.
  const localPlayer = snapshot.players.find(
    (player) => player.side === 'local'
  )!;
  expect(
    Math.abs(
      modelledCard.x - (placement.frameLocal.x + localPlayer.frameBounds.x)
    )
  ).toBeLessThanOrEqual(tolerance);
});
