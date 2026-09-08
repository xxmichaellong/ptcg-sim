import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  resolveAttachEvolveTarget,
  resolveAttachEvolveTargeting,
} from './resolveAttachEvolveTargeting.js';

describe('attach/evolve target resolver', () => {
  it('derives evolution mode and active-then-bench targets from the source board', () => {
    const view = createRendererSpikeView();
    const hand = view.zones['zone:spike-blue:hand']!;
    const source = hand.cards.find(
      (card) => card.kind === 'known' && card.category === 'Pokémon'
    );
    if (!source) throw new Error('Fixture is missing a hand Pokémon');
    const board = view.boards[source.ownerId]!;
    const targetStackIds = [board.activeStackId!, ...board.benchStackIds];

    expect(resolveAttachEvolveTargeting(view, source.id)).toEqual({
      ok: true,
      targeting: {
        kind: 'attachOrEvolve',
        sourceCardId: source.id,
        expectedSourceId: hand.id,
        mode: 'evolution',
        targets: targetStackIds.map((stackId) => ({
          stackId,
          topCardId: view.stacks[stackId]!.evolutionCards.at(-1)!.id,
        })),
      },
    });
  });

  it('derives attachment mode for non-Pokémon and isolates the source side', () => {
    const view = createRendererSpikeView();
    const source = Object.values(view.zones)
      .flatMap((zone) => zone.cards.map((card) => ({ card, zone })))
      .find(
        ({ card, zone }) =>
          zone.ownerId === view.viewer.playerId &&
          card.kind === 'known' &&
          card.category !== 'Pokémon'
      );
    if (!source || view.viewer.kind !== 'player') {
      throw new Error('Fixture is missing a known non-Pokémon');
    }
    const resolution = resolveAttachEvolveTargeting(view, source.card.id);
    expect(resolution).toMatchObject({
      ok: true,
      targeting: { mode: 'attachment' },
    });
    if (!resolution.ok) return;
    expect(
      resolution.targeting.targets.every(
        (target) =>
          view.stacks[target.stackId]?.boardPlayerId === view.viewer.playerId
      )
    ).toBe(true);
  });

  it('allows attachments and lower evolutions but rejects a stack top', () => {
    const view = createRendererSpikeView();
    const stack = view.stacks['stack:blue:active']!;
    const top = stack.evolutionCards.at(-1)!;
    const attachment = stack.attachmentCards[0];
    expect(resolveAttachEvolveTargeting(view, top.id)).toEqual({
      ok: false,
      reason: 'unsupported_source',
    });
    if (attachment) {
      expect(resolveAttachEvolveTargeting(view, attachment.id)).toMatchObject({
        ok: true,
        targeting: { mode: 'attachment' },
      });
    }
    if (stack.evolutionCards.length > 1) {
      expect(
        resolveAttachEvolveTargeting(view, stack.evolutionCards[0]!.id)
      ).toMatchObject({
        ok: true,
        targeting: { mode: 'attachment' },
      });
    }
  });

  it('derives opponent-public targets from the source placement, not the viewer', () => {
    const view = createRendererSpikeView();
    const opponentId = view.playerOrder[1]!;
    const source = Object.values(view.zones)
      .flatMap((zone) => zone.cards.map((card) => ({ card, zone })))
      .find(
        ({ card, zone }) => zone.ownerId === opponentId && card.kind === 'known'
      );
    if (!source) throw new Error('Fixture is missing an opponent public card');
    const resolution = resolveAttachEvolveTargeting(view, source.card.id);
    if (!resolution.ok) throw new Error(resolution.reason);
    expect(resolution.targeting.expectedSourceId).toBe(source.zone.id);
    expect(resolution.targeting.targets).toEqual([
      {
        stackId: view.boards[opponentId]!.activeStackId,
        topCardId:
          view.stacks[
            view.boards[opponentId]!.activeStackId!
          ]!.evolutionCards.at(-1)!.id,
      },
    ]);
  });

  it('accepts recipient-visible inspection and staged work-area sources', () => {
    const base = createRendererSpikeView();
    if (base.viewer.kind !== 'player') throw new Error('Player view required');
    const playerId = base.viewer.playerId;
    const hand = base.zones[`zone:${playerId}:hand`]!;
    const sources = hand.cards.filter((card) => card.kind === 'known');
    const inspectionCard = sources[0]!;
    const stagedCard = sources[1]!;
    const zones = {
      ...base.zones,
      [hand.id]: {
        ...hand,
        cards: hand.cards.filter(
          (card) => card.id !== inspectionCard.id && card.id !== stagedCard.id
        ),
      },
    };
    const inspectionView = {
      ...base,
      zones,
      workAreas: {
        ...base.workAreas,
        [playerId]: {
          inspection: {
            id: 'inspection-work',
            cards: [inspectionCard],
            sourceZoneId: hand.id,
          },
          attachmentResolution: {
            id: 'staged-work',
            sourceStackId: base.boards[playerId]!.activeStackId!,
            evolutionCards: [stagedCard],
            attachmentCards: [],
            suggestedSlot: 'active' as const,
          },
        },
      },
    };
    expect(
      resolveAttachEvolveTargeting(inspectionView, inspectionCard.id)
    ).toMatchObject({
      ok: true,
      targeting: { expectedSourceId: 'inspection-work' },
    });
    expect(
      resolveAttachEvolveTargeting(inspectionView, stagedCard.id)
    ).toMatchObject({
      ok: true,
      targeting: { expectedSourceId: 'staged-work' },
    });
  });

  it('emits one closed command and supports a same-stack target', () => {
    const view = createRendererSpikeView();
    const stack = view.stacks['stack:blue:active']!;
    const source = stack.attachmentCards[0];
    if (!source) throw new Error('Fixture is missing an attachment');
    const first = resolveAttachEvolveTargeting(view, source.id);
    if (!first.ok) throw new Error(`Unexpected rejection: ${first.reason}`);
    const target = first.targeting.targets.find(
      (candidate) => candidate.stackId === stack.id
    )!;
    expect(
      resolveAttachEvolveTarget(view, first.targeting, target.topCardId)
    ).toEqual({
      ok: true,
      command: {
        type: 'PlaceCardOnPlayStack',
        cardId: source.id,
        expectedSourceId: stack.id,
        targetStackId: stack.id,
        expectedTargetTopCardId: target.topCardId,
        mode: 'attachment',
      },
    });
  });

  it('fails closed for spectators, concealed sources, stale sources and stale tops', () => {
    const view = createRendererSpikeView();
    const source = Object.values(view.zones)
      .flatMap((zone) => zone.cards)
      .find((card) => card.kind === 'known');
    if (!source) throw new Error('Fixture is missing a known card');
    expect(
      resolveAttachEvolveTargeting(
        { ...view, viewer: { kind: 'spectator' } },
        source.id
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    const concealed = Object.values(view.zones)
      .flatMap((zone) => zone.cards)
      .find((card) => card.kind === 'concealed');
    if (concealed) {
      expect(resolveAttachEvolveTargeting(view, concealed.id)).toEqual({
        ok: false,
        reason: 'unsupported_source',
      });
    }

    const first = resolveAttachEvolveTargeting(view, source.id);
    if (!first.ok) return;
    const target = first.targeting.targets[0]!;
    expect(
      resolveAttachEvolveTarget(
        view,
        {
          ...first.targeting,
          expectedSourceId: 'stale-source',
        },
        target.topCardId
      )
    ).toEqual({ ok: false, reason: 'stale_source' });
    expect(
      resolveAttachEvolveTarget(
        {
          ...view,
          stacks: {
            ...view.stacks,
            [target.stackId]: {
              ...view.stacks[target.stackId]!,
              evolutionCards: view.stacks[target.stackId]!.evolutionCards.slice(
                0,
                -1
              ),
            },
          },
        },
        first.targeting,
        target.topCardId
      )
    ).toEqual({ ok: false, reason: 'stale_target' });
  });
});
