import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveCardInspectionAction,
  resolveZoneInspectionAction,
  submitPrivateInspectionAction,
} from './resolvePrivateInspectionAction.js';

describe('private inspection action resolver', () => {
  it('maps whole-zone look and stop-looking toggles to grant commands', () => {
    const view = createRendererSpikeView();
    const prizes = Object.values(view.zones).find(
      (zone) => zone.ownerId === 'spike-blue' && zone.kind === 'prizes'
    )!;
    expect(
      resolveZoneInspectionAction(view, 'spike-blue', 'prizes', true)
    ).toEqual({
      ok: true,
      command: {
        type: 'BeginZoneInspection',
        targetPlayerId: 'spike-blue',
        zoneId: prizes.id,
        expectedCardIds: prizes.cards.map((card) => card.id),
      },
    });
    const activeView = {
      ...view,
      privateInspections: [
        {
          id: 'private-inspection-id',
          sourcePlayerId: 'spike-blue',
          sourceId: prizes.id,
          cardIds: prizes.cards.map((card) => card.id),
        },
      ],
    } as typeof view;
    expect(
      resolveZoneInspectionAction(activeView, 'spike-blue', 'prizes', false)
    ).toEqual({
      ok: true,
      command: {
        type: 'EndPrivateInspection',
        inspectionId: 'private-inspection-id',
      },
    });
  });

  it('maps one concealed-card look and its active grant close', () => {
    const view = createRendererSpikeView();
    const prizes = Object.values(view.zones).find(
      (zone) => zone.ownerId === 'spike-red' && zone.kind === 'prizes'
    )!;
    const card = prizes.cards[0]!;
    expect(resolveCardInspectionAction(view, card.id, true)).toEqual({
      ok: true,
      command: {
        type: 'BeginCardInspection',
        cardId: card.id,
        expectedSourceId: prizes.id,
      },
    });
    const activeView = {
      ...view,
      privateInspections: [
        {
          id: 'private-card-inspection',
          sourcePlayerId: 'spike-red',
          sourceId: prizes.id,
          cardIds: [card.id],
        },
      ],
    } as typeof view;
    expect(resolveCardInspectionAction(activeView, card.id, false)).toEqual({
      ok: true,
      command: {
        type: 'EndPrivateInspection',
        inspectionId: 'private-card-inspection',
      },
    });
  });

  it('rejects spectators, stale targets, empty zones, known cards, and no-ops', () => {
    const view = createRendererSpikeView();
    expect(
      resolveCardInspectionAction(
        { ...view, viewer: { kind: 'spectator' } },
        'missing-card',
        true
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(resolveCardInspectionAction(view, 'missing-card', true)).toEqual({
      ok: false,
      reason: 'stale_card',
    });
    expect(
      resolveZoneInspectionAction(view, 'missing-player', 'prizes', true)
    ).toEqual({ ok: false, reason: 'stale_player' });
    const hand = Object.values(view.zones).find(
      (zone) => zone.ownerId === 'spike-blue' && zone.kind === 'hand'
    )!;
    expect(
      resolveZoneInspectionAction(view, 'spike-blue', 'hand', true)
    ).toEqual({ ok: false, reason: 'no_op' });
    expect(resolveCardInspectionAction(view, hand.cards[0]!.id, true)).toEqual({
      ok: false,
      reason: 'no_op',
    });
    expect(
      resolveZoneInspectionAction(view, 'spike-blue', 'prizes', false)
    ).toEqual({ ok: false, reason: 'no_op' });
    const prizes = Object.values(view.zones).find(
      (zone) => zone.ownerId === 'spike-blue' && zone.kind === 'prizes'
    )!;
    expect(
      resolveZoneInspectionAction(
        {
          ...view,
          zones: {
            ...view.zones,
            [prizes.id]: { ...prizes, cards: [] },
          },
        },
        'spike-blue',
        'prizes',
        true
      )
    ).toEqual({ ok: false, reason: 'empty_zone' });
  });

  it('submits only accepted grant resolutions', () => {
    const view = createRendererSpikeView();
    const prizes = Object.values(view.zones).find(
      (zone) => zone.ownerId === 'spike-blue' && zone.kind === 'prizes'
    )!;
    const submit = vi.fn();
    const accepted = resolveCardInspectionAction(
      view,
      prizes.cards[0]!.id,
      true
    );
    expect(submitPrivateInspectionAction(accepted, submit).ok).toBe(true);
    expect(submit).toHaveBeenCalledWith({
      type: 'BeginCardInspection',
      cardId: prizes.cards[0]!.id,
      expectedSourceId: prizes.id,
    });
    submitPrivateInspectionAction({ ok: false, reason: 'no_op' }, submit);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
