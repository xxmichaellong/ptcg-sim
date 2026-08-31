import type { MatchViewState } from '@ptcgsim/game-core';
import {
  createBoardScene,
  createRendererSpikeView,
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
    scene: createBoardScene(view, {
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
    const stackCard = stack.evolutionCards.at(-1)!;
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
    const scene = createBoardScene(view, {
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

  it('fails closed for spectators and unknown or work-area targets', () => {
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
          count: 1,
          zIndex: 900,
          label: 'Inspection',
          interactive: true,
        },
      ],
    };
    expect(
      resolveBoardDrop(input.view, workAreaScene, {
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
