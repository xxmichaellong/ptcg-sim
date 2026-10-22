import { asPlayerId, type MatchViewState } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { resolveBoardDropTarget } from './drag.js';
import { CARD_ASPECT_RATIO } from './geometry.js';
import type { BoardLayoutState } from './layout.js';
import {
  APP_BAR_INSET_PX,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  TABLE_CONTROL_CORNER_HEIGHT_PX,
  TABLE_CONTROL_CORNER_PX,
  TABLE_FAR_HAND_SCALE,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  TABLE_SPLIT,
  createLayoutSnapshotFor,
  createTableLayoutSnapshot,
  layoutTableHand,
  layoutTablePrizes,
  resizeLayoutStateFor,
  tableRailWidth,
  tableVerticalLayout,
} from './layout-table.js';
import type { Rect } from './model.js';
import { createBoardScene } from './scene.js';
import { createRendererSpikeView } from './spike-fixture.js';

const blue = asPlayerId('spike-blue');
const red = asPlayerId('spike-red');
const stateAt = (
  width: number,
  height: number,
  overrides: Partial<BoardLayoutState> = {}
): BoardLayoutState => ({
  geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
  viewport: { width, height, devicePixelRatio: 1 },
  playerIds: [blue, red],
  bottomPlayerId: blue,
  shellMode: 'sidebar',
  vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
  ...overrides,
});
const region = (
  snapshot: ReturnType<typeof createTableLayoutSnapshot>,
  side: 'local' | 'opponent',
  kind: string
) =>
  snapshot.players
    .find((player) => player.side === side)!
    .regions.find((candidate) => candidate.kind === kind)!;
const inside = (rect: Rect, outer: Rect) =>
  rect.x >= outer.x - 0.01 &&
  rect.y >= outer.y - 0.01 &&
  rect.x + rect.width <= outer.x + outer.width + 0.01 &&
  rect.y + rect.height <= outer.y + outer.height + 0.01;
const overlaps = (left: Rect, right: Rect) =>
  left.x < right.x + right.width - 0.01 &&
  right.x < left.x + left.width - 0.01 &&
  left.y < right.y + right.height - 0.01 &&
  right.y < left.y + left.height - 0.01;

