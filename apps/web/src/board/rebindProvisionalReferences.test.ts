import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { rebindProvisionalReferences } from './rebindProvisionalReferences.js';

describe('rebinding predicted references', () => {
  it('names the stack and window the room made for what was predicted', () => {
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
});
