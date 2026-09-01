import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolvePrizeVisibilityAction,
  resolvePublicCardVisibilityAction,
  submitPublicVisibilityAction,
} from './resolvePublicVisibilityAction.js';

describe('public visibility action resolver', () => {
  it('maps a per-card shortcut to its exact source container', () => {
    const view = createRendererSpikeView();
    const board = Object.values(view.zones).find(
      (zone) => zone.ownerId === 'spike-blue' && zone.kind === 'board'
    )!;
    const card = board.cards[0]!;
    expect(resolvePublicCardVisibilityAction(view, card.id, false)).toEqual({
      ok: true,
      command: {
        type: 'SetPublicReveal',
        cardId: card.id,
        expectedSourceId: board.id,
        revealed: false,
      },
    });
  });

  it('maps reveal/hide-all prizes to one ordered target-aware command', () => {
    const view = createRendererSpikeView();
    const prizes = Object.values(view.zones).find(
      (zone) => zone.ownerId === 'spike-red' && zone.kind === 'prizes'
    )!;
    expect(resolvePrizeVisibilityAction(view, 'spike-red', true)).toEqual({
      ok: true,
      command: {
        type: 'SetZonePublicReveal',
        targetPlayerId: 'spike-red',
        zoneId: prizes.id,
        expectedCardIds: prizes.cards.map((card) => card.id),
        revealed: true,
      },
    });

    const revealedView = {
      ...view,
      zones: {
        ...view.zones,
        [prizes.id]: {
          ...prizes,
          cards: prizes.cards.map((card) => ({
            ...card,
            publiclyRevealed: true as const,
          })),
        },
      },
    };
    expect(
      resolvePrizeVisibilityAction(revealedView, 'spike-red', false)
    ).toMatchObject({
      ok: true,
      command: { type: 'SetZonePublicReveal', revealed: false },
    });
  });

  it('rejects spectators, stale references, empty zones, and no-ops', () => {
    const view = createRendererSpikeView();
    expect(
      resolvePublicCardVisibilityAction(
        { ...view, viewer: { kind: 'spectator' } },
        'missing-card',
        true
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(
      resolvePublicCardVisibilityAction(view, 'missing-card', true)
    ).toEqual({ ok: false, reason: 'stale_card' });
    expect(resolvePrizeVisibilityAction(view, 'missing-player', true)).toEqual({
      ok: false,
      reason: 'stale_player',
    });
    const prizes = Object.values(view.zones).find(
      (zone) => zone.ownerId === 'spike-blue' && zone.kind === 'prizes'
    )!;
    expect(
      resolvePrizeVisibilityAction(
        {
          ...view,
          zones: {
            ...view.zones,
            [prizes.id]: { ...prizes, cards: [] },
          },
        },
        'spike-blue',
        true
      )
    ).toEqual({ ok: false, reason: 'empty_zone' });
    expect(resolvePrizeVisibilityAction(view, 'spike-blue', false)).toEqual({
      ok: false,
      reason: 'no_op',
    });
  });

  it('submits only accepted resolutions', () => {
    const view = createRendererSpikeView();
    const prizes = Object.values(view.zones).find(
      (zone) => zone.ownerId === 'spike-blue' && zone.kind === 'prizes'
    )!;
    const submit = vi.fn();
    const accepted = resolvePrizeVisibilityAction(view, 'spike-blue', true);
    expect(submitPublicVisibilityAction(accepted, submit).ok).toBe(true);
    expect(submit).toHaveBeenCalledWith({
      type: 'SetZonePublicReveal',
      targetPlayerId: 'spike-blue',
      zoneId: prizes.id,
      expectedCardIds: prizes.cards.map((card) => card.id),
      revealed: true,
    });
    submitPublicVisibilityAction({ ok: false, reason: 'stale_card' }, submit);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
