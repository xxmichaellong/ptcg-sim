import type { MatchViewState } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
} from './layout-table.js';
import type { BoardScene, MarkerSceneNode, Rect } from './model.js';
import { createBoardScene } from './scene.js';
import { createRendererSpikeView } from './spike-fixture.js';

/**
 * A Pokémon's Special Condition chips lie clear of its other markers
 * (ADR-043 §14): every combination of damage, the Ability marker, reminders
 * and one to three conditions (or a typed note), on either seat, on a flat
 * or tilted table, at a desktop's size and a phone's.
 */

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5;

const sceneFor = (
  markers: {
    readonly damage: number | null;
    readonly abilityUsed: boolean;
    readonly reminders: readonly string[];
    readonly specialCondition: string;
    readonly turns: 0 | 1;
  },
  viewport: { readonly width: number; readonly height: number },
  tiltedTable: boolean
): BoardScene => {
  const view = createRendererSpikeView();
  const stacks = Object.fromEntries(
    Object.entries(view.stacks).map(([id, stack]) => [
      id,
      stack.slot === 'active'
        ? {
            ...stack,
            damage: markers.damage,
            abilityUsed: markers.abilityUsed,
            reminders: markers.reminders,
            specialCondition: markers.specialCondition,
            rotationQuarterTurns: markers.turns,
          }
        : stack,
    ])
  ) as MatchViewState['stacks'];
  return createBoardScene(
    { ...view, stacks },
    createTableLayoutSnapshot({
      viewport: { ...viewport, devicePixelRatio: 1 },
      playerIds: [view.playerOrder[0]!, view.playerOrder[1]!],
      bottomPlayerId: view.playerOrder[0]!,
      shellMode: 'fullscreen',
      geometryVersion: 2,
      vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
      seamBandPx: 46,
      ...(tiltedTable ? { tiltedTable: true } : {}),
    })
  );
};

const REMINDERS = [
  'cantAttack',
  'cantRetreat',
  'takesLess',
  'hitsHarder',
  'noAbilities',
];
const CONDITIONS = ['P', 'P B', 'P B Pa', 'B A', 'Hit by Iono'];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
];

const cases = function* () {
  for (const specialCondition of CONDITIONS)
    for (const damage of [null, 130])
      for (const abilityUsed of [false, true])
        for (const reminderCount of [0, 1, 3, 5])
          yield {
            specialCondition,
            damage,
            abilityUsed,
            reminders: REMINDERS.slice(0, reminderCount),
          };
};

const onCard = (scene: BoardScene, cardId: string): MarkerSceneNode[] =>
  scene.markers.filter((marker) => marker.parentCardId === cardId);

describe('Special Condition chips among the other markers', () => {
  it('lie on the card and clear of every other marker on an upright Pokémon', () => {
    for (const viewport of VIEWPORTS)
      for (const tilted of [false, true])
        for (const markers of cases()) {
          const scene = sceneFor({ ...markers, turns: 0 }, viewport, tilted);
          const conditions = scene.markers.filter(
            (marker) => marker.kind === 'specialCondition'
          );
          // Both seats' Actives.
          expect(new Set(conditions.map((chip) => chip.side))).toEqual(
            new Set(['local', 'opponent'])
          );
          for (const chip of conditions) {
            const card = scene.cards.find(
              (node) => node.id === chip.parentCardId
            )!;
            const where = `${chip.id} ${JSON.stringify(markers)} ${viewport.width}x${viewport.height}${tilted ? ' tilted' : ''}`;
            expect(chip.bounds.x, where).toBeGreaterThanOrEqual(
              card.bounds.x - 0.5
            );
            expect(chip.bounds.y, where).toBeGreaterThanOrEqual(
              card.bounds.y - 0.5
            );
            expect(
              chip.bounds.x + chip.bounds.width,
              where
            ).toBeLessThanOrEqual(card.bounds.x + card.bounds.width + 0.5);
            expect(
              chip.bounds.y + chip.bounds.height,
              where
            ).toBeLessThanOrEqual(card.bounds.y + card.bounds.height + 0.5);
            // Clear of every other marker on the card: its middle is its own
            // to press, its glyph whole.
            for (const other of onCard(scene, chip.parentCardId)) {
              if (other.id === chip.id) continue;
              expect(
                overlaps(chip.bounds, other.bounds),
                `${where} vs ${other.id}`
              ).toBe(false);
            }
            // Full size, as v1's one marker.
            expect(chip.bounds.width, where).toBeCloseTo(
              card.bounds.width / 3,
              6
            );
          }
        }
  });

  it('keeps each chip apart from the others, the damage and the reminders on a card turned a quarter', () => {
    for (const viewport of VIEWPORTS)
      for (const tilted of [false, true])
        for (const markers of cases()) {
          const scene = sceneFor({ ...markers, turns: 1 }, viewport, tilted);
          for (const chip of scene.markers.filter(
            (marker) => marker.kind === 'specialCondition'
          )) {
            const where = `${chip.id} ${JSON.stringify(markers)} ${viewport.width}x${viewport.height}${tilted ? ' tilted' : ''}`;
            for (const other of onCard(scene, chip.parentCardId)) {
              // v1's own row already crosses the Ability marker on a card
              // turned a quarter; nothing else may be covered.
              if (other.id === chip.id || other.kind === 'abilityUsed')
                continue;
              expect(
                overlaps(chip.bounds, other.bounds),
                `${where} vs ${other.id}`
              ).toBe(false);
            }
          }
        }
  });

  it('puts the second in the middle of v1’s row and the third above the first (below, on the opponent’s side)', () => {
    const scene = sceneFor(
      {
        specialCondition: 'P B Pa',
        damage: 130,
        abilityUsed: true,
        reminders: REMINDERS,
        turns: 0,
      },
      { width: 1440, height: 900 },
      false
    );
    for (const side of ['local', 'opponent'] as const) {
      const [first, second, third] = scene.markers
        .filter(
          (marker) => marker.kind === 'specialCondition' && marker.side === side
        )
        .map((chip) => chip.bounds);
      const size = first!.width;
      expect(second!.y).toBeCloseTo(first!.y, 6);
      expect(second!.x - first!.x).toBeCloseTo(
        side === 'local' ? size : -size,
        6
      );
      expect(third!.x).toBeCloseTo(first!.x, 6);
      expect(third!.y - first!.y).toBeCloseTo(
        side === 'local' ? -size : size,
        6
      );
    }
  });
});
