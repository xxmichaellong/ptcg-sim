import type { MatchViewState } from '@ptcgsim/game-core';
import {
  createBoardSceneForViewport,
  createRendererSpikeView,
  resolveBoardDropTarget,
  type BoardScene,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import { resolveBoardDrop, submitBoardDrop } from './resolveBoardDrop.js';

const fixture = (): {
  readonly view: MatchViewState;
  readonly scene: BoardScene;
} => {
  const view = createRendererSpikeView();
  return {
    view,
    scene: createBoardSceneForViewport(view, {
      viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
      bottomPlayerId: view.playerOrder[0]!,
      splitRatio: 0.5,
      geometryVersion: 1,
    }),
  };
};

const localHandCard = (input: ReturnType<typeof fixture>) =>
  input.scene.cards.find(
    (card) => card.side === 'local' && card.parentId.endsWith(':hand')
  )!;

describe('board drop command resolution', () => {
  it('moves a zone card with an explicit source precondition', () => {
    const input = fixture();
    const card = localHandCard(input);
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: 'zone:spike-blue:discard',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveCard',
        cardId: card.id,
        expectedSourceZoneId: 'zone:spike-blue:hand',
        destinationZoneId: 'zone:spike-blue:discard',
      },
    });
  });

  it('resolves active, bench, and existing-stack play targets', () => {
    const input = fixture();
    const card = localHandCard(input);
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: 'slot:spike-blue:active',
      })
    ).toMatchObject({
      ok: true,
      command: {
        type: 'MoveCardToPlay',
        boardPlayerId: 'spike-blue',
        slot: 'active',
      },
    });
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: 'slot:spike-blue:bench',
      })
    ).toMatchObject({
      ok: true,
      command: { type: 'MoveCardToPlay', slot: 'bench' },
    });
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: 'stack:blue:active',
      })
    ).toMatchObject({
      ok: true,
      command: {
        type: 'MoveCardToPlay',
        targetStackId: 'stack:blue:active',
        slot: 'active',
      },
    });
  });

  it('refuses no-ops and stale scenes while resolving safe stack departures', () => {
    const input = fixture();
    const card = localHandCard(input);
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: card.parentId,
      })
    ).toEqual({ ok: false, reason: 'no_op' });
    expect(
      resolveBoardDrop(
        input.view,
        { ...input.scene, revision: 99 },
        {
          kind: 'CardDropRequested',
          cardId: card.id,
          targetId: 'zone:spike-blue:discard',
        }
      )
    ).toEqual({ ok: false, reason: 'stale_scene' });
    const stack = input.view.stacks['stack:blue:active']!;
    const lowerEvolution = stack.evolutionCards[0]!;
    const stackCard = stack.evolutionCards.at(-1)!;
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: stackCard.id,
        targetId: 'slot:spike-blue:bench',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MovePlayStack',
        stackId: stack.id,
        expectedSourceSlot: 'active',
        expectedActiveStackId: stack.id,
        expectedBenchStackIds: [],
        destinationSlot: 'bench',
      },
    });
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: stackCard.id,
        targetId: 'stack:red:active',
      })
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: stack.attachmentCards[0]!.id,
        targetId: 'slot:spike-blue:bench',
      })
    ).toEqual({ ok: false, reason: 'unsupported_source' });
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: stackCard.id,
        targetId: 'zone:spike-blue:discard',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveCardFromStack',
        cardId: stackCard.id,
        expectedStackId: stack.id,
        destinationZoneId: 'zone:spike-blue:discard',
      },
    });
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: lowerEvolution.id,
        targetId: 'zone:spike-blue:discard',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveCardFromStack',
        cardId: lowerEvolution.id,
        expectedStackId: stack.id,
        destinationZoneId: 'zone:spike-blue:discard',
      },
    });
  });

  it('replaces an occupied Stadium with a card dropped from play (PX-020)', () => {
    const input = fixture();
    const stadium = input.view.zones['zone:shared:stadium']!;
    const incumbent = stadium.cards[0]!;
    const stack = input.view.stacks['stack:blue:active']!;
    const top = stack.evolutionCards.at(-1)!;
    // v1 refused this drop; it now replaces the Stadium as G does, the
    // incumbent named so a stale table cannot displace the wrong card.
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: top.id,
        targetId: stadium.id,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveCardToStadium',
        cardId: top.id,
        expectedSourceId: stack.id,
        expectedStadiumCardId: incumbent.id,
      },
    });
  });

  it('moves an attached card, or one under the top, onto another Pokémon as v1 does', () => {
    const input = fixture();
    const playerId = input.view.playerOrder[0]!;
    const blue = input.view.stacks['stack:blue:active']!;
    const red = input.view.stacks['stack:red:active']!;
    const energy = blue.attachmentCards[0]!;
    const lower = blue.evolutionCards[0]!;
    // A second Pokémon on Blue's bench, so a card can change Pokémon on
    // its own side.
    const hand = input.view.zones[`zone:${playerId}:hand`]!;
    const benched = hand.cards.find(
      (card) => card.kind === 'known' && card.category === 'Pokémon'
    )!;
    const view: MatchViewState = {
      ...input.view,
      zones: {
        ...input.view.zones,
        [hand.id]: {
          ...hand,
          cards: hand.cards.filter((card) => card.id !== benched.id),
        },
      },
      boards: {
        ...input.view.boards,
        [playerId]: {
          ...input.view.boards[playerId]!,
          benchStackIds: ['stack:blue:bench-1'],
        },
      },
      stacks: {
        ...input.view.stacks,
        'stack:blue:bench-1': {
          ...blue,
          id: 'stack:blue:bench-1',
          slot: 'bench',
          evolutionCards: [benched],
          attachmentCards: [],
          damage: 0,
        },
      },
    };
    const scene = createBoardSceneForViewport(view, {
      viewport: input.scene.viewport,
      bottomPlayerId: playerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    });
    const drop = (cardId: string, targetId: string) =>
      resolveBoardDrop(view, scene, {
        kind: 'CardDropRequested',
        cardId: cardId as typeof energy.id,
        targetId,
      });
    const placement = (
      cardId: string,
      targetStackId: string,
      expectedTargetTopCardId: string
    ) => ({
      ok: true,
      command: {
        type: 'PlaceCardOnPlayStack',
        cardId,
        expectedSourceId: blue.id,
        targetStackId,
        expectedTargetTopCardId,
        mode: 'attachment',
      },
    });

    // Energy from the Active to a Benched Pokémon.
    expect(drop(energy.id, 'stack:blue:bench-1')).toEqual(
      placement(energy.id, 'stack:blue:bench-1', benched.id)
    );
    // The card under the top attaches too, as v1 attaches any non-top card.
    expect(drop(lower.id, 'stack:blue:bench-1')).toEqual(
      placement(lower.id, 'stack:blue:bench-1', benched.id)
    );
    // Onto the opponent's Pokémon (Tools like Head Ringer, PX-017).
    expect(drop(energy.id, red.id)).toEqual(
      placement(energy.id, red.id, red.evolutionCards.at(-1)!.id)
    );
    // Back onto its own Pokémon is nothing to do.
    expect(drop(energy.id, blue.id)).toEqual({ ok: false, reason: 'no_op' });
    // The top card still moves the whole Pokémon.
    expect(drop(blue.evolutionCards.at(-1)!.id, 'stack:blue:bench-1')).toEqual(
      expect.objectContaining({
        ok: true,
        command: expect.objectContaining({ type: 'MovePlayStack' }),
      })
    );
  });

  it('places a card from a Looking-at-cards window onto a Pokémon', () => {
    const input = fixture();
    const playerId = input.view.playerOrder[0]!;
    const hand = input.view.zones[`zone:${playerId}:hand`]!;
    const pokemon = hand.cards.find(
      (card) => card.kind === 'known' && card.category === 'Pokémon'
    )!;
    const other = hand.cards.find(
      (card) => card.kind === 'known' && card.category !== 'Pokémon'
    )!;
    const view: MatchViewState = {
      ...input.view,
      zones: {
        ...input.view.zones,
        [hand.id]: {
          ...hand,
          cards: hand.cards.filter(
            (card) => card.id !== pokemon.id && card.id !== other.id
          ),
        },
      },
      workAreas: {
        ...input.view.workAreas,
        [playerId]: {
          ...input.view.workAreas[playerId]!,
          inspection: {
            id: 'inspection-work-area',
            sourceZoneId: hand.id,
            cards: [pokemon, other],
          },
        },
      },
    };
    const scene = createBoardSceneForViewport(view, {
      viewport: input.scene.viewport,
      bottomPlayerId: playerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    });
    const blue = view.stacks['stack:blue:active']!;
    const red = view.stacks['stack:red:active']!;
    const drop = (cardId: string, targetId: string) =>
      resolveBoardDrop(view, scene, {
        kind: 'CardDropRequested',
        cardId: cardId as typeof pokemon.id,
        targetId,
      });
    // A Pokémon evolves the Pokémon it is dropped on; anything else attaches.
    expect(drop(pokemon.id, blue.id)).toEqual({
      ok: true,
      command: {
        type: 'PlaceCardOnPlayStack',
        cardId: pokemon.id,
        expectedSourceId: 'inspection-work-area',
        targetStackId: blue.id,
        expectedTargetTopCardId: blue.evolutionCards.at(-1)!.id,
        mode: 'evolution',
      },
    });
    expect(drop(other.id, red.id)).toEqual({
      ok: true,
      command: expect.objectContaining({
        type: 'PlaceCardOnPlayStack',
        cardId: other.id,
        targetStackId: red.id,
        mode: 'attachment',
      }),
    });
    // Evolving the opponent's Pokémon is not offered.
    expect(drop(pokemon.id, red.id)).toEqual({
      ok: false,
      reason: 'unsupported_target',
    });
  });

  it('moves a card out of an explicit inspection work area', () => {
    const input = fixture();
    const sceneCard = localHandCard(input);
    const playerId = input.view.playerOrder[0]!;
    const hand = input.view.zones[`zone:${playerId}:hand`]!;
    const viewCard = hand.cards.find((card) => card.id === sceneCard.id)!;
    const view: MatchViewState = {
      ...input.view,
      zones: {
        ...input.view.zones,
        [hand.id]: {
          ...hand,
          cards: hand.cards.filter((card) => card.id !== viewCard.id),
        },
      },
      workAreas: {
        ...input.view.workAreas,
        [playerId]: {
          ...input.view.workAreas[playerId]!,
          inspection: {
            id: 'inspection-work-area',
            sourceZoneId: hand.id,
            cards: [viewCard],
          },
        },
      },
    };
    const scene = createBoardSceneForViewport(view, {
      viewport: input.scene.viewport,
      bottomPlayerId: playerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    });
    expect(
      resolveBoardDrop(view, scene, {
        kind: 'CardDropRequested',
        cardId: viewCard.id,
        targetId: `zone:${playerId}:discard`,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveInspectedCard',
        cardId: viewCard.id,
        expectedWorkAreaId: 'inspection-work-area',
        destinationZoneId: `zone:${playerId}:discard`,
      },
    });
  });

  it('drops a board card onto the painted popup the way v1 does', () => {
    const input = fixture();
    const playerId = input.view.playerOrder[0]!;
    const hand = input.view.zones[`zone:${playerId}:hand`]!;
    const [inspected, dragged] = hand.cards;
    if (!inspected || !dragged) throw new Error('hand fixture is required');
    const view: MatchViewState = {
      ...input.view,
      zones: {
        ...input.view.zones,
        [hand.id]: {
          ...hand,
          cards: hand.cards.filter((card) => card.id !== inspected.id),
        },
      },
      workAreas: {
        ...input.view.workAreas,
        [playerId]: {
          ...input.view.workAreas[playerId]!,
          inspection: {
            id: 'inspection-work-area',
            sourceZoneId: hand.id,
            cards: [inspected],
          },
        },
      },
    };
    const scene = createBoardSceneForViewport(view, {
      viewport: input.scene.viewport,
      bottomPlayerId: playerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    });
    const panel = scene.zones.find(
      (zone) => zone.id === 'inspection-work-area'
    )!;
    // A pointer released anywhere over the painted popup resolves to it,
    // whether it lands on the window itself or on a card already inside.
    const targetId = resolveBoardDropTarget(
      scene,
      dragged.id,
      panel.bounds.x + panel.bounds.width / 2,
      panel.bounds.y + panel.bounds.height / 2
    );
    expect(targetId).toBe('inspection-work-area');
    expect(
      resolveBoardDrop(view, scene, {
        kind: 'CardDropRequested',
        cardId: dragged.id,
        targetId: targetId!,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveCardToWorkArea',
        cardId: dragged.id,
        expectedWorkAreaId: 'inspection-work-area',
      },
    });
    // Dropping a card back onto the popup it already sits in changes nothing.
    expect(
      resolveBoardDrop(view, scene, {
        kind: 'CardDropRequested',
        cardId: inspected.id,
        targetId: 'inspection-work-area',
      })
    ).toEqual({ ok: false, reason: 'no_op' });
  });

  it('rejects a card visible through another player inspection without submitting', () => {
    const input = fixture();
    const sceneCard = localHandCard(input);
    if (input.view.viewer.kind !== 'player') {
      throw new Error('player view fixture is required');
    }
    const viewerPlayerId = input.view.viewer.playerId;
    const sourcePlayerId = input.view.playerOrder.find(
      (playerId) => playerId !== viewerPlayerId
    )!;
    const hand = input.view.zones[`zone:${viewerPlayerId}:hand`]!;
    const viewCard = hand.cards.find((card) => card.id === sceneCard.id)!;
    const view: MatchViewState = {
      ...input.view,
      zones: {
        ...input.view.zones,
        [hand.id]: {
          ...hand,
          cards: hand.cards.filter((card) => card.id !== viewCard.id),
        },
      },
      workAreas: {
        ...input.view.workAreas,
        [sourcePlayerId]: {
          ...input.view.workAreas[sourcePlayerId]!,
          inspection: {
            id: 'foreign-inspection-work-area',
            sourceZoneId: hand.id,
            cards: [viewCard],
          },
        },
      },
    };
    const scene = createBoardSceneForViewport(view, {
      viewport: input.scene.viewport,
      bottomPlayerId: viewerPlayerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    });
    const submit = vi.fn();

    expect(
      submitBoardDrop(
        view,
        scene,
        {
          kind: 'CardDropRequested',
          cardId: viewCard.id,
          targetId: `zone:${viewerPlayerId}:discard`,
        },
        submit
      )
    ).toEqual({ ok: false, reason: 'unsupported_source' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('moves staged cards individually or restores the represented stack', () => {
    const input = fixture();
    const sceneCard = localHandCard(input);
    const playerId = input.view.playerOrder[0]!;
    const hand = input.view.zones[`zone:${playerId}:hand`]!;
    const viewCard = hand.cards.find((card) => card.id === sceneCard.id)!;
    const view: MatchViewState = {
      ...input.view,
      zones: {
        ...input.view.zones,
        [hand.id]: {
          ...hand,
          cards: hand.cards.filter((card) => card.id !== viewCard.id),
        },
      },
      workAreas: {
        ...input.view.workAreas,
        [playerId]: {
          ...input.view.workAreas[playerId]!,
          attachmentResolution: {
            id: 'staged-work-area',
            sourceStackId: 'removed-stack',
            cards: [viewCard],
            evolutionCards: [viewCard],
            attachmentCards: [],
            suggestedSlot: 'bench',
          },
        },
      },
    };
    const scene = createBoardSceneForViewport(view, {
      viewport: input.scene.viewport,
      bottomPlayerId: playerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    });
    expect(
      resolveBoardDrop(view, scene, {
        kind: 'CardDropRequested',
        cardId: viewCard.id,
        targetId: `zone:${playerId}:discard`,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveStagedCard',
        cardId: viewCard.id,
        expectedWorkAreaId: 'staged-work-area',
        destinationZoneId: `zone:${playerId}:discard`,
      },
    });
    expect(
      resolveBoardDrop(view, scene, {
        kind: 'CardDropRequested',
        cardId: viewCard.id,
        targetId: `slot:${playerId}:bench`,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'RestoreStagedStack',
        expectedWorkAreaId: 'staged-work-area',
        expectedActiveStackId: 'stack:blue:active',
        expectedBenchStackIds: [],
        destinationSlot: 'bench',
      },
    });
  });

  it('fails closed for spectators and unknown targets', () => {
    const input = fixture();
    const card = localHandCard(input);
    expect(
      resolveBoardDrop(
        { ...input.view, viewer: { kind: 'spectator' } },
        input.scene,
        {
          kind: 'CardDropRequested',
          cardId: card.id,
          targetId: 'zone:spike-blue:discard',
        }
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(
      resolveBoardDrop(input.view, input.scene, {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: 'missing-target',
      })
    ).toEqual({ ok: false, reason: 'stale_target' });
    const workAreaScene: BoardScene = {
      ...input.scene,
      zones: [
        ...input.scene.zones,
        {
          id: 'inspection-one',
          playerId: input.view.playerOrder[0]!,
          side: 'local',
          kind: 'inspection',
          bounds: { x: 100, y: 100, width: 200, height: 200 },
          contentBounds: { x: 100, y: 100, width: 200, height: 200 },
          surface: 'zone',
          count: 1,
          zIndex: 900,
          label: 'Inspection',
          interactive: true,
        },
      ],
    };
    // v1's popups take drops too, so the viewer's own window accepts one.
    expect(
      resolveBoardDrop(input.view, workAreaScene, {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: 'inspection-one',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveCardToWorkArea',
        cardId: card.id,
        expectedWorkAreaId: 'inspection-one',
      },
    });
    // The opponent's window is theirs alone, as every other work-area move is.
    const opponentId = input.view.playerOrder[1]!;
    const opponentScene: BoardScene = {
      ...workAreaScene,
      zones: workAreaScene.zones.map((zone) =>
        zone.id === 'inspection-one' ? { ...zone, playerId: opponentId } : zone
      ),
    };
    expect(
      resolveBoardDrop(input.view, opponentScene, {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: 'inspection-one',
      })
    ).toEqual({ ok: false, reason: 'unsupported_target' });
  });

  it('submits exactly once only after successful resolution', () => {
    const input = fixture();
    const card = localHandCard(input);
    const submit = vi.fn();
    const resolved = submitBoardDrop(
      input.view,
      input.scene,
      {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: 'zone:spike-blue:discard',
      },
      submit
    );
    expect(resolved.ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);

    submitBoardDrop(
      input.view,
      input.scene,
      {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: card.parentId,
      },
      submit
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
