// @vitest-environment happy-dom

import { catalogCardText, decodeCatalog } from '@ptcgsim/deck-core';
import type { MatchViewState } from '@ptcgsim/game-core';
import {
  createBoardSceneForViewport,
  createRendererSpikeView,
} from '@ptcgsim/renderer-contract';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { CardCatalogSource } from '../../features/deck/card-catalog-contract.js';
import { createInitialBoardSessionControllerState } from '../BoardSessionController.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The Pokémon window read from the catalog (ADR-043): a BREAK's printed
 * card has no Weakness, Resistance or Retreat (the catalog says Retreat
 * 0), so it plays with its Stage below's.
 */
const catalog = decodeCatalog({
  v: 1,
  builtAt: '2026-11-04T00:00:00.000Z',
  source: 'TCGdex',
  sets: [
    {
      id: 'xy8',
      code: 'BKT',
      name: 'BREAKthrough',
      series: 'XY',
      released: '2015-11-04',
      img: 'https://assets.tcgdex.net/en/xy/xy8/',
      cards: [
        {
          n: '103',
          nm: 'Florges',
          c: 'P',
          st: 'Stage 2',
          ty: 'Y',
          hp: 130,
          rt: 1,
          wk: 'M',
          wv: '×2',
          at: [['Wonder Shine', 'YYC', '70']],
        },
        {
          n: '104',
          nm: 'Florges BREAK',
          c: 'P',
          st: 'BREAK',
          ty: 'Y',
          hp: 160,
          rt: 0,
          at: [['Bright Garden', 'YYC', '']],
        },
      ],
    },
  ],
} as never);

const ready = { status: 'ready', catalog } as const;
const source: CardCatalogSource = {
  getSnapshot: () => ready,
  subscribe: () => () => undefined,
  load: () => undefined,
  retry: () => undefined,
};

vi.mock('../../features/deck/LazyDeckBuilderSession.js', () => ({
  loadedTableCardCatalog: () => source,
  tableCardCatalog: async () => source,
}));

const { LegacyBoardOverlays } = await import('./LegacyBoardOverlays.js');

