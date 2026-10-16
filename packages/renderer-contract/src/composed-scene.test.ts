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
  it("shows a BREAK sideways once, whether or not v1's Alt+R also turned it", () => {
    const base = createRendererSpikeView();
    const playerId = base.playerOrder[0]!;
    const stack = base.stacks[base.boards[playerId]!.activeStackId!]!;
    const top = stack.evolutionCards.at(-1)!;
    if (top.kind !== 'known') throw new Error('known top card required');
    const breakId = asViewDefinitionId('break-definition');
    const breakCard = (orientationQuarterTurns: 0 | 1 | 2 | 3) => ({
      ...top,
      id: asViewCardId('break-card'),
      definitionId: breakId,
      orientationQuarterTurns,
    });
    const turnOf = (orientationQuarterTurns: 0 | 1 | 2 | 3) => {
      const view: MatchViewState = {
        ...base,
        definitions: {
          ...base.definitions,
          [breakId]: {
            id: breakId,
            name: 'Greninja BREAK',
            category: 'Pokémon',
            imageUrl: '/greninja-break.png',
          },
        },
        stacks: {
          ...base.stacks,
          [stack.id]: {
            ...stack,
            evolutionCards: [
              ...stack.evolutionCards,
              breakCard(orientationQuarterTurns),
            ],
            attachmentCards: [],
            rotationQuarterTurns: 0,
          },
        },
      };
      const scene = createBoardScene(
        view,
        createTableLayoutSnapshot({
          viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
          bottomPlayerId: playerId,
          playerIds: base.playerOrder as [PlayerId, PlayerId],
          shellMode: 'fullscreen',
          vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
          geometryVersion: 2,
        })
      );
      return scene.cards.find((card) => card.id === 'break-card')!
        .rotationQuarterTurns;
    };
    // The arrangement lays it across the card below; Alt+R (which toggles
    // a card between upright and one quarter-turn) must not stand it on its
    // head, and neither may a v1 game where it was already turned.
    expect(turnOf(0)).toBe(1);
    expect(turnOf(1)).toBe(1);
    // A deliberate further turn still shows.
    expect(turnOf(2)).toBe(3);
  });

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
          compositionHold(scene, card, {
            cardId: anchor.id,
            x: 400,
            y: 300,
            targetId: null,
          })!
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
  it('carries a joined Pokémon whole wherever it is held, and settles it whole only when the drop moved it whole', () => {
    const { view, cards, stack, playerId } = fixture();
    const scene = createBoardScene(
      view,
      createTableLayoutSnapshot({
        viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
        bottomPlayerId: playerId,
        playerIds: view.playerOrder as [PlayerId, PlayerId],
        shellMode: 'fullscreen',
        vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
        geometryVersion: 2,
      })
    );
    const pieces = scene.cards.filter((card) => card.parentId === stack.id);
    expect(pieces.length).toBe(cards.length);
    const grabbed = pieces[0]!;
    const other = pieces[1]!;
    const drag = (targetId: string | null) => ({
      cardId: grabbed.id,
      x: 400,
      y: 300,
      targetId,
    });
    const zoneOf = (kind: string) =>
      scene.zones.find(
        (zone) => zone.kind === kind && zone.playerId === playerId
      )!.id;
    // Picked up, over a play slot or over a pile: the whole Pokémon comes
    // along, as the drop sends all of it.
    expect(compositionHold(scene, other, drag(null))).not.toBeNull();
    expect(compositionHold(scene, other, drag(zoneOf('bench')))).not.toBeNull();
    expect(
      compositionHold(scene, other, drag(zoneOf('discard')))
    ).not.toBeNull();
    // Dropped, it settles whole only when the drop moved all of it.
    expect(
      compositionHold(scene, other, { cardId: grabbed.id, x: 400, y: 300 })
    ).toBeNull();
    expect(
      compositionHold(scene, other, {
        cardId: grabbed.id,
        x: 400,
        y: 300,
        wholeStack: true,
      })
    ).not.toBeNull();
    // The grabbed piece itself always follows.
    expect(compositionHold(scene, grabbed, drag(zoneOf('discard')))).toEqual(
      drag(zoneOf('discard'))
    );
  });

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
  it("reads a far joined card upright, its pieces where the viewer's own would be", () => {
    const { view, stack, playerId } = fixture();
    const other = view.playerOrder.find((id) => id !== playerId)!;
    const sceneFor = (bottomPlayerId: PlayerId, farCardsUpright: boolean) =>
      createBoardScene(
        view,
        createTableLayoutSnapshot({
          viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
          bottomPlayerId,
          playerIds: view.playerOrder as [PlayerId, PlayerId],
          shellMode: 'fullscreen',
          vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
          geometryVersion: 2,
          ...(farCardsUpright ? { farCardsUpright: true } : {}),
        })
      );
    // Each piece's place in the joined card, and which way it faces.
    const arrangement = (scene: ReturnType<typeof sceneFor>) =>
      scene.cards
        .filter((card) => card.parentId === stack.id)
        .map((card) => {
          const whole = card.composition!.bounds;
          // (+ 0 turns a rounded -0 into 0.)
          return {
            id: card.id,
            x: Math.round(((card.bounds.x - whole.x) / whole.width) * 1000) + 0,
            y:
              Math.round(((card.bounds.y - whole.y) / whole.height) * 1000) + 0,
            turns: card.rotationQuarterTurns,
          };
        })
        .sort((left, right) => left.id.localeCompare(right.id));
    const near = arrangement(sceneFor(playerId, false));
    const facing = arrangement(sceneFor(other, false));
    const upright = arrangement(sceneFor(other, true));
    expect(facing).not.toEqual(near);
    expect(upright).toEqual(near);
  });
});
