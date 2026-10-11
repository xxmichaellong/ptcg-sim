import {
  asViewCardId,
  asViewDefinitionId,
  type CardPresentation,
  type MatchViewState,
  type PlayerId,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';
import { createRendererSpikeView } from './spike-fixture.js';
import { createBoardScene, hitTestBoardScene } from './scene.js';
import {
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
} from './layout-table.js';
import { compositionHold, paintedCardBounds } from './card-composition.js';

const fixture = () => {
  const base = createRendererSpikeView();
  const playerId = base.playerOrder[0]!;
  const stack = base.stacks[base.boards[playerId]!.activeStackId!]!;
  const definitions = { ...base.definitions };
  const cards = [3, 0, 2, 1].map((part) => {
    const id = asViewDefinitionId(`union-definition-${part}`);
    const presentation: CardPresentation = {
      readingQuarterTurns: 0,
      join: { key: 'mewtwo', columns: 2, rows: 2, part: part as 0 | 1 | 2 | 3 },
    };
    definitions[id] = {
      id,
      name: 'Mewtwo V-UNION',
      category: 'Pokémon',
      imageUrl: `/piece-${part}.png`,
      presentation,
    };
    return {
      kind: 'known' as const,
      id: asViewCardId(`union-${part}`),
      definitionId: id,
      ownerId: playerId,
      category: 'Pokémon' as const,
      face: 'up' as const,
      orientationQuarterTurns: 0 as const,
      abilityUsed: false,
      publiclyRevealed: true,
    };
  });
  const view: MatchViewState = {
    ...base,
    definitions,
    stacks: {
      ...base.stacks,
      [stack.id]: {
        ...stack,
        evolutionCards: cards,
        attachmentCards: [],
        rotationQuarterTurns: 0,
        damage: 120,
      },
    },
  };
  return { view, cards, stack, playerId };
};

describe('composed board scenes', () => {
  it.each([724, 1024, 1109, 1600])(
    'keeps a paired Stadium clear of both Active slots and side piles at width %s',
    (width) => {
      const base = createRendererSpikeView();
      const { cards, view: unionView } = fixture();
      const definitions = { ...base.definitions };
      const pieces = cards.slice(0, 2).map((card, part) => {
        definitions[card.definitionId] = {
          ...unionView.definitions[card.definitionId]!,
          category: 'Trainer',
          presentation: {
            readingQuarterTurns: 0,
            join: {
              key: 'paired-stadium',
              columns: 2,
              rows: 1,
              part: part as 0 | 1,
            },
          },
        };
        return { ...card, category: 'Trainer' as const };
      });
      const stadium = Object.values(base.zones).find(
        (zone) => zone.kind === 'stadium'
      )!;
      const view: MatchViewState = {
        ...base,
        definitions,
        zones: { ...base.zones, [stadium.id]: { ...stadium, cards: pieces } },
      };
      for (const bottomPlayerId of base.playerOrder) {
        const scene = createBoardScene(
          view,
          createTableLayoutSnapshot({
            viewport: { width, height: 768, devicePixelRatio: 1 },
            bottomPlayerId,
            playerIds: base.playerOrder as [PlayerId, PlayerId],
            shellMode: 'fullscreen',
            vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
            geometryVersion: 2,
          })
        );
        const obstacleKinds = [
          'active',
          'deck',
          'discard',
          'lostZone',
          'prizes',
        ];
        for (const card of scene.cards.filter(
          (candidate) => candidate.parentId === stadium.id
        )) {
          const box = paintedCardBounds(card.bounds, card.rotationQuarterTurns);
          for (const zone of scene.zones.filter((candidate) =>
            obstacleKinds.includes(candidate.kind)
          )) {
            const other = zone.bounds;
            const separated =
              box.x + box.width <= other.x ||
              other.x + other.width <= box.x ||
              box.y + box.height <= other.y ||
              other.y + other.height <= box.y;
            expect(separated, `Stadium piece overlaps ${zone.kind}`).toBe(true);
          }
        }
      }
    }
  );
  it.each([1024, 1440, 1920])(
    'keeps four individually hittable pieces inside the Active at width %s',
    (width) => {
      const { view, stack, playerId } = fixture();
      for (const bottomPlayerId of view.playerOrder) {
        const scene = createBoardScene(
          view,
          createTableLayoutSnapshot({
            viewport: { width, height: 900, devicePixelRatio: 1 },
            bottomPlayerId,
            playerIds: view.playerOrder as [typeof playerId, typeof playerId],
            shellMode: 'fullscreen',
            vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
            geometryVersion: 2,
          })
        );
        const zone = scene.zones.find(
          (zone) => zone.playerId === playerId && zone.kind === 'active'
        )!;
        const pieces = scene.cards.filter((card) => card.parentId === stack.id);
        expect(pieces).toHaveLength(4);
        for (const card of pieces) {
          const bounds = paintedCardBounds(
            card.bounds,
            card.rotationQuarterTurns
          );
          expect(bounds.x).toBeGreaterThanOrEqual(zone.bounds.x - 0.001);
          expect(bounds.y).toBeGreaterThanOrEqual(zone.bounds.y - 0.001);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(
            zone.bounds.x + zone.bounds.width + 0.001
          );
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(
            zone.bounds.y + zone.bounds.height + 0.001
          );
          expect(
            hitTestBoardScene(
              scene,
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2
            )
          ).toEqual({ kind: 'card', id: card.id });
        }
        const anchor = pieces[0]!;
        const held = pieces.map((card) =>
          compositionHold(scene, card, { cardId: anchor.id, x: 400, y: 300 })!
        );
        expect(held[1]!.x - held[0]!.x).toBeCloseTo(
          pieces[1]!.bounds.x - anchor.bounds.x
        );
        expect(
          scene.markers.filter(
            (marker) =>
              marker.parentCardId === pieces.at(-1)!.id &&
              marker.kind === 'damage'
          )
        ).toHaveLength(1);
      }
    }
  );
  it('does not attach artwork metadata or composite geometry to concealed faces', () => {
    const { view, cards, stack, playerId } = fixture();
    const hidden: MatchViewState = {
      ...view,
      stacks: {
        ...view.stacks,
        [stack.id]: {
          ...view.stacks[stack.id]!,
          evolutionCards: cards.map((card) => ({
            ...card,
            face: 'down' as const,
          })),
        },
      },
    };
    const scene = createBoardScene(
      hidden,
      createTableLayoutSnapshot({
        viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
        bottomPlayerId: playerId,
        playerIds: view.playerOrder as [typeof playerId, typeof playerId],
        shellMode: 'fullscreen',
        vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
        geometryVersion: 2,
      })
    );
    for (const card of scene.cards.filter(
      (card) => card.parentId === stack.id
    )) {
      expect(card.presentation).toBeUndefined();
      expect(card.composition).toBeUndefined();
      expect(card.imageUrl).toBe(view.players[playerId]!.cardBackUrl);
    }
  });
});
