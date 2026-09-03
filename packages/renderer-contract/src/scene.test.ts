import {
  asPlayerId,
  asViewCardId,
  asViewDefinitionId,
  type MatchViewState,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD_VIEWPORT } from './defaults.js';
import { resolveBoardDropTarget } from './drag.js';
import { layoutPlayerZone } from './geometry.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  findBoardLayoutRegion,
  layoutLegacyOrdinaryEvolutionStack,
  layoutLegacySingleEnergyAttachmentStack,
  layoutLegacySingleTrainerToolAttachmentStack,
  type BoardLayoutRegion,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
} from './layout.js';
import {
  createBoardScene,
  createBoardSceneForViewport,
  diffBoardScenes,
  hitTestBoardScene,
} from './scene.js';
import { createRendererSpikeView } from './spike-fixture.js';

const p1 = asPlayerId('p1');
const p2 = asPlayerId('p2');
const knownCardId = asViewCardId('view-card-known');
const hiddenCardId = asViewCardId('view-card-hidden');
const definitionId = asViewDefinitionId('view-definition-known');
const energyDefinitionId = asViewDefinitionId('view-definition-energy');
const trainerDefinitionId = asViewDefinitionId('view-definition-trainer');

const createView = (): MatchViewState => ({
  matchId: 'match-renderer-contract',
  revision: 7,
  lifecycle: 'playing',
  viewer: { kind: 'player', playerId: p1 },
  playerOrder: [p1, p2],
  players: {
    [p1]: {
      id: p1,
      displayName: 'Blue',
      cardBackUrl: '/blue-back.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
    [p2]: {
      id: p2,
      displayName: 'Red',
      cardBackUrl: '/red-back.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
  },
  definitions: {
    [definitionId]: {
      id: definitionId,
      name: 'Visible Pokémon',
      category: 'Pokémon',
      imageUrl: 'https://cards.invalid/full-secret.png',
      imageUrlSmall: 'https://cards.invalid/board-visible.png',
    },
    [energyDefinitionId]: {
      id: energyDefinitionId,
      name: 'Visible Energy',
      category: 'Energy',
      imageUrl: 'https://cards.invalid/full-energy.png',
      imageUrlSmall: 'https://cards.invalid/board-energy.png',
    },
    [trainerDefinitionId]: {
      id: trainerDefinitionId,
      name: 'Visible Trainer',
      category: 'Trainer',
      imageUrl: 'https://cards.invalid/full-trainer.png',
      imageUrlSmall: 'https://cards.invalid/board-trainer.png',
    },
  },
  zones: {
    'zone:p1:hand': {
      id: 'zone:p1:hand',
      kind: 'hand',
      ownerId: p1,
      cards: [
        {
          kind: 'known',
          id: knownCardId,
          definitionId,
          ownerId: p1,
          category: 'Pokémon',
          face: 'up',
          orientationQuarterTurns: 0,
          abilityUsed: false,
          publiclyRevealed: false,
        },
      ],
    },
    'zone:p2:deck': {
      id: 'zone:p2:deck',
      kind: 'deck',
      ownerId: p2,
      cards: [
        {
          kind: 'concealed',
          id: hiddenCardId,
          ownerId: p2,
          cardBackUrl: '/red-back.png',
          publiclyRevealed: false,
        },
      ],
    },
    'zone:shared:stadium': {
      id: 'zone:shared:stadium',
      kind: 'stadium',
      ownerId: null,
      cards: [],
    },
  },
  boards: {
    [p1]: { activeStackId: null, benchStackIds: [] },
    [p2]: { activeStackId: null, benchStackIds: [] },
  },
  stacks: {},
  workAreas: {
    [p1]: { inspection: null, attachmentResolution: null },
    [p2]: { inspection: null, attachmentResolution: null },
  },
  privateInspections: [],
  turn: { number: 2, currentPlayerId: p1 },
});

const createOrdinaryEvolutionView = (): MatchViewState => {
  const base = createView();
  const card = (id: string, ownerId: typeof p1 | typeof p2) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId,
    ownerId,
    category: 'Pokémon' as const,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: true,
  });
  const stack = (
    id: string,
    boardPlayerId: typeof p1 | typeof p2,
    slot: 'active' | 'bench'
  ) => ({
    id,
    boardPlayerId,
    slot,
    evolutionCards: [
      card(`${id}:base`, boardPlayerId),
      card(`${id}:middle`, boardPlayerId),
      card(`${id}:top`, boardPlayerId),
    ],
    attachmentCards: [],
    rotationQuarterTurns: 0 as const,
    damage: null,
    specialCondition: null,
    abilityUsed: false,
  });
  return {
    ...base,
    boards: {
      [p1]: {
        activeStackId: 'stack:p1:active',
        benchStackIds: ['stack:p1:bench'],
      },
      [p2]: {
        activeStackId: 'stack:p2:active',
        benchStackIds: ['stack:p2:bench'],
      },
    },
    stacks: {
      'stack:p1:active': stack('stack:p1:active', p1, 'active'),
      'stack:p1:bench': stack('stack:p1:bench', p1, 'bench'),
      'stack:p2:active': stack('stack:p2:active', p2, 'active'),
      'stack:p2:bench': stack('stack:p2:bench', p2, 'bench'),
    },
  };
};

const createSingleEnergyAttachmentView = (): MatchViewState => {
  const view = createView();
  const card = (
    id: string,
    ownerId: typeof p1 | typeof p2,
    category: 'Pokémon' | 'Energy'
  ) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId: category === 'Pokémon' ? definitionId : energyDefinitionId,
    ownerId,
    category,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: false,
  });
  const stack = (id: string, boardPlayerId: typeof p1 | typeof p2) => ({
    id,
    boardPlayerId,
    slot: 'active' as const,
    evolutionCards: [card(`${id}:base`, boardPlayerId, 'Pokémon')],
    attachmentCards: [card(`${id}:energy`, boardPlayerId, 'Energy')],
    rotationQuarterTurns: 0 as const,
    damage: null,
    specialCondition: null,
    abilityUsed: false,
  });
  const local = stack('stack:p1:single-energy', p1);
  const opponent = stack('stack:p2:single-energy', p2);
  return {
    ...view,
    zones: Object.fromEntries(
      Object.entries(view.zones).map(([id, zone]) => [
        id,
        { ...zone, cards: [] },
      ])
    ),
    boards: {
      [p1]: { activeStackId: local.id, benchStackIds: [] },
      [p2]: { activeStackId: opponent.id, benchStackIds: [] },
    },
    stacks: { [local.id]: local, [opponent.id]: opponent },
  };
};

const createSingleTrainerToolAttachmentView = (): MatchViewState => {
  const view = createView();
  const card = (
    id: string,
    ownerId: typeof p1 | typeof p2,
    category: 'Pokémon' | 'Trainer'
  ) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId: category === 'Pokémon' ? definitionId : trainerDefinitionId,
    ownerId,
    category,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: false,
  });
  const stack = (id: string, boardPlayerId: typeof p1 | typeof p2) => ({
    id,
    boardPlayerId,
    slot: 'active' as const,
    evolutionCards: [card(`${id}:base`, boardPlayerId, 'Pokémon')],
    attachmentCards: [card(`${id}:tool`, boardPlayerId, 'Trainer')],
    rotationQuarterTurns: 0 as const,
    damage: null,
    specialCondition: null,
    abilityUsed: false,
  });
  const local = stack('stack:p1:single-trainer-tool', p1);
  const opponent = stack('stack:p2:single-trainer-tool', p2);
  return {
    ...view,
    zones: Object.fromEntries(
      Object.entries(view.zones).map(([id, zone]) => [
        id,
        { ...zone, cards: [] },
      ])
    ),
    boards: {
      [p1]: { activeStackId: local.id, benchStackIds: [] },
      [p2]: { activeStackId: opponent.id, benchStackIds: [] },
    },
    stacks: { [local.id]: local, [opponent.id]: opponent },
  };
};

