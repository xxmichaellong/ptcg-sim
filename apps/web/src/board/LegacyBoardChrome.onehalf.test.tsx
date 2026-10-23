// @vitest-environment happy-dom

import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import {
  BoardDepthProjection,
  createBoardScene,
  createRendererSpikeView,
  createTableLayoutSnapshot,
  DEFAULT_BOARD_DEPTH,
  DEFAULT_BOARD_PREFERENCES,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  tableVerticalLayout,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { LegacyBoardChrome } from './LegacyBoardChrome.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The rail with one half shown, flat or on the tilted table. */
const railWith = async (
  width: number,
  height: number,
  hidden: 'upper' | 'lower',
  tilted: boolean
) => {
  const view = createRendererSpikeView();
  const layout = createTableLayoutSnapshot({
    geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
    viewport: { width, height, devicePixelRatio: 1 },
    playerIds: [view.playerOrder[0]!, view.playerOrder[1]!],
    bottomPlayerId: view.playerOrder[0]!,
    shellMode: 'fullscreen',
    vertical: tableVerticalLayout(0.54),
    seamBandPx: 44,
    hideEmptyLostZone: true,
    oncePerGameMarkers: 2,
    hiddenPhysicalSide: hidden,
    appBarPx: { width: 122, height: 42 },
  });
  const depth = tilted
    ? new BoardDepthProjection(createBoardScene(view, layout), {
        ...DEFAULT_BOARD_PREFERENCES,
        depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' },
      })
    : undefined;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const action = (id: string) => ({
    id,
    label: id,
    icon: PlayIcon,
    onSelect: vi.fn(),
  });
  await act(async () =>
    root.render(
      <LegacyBoardChrome
        layout={layout}
        {...(depth ? { depth } : {})}
        localPlayerId={view.playerOrder[0]!}
        players={view.players}
        darkMode={false}
        actions={{ toggleOncePerGame: vi.fn() }}
        rail={{
          actions: [
            'turnButton',
            'attackButton',
            'passButton',
            'flipCoinButton',
            'undoButton',
            'flipBoardButton',
          ].map(action),
          more: ['a', 'b', 'c'].map((id) => ({
            id,
            label: id,
            onSelect: vi.fn(),
          })),
        }}
      />
    )
  );
  const bar = host.querySelector<HTMLElement>('#boardButtonContainer')!;
  const rail = {
    align: bar.dataset['align'],
    shown: [...bar.querySelectorAll('button.ptcgsim-rail-button')].map(
      (button) => button.id
    ),
  };
  await act(async () => root.unmount());
  host.remove();
  return rail;
};

describe('the rail with one half shown on the tilted table', () => {
  it('keeps its actions as on the flat table, the Stadium in the Active row not in its way', async () => {
    // Theirs on an upright phone; mine on a desktop.
    for (const [width, height, hidden] of [
      [390, 844, 'lower'],
      [1280, 720, 'upper'],
    ] as const) {
      const at = `${String(width)}x${String(height)} ${hidden} hidden`;
      const flat = await railWith(width, height, hidden, false);
      const tilted = await railWith(width, height, hidden, true);
      expect(tilted.shown, at).toEqual(flat.shown);
      expect(tilted.align, at).toBe(flat.align);
    }
  });
});
