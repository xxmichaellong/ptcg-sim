import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { createProvisionalRebinder } from './rebindProvisionalReferences.js';

describe('rebinding predicted references', () => {
  it('names the stack and window the room made for what was predicted', () => {
    const rebindProvisionalReferences = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const active = view.stacks['stack:blue:active']!;
    const played = active.evolutionCards.at(-1)!;
    const withLook: MatchViewState = {
      ...view,
      workAreas: {
        ...view.workAreas,
        [playerId]: {
          ...view.workAreas[playerId]!,
          inspection: {
            id: 'room-inspection',
            sourceZoneId: `zone:${playerId}:deck`,
            cards: [],
          },
        },
      },
    };
    const attach: WireGameCommand = {
      type: 'PlaceCardOnPlayStack',
      cardId: 'energy',
      expectedSourceId: `predicted-inspection:${playerId}`,
      targetStackId: `predicted-stack:${played.id}`,
      expectedTargetTopCardId: played.id,
    } as unknown as WireGameCommand;
    expect(rebindProvisionalReferences(attach, withLook)).toMatchObject({
      expectedSourceId: 'room-inspection',
      targetStackId: active.id,
      expectedTargetTopCardId: played.id,
    });
    // Nothing predicted: the very same command.
    const plain: WireGameCommand = { type: 'FlipCoin' };
    expect(rebindProvisionalReferences(plain, view)).toBe(plain);
    // Not published yet: left for the room to refuse as stale.
    const unknown = {
      ...attach,
      targetStackId: 'predicted-stack:missing',
    } as WireGameCommand;
    expect(rebindProvisionalReferences(unknown, view)).toMatchObject({
      targetStackId: 'predicted-stack:missing',
    });
  });

  it('finds a window made by taking apart a predicted stack, after the stack is gone', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const active = view.stacks['stack:blue:active']!;
    const played = active.evolutionCards.at(-1)!;
    const predicted = `predicted-stack:${played.id}`;
    // Sent while the stack stood: it is learned.
    expect(
      rebind(
        {
          type: 'RotateStack',
          stackId: predicted,
        } as unknown as WireGameCommand,
        view
      )
    ).toMatchObject({ stackId: active.id });
    // Then the stack was taken apart into a window.
    const { [active.id]: _gone, ...stacks } = view.stacks;
    const apart: MatchViewState = {
      ...view,
      stacks,
      workAreas: {
        ...view.workAreas,
        [playerId]: {
          ...view.workAreas[playerId]!,
          attachmentResolution: {
            id: 'room-work-area',
            sourceStackId: active.id,
            cards: [],
            evolutionCards: [],
            attachmentCards: [],
            suggestedSlot: 'active',
          },
        },
      },
    };
    expect(
      rebind(
        {
          type: 'ResolveStagedCards',
          expectedWorkAreaId: `predicted-work-area:${predicted}`,
          destination: 'discard',
        } as WireGameCommand,
        apart
      )
    ).toMatchObject({ expectedWorkAreaId: 'room-work-area' });
  });
});