describe('a BREAK in its window', () => {
  it('says no Retreat of its own when an edit starts from its print', () => {
    expect(catalogCardText(catalog.byId.get('BKT 104')!)).not.toHaveProperty(
      'retreat'
    );
    expect(catalogCardText(catalog.byId.get('BKT 103')!).retreat).toBe(1);
  });

  it.each([
    ['from the catalog', undefined, 1],
    ['given its own Retreat of 0', { retreat: 0 }, 0],
  ] as const)(
    'shows the Stage below’s Retreat and Weakness, and its moves too (%s)',
    async (_, ownText, retreatCost) => {
      const base = createRendererSpikeView();
      const blue = base.playerOrder[0]!;
      const stackId = base.boards[blue]!.activeStackId!;
      const stack = base.stacks[stackId]!;
      const [lower, top] = [
        stack.evolutionCards.at(-2),
        stack.evolutionCards.at(-1),
      ];
      if (lower?.kind !== 'known' || top?.kind !== 'known') return;
      const definitions = { ...base.definitions };
      const image = (number: string) =>
        `https://assets.tcgdex.net/en/xy/xy8/${number}/high.webp`;
      definitions[lower.definitionId] = {
        ...definitions[lower.definitionId]!,
        name: 'Florges',
        imageUrl: image('103'),
        print: 'BKT 103',
      };
      definitions[top.definitionId] = {
        ...definitions[top.definitionId]!,
        name: 'Florges BREAK',
        imageUrl: image('104'),
        print: 'BKT 104',
        ...(ownText
          ? {
              text: {
                hp: 160,
                ...ownText,
                attacks: [
                  { name: 'Bright Garden', cost: ['Fairy'], damage: '' },
                ],
              },
            }
          : {}),
      };
      const view: MatchViewState = { ...base, definitions };
      const scene = createBoardSceneForViewport(view, {
        geometryVersion: 1,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
        bottomPlayerId: blue,
        splitRatio: 0.5,
      });
      const host = document.createElement('div');
      document.body.replaceChildren(host);
      const root = createRoot(host);
      await act(async () =>
        root.render(
          createElement(LegacyBoardOverlays, {
            state: {
              ...createInitialBoardSessionControllerState(),
              generation: 1,
              sessionPhase: 'ready',
              source: { kind: 'live' },
              view,
              scene,
              canSubmitCommands: true,
              overlays: {
                contextMenuCardId: null,
                preview: { kind: 'stack', stackId, focusCardId: top.id },
                input: null,
              },
            },
            darkMode: false,
            actions: {
              emitOpenedZoneCardIntent: vi.fn(),
              dismiss: vi.fn(),
              invokeContextAction: vi.fn(),
              invokeZoneAction: vi.fn(),
              submitDamageInput: vi.fn(),
              submitSpecialConditionInput: vi.fn(),
              submitCountInput: vi.fn(),
              submitShortcutCountInput: vi.fn(),
              submitCategoryChoice: vi.fn(),
              submitMoveChoice: vi.fn(),
            },
          })
        )
      );
      let window = host.querySelector<HTMLElement>('[data-pokemon-window]');
      if (!window) {
        // A BREAK is shown laid over its Stage first; Details opens it.
        const details = [...host.querySelectorAll('button')].find(
          (button) => button.textContent === 'Details'
        )!;
        await act(async () => details.click());
        window = host.querySelector<HTMLElement>('[data-pokemon-window]')!;
      }
      const stats = window.querySelector('.pokemon-window__stats')!;
      const retreat = stats.querySelectorAll('div')[2]!;
      expect(retreat.querySelectorAll('.energy-symbol')).toHaveLength(
        retreatCost
      );
      expect(stats.querySelectorAll('div')[0]!.textContent).toContain('×2');
      expect(window.textContent).toContain('Bright Garden');
      expect(window.textContent).toContain('Wonder Shine');
      expect(
        window.querySelector('.pokemon-window__hp-value')?.textContent
      ).toMatch(/\/160$/u);
      await act(async () => root.unmount());
    }
  );

  it('shows nothing of its Stage as its own when its own print is unknown', async () => {
    const base = createRendererSpikeView();
    const blue = base.playerOrder[0]!;
    const stackId = base.boards[blue]!.activeStackId!;
    const stack = base.stacks[stackId]!;
    const [lower, top] = [
      stack.evolutionCards.at(-2),
      stack.evolutionCards.at(-1),
    ];
    if (lower?.kind !== 'known' || top?.kind !== 'known') return;
    const definitions = { ...base.definitions };
    definitions[lower.definitionId] = {
      ...definitions[lower.definitionId]!,
      name: 'Florges',
      imageUrl: 'https://assets.tcgdex.net/en/xy/xy8/103/high.webp',
      print: 'BKT 103',
    };
    definitions[top.definitionId] = {
      ...definitions[top.definitionId]!,
      name: 'Florges BREAK',
      imageUrl: '/unknown-break.png',
    };
    const view: MatchViewState = { ...base, definitions };
    const scene = createBoardSceneForViewport(view, {
      geometryVersion: 1,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      bottomPlayerId: blue,
      splitRatio: 0.5,
    });
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(LegacyBoardOverlays, {
          state: {
            ...createInitialBoardSessionControllerState(),
            generation: 1,
            sessionPhase: 'ready',
            source: { kind: 'live' },
            view,
            scene,
            canSubmitCommands: true,
            overlays: {
              contextMenuCardId: null,
              preview: { kind: 'stack', stackId, focusCardId: top.id },
              input: null,
            },
          },
          darkMode: false,
          actions: {
            emitOpenedZoneCardIntent: vi.fn(),
            dismiss: vi.fn(),
            invokeContextAction: vi.fn(),
            invokeZoneAction: vi.fn(),
            submitDamageInput: vi.fn(),
            submitSpecialConditionInput: vi.fn(),
            submitCountInput: vi.fn(),
            submitShortcutCountInput: vi.fn(),
            submitCategoryChoice: vi.fn(),
            submitMoveChoice: vi.fn(),
          },
        })
      )
    );
    let window = host.querySelector<HTMLElement>('[data-pokemon-window]');
    if (!window) {
      const details = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Details'
      )!;
      await act(async () => details.click());
      window = host.querySelector<HTMLElement>('[data-pokemon-window]')!;
    }
    // Not Florges's 130 HP, nor its Stage 2: its moves and its Retreat.
    expect(window.querySelector('.pokemon-window__hp-value')).toBeNull();
    expect(
      window.querySelector('.pokemon-window__eyebrow')?.textContent
    ).not.toContain('Stage 2');
    expect(window.textContent).toContain('Wonder Shine');
    expect(
      window
        .querySelectorAll('.pokemon-window__stats div')[2]!
        .querySelectorAll('.energy-symbol')
    ).toHaveLength(1);
    await act(async () => root.unmount());
  });
});