describe('table layout: the app bar corner (ADR-036)', () => {
  const BAR = { width: 242, height: 42 };
  /** The bar's box, at the play area's top right. */
  const barBox = (snapshot: ReturnType<typeof createTableLayoutSnapshot>) => ({
    x: snapshot.playAreaBounds.width - APP_BAR_INSET_PX - BAR.width,
    y: APP_BAR_INSET_PX,
    width: BAR.width,
    height: BAR.height,
  });
  const everything = (snapshot: ReturnType<typeof createTableLayoutSnapshot>) =>
    snapshot.players
      .filter((player) => !player.hidden)
      .flatMap((player) => player.regions.map((r) => r.physicalDeclaredBounds));

  it('keeps the far hand and every zone out of the bar, at every size and split', () => {
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [1024, 768],
      [768, 1024],
      [390, 844],
      [844, 390],
    ] as const) {
      for (const shellMode of ['fullscreen', 'sidebar'] as const) {
        const snapshot = createTableLayoutSnapshot(
          stateAt(width, height, { shellMode, appBarPx: BAR })
        );
        for (const rect of everything(snapshot)) {
          expect(overlaps(rect, barBox(snapshot)), `${width}x${height}`).toBe(
            false
          );
        }
        // The far hand ends a gap short of the bar.
        const hand = region(
          snapshot,
          'opponent',
          'hand'
        ).physicalDeclaredBounds;
        expect(hand.x + hand.width).toBeLessThanOrEqual(
          barBox(snapshot).x - APP_BAR_INSET_PX + 0.01
        );
      }
    }
  });

  it('leaves the near half where it was', () => {
    // The table's split is found as without the bar, so the bar never
    // reaches the near half: docked log or not, markers or none.
    for (const [width, height, sidebar, markers, lowerShare] of [
      [1440, 900, false, 0, undefined],
      [1193, 800, true, 0, undefined],
      [1077, 720, true, 0, undefined],
      [724, 768, false, 2, 0.46],
      [725, 768, false, 2, 0.46],
      [928, 768, false, 1, undefined],
      [600, 667, false, 2, 0.46],
    ] as const) {
      const state = {
        ...(sidebar
          ? { shellMode: 'sidebar' as const }
          : { shellMode: 'fullscreen' as const }),
        ...(markers ? { oncePerGameMarkers: markers } : {}),
        ...(lowerShare === undefined
          ? {}
          : { vertical: tableVerticalLayout(lowerShare) }),
        seamBandPx: 42,
      };
      const without = createTableLayoutSnapshot(stateAt(width, height, state));
      const withBar = createTableLayoutSnapshot(
        stateAt(width, height, { ...state, appBarPx: BAR })
      );
      for (const kind of [
        'hand',
        'active',
        'bench',
        'prizes',
        'deck',
        'lostZone',
      ]) {
        expect(
          region(withBar, 'local', kind).physicalDeclaredBounds,
          `${String(width)}x${String(height)} ${kind}`
        ).toEqual(region(without, 'local', kind).physicalDeclaredBounds);
      }
    }
  });

  it('keeps the far board rows on the shortest tables, and builds their scene', () => {
    const view: MatchViewState = createRendererSpikeView();
    for (const width of [320, 568, 740, 800, 844, 1280]) {
      for (const height of [190, 218, 252, 296, 320, 360, 390]) {
        for (const lowerShare of [0.54, 0.6, 0.66]) {
          for (const markers of [0, 2]) {
            for (const bar of [BAR, { width: 146, height: 50 }]) {
              const at = `${String(width)}x${String(height)} split=${String(lowerShare)} markers=${String(markers)} bar=${String(bar.height)}`;
              const snapshot = createTableLayoutSnapshot(
                stateAt(width, height, {
                  shellMode: 'fullscreen',
                  appBarPx: bar,
                  seamBandPx: 46,
                  vertical: tableVerticalLayout(lowerShare),
                  ...(markers ? { oncePerGameMarkers: markers } : {}),
                })
              );
              const far = snapshot.players.find(
                (player) => player.physicalSide === 'upper'
              )!;
              expect(
                far.regions.find((region) => region.kind === 'active')!
                  .physicalDeclaredBounds.height,
                at
              ).toBeGreaterThan(0);
              expect(() => createBoardScene(view, snapshot), at).not.toThrow();
              // A corner past the bar stays on the table.
              const corner = far.extras?.corner;
              if (corner) {
                expect(corner.x, at).toBeGreaterThanOrEqual(
                  far.frameBounds.x - 0.01
                );
              }
            }
          }
        }
      }
    }
  });

  it('keeps a lone half clear of the bar from the window top', () => {
    for (const hiddenPhysicalSide of ['upper', 'lower'] as const) {
      for (const [width, height] of [
        [1440, 900],
        [390, 844],
        [844, 390],
      ] as const) {
        const snapshot = createTableLayoutSnapshot(
          stateAt(width, height, {
            shellMode: 'fullscreen',
            hiddenPhysicalSide,
            appBarPx: BAR,
          })
        );
        for (const rect of everything(snapshot)) {
          expect(
            overlaps(rect, barBox(snapshot)),
            `${hiddenPhysicalSide} ${width}x${height}`
          ).toBe(false);
        }
        const stadium = snapshot.shared.stadium.physicalDeclaredBounds;
        expect(overlaps(stadium, barBox(snapshot))).toBe(false);
        const controls = snapshot.shared.boardControlsAnchor;
        expect(controls.y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps the far markers out of the bar: beside the prizes, or in a corner past it', () => {
    // On a phone the bar keeps three buttons, a finger's size.
    const PHONE_BAR = { width: 146, height: 50 };
    for (const [width, height] of [
      [320, 480],
      [320, 568],
      [360, 640],
      [390, 667],
      [390, 844],
      [430, 932],
      [844, 390],
      [932, 430],
      [768, 1024],
      [820, 1180],
      [1024, 768],
      [1366, 1024],
      [1280, 720],
      [1440, 900],
      [1920, 1080],
    ] as const) {
      const bar = width < 600 || height < 500 ? PHONE_BAR : BAR;
      for (const [markers, lowerShare] of [
        [1, undefined],
        [2, undefined],
        // The table split toward the near half, or the far.
        [2, 0.4],
        [2, 0.6],
      ] as const) {
        for (const hiddenPhysicalSide of [undefined, 'lower'] as const) {
          for (const lostZone of [true, false]) {
            const snapshot = createTableLayoutSnapshot(
              stateAt(width, height, {
                shellMode: 'fullscreen',
                appBarPx: bar,
                oncePerGameMarkers: markers,
                ...(lowerShare === undefined
                  ? {}
                  : { vertical: tableVerticalLayout(lowerShare) }),
                hideEmptyLostZone: !lostZone,
                ...(hiddenPhysicalSide ? { hiddenPhysicalSide } : {}),
              })
            );
            const far = snapshot.players.find(
              (player) => player.physicalSide === 'upper'
            )!;
            const hand = far.regions.find(
              (candidate) => candidate.kind === 'hand'
            )!.physicalDeclaredBounds;
            const frame = far.frameBounds;
            // Beside the prizes, in a corner the layout moved, or else in
            // the half's own corner beside the hand (shell.css): turned
            // with the half, the window's top right.
            const box = far.extras?.markers ??
              far.extras?.corner ?? {
                x: frame.x + frame.width - TABLE_CONTROL_CORNER_PX,
                y: frame.y,
                width: TABLE_CONTROL_CORNER_PX,
                height: Math.min(hand.height, TABLE_CONTROL_CORNER_HEIGHT_PX),
              };
            const at = `${width}x${height} ${String(markers)} split=${String(lowerShare)} ${String(hiddenPhysicalSide)} lostZone=${String(lostZone)}`;
            const barRect = {
              x: snapshot.playAreaBounds.width - APP_BAR_INSET_PX - bar.width,
              y: APP_BAR_INSET_PX,
              ...bar,
            };
            expect(overlaps(box, barRect), at).toBe(false);
            for (const other of far.regions) {
              expect(
                overlaps(box, other.physicalDeclaredBounds),
                `${at} ${other.kind}`
              ).toBe(false);
            }
            // However the markers sit, the far hand keeps room to hold its
            // cards apart: 128px, or all the bar leaves it on its own.
            const bare = createTableLayoutSnapshot(
              stateAt(width, height, {
                shellMode: 'fullscreen',
                appBarPx: bar,
                hideEmptyLostZone: !lostZone,
                ...(lowerShare === undefined
                  ? {}
                  : { vertical: tableVerticalLayout(lowerShare) }),
                ...(hiddenPhysicalSide ? { hiddenPhysicalSide } : {}),
              })
            )
              .players.find((player) => player.physicalSide === 'upper')!
              .regions.find(
                (candidate) => candidate.kind === 'hand'
              )!.physicalDeclaredBounds;
            expect(hand.width, at).toBeGreaterThanOrEqual(
              Math.min(128, bare.width) - 0.01
            );
            // On a phone, at least what the upright mat leaves past the
            // bar (the hand from the bar to its count badge).
            if (bar === PHONE_BAR && height > width) {
              const edge = Math.max(8, Math.min(16, width * 0.02));
              const pastBar = bar.width + 2 * APP_BAR_INSET_PX;
              expect(hand.width, at).toBeGreaterThanOrEqual(
                Math.min(128, width - edge - 44 - pastBar) - 0.01
              );
            }
            const corner = far.extras?.corner;
            if (corner && Math.abs(corner.y - hand.y) < 1e-6) {
              // The corner runs the hand strip's depth, past the bar, and
              // the hand starts after it.
              expect(corner.height).toBeCloseTo(hand.height, 6);
              expect(hand.x + hand.width).toBeLessThanOrEqual(corner.x + 0.01);
            } else if (corner) {
              // Or, on a narrow upright screen, a row of its own below the
              // bar, the hand at the edge beside the bar.
              expect(corner.y, at).toBeGreaterThanOrEqual(
                barRect.y + barRect.height
              );
              expect(corner.y, at).toBeGreaterThanOrEqual(
                hand.y + hand.height - 0.01
              );
            }
          }
        }
      }
    }
  });

  it('never leaves the far board without rows, the markers in a row of their own only where it has room', () => {
    const PHONE_BAR = { width: 146, height: 50 };
    for (let width = 320; width <= 420; width += 20) {
      for (let height = 300; height <= 420; height += 20) {
        for (const lowerShare of [0.4, 0.5, 0.6, 0.66]) {
          for (const markers of [0, 1, 2]) {
            const snapshot = createTableLayoutSnapshot(
              stateAt(width, height, {
                shellMode: 'fullscreen',
                appBarPx: PHONE_BAR,
                vertical: tableVerticalLayout(lowerShare),
                ...(markers ? { oncePerGameMarkers: markers } : {}),
              })
            );
            const far = snapshot.players.find(
              (player) => player.physicalSide === 'upper'
            )!;
            const at = `${String(width)}x${String(height)} split=${String(lowerShare)} markers=${String(markers)}`;
            for (const kind of ['active', 'bench'] as const) {
              const rect = far.regions.find(
                (region) => region.kind === kind
              )!.physicalDeclaredBounds;
              expect(rect.height, `${at} ${kind}`).toBeGreaterThan(0);
            }
            // A markers' row holds the markers: never beside the prizes too.
            const corner = far.extras?.corner;
            const hand = far.regions.find(
              (region) => region.kind === 'hand'
            )!.physicalDeclaredBounds;
            if (corner && Math.abs(corner.y - hand.y) > 1e-6) {
              expect(far.extras?.markers, at).toBeUndefined();
            }
          }
        }
      }
    }
  });

  it('turns a half from mat to portrait once at most as the window widens, markers or none', () => {
    const kindOf = (snapshot: ReturnType<typeof createTableLayoutSnapshot>) => {
      const far = snapshot.players.find(
        (player) => player.physicalSide === 'upper'
      )!;
      const box = (kind: string) =>
        far.regions.find((region) => region.kind === kind)!
          .physicalDeclaredBounds;
      // Side by side in the portrait mat's pile row; one above the other
      // down the mat's outer column.
      return Math.abs(box('deck').y - box('discard').y) < 1
        ? 'portrait'
        : 'mat';
    };
    for (const height of [500, 640, 1024]) {
      for (const lowerShare of [0.5, 0.6]) {
        for (const markers of [0, 1, 2]) {
          let changes = 0;
          let last: string | undefined;
          for (let width = 360; width <= 760; width += 2) {
            const kind = kindOf(
              createTableLayoutSnapshot(
                stateAt(width, height, {
                  shellMode: 'fullscreen',
                  appBarPx: BAR,
                  vertical: tableVerticalLayout(lowerShare),
                  ...(markers ? { oncePerGameMarkers: markers } : {}),
                })
              )
            );
            if (last !== undefined && kind !== last) changes += 1;
            last = kind;
          }
          expect(
            changes,
            `${String(height)} split=${String(lowerShare)} markers=${String(markers)}`
          ).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('moves no corner where nothing lies under the bar', () => {
    const near = (snapshot: ReturnType<typeof createTableLayoutSnapshot>) =>
      snapshot.players.find((player) => player.physicalSide === 'lower')!;
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      // No markers shown, or no bar: the far corner stays the half's own.
      for (const state of [
        stateAt(width, height, { appBarPx: BAR }),
        stateAt(width, height, { oncePerGameMarkers: 2 }),
      ]) {
        const snapshot = createTableLayoutSnapshot(state);
        for (const player of snapshot.players) {
          expect(player.extras?.corner).toBeUndefined();
        }
      }
      // The near half's corner is never under the bar.
      expect(
        near(
          createTableLayoutSnapshot(
            stateAt(width, height, { appBarPx: BAR, oncePerGameMarkers: 2 })
          )
        ).extras?.corner
      ).toBeUndefined();
    }
  });

  it('refits the far half no shorter than it must, keeping its staging area, markers and markers\u2019 row clear', () => {
    const far = (snapshot: ReturnType<typeof createTableLayoutSnapshot>) =>
      snapshot.players.find((player) => player.physicalSide === 'upper')!;
    const box = (
      snapshot: ReturnType<typeof createTableLayoutSnapshot>,
      kind: string
    ) =>
      far(snapshot).regions.find((candidate) => candidate.kind === kind)!
        .physicalDeclaredBounds;
    // The tallest clear fit, not wherever a bisection landed (it took the
    // far Active from 111px to 90px here).
    const tall = createTableLayoutSnapshot(
      stateAt(656, 600, {
        shellMode: 'fullscreen',
        appBarPx: BAR,
        vertical: tableVerticalLayout(0.5),
        seamBandPx: 42,
        oncePerGameMarkers: 1,
      })
    );
    expect(box(tall, 'active').height).toBeGreaterThan(108);
    // Never the shortest fit when none clears: the staging area still holds
    // the Stadium.
    for (const [width, height, bar, seamBandPx] of [
      [640, 640, BAR, 42],
      [720, 720, { width: 290, height: 50 }, 46],
    ] as const) {
      const snapshot = createTableLayoutSnapshot(
        stateAt(width, height, {
          shellMode: 'fullscreen',
          appBarPx: bar,
          vertical: tableVerticalLayout(0.46),
          seamBandPx,
          oncePerGameMarkers: 2,
        })
      );
      expect(box(snapshot, 'board').width).toBeGreaterThanOrEqual(
        snapshot.shared.stadium.physicalDeclaredBounds.width
      );
    }
    // The far markers count: none under the Stadium.
    const marked = createTableLayoutSnapshot(
      stateAt(1040, 768, {
        shellMode: 'sidebar',
        appBarPx: BAR,
        vertical: tableVerticalLayout(0.54),
        seamBandPx: 42,
        oncePerGameMarkers: 1,
        hideEmptyLostZone: true,
      })
    );
    const markers = far(marked).extras?.markers;
    if (markers) {
      expect(
        overlaps(markers, marked.shared.stadium.physicalDeclaredBounds)
      ).toBe(false);
    }
    // The markers keep their row (the hand its width) over a sliver of
    // Stadium.
    const rowed = createTableLayoutSnapshot(
      stateAt(688, 568, {
        shellMode: 'fullscreen',
        appBarPx: BAR,
        vertical: tableVerticalLayout(0.54),
        seamBandPx: 42,
        oncePerGameMarkers: 2,
      })
    );
    expect(far(rowed).extras?.markersRow).toBe(true);
    expect(box(rowed, 'hand').width).toBeGreaterThan(300);
  });

  it('never puts the far markers or Lost Zone under the Stadium with the bar', () => {
    const under = (
      snapshot: ReturnType<typeof createTableLayoutSnapshot>,
      piece: 'markers' | 'lostZone'
    ): number => {
      const far = snapshot.players.find(
        (player) => player.physicalSide === 'upper'
      )!;
      const rect =
        piece === 'markers'
          ? far.extras?.markers
          : far.regions.find((region) => region.kind === 'lostZone')!
              .physicalDeclaredBounds;
      const stadium = snapshot.shared.stadium.physicalDeclaredBounds;
      if (!rect) return 0;
      return (
        Math.max(
          0,
          Math.min(rect.x + rect.width, stadium.x + stadium.width) -
            Math.max(rect.x, stadium.x)
        ) *
        Math.max(
          0,
          Math.min(rect.y + rect.height, stadium.y + stadium.height) -
            Math.max(rect.y, stadium.y)
        )
      );
    };
    // Where the bar shrank the far cards, the staging area came out from
    // under the Stadium and the pieces beside the prizes went in (an iPad
    // upright: the VSTAR marker, a live toggle, wholly under it).
    for (let width = 560; width <= 1120; width += 40) {
      for (const height of [632, 712, 760, 1024]) {
        for (const lowerShare of [0.54, 0.66]) {
          for (const touch of [false, true]) {
            for (const markers of [0, 1]) {
              for (const lost of [false, true]) {
                const state = stateAt(width, height, {
                  shellMode: 'fullscreen',
                  vertical: tableVerticalLayout(lowerShare),
                  seamBandPx: touch ? 46 : 42,
                  ...(markers ? { oncePerGameMarkers: markers } : {}),
                  ...(lost ? {} : { hideEmptyLostZone: true }),
                });
                const slots = width < 600 ? 3 : 6;
                const button = touch ? 44 : 36;
                const barred = createTableLayoutSnapshot({
                  ...state,
                  appBarPx: {
                    width: slots * button + (slots - 1) * 4 + 6,
                    height: button + 6,
                  },
                });
                const at = `${String(width)}x${String(height)} split ${String(lowerShare)} ${touch ? 'touch' : 'mouse'} markers ${String(markers)} lost ${String(lost)}`;
                // A sliver (24px²) at most, as the far half's refit allows.
                expect(under(barred, 'markers'), at).toBeLessThan(24.5);
                expect(under(barred, 'lostZone'), at).toBeLessThan(24.5);
              }
            }
          }
        }
      }
    }
  });

  it('moves only what is under the Stadium, for more than a sliver, and keeps the staging area a clear card', () => {
    const far = (snapshot: ReturnType<typeof createTableLayoutSnapshot>) =>
      snapshot.players.find((player) => player.physicalSide === 'upper')!;
    const box = (
      snapshot: ReturnType<typeof createTableLayoutSnapshot>,
      kind: string
    ) =>
      far(snapshot).regions.find((region) => region.kind === kind)!
        .physicalDeclaredBounds;
    // The staging area's widest stretch clear of the Stadium.
    const clearOfStadium = (
      snapshot: ReturnType<typeof createTableLayoutSnapshot>
    ) => {
      const staging = box(snapshot, 'board');
      const stadium = snapshot.shared.stadium.physicalDeclaredBounds;
      return Math.max(
        Math.max(0, Math.min(staging.x + staging.width, stadium.x) - staging.x),
        Math.max(
          0,
          staging.x +
            staging.width -
            Math.max(staging.x, stadium.x + stadium.width)
        )
      );
    };
    const at = (
      width: number,
      height: number,
      overrides: Partial<BoardLayoutState>
    ) =>
      createTableLayoutSnapshot(
        stateAt(width, height, { shellMode: 'fullscreen', ...overrides })
      );
    // Only the Lost Zone was under: the markers, clear, stay by the prizes
    // and the hand keeps its room.
    const lostZoneOnly = at(560, 568, {
      appBarPx: { width: 122, height: 42 },
      vertical: tableVerticalLayout(0.6),
      seamBandPx: 42,
      oncePerGameMarkers: 2,
    });
    expect(far(lostZoneOnly).extras?.markers).toBeDefined();
    expect(box(lostZoneOnly, 'hand').width).toBeGreaterThan(250);
    // A shorter fit counts as keeping the markers only with them by the
    // prizes in fact: one where they never fit there put them in the
    // corner, the far hand at its floor.
    const kept = at(704, 700, {
      appBarPx: BAR,
      vertical: tableVerticalLayout(0.54),
      seamBandPx: 42,
      oncePerGameMarkers: 2,
    });
    expect(box(kept, 'hand').width).toBeGreaterThan(250);
    // A sliver under the Stadium takes no markers' row (the far Active a
    // third smaller for it).
    const sliver = at(416, 568, {
      appBarPx: { width: 122, height: 42 },
      vertical: tableVerticalLayout(0.66),
      seamBandPx: 46,
      oncePerGameMarkers: 1,
      hideEmptyLostZone: true,
    });
    expect(far(sliver).extras?.markersRow).toBeUndefined();
    expect(box(sliver, 'active').height).toBeGreaterThan(50);
    // The room the pieces leave the staging area lies under the Stadium:
    // the split never takes it for a card's clear width.
    for (const snapshot of [
      at(640, 600, {
        vertical: tableVerticalLayout(0.6),
        seamBandPx: 42,
        oncePerGameMarkers: 1,
      }),
      at(800, 720, {
        appBarPx: BAR,
        vertical: tableVerticalLayout(0.54),
        seamBandPx: 42,
      }),
    ]) {
      expect(clearOfStadium(snapshot)).toBeGreaterThanOrEqual(
        snapshot.shared.stadium.physicalDeclaredBounds.width
      );
    }
  });

  it('keeps the far half steady through a window resized a pixel at a time', () => {
    const active = (
      width: number,
      height: number,
      touch: boolean,
      lowerShare: number,
      markers: number
    ) =>
      createTableLayoutSnapshot(
        stateAt(width, height, {
          shellMode: 'fullscreen',
          appBarPx: touch ? { width: 290, height: 50 } : BAR,
          vertical: tableVerticalLayout(lowerShare),
          seamBandPx: touch ? 46 : 42,
          oncePerGameMarkers: markers,
        })
      )
        .players.find((player) => player.physicalSide === 'upper')!
        .regions.find((region) => region.kind === 'active')!
        .physicalDeclaredBounds.height;
    // A refit's narrow window missed on one pixel took a fifth off the far
    // Active there.
    for (const [width, height, touch, lowerShare, markers] of [
      [632, 640, false, 0.54, 2],
      [703, 800, false, 0.6, 2],
      [730, 844, true, 0.54, 2],
    ] as const) {
      const here = active(width, height, touch, lowerShare, markers);
      for (const beside of [width - 1, width + 1]) {
        expect(
          here,
          `${String(width)}x${String(height)} beside ${String(beside)}`
        ).toBeGreaterThan(
          0.92 * active(beside, height, touch, lowerShare, markers)
        );
      }
    }
  });

  it('refuses a bar of no sensible size', () => {
    expect(() =>
      createTableLayoutSnapshot(
        stateAt(1440, 900, { appBarPx: { width: Number.NaN, height: 42 } })
      )
    ).toThrow(/app bar/u);
  });
});

describe('table layout (geometry v2)', () => {
  it('gives the table everything but a clamped rail', () => {
    expect(tableRailWidth(1280)).toBe(300);
    expect(tableRailWidth(1440)).toBe(331);
    expect(tableRailWidth(2560)).toBe(380);
    const snapshot = createTableLayoutSnapshot(stateAt(1440, 900));
    expect(snapshot.geometryVersion).toBe(2);
    expect(snapshot.playAreaBounds).toEqual({
      x: 0,
      y: 0,
      width: 1109,
      height: 900,
    });
    expect(snapshot.sidebarBounds).toEqual({
      x: 1109,
      y: 0,
      width: 331,
      height: 900,
    });
    const full = createTableLayoutSnapshot(
      stateAt(1440, 900, { shellMode: 'fullscreen' })
    );
    expect(full.playAreaBounds.width).toBe(1440);
    expect(full.sidebarBounds).toBeNull();
  });

  it('lays each half out like the play mat without regions colliding', () => {
    const snapshot = createTableLayoutSnapshot(stateAt(1440, 900));
    for (const side of ['local', 'opponent'] as const) {
      const player = snapshot.players.find(
        (candidate) => candidate.side === side
      )!;
      const kinds = player.regions.map((candidate) => candidate.kind).sort();
      expect(kinds).toEqual(
        [
          'active',
          'bench',
          'board',
          'deck',
          'discard',
          'hand',
          'lostZone',
          'prizes',
        ].sort()
      );
      for (const candidate of player.regions) {
        expect(
          inside(candidate.physicalDeclaredBounds, player.frameBounds),
          `${side} ${candidate.kind}`
        ).toBe(true);
      }
      for (const left of player.regions) {
        for (const right of player.regions) {
          if (left === right) continue;
          expect(
            overlaps(left.physicalDeclaredBounds, right.physicalDeclaredBounds),
            `${side} ${left.kind} / ${right.kind}`
          ).toBe(false);
        }
      }
    }
    // The viewer's mat: prizes left of the Active, deck right, hand at the
    // bottom edge, the Active nearest the centre line.
    const prizes = region(snapshot, 'local', 'prizes').physicalDeclaredBounds;
    const active = region(snapshot, 'local', 'active').physicalDeclaredBounds;
    const deck = region(snapshot, 'local', 'deck').physicalDeclaredBounds;
    const hand = region(snapshot, 'local', 'hand').physicalDeclaredBounds;
    expect(prizes.x).toBeLessThan(active.x);
    expect(deck.x).toBeGreaterThan(active.x + active.width);
    expect(hand.y + hand.height).toBeCloseTo(900, 5);
    expect(active.y).toBeLessThan(hand.y);
    // The opponent's mat is turned around: their prizes on the right, their
    // hand along the top edge.
    const theirPrizes = region(
      snapshot,
      'opponent',
      'prizes'
    ).physicalDeclaredBounds;
    const theirHand = region(
      snapshot,
      'opponent',
      'hand'
    ).physicalDeclaredBounds;
    expect(theirPrizes.x).toBeGreaterThan(active.x);
    expect(theirHand.y).toBeCloseTo(0, 5);
    // Behaviour comes from v1's regions: the same surfaces and affordances.
    const v1 = createLayoutSnapshotFor({
      ...stateAt(1440, 900),
      geometryVersion: 1,
      vertical: {
        lowerFrame: { bottomRatio: 0, heightRatio: 0.5 },
        upperFrame: { bottomRatio: 0.5, heightRatio: 0.5 },
        lowerHandle: { bottomRatio: 0.505, heightRatio: 0.025 },
        upperHandle: { bottomRatio: 0.53, heightRatio: 0.025 },
        sharedPlacement: 'cssDefault',
      },
    });
    for (const kind of ['hand', 'deck', 'prizes', 'active']) {
      const legacy = v1.players[0].regions.find(
        (candidate) => candidate.kind === kind
      )!;
      const table = region(snapshot, 'local', kind);
      expect(table.surface).toBe(legacy.surface);
      expect(table.affordances).toEqual(legacy.affordances);
    }
  });

  it("keeps the seam clear for the table controls and a corner for each player's markers", () => {
    for (const [width, height] of [
      [1280, 720],
      [1440, 900],
      [1920, 1080],
    ] as const) {
      const snapshot = createTableLayoutSnapshot(stateAt(width, height));
      const controls = snapshot.shared.boardControlsAnchor;
      for (const player of snapshot.players) {
        for (const candidate of player.regions) {
          const rect = candidate.physicalDeclaredBounds;
          const clear =
            rect.y >= controls.y + controls.height - 0.01 ||
            rect.y + rect.height <= controls.y + 0.01;
          expect(clear, `${width} ${player.side} ${candidate.kind}`).toBe(true);
        }
      }
      // The hand starts after its owner's marker corner.
      const hand = region(snapshot, 'local', 'hand').physicalDeclaredBounds;
      const prizes = region(snapshot, 'local', 'prizes').physicalDeclaredBounds;
      expect(hand.x - prizes.x).toBeGreaterThanOrEqual(TABLE_CONTROL_CORNER_PX);
    }
  });

  it('gives the far hand the smaller strip, and both halves cards of one size', () => {
    for (const [width, height, shellMode] of [
      [1440, 900, 'fullscreen'],
      [1440, 900, 'sidebar'],
      [1280, 720, 'fullscreen'],
      [1920, 1080, 'sidebar'],
    ] as const) {
      const snapshot = createTableLayoutSnapshot(
        stateAt(width, height, { shellMode })
      );
      const strip = (side: 'local' | 'opponent') =>
        region(snapshot, side, 'hand').physicalDeclaredBounds.height;
      const label = `${width}x${height} ${shellMode}`;
      expect(strip('opponent'), label).toBeLessThan(
        strip('local') * (TABLE_FAR_HAND_SCALE + 0.05)
      );
      const bench = (side: 'local' | 'opponent') =>
        region(snapshot, side, 'bench').physicalDeclaredBounds.height;
      expect(Math.abs(bench('local') - bench('opponent')), label).toBeLessThan(
        3
      );
    }
    // Wide enough, the room the far hand gives up goes to both boards.
    const even = createTableLayoutSnapshot(
      stateAt(1440, 900, {
        shellMode: 'fullscreen',
        vertical: tableVerticalLayout(0.5),
      })
    );
    const balanced = createTableLayoutSnapshot(
      stateAt(1440, 900, { shellMode: 'fullscreen' })
    );
    expect(
      region(balanced, 'local', 'bench').physicalDeclaredBounds.height
    ).toBeGreaterThan(
      region(even, 'local', 'bench').physicalDeclaredBounds.height
    );
  });

  it('keeps the Stadium clear of both halves on a split table', () => {
    for (const [width, height, shellMode] of [
      [1440, 900, 'sidebar'],
      [1440, 900, 'fullscreen'],
      [1280, 720, 'fullscreen'],
      [1920, 1080, 'sidebar'],
      [1024, 768, 'fullscreen'],
    ] as const) {
      for (const seamBandPx of [undefined, 42, 46]) {
        const snapshot = createTableLayoutSnapshot(
          stateAt(width, height, {
            shellMode,
            ...(seamBandPx ? { seamBandPx } : {}),
          })
        );
        const stadium = snapshot.shared.stadium.physicalDeclaredBounds;
        for (const player of snapshot.players) {
          for (const candidate of player.regions) {
            expect(
              overlaps(stadium, candidate.physicalDeclaredBounds),
              `${width}x${height} ${player.side} ${candidate.kind}`
            ).toBe(false);
          }
        }
        // The far staging area is shortened, not gone.
        expect(
          region(snapshot, 'opponent', 'board').physicalDeclaredBounds.width
        ).toBeGreaterThanOrEqual(stadium.width);
      }
    }
    // Too narrow to shorten it by a Stadium and keep a card's width, the
    // far staging area keeps its width, under the Stadium's edge.
    const narrow = createTableLayoutSnapshot(stateAt(1024, 768));
    expect(
      region(narrow, 'opponent', 'board').physicalDeclaredBounds.width
    ).toBeGreaterThan(0);
  });

  it('keeps the markers and then the Lost Zone beside the prizes, toward the centre line', () => {
    for (const [width, height] of [
      [1280, 720],
      [1440, 900],
      [1920, 1080],
    ] as const) {
      for (const markers of [0, 1, 2]) {
        const snapshot = createTableLayoutSnapshot(
          stateAt(width, height, {
            shellMode: 'fullscreen',
            oncePerGameMarkers: markers,
          })
        );
        for (const player of snapshot.players) {
          const label = `${width}x${height} ${player.side} ${markers}`;
          const rect = (kind: string) =>
            region(snapshot, player.side, kind).physicalDeclaredBounds;
          const prizes = rect('prizes');
          const lost = rect('lostZone');
          const active = rect('active');
          const board = rect('board');
          // Level with the Active row, between the prizes and the staging
          // area; nothing overlaps.
          if (player.side === 'local') {
            expect(lost.y, label).toBeCloseTo(active.y, 5);
          } else {
            expect(lost.y + lost.height, label).toBeCloseTo(
              active.y + active.height,
              5
            );
          }
          const between = (value: number, a: number, b: number) =>
            value >= Math.min(a, b) - 0.01 && value <= Math.max(a, b) + 0.01;
          expect(
            between(
              lost.x + lost.width / 2,
              prizes.x + prizes.width / 2,
              board.x + board.width / 2
            ),
            label
          ).toBe(true);
          const markerRect = player.extras?.markers;
          if (markers === 0) expect(markerRect, label).toBeUndefined();
          else {
            expect(markerRect, label).toBeDefined();
            expect(overlaps(markerRect!, lost), label).toBe(false);
            // The markers come first from the prizes, the Lost Zone after.
            expect(
              between(
                markerRect!.x + markerRect!.width / 2,
                prizes.x + prizes.width / 2,
                lost.x + lost.width / 2
              ),
              label
            ).toBe(true);
            for (const candidate of player.regions) {
              expect(
                overlaps(markerRect!, candidate.physicalDeclaredBounds),
                `${label} ${candidate.kind}`
              ).toBe(false);
            }
          }
          // The control that adds them sits inside the staging area.
          expect(inside(player.extras!.control, board), label).toBe(true);
          // The staging area keeps room for a card or two.
          expect(board.width, label).toBeGreaterThan(lost.width);
        }
      }
    }
    // Too narrow for them, they keep their old places.
    const narrow = createTableLayoutSnapshot(
      stateAt(1024, 768, { oncePerGameMarkers: 2 })
    );
    expect(narrow.players[0].extras?.markers).toBeUndefined();
  });

  it('runs the zones out to the mat: the columns to its sides, the bench to the piles, the piles down both rows', () => {
    for (const [width, height] of [
      [1280, 720],
      [1440, 900],
      [1920, 1080],
      [2560, 1440],
    ] as const) {
      const snapshot = createTableLayoutSnapshot(
        stateAt(width, height, { shellMode: 'fullscreen' })
      );
      for (const player of snapshot.players) {
        const label = `${width}x${height} ${player.side}`;
        const rect = (kind: string) =>
          region(snapshot, player.side, kind).physicalDeclaredBounds;
        const frame = player.frameBounds;
        const [prizes, deck, discard, bench, active] = [
          'prizes',
          'deck',
          'discard',
          'bench',
          'active',
        ].map(rect) as [Rect, Rect, Rect, Rect, Rect];
        // The outer columns sit close to the mat's sides.
        const outer = [prizes, deck];
        expect(
          Math.min(...outer.map((box) => box.x)) - frame.x,
          label
        ).toBeLessThanOrEqual(14.01);
        expect(
          frame.x +
            frame.width -
            Math.max(...outer.map((box) => box.x + box.width)),
          label
        ).toBeLessThanOrEqual(14.01);
        // The bench reaches the piles as closely as it does the prizes.
        const local = player.side === 'local';
        const toPiles = local
          ? deck.x - (bench.x + bench.width)
          : bench.x - (deck.x + deck.width);
        const toPrizes = local
          ? bench.x - (prizes.x + prizes.width)
          : prizes.x - (bench.x + bench.width);
        expect(toPiles, label).toBeGreaterThan(0);
        expect(toPiles, label).toBeLessThanOrEqual(toPrizes + 0.5);
        // With the Lost Zone beside the prizes, the deck and discard fill
        // both card rows of their column.
        const span = (boxes: readonly Rect[]) =>
          Math.max(...boxes.map((box) => box.y + box.height)) -
          Math.min(...boxes.map((box) => box.y));
        expect(span([deck, discard]), label).toBeCloseTo(
          span([active, bench]),
          0
        );
      }
    }
  });

  it('makes the cards readable at common desktop sizes', () => {
    for (const [width, height, minimum] of [
      [1440, 900, { active: 150, bench: 130, hand: 150 }],
      [1920, 1080, { active: 180, bench: 155, hand: 180 }],
      [1280, 720, { active: 120, bench: 100, hand: 120 }],
    ] as const) {
      const snapshot = createTableLayoutSnapshot(stateAt(width, height));
      const active = region(snapshot, 'local', 'active').physicalDeclaredBounds;
      const bench = region(snapshot, 'local', 'bench').physicalDeclaredBounds;
      const hand = region(snapshot, 'local', 'hand').physicalDeclaredBounds;
      expect(active.height, `${width} active`).toBeGreaterThanOrEqual(
        minimum.active
      );
      expect(bench.height, `${width} bench`).toBeGreaterThanOrEqual(
        minimum.bench
      );
      const [handCard] = layoutTableHand(hand, 'local', 1);
      expect(handCard!.height, `${width} hand`).toBeGreaterThanOrEqual(
        minimum.hand
      );
      // Five bench Pokémon with two Energy each fit side by side.
      const benchCardWidth = bench.height * CARD_ASPECT_RATIO;
      expect(5 * benchCardWidth * (1 + 2 / 6) + 4 * 8).toBeLessThanOrEqual(
        bench.width
      );
    }
  });

  it('stacks deck, discard and an optional Lost Zone down the outer column', () => {
    for (const [width, height] of [
      [1024, 768],
      [1280, 720],
      [1440, 900],
      [1920, 1080],
    ] as const) {
      // Optional and off, an empty Lost Zone is not shown; one with cards
      // shows at the end of the outer column.
      const snapshot = createTableLayoutSnapshot(
        stateAt(width, height, { hideEmptyLostZone: true })
      );
      for (const side of ['local', 'opponent'] as const) {
        const deck = region(snapshot, side, 'deck').physicalDeclaredBounds;
        const discard = region(
          snapshot,
          side,
          'discard'
        ).physicalDeclaredBounds;
        const lost = region(snapshot, side, 'lostZone').physicalDeclaredBounds;
        const bench = region(snapshot, side, 'bench').physicalDeclaredBounds;
        const label = `${width} ${side}`;
        // One column of equal piles, deck nearest the centre line.
        expect(discard.x, label).toBeCloseTo(deck.x, 5);
        expect(lost.x, label).toBeCloseTo(deck.x, 5);
        expect(lost.height, label).toBeCloseTo(deck.height, 5);
        const order = [deck, discard, lost].map((rect) => rect.y);
        expect(order, label).toEqual(
          side === 'local'
            ? [...order].sort((a, b) => a - b)
            : [...order].sort((a, b) => b - a)
        );
        // Big enough to read its top card: never far below a bench card.
        expect(lost.height / bench.height, label).toBeGreaterThan(0.8);
        // Its corner badge stays on the screen.
        expect(lost.y, label).toBeGreaterThanOrEqual(10);
        expect(lost.y + lost.height, label).toBeLessThanOrEqual(height - 10);
      }
    }
  });

  it("puts each hand's count at the far end of its strip, clear of every zone", () => {
    for (const [width, height] of [
      [1280, 720],
      [1440, 900],
      [1920, 1080],
    ] as const) {
      const snapshot = createTableLayoutSnapshot(stateAt(width, height));
      for (const player of snapshot.players) {
        const hand = player.regions.find(
          (candidate) => candidate.kind === 'hand'
        )!;
        const count = hand.countLabel!;
        // A 22px badge, up to 48px wide, grows away from the anchor.
        const badge: Rect = {
          x:
            count.horizontalAlign === 'left'
              ? count.anchor.x
              : count.anchor.x - 48,
          y:
            count.verticalAlign === 'top'
              ? count.anchor.y
              : count.anchor.y - 22,
          width: 48,
          height: 22,
        };
        const label = `${width} ${player.side}`;
        expect(
          inside(badge, player.frameBounds),
          `${label} inside its half`
        ).toBe(true);
        for (const other of player.regions) {
          if (other.kind === 'hand') continue;
          expect(
            overlaps(badge, other.physicalDeclaredBounds),
            `${label} / ${other.kind}`
          ).toBe(false);
        }
        // It sits level with the hand, past its last card.
        const strip = hand.physicalDeclaredBounds;
        expect(badge.y, label).toBeGreaterThanOrEqual(strip.y);
        expect(badge.y + badge.height, label).toBeLessThanOrEqual(
          strip.y + strip.height
        );
        expect(overlaps(badge, strip), label).toBe(false);
      }
    }
  });

  it('runs the hand off the screen edge and overlaps it when crowded', () => {
    const content = { x: 100, y: 600, width: 700, height: 130 };
    const three = layoutTableHand(content, 'local', 3);
    expect(three[0]!.height).toBeCloseTo(130 / 0.8, 5);
    expect(three[0]!.y).toBe(600);
    expect(three[1]!.x - three[0]!.x).toBeGreaterThan(three[0]!.width);
    const crowded = layoutTableHand(content, 'local', 20);
    expect(crowded[0]!.x).toBeCloseTo(100, 5);
    expect(crowded.at(-1)!.x + crowded.at(-1)!.width).toBeCloseTo(800, 5);
    expect(crowded[1]!.x - crowded[0]!.x).toBeLessThan(crowded[0]!.width);
    // The opponent's hand runs off the top, in mirrored order.
    const theirs = layoutTableHand({ ...content, y: 0 }, 'opponent', 3);
    expect(theirs[0]!.y + theirs[0]!.height).toBeCloseTo(130, 5);
    expect(theirs[0]!.x).toBeGreaterThan(theirs[2]!.x);
  });

  it("lays prizes in a two-by-three grid starting at their owner's top left", () => {
    const content = { x: 0, y: 0, width: 160, height: 330 };
    const mine = layoutTablePrizes(content, 'local', 6);
    expect(new Set(mine.map((rect) => Math.round(rect.x))).size).toBe(2);
    expect(new Set(mine.map((rect) => Math.round(rect.y))).size).toBe(3);
    expect(mine[0]!.x).toBeLessThan(mine[1]!.x);
    expect(mine[0]!.y).toBeLessThan(mine[2]!.y);
    const theirs = layoutTablePrizes(content, 'opponent', 6);
    expect(theirs[0]!.x).toBeGreaterThan(theirs[1]!.x);
    expect(theirs[0]!.y).toBeGreaterThan(theirs[2]!.y);
    for (const rect of [...mine, ...theirs])
      expect(inside(rect, content)).toBe(true);
  });

  it('builds a full scene whose cards stay on the table except the hidden part of the hand', () => {
    const view: MatchViewState = createRendererSpikeView();
    const snapshot = createTableLayoutSnapshot(stateAt(1440, 900));
    const scene = createBoardScene(view, snapshot);
    expect(scene.layout.geometryVersion).toBe(2);
    expect(scene.viewport.width).toBe(1109);
    const table = {
      x: 0,
      y: 0,
      width: scene.viewport.width,
      height: scene.viewport.height,
    };
    for (const card of scene.cards) {
      if (card.parentId.endsWith(':hand')) {
        // Hand cards are cut by the screen edge but never by its sides.
        expect(card.bounds.x).toBeGreaterThanOrEqual(-0.01);
        expect(card.bounds.x + card.bounds.width).toBeLessThanOrEqual(
          table.width + 0.01
        );
        continue;
      }
      expect(inside(card.bounds, table), card.parentId).toBe(true);
    }
    // No zone scrolls in the table layout.
    expect(scene.zones.every((zone) => zone.scroll === undefined)).toBe(true);
  });

  it('moves the seam when either handle is dragged, keeping both halves usable', () => {
    const state = stateAt(1440, 900);
    const dragged = resizeLayoutStateFor(state, 'lower', 360);
    expect(dragged.vertical.upperFrame.heightRatio).toBeCloseTo(0.4, 5);
    expect(dragged.vertical.lowerFrame.heightRatio).toBeCloseTo(0.6, 5);
    expect(
      resizeLayoutStateFor(state, 'upper', 0).vertical.upperFrame.heightRatio
    ).toBeCloseTo(0.34, 5);
    expect(
      resizeLayoutStateFor(state, 'lower', 900).vertical.lowerFrame.heightRatio
    ).toBeCloseTo(0.34, 5);
    expect(() => createLayoutSnapshotFor(dragged)).not.toThrow();
  });

  it('sets the split from a share of the table, clamped so both halves stay usable', () => {
    expect(DEFAULT_TABLE_VERTICAL_LAYOUT).toEqual(
      tableVerticalLayout(TABLE_SPLIT.defaultLowerShare)
    );
    const tall = tableVerticalLayout(0.6);
    expect(tall.lowerFrame).toEqual({ bottomRatio: 0, heightRatio: 0.6 });
    expect(tall.upperFrame.bottomRatio).toBeCloseTo(0.6, 5);
    expect(tall.upperFrame.heightRatio).toBeCloseTo(0.4, 5);
    expect(tableVerticalLayout(0.9).lowerFrame.heightRatio).toBe(
      TABLE_SPLIT.maximumLowerShare
    );
    expect(tableVerticalLayout(0).lowerFrame.heightRatio).toBe(
      TABLE_SPLIT.minimumLowerShare
    );
    expect(tableVerticalLayout(Number.NaN)).toEqual(
      DEFAULT_TABLE_VERTICAL_LAYOUT
    );
  });

  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 768],
    [1920, 1080],
  ] as const) {
    for (const hidden of ['upper', 'lower'] as const) {
      it(`gives one half the whole table when the ${hidden} half is hidden (${width}x${height})`, () => {
        const snapshot = createTableLayoutSnapshot(
          stateAt(width, height, { hiddenPhysicalSide: hidden })
        );
        const table = snapshot.playAreaBounds;
        const shown = snapshot.players.find(
          (player) => player.physicalSide !== hidden
        )!;
        const gone = snapshot.players.find(
          (player) => player.physicalSide === hidden
        )!;
        expect(shown.hidden).toBeUndefined();
        expect(gone.hidden).toBe(true);
        expect(shown.frameBounds).toEqual(table);
        // The hidden half lies wholly past the table's edge on its own side.
        if (hidden === 'upper') {
          expect(gone.frameBounds.y + gone.frameBounds.height).toBe(0);
        } else {
          expect(gone.frameBounds.y).toBe(table.height);
        }

        const regions = shown.regions.map(
          (candidate) => candidate.physicalDeclaredBounds
        );
        for (const candidate of shown.regions) {
          expect(
            inside(candidate.physicalDeclaredBounds, table),
            candidate.kind
          ).toBe(true);
        }
        for (const left of regions) {
          for (const right of regions) {
            if (left !== right) expect(overlaps(left, right)).toBe(false);
          }
        }
        // The hand still runs along the player's own edge of the screen.
        const hand = shown.regions.find(
          (candidate) => candidate.kind === 'hand'
        )!.physicalDeclaredBounds;
        if (hidden === 'upper') {
          expect(hand.y + hand.height).toBeCloseTo(table.height, 5);
        } else {
          expect(hand.y).toBeCloseTo(0, 5);
        }
        // Cards grow no further than lets five fit across the bench.
        const bench = shown.regions.find(
          (candidate) => candidate.kind === 'bench'
        )!.physicalDeclaredBounds;
        expect(5 * bench.height * CARD_ASPECT_RATIO).toBeLessThanOrEqual(
          bench.width
        );
        const split = createTableLayoutSnapshot(stateAt(width, height));
        const splitBench = split.players
          .find((player) => player.physicalSide !== hidden)!
          .regions.find(
            (candidate) => candidate.kind === 'bench'
          )!.physicalDeclaredBounds;
        expect(bench.height).toBeGreaterThanOrEqual(splitBench.height);

        // The Stadium stays on the table beside the Active, clear of every
        // zone, and the controls sit in the clear band at the table's edge.
        const stadium = snapshot.shared.stadium.physicalDeclaredBounds;
        expect(inside(stadium, table)).toBe(true);
        for (const candidate of regions) {
          expect(overlaps(stadium, candidate)).toBe(false);
        }
        const anchor = snapshot.shared.boardControlsAnchor;
        expect(anchor.height).toBeGreaterThanOrEqual(20);
        const controls: Rect = {
          x: anchor.x,
          y: anchor.y,
          width: 200,
          height: anchor.height,
        };
        expect(inside(controls, table)).toBe(true);
        for (const candidate of regions) {
          expect(overlaps(controls, candidate)).toBe(false);
        }
      });
    }
  }

  it('leaves a hidden half out of the scene but keeps the shared Stadium', () => {
    const view: MatchViewState = createRendererSpikeView();
    const both = createBoardScene(
      view,
      createTableLayoutSnapshot(stateAt(1440, 900))
    );
    const scene = createBoardScene(
      view,
      createTableLayoutSnapshot(
        stateAt(1440, 900, { hiddenPhysicalSide: 'upper' })
      )
    );
    expect(both.cards.some((card) => card.side === 'opponent')).toBe(true);
    expect(scene.cards.some((card) => card.side === 'opponent')).toBe(false);
    expect(scene.zones.some((zone) => zone.side === 'opponent')).toBe(false);
    expect(scene.counts.some((count) => count.side === 'opponent')).toBe(false);
    const shownCards = new Set(scene.cards.map((card) => card.id));
    expect(
      scene.markers.every((marker) => shownCards.has(marker.parentCardId))
    ).toBe(true);
    expect(scene.zones.some((zone) => zone.side === 'shared')).toBe(true);
    expect(scene.cards.filter((card) => card.side === 'local').length).toBe(
      both.cards.filter((card) => card.side === 'local').length
    );
    expect(
      scene.layout.players.find((frame) => frame.side === 'opponent')!.hidden
    ).toBe(true);
    expect(() =>
      createTableLayoutSnapshot(
        stateAt(1440, 900, {
          hiddenPhysicalSide: 'left' as unknown as 'upper',
        })
      )
    ).toThrow('Unsupported hidden board side');
  });

  describe('portrait (a table tall for its width)', () => {
    const PORTRAIT_VIEWPORTS = [
      [390, 844],
      [430, 932],
      [360, 740],
      [810, 1080],
    ] as const;
    const portraitAt = (
      width: number,
      height: number,
      overrides: Partial<BoardLayoutState> = {}
    ) =>
      createTableLayoutSnapshot(
        stateAt(width, height, { shellMode: 'fullscreen', ...overrides })
      );
    const benchCardWidth = (rect: Rect) =>
      Math.min(rect.height, rect.width / 5.5 / CARD_ASPECT_RATIO) *
      CARD_ASPECT_RATIO;

    it('turns the mat into rows: Active, bench, then prizes and piles side by side above the hand', () => {
      for (const [width, height] of PORTRAIT_VIEWPORTS) {
        const snapshot = portraitAt(width, height);
        for (const player of snapshot.players) {
          const frame = player.frameBounds;
          const regions = player.regions.map(
            (candidate) => candidate.physicalDeclaredBounds
          );
          for (const rect of regions) expect(inside(rect, frame)).toBe(true);
          for (const [index, rect] of regions.entries()) {
            for (const other of regions.slice(index + 1)) {
              expect(overlaps(rect, other), `${width}x${height}`).toBe(false);
            }
          }
        }
        const bench = region(snapshot, 'local', 'bench').physicalDeclaredBounds;
        const active = region(
          snapshot,
          'local',
          'active'
        ).physicalDeclaredBounds;
        const prizes = region(
          snapshot,
          'local',
          'prizes'
        ).physicalDeclaredBounds;
        const hand = region(snapshot, 'local', 'hand').physicalDeclaredBounds;
        const piles = (['deck', 'discard', 'lostZone'] as const).map(
          (kind) => region(snapshot, 'local', kind).physicalDeclaredBounds
        );
        // From the centre line out: Active, bench, the pile row, the hand.
        expect(active.y).toBeLessThan(bench.y);
        expect(bench.y).toBeLessThan(prizes.y);
        expect(prizes.y + prizes.height).toBeLessThanOrEqual(hand.y);
        // The bench runs the width of the table and holds five and a half.
        expect(bench.width).toBeGreaterThan(width * 0.9);
        expect(5.5 * bench.height * CARD_ASPECT_RATIO).toBeLessThanOrEqual(
          bench.width + 0.01
        );
        // Prizes at the outer left, the piles side by side on the right.
        expect(prizes.width).toBeGreaterThan(prizes.height);
        for (const pile of piles) {
          expect(pile.y).toBeCloseTo(prizes.y, 5);
          expect(pile.x).toBeGreaterThan(prizes.x + prizes.width);
        }
        expect(piles[0]!.x).toBeLessThan(piles[1]!.x);
        expect(piles[1]!.x).toBeLessThan(piles[2]!.x);
        // Every pile keeps its count badge clear of the screen's edge.
        expect(piles[2]!.x + piles[2]!.width).toBeLessThanOrEqual(width - 12);
        // The rail's actions may start at the mat's edge: the app menu is
        // in the corner now (ADR-036).
        expect(snapshot.shared.boardControlsAnchor.x).toBeGreaterThanOrEqual(0);
      }
    });

    it('makes the cards on a phone held upright big enough to read', () => {
      const phone = portraitAt(390, 844);
      expect(
        benchCardWidth(region(phone, 'local', 'bench').physicalDeclaredBounds)
      ).toBeGreaterThanOrEqual(60);
      expect(
        benchCardWidth(
          region(phone, 'opponent', 'bench').physicalDeclaredBounds
        )
      ).toBeGreaterThanOrEqual(60);
      // A tablet in portrait gains too.
      const tablet = portraitAt(810, 1080);
      expect(
        benchCardWidth(region(tablet, 'local', 'bench').physicalDeclaredBounds)
      ).toBeGreaterThanOrEqual(85);
    });

    it('keeps the mat wherever the table is wide', () => {
      for (const [width, height] of [
        [1440, 900],
        [1280, 720],
        [1080, 810],
        [844, 390],
      ] as const) {
        const snapshot = portraitAt(width, height);
        const deck = region(snapshot, 'local', 'deck').physicalDeclaredBounds;
        const discard = region(
          snapshot,
          'local',
          'discard'
        ).physicalDeclaredBounds;
        // Piles stacked down the outer column.
        expect(discard.x).toBeCloseTo(deck.x, 5);
        expect(discard.y).toBeGreaterThan(deck.y);
      }
    });

    it('builds a scene whose prizes lie three across and two down', () => {
      const view: MatchViewState = createRendererSpikeView();
      const scene = createBoardScene(view, portraitAt(390, 844));
      const table = { x: 0, y: 0, width: 390, height: 844 };
      for (const card of scene.cards) {
        if (card.parentId.endsWith(':hand')) continue;
        expect(inside(card.bounds, table), card.parentId).toBe(true);
      }
      const prizeZone = scene.zones.find(
        (zone) => zone.kind === 'prizes' && zone.side === 'local'
      )!;
      const prizes = scene.cards.filter(
        (card) => card.parentId === prizeZone.id
      );
      expect(prizes.length).toBe(6);
      expect(
        new Set(prizes.map((card) => Math.round(card.bounds.x))).size
      ).toBe(3);
      expect(
        new Set(prizes.map((card) => Math.round(card.bounds.y))).size
      ).toBe(2);
      for (const card of prizes)
        expect(inside(card.bounds, prizeZone.bounds)).toBe(true);
    });

    it('fills the table with one half and keeps the controls in its band', () => {
      const snapshot = portraitAt(390, 844, { hiddenPhysicalSide: 'upper' });
      const active = region(snapshot, 'local', 'active').physicalDeclaredBounds;
      const controls = snapshot.shared.boardControlsAnchor;
      expect(controls.y).toBeGreaterThanOrEqual(0);
      expect(controls.y + controls.height).toBeLessThanOrEqual(active.y);
      // Rows, not the mat's columns, and larger for the room.
      const prizes = region(snapshot, 'local', 'prizes').physicalDeclaredBounds;
      expect(prizes.width).toBeGreaterThan(prizes.height);
      expect(
        benchCardWidth(
          region(snapshot, 'local', 'bench').physicalDeclaredBounds
        )
      ).toBeGreaterThanOrEqual(60);
    });
  });

  it('widens the seam band for finger-sized controls when asked', () => {
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [844, 390],
      [390, 844],
    ] as const) {
      const plain = createTableLayoutSnapshot(
        stateAt(width, height, { shellMode: 'fullscreen' })
      );
      const snapshot = createTableLayoutSnapshot(
        stateAt(width, height, { shellMode: 'fullscreen', seamBandPx: 48 })
      );
      expect(plain.shared.boardControlsAnchor.height).toBeLessThanOrEqual(32);
      const seamY = snapshot.players.find(
        (player) => player.physicalSide === 'lower'
      )!.frameBounds.y;
      for (const player of snapshot.players) {
        for (const candidate of player.regions) {
          const rect = candidate.physicalDeclaredBounds;
          if (player.physicalSide === 'lower')
            expect(rect.y - seamY).toBeGreaterThanOrEqual(24 - 0.01);
          else
            expect(seamY - (rect.y + rect.height)).toBeGreaterThanOrEqual(
              24 - 0.01
            );
        }
      }
      const controls = snapshot.shared.boardControlsAnchor;
      expect(controls.height).toBeGreaterThanOrEqual(44);
      expect(controls.y).toBeGreaterThanOrEqual(seamY - 24 - 0.01);
      expect(controls.y + controls.height).toBeLessThanOrEqual(
        seamY + 24 + 0.01
      );
    }
    // The band is a size, not a switch: nonsense is refused.
    expect(() =>
      createTableLayoutSnapshot(stateAt(1440, 900, { seamBandPx: -1 }))
    ).toThrow('Table seam band must be a non-negative number');
  });

  it('lays prizes three across and two down in a row wider than tall', () => {
    const content = { x: 0, y: 0, width: 120, height: 80 };
    const mine = layoutTablePrizes(content, 'local', 6);
    expect(new Set(mine.map((rect) => Math.round(rect.x))).size).toBe(3);
    expect(new Set(mine.map((rect) => Math.round(rect.y))).size).toBe(2);
    expect(mine[0]!.x).toBeLessThan(mine[1]!.x);
    expect(mine[0]!.y).toBeLessThan(mine[3]!.y);
    const theirs = layoutTablePrizes(content, 'opponent', 6);
    expect(theirs[0]!.x).toBeGreaterThan(theirs[1]!.x);
    expect(theirs[0]!.y).toBeGreaterThan(theirs[3]!.y);
    // More than six shrink to fit rather than spill.
    const many = layoutTablePrizes(content, 'local', 8);
    for (const rect of [...mine, ...theirs, ...many])
      expect(inside(rect, content)).toBe(true);
  });
  it("turns the far player's cards to read upright when the viewer asks, and nothing else", () => {
    const view = createRendererSpikeView();
    const facing = createBoardScene(
      view,
      createTableLayoutSnapshot(stateAt(1440, 900))
    );
    const upright = createBoardScene(
      view,
      createTableLayoutSnapshot(stateAt(1440, 900, { farCardsUpright: true }))
    );
    expect(facing.layout.farCardsUpright).toBeUndefined();
    expect(upright.layout.farCardsUpright).toBe(true);
    expect(upright.zones).toEqual(facing.zones);
    expect(upright.cards.map((card) => card.id)).toEqual(
      facing.cards.map((card) => card.id)
    );
    const far = upright.cards.filter((card) => card.side === 'opponent');
    expect(far.length).toBeGreaterThan(0);
    for (const card of upright.cards) {
      const before = facing.cards.find((item) => item.id === card.id)!;
      // Where it lies is unchanged; only a far card turns, half round.
      expect(card.bounds, card.label).toEqual(before.bounds);
      expect(card.rotationQuarterTurns, card.label).toBe(
        card.side === 'opponent'
          ? (before.rotationQuarterTurns + 2) % 4
          : before.rotationQuarterTurns
      );
    }
    // The red Active was turned a quarter by its player: it keeps that turn,
    // now counted from upright, as the same card on the near side shows it.
    const redTop = upright.cards.find(
      (card) =>
        card.parentId === 'stack:red:active' && card.role === 'stackEvolution'
    )!;
    expect(redTop.rotationQuarterTurns % 2).toBe(1);
    // Its damage counter sits where it would on the viewer's own card: a
    // third of the way from its right edge, a quarter of the way down.
    const damage = upright.markers.find(
      (marker) =>
        marker.kind === 'damage' &&
        upright.cards.find((card) => card.id === marker.parentCardId)?.side ===
          'opponent'
    )!;
    const host = upright.cards.find((card) => card.id === damage.parentCardId)!;
    const nearDamage = upright.markers.find(
      (marker) =>
        marker.kind === 'damage' &&
        upright.cards.find((card) => card.id === marker.parentCardId)?.side ===
          'local'
    )!;
    const nearHost = upright.cards.find(
      (card) => card.id === nearDamage.parentCardId
    )!;
    const offset = (marker: Rect, card: Rect) => ({
      x: (marker.x + marker.width / 2 - card.x - card.width / 2) / card.width,
      y:
        (marker.y + marker.height / 2 - card.y - card.height / 2) / card.height,
    });
    const painted = (card: typeof host): Rect =>
      card.rotationQuarterTurns % 2 === 1
        ? {
            x: card.bounds.x + (card.bounds.width - card.bounds.height) / 2,
            y: card.bounds.y + (card.bounds.height - card.bounds.width) / 2,
            width: card.bounds.height,
            height: card.bounds.width,
          }
        : card.bounds;
    const farOffset = offset(damage.bounds, painted(host));
    const nearOffset = offset(nearDamage.bounds, painted(nearHost));
    expect(Math.sign(farOffset.x)).toBe(Math.sign(nearOffset.x));
    expect(Math.sign(farOffset.y)).toBe(Math.sign(nearOffset.y));
    // Turned where it lies, a far card is still found where it is painted.
    const centre = {
      x: redTop.bounds.x + redTop.bounds.width / 2,
      y: redTop.bounds.y + redTop.bounds.height / 2,
    };
    expect(
      resolveBoardDropTarget(
        upright,
        upright.cards.find((card) => card.side === 'local')!.id,
        centre.x,
        centre.y
      )
    ).toBe(
      resolveBoardDropTarget(
        facing,
        facing.cards.find((card) => card.side === 'local')!.id,
        centre.x,
        centre.y
      )
    );
  });
});