const options = {
  viewport: DEFAULT_BOARD_VIEWPORT,
  bottomPlayerId: p1,
  splitRatio: 0.5,
  geometryVersion: 1 as const,
};

const characterizedEvolutionLayoutState = {
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
  playerIds: [p1, p2],
  bottomPlayerId: p1,
  shellMode: 'sidebar',
  vertical: {
    lowerFrame: { bottomRatio: 0, heightRatio: 0.5 },
    upperFrame: { bottomRatio: 0.5, heightRatio: 0.5 },
    lowerHandle: { bottomRatio: 0.505, heightRatio: 0.025 },
    upperHandle: { bottomRatio: 0.53, heightRatio: 0.025 },
    sharedPlacement: 'cssDefault',
  },
} as const satisfies BoardLayoutState;

describe('renderer-neutral board scene', () => {
  it('transcribes legacy player-half geometry without depending on CSS layout', () => {
    expect(layoutPlayerZone('hand', 'local', options)).toEqual({
      x: 0,
      y: 765,
      width: 1208,
      height: 135,
    });
    const opponentDeck = layoutPlayerZone('deck', 'opponent', options);
    expect(opponentDeck.x).toBeCloseTo(12.08);
    expect(opponentDeck).toMatchObject({
      y: 297,
      width: 96.64,
      height: 112.5,
    });
    const opponentBoard = layoutPlayerZone('board', 'opponent', options);
    expect(opponentBoard.x).toBeCloseTo(797.28);
    expect(opponentBoard.y).toBeCloseTo(274.5);
    expect(opponentBoard).toMatchObject({
      width: 265.76,
      height: 135,
    });
  });

  it('uses board-tier face images only for visible cards and backs for concealed cards', () => {
    const scene = createBoardSceneForViewport(createView(), options);
    const known = scene.cards.find((card) => card.id === knownCardId);
    const hidden = scene.cards.find((card) => card.id === hiddenCardId);
    expect(known).toMatchObject({
      imageUrl: 'https://cards.invalid/board-visible.png',
      concealed: false,
      label: 'Visible Pokémon',
    });
    expect(hidden).toMatchObject({
      imageUrl: '/red-back.png',
      concealed: true,
      label: 'Face-down card',
      rotationQuarterTurns: 2,
    });
    expect(JSON.stringify(hidden)).not.toContain('full-secret');
  });

  it('composes BREAK offsets with group rotation and projects per-card ability markers', () => {
    const base = createRendererSpikeView();
    const stadium = base.zones['zone:shared:stadium']!;
    const stadiumCard = stadium.cards[0]!;
    const stack = base.stacks['stack:blue:active']!;
    const top = stack.evolutionCards.at(-1)!;
    const attachment = stack.attachmentCards[0]!;
    if (
      stadiumCard.kind !== 'known' ||
      top.kind !== 'known' ||
      attachment.kind !== 'known'
    ) {
      throw new Error('Spike annotation cards must be known');
    }
    const view: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        [stadium.id]: {
          ...stadium,
          cards: [
            {
              ...stadiumCard,
              orientationQuarterTurns: 1,
              abilityUsed: true,
            },
          ],
        },
      },
      stacks: {
        ...base.stacks,
        [stack.id]: {
          ...stack,
          rotationQuarterTurns: 1,
          evolutionCards: [
            ...stack.evolutionCards.slice(0, -1),
            { ...top, orientationQuarterTurns: 1 },
          ],
          attachmentCards: [
            { ...attachment, abilityUsed: true },
            ...stack.attachmentCards.slice(1),
          ],
        },
      },
    };
    const scene = createBoardSceneForViewport(view, {
      ...options,
      bottomPlayerId: view.playerOrder[0]!,
    });
    expect(
      scene.cards.find((card) => card.id === stadiumCard.id)
        ?.rotationQuarterTurns
    ).toBe(1);
    expect(
      scene.cards.find((card) => card.id === top.id)?.rotationQuarterTurns
    ).toBe(2);
    expect(scene.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `${stadiumCard.id}:abilityUsed`,
          parentCardId: stadiumCard.id,
        }),
        expect.objectContaining({
          id: `${attachment.id}:abilityUsed`,
          parentCardId: attachment.id,
        }),
      ])
    );
  });

  it('uses the characterized stable ordinary-evolution layout without definition leakage', () => {
    const view = createOrdinaryEvolutionView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const scene = createBoardScene(view, layout);
    for (const [playerId, side] of [
      [p1, 'local'],
      [p2, 'opponent'],
    ] as const) {
      for (const slot of ['active', 'bench'] as const) {
        const stackId = `stack:${playerId}:${slot}`;
        const stack = view.stacks[stackId]!;
        const expected = layoutLegacyOrdinaryEvolutionStack(
          findBoardLayoutRegion(layout, side, slot),
          63 / 88,
          3
        );
        const nodes = stack.evolutionCards.map((card) => {
          const node = scene.cards.find(
            (candidate) => candidate.id === card.id
          );
          if (!node)
            throw new Error(`Missing ordinary evolution node ${card.id}`);
          return node;
        });
        expect(nodes.map((node) => node.bounds)).toEqual(
          expected.cards.map((card) => card.bounds)
        );
        expect(nodes.map((node) => node.zIndex)).toEqual([298, 299, 300]);
        expect(nodes.map((node) => node.rotationQuarterTurns)).toEqual(
          side === 'local' ? [0, 0, 0] : [2, 2, 2]
        );

        const [base, middle, top] = nodes;
        if (!base || !middle || !top) {
          throw new Error(`Incomplete ordinary evolution stack ${stackId}`);
        }
        const x = top.bounds.x + top.bounds.width / 2;
        const commonY =
          Math.max(base.bounds.y, middle.bounds.y, top.bounds.y) +
          Math.min(
            base.bounds.height,
            middle.bounds.height,
            top.bounds.height
          ) /
            2;
        expect(hitTestBoardScene(scene, x, commonY)).toEqual({
          kind: 'card',
          id: top.id,
        });
        const middleStripY =
          side === 'local'
            ? (middle.bounds.y + top.bounds.y) / 2
            : (middle.bounds.y +
                middle.bounds.height +
                top.bounds.y +
                top.bounds.height) /
              2;
        expect(hitTestBoardScene(scene, x, middleStripY)).toEqual({
          kind: 'card',
          id: middle.id,
        });
        const baseStripY =
          side === 'local'
            ? (base.bounds.y + middle.bounds.y) / 2
            : (base.bounds.y +
                base.bounds.height +
                middle.bounds.y +
                middle.bounds.height) /
              2;
        expect(hitTestBoardScene(scene, x, baseStripY)).toEqual({
          kind: 'card',
          id: base.id,
        });
      }
    }
    expect(scene.markers).toEqual([]);

    const changedDefinitions: MatchViewState = {
      ...view,
      definitions: {
        ...view.definitions,
        [definitionId]: {
          ...view.definitions[definitionId]!,
          imageUrl: 'https://cards.invalid/different-secret-dimensions.png',
          imageUrlSmall: 'https://cards.invalid/different-board-dimensions.png',
        },
      },
    };
    const changedScene = createBoardScene(changedDefinitions, layout);
    for (const stack of Object.values(view.stacks)) {
      for (const card of stack.evolutionCards) {
        expect(
          changedScene.cards.find((candidate) => candidate.id === card.id)
            ?.bounds
        ).toEqual(
          scene.cards.find((candidate) => candidate.id === card.id)?.bounds
        );
      }
    }
  });

  it('uses stable one-Energy active geometry without definition-size leakage', () => {
    const view = createSingleEnergyAttachmentView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const scene = createBoardScene(view, layout);
    expect(scene.cards).toHaveLength(4);
    expect(scene.markers).toEqual([]);
    for (const [playerId, side] of [
      [p1, 'local'],
      [p2, 'opponent'],
    ] as const) {
      const stack = view.stacks[`stack:${playerId}:single-energy`]!;
      const expected = layoutLegacySingleEnergyAttachmentStack(
        findBoardLayoutRegion(layout, side, 'active'),
        63 / 88
      );
      const base = scene.cards.find(
        (card) => card.id === stack.evolutionCards[0]?.id
      );
      const energy = scene.cards.find(
        (card) => card.id === stack.attachmentCards[0]?.id
      );
      if (!base || !energy) {
        throw new Error(`Incomplete one-Energy stack for ${playerId}`);
      }
      expect(
        scene.cards
          .filter((card) => card.parentId === stack.id)
          .map((card) => card.role)
      ).toEqual(['stackAttachment', 'stackEvolution']);
      expect(base).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackEvolution',
        bounds: expected.base.bounds,
        zIndex: 300,
        rotationQuarterTurns: side === 'local' ? 0 : 2,
        interactive: true,
      });
      expect(energy).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackAttachment',
        bounds: expected.energy.bounds,
        zIndex: 299,
        rotationQuarterTurns: side === 'local' ? 0 : 2,
        interactive: true,
      });
      const commonX =
        (Math.max(base.bounds.x, energy.bounds.x) +
          Math.min(
            base.bounds.x + base.bounds.width,
            energy.bounds.x + energy.bounds.width
          )) /
        2;
      const commonY = base.bounds.y + base.bounds.height / 2;
      expect(hitTestBoardScene(scene, commonX, commonY)).toEqual({
        kind: 'card',
        id: base.id,
      });
      const energyOnlyX =
        side === 'local'
          ? (base.bounds.x +
              base.bounds.width +
              energy.bounds.x +
              energy.bounds.width) /
            2
          : (energy.bounds.x + base.bounds.x) / 2;
      expect(hitTestBoardScene(scene, energyOnlyX, commonY)).toEqual({
        kind: 'card',
        id: energy.id,
      });
    }

    const changedDefinitions: MatchViewState = {
      ...view,
      definitions: Object.fromEntries(
        Object.entries(view.definitions).map(([id, definition]) => [
          id,
          {
            ...definition,
            name: `Changed ${id}`,
            category: 'Trainer',
            imageUrl: 'https://cards.invalid/changed-secret-dimensions.png',
            imageUrlSmall: 'https://cards.invalid/changed-board-dimensions.png',
          },
        ])
      ),
    };
    const changedScene = createBoardScene(changedDefinitions, layout);
    const geometryProjection = (candidate: typeof scene) =>
      candidate.cards.map(({ id, bounds, role, zIndex }) => ({
        id,
        bounds,
        role,
        zIndex,
      }));
    expect(geometryProjection(changedScene)).toEqual(geometryProjection(scene));
    const irrelevantVisibilityFields: MatchViewState = {
      ...view,
      viewer: { kind: 'spectator' },
      stacks: Object.fromEntries(
        Object.entries(view.stacks).map(([id, stack]) => [
          id,
          {
            ...stack,
            evolutionCards: stack.evolutionCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
            attachmentCards: stack.attachmentCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
          },
        ])
      ),
    };
    expect(
      geometryProjection(createBoardScene(irrelevantVisibilityFields, layout))
    ).toEqual(geometryProjection(scene));
  });

  it('uses stable one-Trainer-as-Tool active geometry and rotated input footprints', () => {
    const view = createSingleTrainerToolAttachmentView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const scene = createBoardScene(view, layout);
    const externalSourceId = asViewCardId('external-drag-source');
    expect(scene.cards).toHaveLength(4);
    expect(scene.markers).toEqual([]);
    for (const [playerId, side] of [
      [p1, 'local'],
      [p2, 'opponent'],
    ] as const) {
      const stack = view.stacks[`stack:${playerId}:single-trainer-tool`]!;
      const expected = layoutLegacySingleTrainerToolAttachmentStack(
        findBoardLayoutRegion(layout, side, 'active'),
        63 / 88
      );
      const base = scene.cards.find(
        (card) => card.id === stack.evolutionCards[0]?.id
      );
      const tool = scene.cards.find(
        (card) => card.id === stack.attachmentCards[0]?.id
      );
      if (!base || !tool) {
        throw new Error(`Incomplete one-Trainer-as-Tool stack for ${playerId}`);
      }
      expect(
        scene.cards
          .filter((card) => card.parentId === stack.id)
          .map((card) => card.role)
      ).toEqual(['stackAttachment', 'stackEvolution']);
      expect(base).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackEvolution',
        bounds: expected.base.bounds,
        zIndex: 300,
        rotationQuarterTurns: side === 'local' ? 0 : 2,
        interactive: true,
      });
      expect(tool).toMatchObject({
        parentId: stack.id,
        side,
        role: 'stackAttachment',
        bounds: expected.tool.bounds,
        zIndex: 299,
        rotationQuarterTurns: side === 'local' ? 1 : 3,
        interactive: true,
      });

      const paintedToolBounds = {
        x: tool.bounds.x + (tool.bounds.width - tool.bounds.height) / 2,
        y: tool.bounds.y + (tool.bounds.height - tool.bounds.width) / 2,
        width: tool.bounds.height,
        height: tool.bounds.width,
      };
      const commonX =
        (Math.max(base.bounds.x, paintedToolBounds.x) +
          Math.min(
            base.bounds.x + base.bounds.width,
            paintedToolBounds.x + paintedToolBounds.width
          )) /
        2;
      const commonY =
        (Math.max(base.bounds.y, paintedToolBounds.y) +
          Math.min(
            base.bounds.y + base.bounds.height,
            paintedToolBounds.y + paintedToolBounds.height
          )) /
        2;
      expect(hitTestBoardScene(scene, commonX, commonY)).toEqual({
        kind: 'card',
        id: base.id,
      });

      const toolOnlyX =
        side === 'local'
          ? (base.bounds.x +
              base.bounds.width +
              paintedToolBounds.x +
              paintedToolBounds.width) /
            2
          : (paintedToolBounds.x + base.bounds.x) / 2;
      expect(hitTestBoardScene(scene, toolOnlyX, commonY)).toEqual({
        kind: 'card',
        id: tool.id,
      });
      expect(
        resolveBoardDropTarget(scene, externalSourceId, toolOnlyX, commonY)
      ).toBe(stack.id);

      const baseOnlyY = (base.bounds.y + paintedToolBounds.y) / 2;
      expect(hitTestBoardScene(scene, commonX, baseOnlyY)).toEqual({
        kind: 'card',
        id: base.id,
      });

      const authoredOnlyX =
        side === 'local'
          ? (Math.max(base.bounds.x + base.bounds.width, tool.bounds.x) +
              tool.bounds.x +
              tool.bounds.width) /
            2
          : (tool.bounds.x +
              Math.min(base.bounds.x, tool.bounds.x + tool.bounds.width)) /
            2;
      const authoredOnlyY =
        (paintedToolBounds.y +
          paintedToolBounds.height +
          tool.bounds.y +
          tool.bounds.height) /
        2;
      expect(hitTestBoardScene(scene, authoredOnlyX, authoredOnlyY)).toEqual({
        kind: 'zone',
        id: `slot:${playerId}:active`,
      });
      expect(
        resolveBoardDropTarget(
          scene,
          externalSourceId,
          authoredOnlyX,
          authoredOnlyY
        )
      ).toBe(`slot:${playerId}:active`);
    }

    const geometryProjection = (candidate: typeof scene) =>
      candidate.cards.map(
        ({ id, bounds, role, zIndex, rotationQuarterTurns }) => ({
          id,
          bounds,
          role,
          zIndex,
          rotationQuarterTurns,
        })
      );
    const changedDefinitions: MatchViewState = {
      ...view,
      definitions: Object.fromEntries(
        Object.entries(view.definitions).map(([id, definition]) => [
          id,
          {
            ...definition,
            name: `Changed ${id}`,
            category: 'Energy',
            imageUrl: 'https://cards.invalid/changed-secret-dimensions.png',
            imageUrlSmall: 'https://cards.invalid/changed-board-dimensions.png',
          },
        ])
      ),
    };
    expect(
      geometryProjection(createBoardScene(changedDefinitions, layout))
    ).toEqual(geometryProjection(scene));
    const irrelevantVisibilityFields: MatchViewState = {
      ...view,
      viewer: { kind: 'spectator' },
      stacks: Object.fromEntries(
        Object.entries(view.stacks).map(([id, stack]) => [
          id,
          {
            ...stack,
            evolutionCards: stack.evolutionCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
            attachmentCards: stack.attachmentCards.map((card) =>
              card.kind === 'known'
                ? { ...card, publiclyRevealed: !card.publiclyRevealed }
                : card
            ),
          },
        ])
      ),
    };
    expect(
      geometryProjection(createBoardScene(irrelevantVisibilityFields, layout))
    ).toEqual(geometryProjection(scene));
  });

  it('fails closed to generic stack geometry outside the Trainer-as-Tool gate', () => {
    const baseView = createSingleTrainerToolAttachmentView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const stackId = 'stack:p1:single-trainer-tool';
    const original = baseView.stacks[stackId]!;
    const originalBase = original.evolutionCards[0]!;
    const originalTool = original.attachmentCards[0]!;
    if (originalBase.kind !== 'known' || originalTool.kind !== 'known') {
      throw new Error('Trainer-as-Tool fallback fixture cards must be known');
    }
    const withLocalStack = (
      stack: MatchViewState['stacks'][string],
      board: MatchViewState['boards'][string] = baseView.boards[p1]!
    ): MatchViewState => ({
      ...baseView,
      boards: { ...baseView.boards, [p1]: board },
      stacks: { ...baseView.stacks, [stackId]: stack },
    });
    const genericBounds = (
      targetLayout: BoardLayoutSnapshot,
      kind: 'active' | 'bench' = 'active'
    ) => {
      const side = targetLayout.players.find(
        (player) => player.playerId === p1
      )?.side;
      if (!side) throw new Error('Missing p1 layout for Tool fallback');
      const region = findBoardLayoutRegion(targetLayout, side, kind);
      const content = region.physicalContentBoxBounds;
      const cardHeight = Math.min(content.height, content.width / (63 / 88));
      const cardWidth = cardHeight * (63 / 88);
      const base = {
        x: content.x + (content.width - cardWidth) / 2,
        y: content.y + content.height - cardHeight,
        width: cardWidth,
        height: cardHeight,
      };
      return {
        side,
        base,
        tool: {
          x: base.x + base.width * 0.42,
          y: base.y + base.height * 0.18,
          width: base.width * 0.7,
          height: base.height * 0.7,
        },
      };
    };
    const expectFallback = (
      view: MatchViewState,
      targetLayout: BoardLayoutSnapshot = layout
    ) => {
      const expected = genericBounds(targetLayout);
      const scene = createBoardScene(view, targetLayout);
      const stack = view.stacks[stackId]!;
      const baseCard = stack.evolutionCards.find(
        (card) => card.id === originalBase.id
      );
      const toolCard = stack.attachmentCards.find(
        (card) => card.id === originalTool.id
      );
      const base = scene.cards.find((card) => card.id === originalBase.id);
      const tool = scene.cards.find((card) => card.id === originalTool.id);
      if (baseCard) {
        const baseIndex = stack.evolutionCards.indexOf(baseCard);
        const evolutionOffset = Math.min(10, expected.base.height * 0.035);
        expect(base).toMatchObject({
          bounds: {
            ...expected.base,
            y:
              expected.base.y -
              evolutionOffset * (stack.evolutionCards.length - baseIndex - 1),
          },
          zIndex: 300 + baseIndex,
          rotationQuarterTurns: ((stack.rotationQuarterTurns +
            (baseCard.kind === 'known' ? baseCard.orientationQuarterTurns : 0) +
            (expected.side === 'opponent' ? 2 : 0)) %
            4) as 0 | 1 | 2 | 3,
        });
      }
      if (toolCard) {
        expect(tool).toMatchObject({
          bounds: expected.tool,
          zIndex: 250,
          rotationQuarterTurns: (((toolCard.kind === 'known'
            ? toolCard.orientationQuarterTurns
            : 0) +
            (expected.side === 'opponent' ? 2 : 0)) %
            4) as 0 | 1 | 2 | 3,
        });
      }
    };

    const sameShapeFallbacks: readonly MatchViewState['stacks'][string][] = [
      {
        ...original,
        evolutionCards: [{ ...originalBase, category: 'Unknown' }],
      },
      {
        ...original,
        evolutionCards: [{ ...originalBase, category: 'Trainer' }],
      },
      {
        ...original,
        evolutionCards: [{ ...originalBase, category: 'Energy' }],
      },
      {
        ...original,
        attachmentCards: [{ ...originalTool, category: 'Pokémon' }],
      },
      {
        ...original,
        attachmentCards: [{ ...originalTool, category: 'Unknown' }],
      },
      {
        ...original,
        evolutionCards: [
          {
            kind: 'concealed',
            id: originalBase.id,
            ownerId: p1,
            cardBackUrl: '/blue-back.png',
            publiclyRevealed: false,
          },
        ],
      },
      {
        ...original,
        attachmentCards: [
          {
            kind: 'concealed',
            id: originalTool.id,
            ownerId: p1,
            cardBackUrl: '/blue-back.png',
            publiclyRevealed: false,
          },
        ],
      },
      { ...original, evolutionCards: [{ ...originalBase, face: 'down' }] },
      { ...original, attachmentCards: [{ ...originalTool, face: 'down' }] },
      {
        ...original,
        evolutionCards: [{ ...originalBase, orientationQuarterTurns: 1 }],
      },
      {
        ...original,
        attachmentCards: [{ ...originalTool, orientationQuarterTurns: 1 }],
      },
      {
        ...original,
        evolutionCards: [{ ...originalBase, abilityUsed: true }],
      },
      {
        ...original,
        attachmentCards: [{ ...originalTool, abilityUsed: true }],
      },
      { ...original, rotationQuarterTurns: 1 },
      { ...original, damage: 10 },
      { ...original, specialCondition: 'Poisoned' },
      { ...original, abilityUsed: true },
      { ...original, id: 'stack:mismatched-id' },
      { ...original, boardPlayerId: p2 },
      {
        ...original,
        evolutionCards: [{ ...originalBase, ownerId: p2 }],
      },
      {
        ...original,
        attachmentCards: [{ ...originalTool, ownerId: p2 }],
      },
    ];
    for (const stack of sameShapeFallbacks) {
      expectFallback(withLocalStack(stack));
    }

    const countFallbacks: readonly MatchViewState['stacks'][string][] = [
      { ...original, evolutionCards: [] },
      {
        ...original,
        evolutionCards: [
          originalBase,
          { ...originalBase, id: asViewCardId('tool-fallback-extra-base') },
        ],
      },
      { ...original, attachmentCards: [] },
      {
        ...original,
        attachmentCards: [
          originalTool,
          { ...originalTool, id: asViewCardId('tool-fallback-extra-tool') },
        ],
      },
    ];
    for (const stack of countFallbacks) {
      expectFallback(withLocalStack(stack));
    }

    const benchStack = { ...original, slot: 'bench' as const };
    const benchScene = createBoardScene(
      withLocalStack(benchStack, {
        activeStackId: null,
        benchStackIds: [stackId],
      }),
      layout
    );
    const expectedBench = genericBounds(layout, 'bench');
    expect(
      benchScene.cards.find((card) => card.id === originalBase.id)
    ).toMatchObject({ bounds: expectedBench.base, zIndex: 300 });
    expect(
      benchScene.cards.find((card) => card.id === originalTool.id)
    ).toMatchObject({
      bounds: expectedBench.tool,
      zIndex: 250,
      rotationQuarterTurns: 0,
    });

    const emptyBench = {
      id: 'stack:p1:tool-empty-bench',
      boardPlayerId: p1,
      slot: 'bench' as const,
      evolutionCards: [],
      attachmentCards: [],
      rotationQuarterTurns: 0 as const,
      damage: null,
      specialCondition: null,
      abilityUsed: false,
    };
    expectFallback({
      ...baseView,
      boards: {
        ...baseView.boards,
        [p1]: {
          ...baseView.boards[p1]!,
          benchStackIds: [emptyBench.id],
        },
      },
      stacks: { ...baseView.stacks, [emptyBench.id]: emptyBench },
    });

    const forgeLocalActive = (
      mutate: (region: BoardLayoutRegion) => BoardLayoutRegion
    ): BoardLayoutSnapshot => {
      const mutatePlayer = (player: (typeof layout.players)[number]) =>
        player.playerId === p1
          ? {
              ...player,
              regions: player.regions.map((region) =>
                region.kind === 'active' ? mutate(region) : region
              ),
            }
          : player;
      return {
        ...layout,
        players: [
          mutatePlayer(layout.players[0]),
          mutatePlayer(layout.players[1]),
        ],
      };
    };
    const localActive = findBoardLayoutRegion(layout, 'local', 'active');
    const forgedLayouts: readonly BoardLayoutSnapshot[] = [
      forgeLocalActive((region) => ({ ...region, id: 'local:bench' })),
      forgeLocalActive((region) => ({ ...region, playerId: p2 })),
      forgeLocalActive((region) => ({ ...region, side: 'opponent' })),
      forgeLocalActive((region) => ({ ...region, physicalSide: 'upper' })),
      forgeLocalActive((region) => ({ ...region, surface: 'zone' })),
      forgeLocalActive((region) => ({
        ...region,
        playerLocalNormalizedBounds: {
          ...region.playerLocalNormalizedBounds,
          x: region.playerLocalNormalizedBounds.x + 0.01,
        },
      })),
      forgeLocalActive((region) => ({
        ...region,
        physicalDeclaredBounds: {
          ...region.physicalDeclaredBounds,
          x: region.physicalDeclaredBounds.x + 1,
        },
      })),
      forgeLocalActive((region) => ({
        ...region,
        physicalBorderBoxBounds: {
          ...region.physicalBorderBoxBounds,
          x: region.physicalBorderBoxBounds.x + 1,
        },
      })),
      forgeLocalActive((region) => ({
        ...region,
        physicalContentBoxBounds: {
          ...region.physicalContentBoxBounds,
          x: region.physicalContentBoxBounds.x + 1,
        },
      })),
    ];
    expect(localActive.surface).toBe('playSlot');
    for (const forgedLayout of forgedLayouts) {
      expectFallback(baseView, forgedLayout);
    }

    for (const layoutState of [
      { ...characterizedEvolutionLayoutState, shellMode: 'fullscreen' },
      {
        ...characterizedEvolutionLayoutState,
        vertical: {
          ...characterizedEvolutionLayoutState.vertical,
          lowerFrame: { bottomRatio: 0, heightRatio: 0.6 },
          upperFrame: { bottomRatio: 0.6, heightRatio: 0.4 },
        },
      },
      {
        ...characterizedEvolutionLayoutState,
        vertical: {
          ...characterizedEvolutionLayoutState.vertical,
          lowerHandle: { bottomRatio: 0.51, heightRatio: 0.025 },
        },
      },
      {
        ...characterizedEvolutionLayoutState,
        vertical: {
          ...characterizedEvolutionLayoutState.vertical,
          sharedPlacement: 'handleMidpoint',
        },
      },
      { ...characterizedEvolutionLayoutState, bottomPlayerId: p2 },
      {
        ...characterizedEvolutionLayoutState,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      },
      {
        ...characterizedEvolutionLayoutState,
        viewport: { width: 1600, height: 900, devicePixelRatio: 2 },
      },
    ] as const satisfies readonly BoardLayoutState[]) {
      expectFallback(baseView, createBoardLayoutSnapshot(layoutState));
    }

    const energyView = withLocalStack({
      ...original,
      attachmentCards: [
        {
          ...originalTool,
          definitionId: energyDefinitionId,
          category: 'Energy',
        },
      ],
    });
    const energyScene = createBoardScene(energyView, layout);
    const expectedEnergy = layoutLegacySingleEnergyAttachmentStack(
      findBoardLayoutRegion(layout, 'local', 'active'),
      63 / 88
    );
    expect(
      energyScene.cards.find((card) => card.id === originalTool.id)
    ).toMatchObject({
      bounds: expectedEnergy.energy.bounds,
      zIndex: 299,
      rotationQuarterTurns: 0,
    });
  });

  it('retains exact fallback geometry outside the one-Energy eligibility gate', () => {
    const baseView = createSingleEnergyAttachmentView();
    const layout = createBoardLayoutSnapshot(characterizedEvolutionLayoutState);
    const stackId = 'stack:p1:single-energy';
    const original = baseView.stacks[stackId]!;
    const originalBase = original.evolutionCards[0]!;
    const originalEnergy = original.attachmentCards[0]!;
    if (originalBase.kind !== 'known' || originalEnergy.kind !== 'known') {
      throw new Error('One-Energy fallback fixture cards must be known');
    }
    const active = findBoardLayoutRegion(layout, 'local', 'active');
    const fallbackHeight = active.physicalContentBoxBounds.height;
    const fallbackWidth = fallbackHeight * (63 / 88);
    const fallbackBaseBounds = {
      x:
        active.physicalContentBoxBounds.x +
        (active.physicalContentBoxBounds.width - fallbackWidth) / 2,
      y: active.physicalContentBoxBounds.y,
      width: fallbackWidth,
      height: fallbackHeight,
    };
    const fallbackEnergyBounds = {
      x: fallbackBaseBounds.x + fallbackBaseBounds.width * 0.42,
      y: fallbackBaseBounds.y + fallbackBaseBounds.height * 0.18,
      width: fallbackBaseBounds.width * 0.7,
      height: fallbackBaseBounds.height * 0.7,
    };
    const withLocalStack = (
      stack: MatchViewState['stacks'][string],
      board: MatchViewState['boards'][string] = baseView.boards[p1]!
    ): MatchViewState => ({
      ...baseView,
      boards: { ...baseView.boards, [p1]: board },
      stacks: { ...baseView.stacks, [stackId]: stack },
    });
    const expectFallback = (view: MatchViewState) => {
      const scene = createBoardScene(view, layout);
      expect(
        scene.cards.find((card) => card.id === originalBase.id)
      ).toMatchObject({ bounds: fallbackBaseBounds, zIndex: 300 });
      expect(
        scene.cards.find((card) => card.id === originalEnergy.id)
      ).toMatchObject({ bounds: fallbackEnergyBounds, zIndex: 250 });
    };
    const sameShapeFallbacks: readonly MatchViewState['stacks'][string][] = [
      {
        ...original,
        evolutionCards: [{ ...originalBase, category: 'Unknown' }],
      },
      {
        ...original,
        evolutionCards: [{ ...originalBase, category: 'Trainer' }],
      },
      {
        ...original,
        evolutionCards: [{ ...originalBase, category: 'Energy' }],
      },
      {
        ...original,
        attachmentCards: [{ ...originalEnergy, category: 'Pokémon' }],
      },
      {
        ...original,
        attachmentCards: [{ ...originalEnergy, category: 'Unknown' }],
      },
      {
        ...original,
        evolutionCards: [
          {
            kind: 'concealed',
            id: originalBase.id,
            ownerId: p1,
            cardBackUrl: '/blue-back.png',
            publiclyRevealed: false,
          },
        ],
      },
      {
        ...original,
        attachmentCards: [
          {
            kind: 'concealed',
            id: originalEnergy.id,
            ownerId: p1,
            cardBackUrl: '/blue-back.png',
            publiclyRevealed: false,
          },
        ],
      },
      { ...original, evolutionCards: [{ ...originalBase, face: 'down' }] },
      { ...original, attachmentCards: [{ ...originalEnergy, face: 'down' }] },
      {
        ...original,
        evolutionCards: [{ ...originalBase, orientationQuarterTurns: 1 }],
      },
      {
        ...original,
        attachmentCards: [{ ...originalEnergy, orientationQuarterTurns: 1 }],
      },
      {
        ...original,
        evolutionCards: [{ ...originalBase, abilityUsed: true }],
      },
      {
        ...original,
        attachmentCards: [{ ...originalEnergy, abilityUsed: true }],
      },
      { ...original, rotationQuarterTurns: 1 },
      { ...original, damage: 10 },
      { ...original, specialCondition: 'Poisoned' },
      { ...original, abilityUsed: true },
      { ...original, id: 'stack:mismatched-id' },
      { ...original, boardPlayerId: p2 },
      {
        ...original,
        evolutionCards: [{ ...originalBase, ownerId: p2 }],
      },
      {
        ...original,
        attachmentCards: [{ ...originalEnergy, ownerId: p2 }],
      },
    ];
    for (const stack of sameShapeFallbacks) {
      expectFallback(withLocalStack(stack));
    }

    const countFallbacks: readonly MatchViewState['stacks'][string][] = [
      { ...original, evolutionCards: [] },
      {
        ...original,
        evolutionCards: [
          originalBase,
          { ...originalBase, id: asViewCardId('fallback-extra-base') },
        ],
      },
      { ...original, attachmentCards: [] },
      {
        ...original,
        attachmentCards: [
          originalEnergy,
          { ...originalEnergy, id: asViewCardId('fallback-extra-energy') },
        ],
      },
    ];
    for (const stack of countFallbacks) {
      const scene = createBoardScene(withLocalStack(stack), layout);
      const base = scene.cards.find((card) => card.id === originalBase.id);
      const energy = scene.cards.find((card) => card.id === originalEnergy.id);
      if (base) expect(base.zIndex).toBe(300);
      if (energy) expect(energy.zIndex).toBe(250);
      if (stack.attachmentCards.length === 0) {
        expect(base?.bounds).toEqual(fallbackBaseBounds);
        expect(base?.bounds).not.toEqual(
          layoutLegacySingleEnergyAttachmentStack(active, 63 / 88).base.bounds
        );
      }
    }

    const benchStack = { ...original, slot: 'bench' as const };
    const benchScene = createBoardScene(
      withLocalStack(benchStack, {
        activeStackId: null,
        benchStackIds: [stackId],
      }),
      layout
    );
    expect(
      benchScene.cards.find((card) => card.id === originalEnergy.id)?.zIndex
    ).toBe(250);

    const emptyBench = {
      id: 'stack:p1:empty-bench',
      boardPlayerId: p1,
      slot: 'bench' as const,
      evolutionCards: [],
      attachmentCards: [],
      rotationQuarterTurns: 0 as const,
      damage: null,
      specialCondition: null,
      abilityUsed: false,
    };
    expectFallback({
      ...baseView,
      boards: {
        ...baseView.boards,
        [p1]: {
          ...baseView.boards[p1]!,
          benchStackIds: [emptyBench.id],
        },
      },
      stacks: { ...baseView.stacks, [emptyBench.id]: emptyBench },
    });

    const [localPlayer, opponentPlayer] = layout.players;
    const forgedLayout = {
      ...layout,
      players: [
        {
          ...localPlayer,
          regions: localPlayer.regions.map((region) =>
            region.kind === 'active'
              ? {
                  ...region,
                  physicalDeclaredBounds: {
                    ...region.physicalDeclaredBounds,
                    x: region.physicalDeclaredBounds.x + 1,
                  },
                }
              : region
          ),
        },
        opponentPlayer,
      ] as const,
    };
    const forgedScene = createBoardScene(baseView, forgedLayout);
    expect(
      forgedScene.cards.find((card) => card.id === originalEnergy.id)?.zIndex
    ).toBe(250);
    const opponentActiveRegion = opponentPlayer.regions.find(
      (region) => region.kind === 'active'
    );
    if (!opponentActiveRegion) {
      throw new Error('Missing opponent active region for forgery test');
    }
    const forgedSideLayout = {
      ...layout,
      players: [
        {
          ...localPlayer,
          regions: localPlayer.regions.map((region) =>
            region.kind === 'active'
              ? { ...opponentActiveRegion, playerId: p1 }
              : region
          ),
        },
        opponentPlayer,
      ] as const,
    };
    const forgedSideScene = createBoardScene(baseView, forgedSideLayout);
    expect(
      forgedSideScene.cards.find((card) => card.id === originalEnergy.id)
        ?.zIndex
    ).toBe(250);

    for (const layoutState of [
      { ...characterizedEvolutionLayoutState, shellMode: 'fullscreen' },
      {
        ...characterizedEvolutionLayoutState,
        vertical: {
          ...characterizedEvolutionLayoutState.vertical,
          lowerFrame: { bottomRatio: 0, heightRatio: 0.6 },
          upperFrame: { bottomRatio: 0.6, heightRatio: 0.4 },
        },
      },
      {
        ...characterizedEvolutionLayoutState,
        vertical: {
          ...characterizedEvolutionLayoutState.vertical,
          lowerHandle: { bottomRatio: 0.51, heightRatio: 0.025 },
        },
      },
      {
        ...characterizedEvolutionLayoutState,
        vertical: {
          ...characterizedEvolutionLayoutState.vertical,
          sharedPlacement: 'handleMidpoint',
        },
      },
      { ...characterizedEvolutionLayoutState, bottomPlayerId: p2 },
      {
        ...characterizedEvolutionLayoutState,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      },
      {
        ...characterizedEvolutionLayoutState,
        viewport: { width: 1600, height: 900, devicePixelRatio: 2 },
      },
    ] as const satisfies readonly BoardLayoutState[]) {
      const scene = createBoardScene(
        baseView,
        createBoardLayoutSnapshot(layoutState)
      );
      expect(
        scene.cards.find((card) => card.id === originalEnergy.id)?.zIndex
      ).toBe(250);
    }
  });

  it('retains the existing stack fallback outside the narrow evolution gate', () => {
    const base = createOrdinaryEvolutionView();
    const localActive = base.stacks['stack:p1:active']!;
    const opponentActive = base.stacks['stack:p2:active']!;
    const localBench = base.stacks['stack:p1:bench']!;
    const attachment = {
      ...localActive.evolutionCards[0]!,
      id: asViewCardId('fallback-attachment'),
      category: 'Energy' as const,
    };
    const extraBenchCard = {
      ...localBench.evolutionCards[0]!,
      id: asViewCardId('fallback-extra-bench-card'),
    };
    const view: MatchViewState = {
      ...base,
      boards: {
        ...base.boards,
        [p1]: {
          ...base.boards[p1]!,
          benchStackIds: ['stack:p1:bench', 'stack:p1:bench-extra'],
        },
      },
      stacks: {
        ...base.stacks,
        [localActive.id]: {
          ...localActive,
          attachmentCards: [attachment],
        },
        [opponentActive.id]: {
          ...opponentActive,
          rotationQuarterTurns: 1,
        },
        'stack:p1:bench-extra': {
          id: 'stack:p1:bench-extra',
          boardPlayerId: p1,
          slot: 'bench',
          evolutionCards: [extraBenchCard],
          attachmentCards: [],
          rotationQuarterTurns: 0,
          damage: null,
          specialCondition: null,
          abilityUsed: false,
        },
      },
    };
    const scene = createBoardScene(
      view,
      createBoardLayoutSnapshot(characterizedEvolutionLayoutState)
    );
    for (const stackId of [localActive.id, opponentActive.id, localBench.id]) {
      const nodes = view.stacks[stackId]!.evolutionCards.map((card) =>
        scene.cards.find((candidate) => candidate.id === card.id)
      );
      expect(nodes.map((node) => node?.zIndex)).toEqual([300, 301, 302]);
    }
    expect(
      view.stacks['stack:p2:bench']!.evolutionCards.map(
        (card) =>
          scene.cards.find((candidate) => candidate.id === card.id)?.zIndex
      )
    ).toEqual([298, 299, 300]);

    const expectFallbackForLayout = (layoutState: BoardLayoutState) => {
      const fallbackScene = createBoardScene(
        base,
        createBoardLayoutSnapshot(layoutState)
      );
      expect(
        base.stacks['stack:p1:active']!.evolutionCards.map(
          (card) =>
            fallbackScene.cards.find((candidate) => candidate.id === card.id)
              ?.zIndex
        )
      ).toEqual([300, 301, 302]);
    };
    expectFallbackForLayout({
      ...characterizedEvolutionLayoutState,
      shellMode: 'fullscreen',
    });
    expectFallbackForLayout({
      ...characterizedEvolutionLayoutState,
      vertical: {
        ...characterizedEvolutionLayoutState.vertical,
        lowerFrame: { bottomRatio: 0, heightRatio: 0.6 },
        upperFrame: { bottomRatio: 0.6, heightRatio: 0.4 },
      },
    });
    expectFallbackForLayout({
      ...characterizedEvolutionLayoutState,
      vertical: {
        ...characterizedEvolutionLayoutState.vertical,
        lowerHandle: { bottomRatio: 0.51, heightRatio: 0.025 },
      },
    });
    expectFallbackForLayout({
      ...characterizedEvolutionLayoutState,
      vertical: {
        ...characterizedEvolutionLayoutState.vertical,
        sharedPlacement: 'handleMidpoint',
      },
    });
    expectFallbackForLayout({
      ...characterizedEvolutionLayoutState,
      bottomPlayerId: p2,
    });
    expectFallbackForLayout({
      ...characterizedEvolutionLayoutState,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    });
  });

  it('builds the shared 61-card spike with legacy pile-top paint and input priority', () => {
    const base = createRendererSpikeView();
    const baseDiscard = base.zones['zone:spike-blue:discard']!;
    const coveredCard = baseDiscard.cards[0]!;
    const coverCard = baseDiscard.cards.at(-1)!;
    if (coveredCard.kind !== 'known' || coverCard.kind !== 'known') {
      throw new Error('Spike discard fixture must be known');
    }
    const view: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        [baseDiscard.id]: {
          ...baseDiscard,
          cards: [
            { ...coveredCard, abilityUsed: true },
            ...baseDiscard.cards.slice(1, -1),
            { ...coverCard, abilityUsed: true },
          ],
        },
      },
    };
    const scene = createBoardSceneForViewport(view, {
      ...options,
      bottomPlayerId: view.playerOrder[0]!,
    });
    expect(scene.cards).toHaveLength(61);
    const blueDeck = view.zones['zone:spike-blue:deck']!;
    const blueDiscard = view.zones['zone:spike-blue:discard']!;
    const blueLostZone = view.zones['zone:spike-blue:lostZone']!;
    for (const [zone, topIndex] of [
      [blueDeck, 0],
      [blueDiscard, blueDiscard.cards.length - 1],
      [blueLostZone, blueLostZone.cards.length - 1],
    ] as const) {
      const nodes = zone.cards.map((card) =>
        scene.cards.find((candidate) => candidate.id === card.id)
      );
      expect(nodes.every((node) => node !== undefined)).toBe(true);
      expect(nodes.filter((node) => node?.interactive)).toHaveLength(1);
      expect(nodes[topIndex]).toMatchObject({ interactive: true });
      expect(nodes[topIndex]!.zIndex).toBe(
        Math.max(...nodes.map((node) => node!.zIndex))
      );
      expect(
        scene.cards.filter(
          (node) => node.parentId === zone.id && !node.interactive
        )
      ).toHaveLength(zone.cards.length - 1);
    }
    expect(
      scene.markers.some((marker) =>
        scene.cards.some(
          (card) => card.id === marker.parentCardId && !card.interactive
        )
      )
    ).toBe(false);
    expect(
      scene.markers.some(
        (marker) =>
          marker.parentCardId === coveredCard.id ||
          marker.parentCardId === coverCard.id
      )
    ).toBe(false);
    expect(
      scene.zones.some((zone) => zone.id === 'slot:spike-blue:bench')
    ).toBe(true);
  });

  it('uses canonical contained geometry for covers without definition-size leakage', () => {
    const concealedScene = createBoardSceneForViewport(createView(), options);
    const concealed = concealedScene.cards.find(
      (card) => card.id === hiddenCardId
    )!;
    const expectedWidth = concealed.bounds.height * (63 / 88);
    expect(concealed.bounds.width).toBeCloseTo(expectedWidth);
    const parent = concealedScene.zones.find(
      (zone) => zone.id === concealed.parentId
    )!;
    expect(concealed.bounds.x).toBeCloseTo(
      parent.contentBounds.x +
        (parent.contentBounds.width - concealed.bounds.width) / 2
    );
    expect(concealed.bounds.y + concealed.bounds.height).toBeCloseTo(
      parent.contentBounds.y + parent.contentBounds.height
    );

    const visibleDeckCardId = asViewCardId('view-card-visible-deck');
    const base = createView();
    const deck = base.zones['zone:p2:deck']!;
    const visibleScene = createBoardSceneForViewport(
      {
        ...base,
        zones: {
          ...base.zones,
          [deck.id]: {
            ...deck,
            cards: [
              {
                kind: 'known',
                id: visibleDeckCardId,
                definitionId,
                ownerId: p2,
                category: 'Pokémon',
                face: 'up',
                orientationQuarterTurns: 0,
                abilityUsed: false,
                publiclyRevealed: true,
              },
            ],
          },
        },
      },
      options
    );
    expect(
      visibleScene.cards.find((card) => card.id === visibleDeckCardId)?.bounds
    ).toEqual(concealed.bounds);
  });

  it('resolves width-limited cover alignment after asymmetric frame rotation', () => {
    const base = createView();
    const opponentDeck = base.zones['zone:p2:deck']!;
    const localDeckCardId = asViewCardId('view-card-local-deck');
    const view: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        'zone:p1:deck': {
          id: 'zone:p1:deck',
          kind: 'deck',
          ownerId: p1,
          cards: [
            {
              kind: 'concealed',
              id: localDeckCardId,
              ownerId: p1,
              cardBackUrl: '/blue-back.png',
              publiclyRevealed: false,
            },
          ],
        },
      },
    };
    const scene = createBoardScene(
      view,
      createBoardLayoutSnapshot({
        geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
        viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
        playerIds: [p1, p2],
        bottomPlayerId: p1,
        shellMode: 'sidebar',
        vertical: {
          lowerFrame: { bottomRatio: 0, heightRatio: 0.7 },
          upperFrame: { bottomRatio: 0.3, heightRatio: 0.7 },
          lowerHandle: { bottomRatio: 0.5, heightRatio: 0.025 },
          upperHandle: { bottomRatio: 0.525, heightRatio: 0.025 },
          sharedPlacement: 'cssDefault',
        },
      })
    );
    const local = scene.cards.find((card) => card.id === localDeckCardId)!;
    const opponent = scene.cards.find(
      (card) => card.id === opponentDeck.cards[0]!.id
    )!;
    const localZone = scene.zones.find((zone) => zone.id === local.parentId)!;
    const opponentZone = scene.zones.find(
      (zone) => zone.id === opponent.parentId
    )!;
    expect(local.bounds.height).toBeLessThan(localZone.contentBounds.height);
    expect(opponent.bounds.height).toBeLessThan(
      opponentZone.contentBounds.height
    );
    expect(local.bounds.y).toBeCloseTo(localZone.contentBounds.y);
    expect(opponent.bounds.y + opponent.bounds.height).toBeCloseTo(
      opponentZone.contentBounds.y + opponentZone.contentBounds.height
    );
    expect(local.rotationQuarterTurns).toBe(0);
    expect(opponent.rotationQuarterTurns).toBe(2);
  });

  it('keeps the stadium readable to its owner and composes explicit rotation', () => {
    const base = createRendererSpikeView();
    const stadium = base.zones['zone:shared:stadium']!;
    const stadiumCard = stadium.cards[0]!;
    if (stadiumCard.kind !== 'known') {
      throw new Error('Spike stadium fixture must be known');
    }
    const bottomPlayerId = base.playerOrder[0]!;
    const topPlayerId = base.playerOrder[1]!;
    const ownedByTop: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        [stadium.id]: {
          ...stadium,
          cards: [
            {
              ...stadiumCard,
              ownerId: topPlayerId,
              orientationQuarterTurns: 1,
            },
          ],
        },
      },
    };
    const topOwnerScene = createBoardSceneForViewport(ownedByTop, {
      ...options,
      bottomPlayerId,
    });
    const topOwner = topOwnerScene.cards.find(
      (card) => card.id === stadiumCard.id
    )!;
    const stadiumZone = topOwnerScene.zones.find(
      (zone) => zone.id === stadium.id
    )!;
    expect(topOwner.rotationQuarterTurns).toBe(3);
    expect(topOwner.bounds.y + topOwner.bounds.height).toBeCloseTo(
      stadiumZone.contentBounds.y + stadiumZone.contentBounds.height
    );

    const flipped = createBoardSceneForViewport(ownedByTop, {
      ...options,
      bottomPlayerId: topPlayerId,
    });
    const bottomOwner = flipped.cards.find(
      (card) => card.id === stadiumCard.id
    )!;
    expect(bottomOwner.rotationQuarterTurns).toBe(1);
    expect(bottomOwner.bounds.y).toBeCloseTo(
      flipped.zones.find((zone) => zone.id === stadium.id)!.contentBounds.y
    );
  });

  it('rejects a malformed projection with multiple stadium cards', () => {
    const base = createRendererSpikeView();
    const stadium = base.zones['zone:shared:stadium']!;
    const first = stadium.cards[0]!;
    expect(() =>
      createBoardSceneForViewport(
        {
          ...base,
          zones: {
            ...base.zones,
            [stadium.id]: {
              ...stadium,
              cards: [
                first,
                { ...first, id: asViewCardId('second-stadium-card') },
              ],
            },
          },
        },
        { ...options, bottomPlayerId: base.playerOrder[0]! }
      )
    ).toThrow('at most one card');
  });

  it('rejects a projected card owner outside the two-player board', () => {
    const base = createRendererSpikeView();
    const stadium = base.zones['zone:shared:stadium']!;
    const first = stadium.cards[0]!;
    expect(() =>
      createBoardSceneForViewport(
        {
          ...base,
          zones: {
            ...base.zones,
            [stadium.id]: {
              ...stadium,
              cards: [
                {
                  ...first,
                  ownerId: asPlayerId('not-a-projected-player'),
                },
              ],
            },
          },
        },
        { ...options, bottomPlayerId: base.playerOrder[0]! }
      )
    ).toThrow('owner is not a board player');
  });

  it('rejects a projection that places one view card in multiple render locations', () => {
    const view = createView();
    const duplicated: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        'zone:p1:discard': {
          id: 'zone:p1:discard',
          kind: 'discard',
          ownerId: p1,
          cards: view.zones['zone:p1:hand']!.cards,
        },
      },
    };
    expect(() => createBoardSceneForViewport(duplicated, options)).toThrow(
      'Projected card appears more than once'
    );
  });

  it('rejects player-owned stadiums and shared player zones', () => {
    const view = createView();
    const stadium = view.zones['zone:shared:stadium']!;
    expect(() =>
      createBoardSceneForViewport(
        {
          ...view,
          zones: {
            ...view.zones,
            [stadium.id]: { ...stadium, ownerId: p1 },
          },
        },
        options
      )
    ).toThrow('Stadium zone must be shared');

    const hand = view.zones['zone:p1:hand']!;
    expect(() =>
      createBoardSceneForViewport(
        {
          ...view,
          zones: {
            ...view.zones,
            [hand.id]: { ...hand, ownerId: null },
          },
        },
        options
      )
    ).toThrow('hand zone must belong to a player');
  });

  it('diffs by stable view identity and hit-tests the topmost card before its zone', () => {
    const first = createBoardSceneForViewport(createView(), options);
    const moved = createBoardSceneForViewport(createView(), {
      ...options,
      viewport: { ...options.viewport, width: 1000 },
    });
    const diff = diffBoardScenes(first, moved);
    expect(diff.addedCardIds).toEqual([]);
    expect(diff.removedCardIds).toEqual([]);
    expect(new Set(diff.updatedCardIds)).toEqual(
      new Set([hiddenCardId, knownCardId])
    );

    const known = first.cards.find((card) => card.id === knownCardId)!;
    expect(
      hitTestBoardScene(
        first,
        known.bounds.x + known.bounds.width / 2,
        known.bounds.y + known.bounds.height / 2
      )
    ).toEqual({ kind: 'card', id: knownCardId });
  });

  it('hit-tests a quarter-turned card by its painted footprint', () => {
    const base = createBoardSceneForViewport(createView(), options);
    const known = base.cards.find((card) => card.id === knownCardId)!;
    const scene = {
      ...base,
      zones: [],
      cards: [
        {
          ...known,
          bounds: { x: 100, y: 200, width: 60, height: 100 },
          rotationQuarterTurns: 1 as const,
        },
      ],
    };

    expect(hitTestBoardScene(scene, 81, 250)).toEqual({
      kind: 'card',
      id: knownCardId,
    });
    expect(hitTestBoardScene(scene, 130, 219)).toBeNull();
  });

  it('fails closed for invalid viewports and unsafe split ratios', () => {
    expect(() =>
      createBoardSceneForViewport(createView(), {
        ...options,
        viewport: { width: 0, height: 900, devicePixelRatio: 1 },
      })
    ).toThrow('positive');
    expect(() =>
      createBoardSceneForViewport(createView(), {
        ...options,
        splitRatio: 0.99,
      })
    ).toThrow('between 0.2 and 0.8');
  });
});
