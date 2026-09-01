import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveCardAnnotationAction,
  submitCardAnnotationAction,
} from './resolveCardAnnotationAction.js';

describe('card-annotation application actions', () => {
  it('routes group, BREAK, and stadium rotations to explicit target values', () => {
    const view = createRendererSpikeView();
    const stack = view.stacks['stack:blue:active']!;
    const top = stack.evolutionCards.at(-1)!;
    expect(
      resolveCardAnnotationAction(view, top.id, {
        type: 'rotate',
        single: false,
      })
    ).toMatchObject({
      ok: true,
      command: { type: 'RotateStack', rotationQuarterTurns: 1 },
    });
    expect(
      resolveCardAnnotationAction(view, top.id, {
        type: 'rotate',
        single: true,
      })
    ).toMatchObject({
      ok: true,
      command: { type: 'SetCardOrientation', orientationQuarterTurns: 1 },
    });
    const stadium = view.zones['zone:shared:stadium']!.cards[0]!;
    expect(
      resolveCardAnnotationAction(view, stadium.id, {
        type: 'rotate',
        single: false,
      })
    ).toMatchObject({
      ok: true,
      command: { type: 'SetCardOrientation', orientationQuarterTurns: 1 },
    });
  });

  it('routes host and per-card ability controls without conflating targets', () => {
    const view = createRendererSpikeView();
    const stack = view.stacks['stack:blue:active']!;
    expect(
      resolveCardAnnotationAction(view, stack.evolutionCards.at(-1)!.id, {
        type: 'toggleAbilityUsed',
      })
    ).toMatchObject({
      ok: true,
      command: { type: 'SetAbilityUsed', stackId: stack.id, used: false },
    });
    expect(
      resolveCardAnnotationAction(view, stack.attachmentCards[0]!.id, {
        type: 'toggleAbilityUsed',
      })
    ).toMatchObject({
      ok: true,
      command: { type: 'SetCardAbilityUsed', used: true },
    });
    const discard = view.zones['zone:spike-blue:discard']!;
    expect(
      resolveCardAnnotationAction(view, discard.cards[0]!.id, {
        type: 'toggleAbilityUsed',
      })
    ).toMatchObject({
      ok: true,
      command: { type: 'SetCardAbilityUsed', used: true },
    });
  });

  it('maps a category shortcut to one stale-safe move-and-annotate command', () => {
    const view = createRendererSpikeView();
    const stack = view.stacks['stack:blue:active']!;
    const top = stack.evolutionCards.at(-1)!;
    expect(
      resolveCardAnnotationAction(view, top.id, {
        type: 'changeCategory',
        category: 'Energy',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'ChangeCardCategory',
        cardId: top.id,
        expectedSourceId: stack.id,
        category: 'Energy',
      },
    });
  });

  it('fails closed for spectators, stale cards, lower evolutions, unsupported zones, and no-ops', () => {
    const view = createRendererSpikeView();
    const stack = view.stacks['stack:blue:active']!;
    const top = stack.evolutionCards.at(-1)!;
    expect(
      resolveCardAnnotationAction(
        { ...view, viewer: { kind: 'spectator' } },
        top.id,
        { type: 'toggleAbilityUsed' }
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(
      resolveCardAnnotationAction(view, 'missing-card', {
        type: 'changeCategory',
        category: 'Trainer',
      })
    ).toEqual({ ok: false, reason: 'stale_card' });
    expect(
      resolveCardAnnotationAction(view, stack.evolutionCards[0]!.id, {
        type: 'changeCategory',
        category: 'Trainer',
      })
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    const hand = view.zones['zone:spike-blue:hand']!;
    expect(
      resolveCardAnnotationAction(view, hand.cards[0]!.id, {
        type: 'toggleAbilityUsed',
      })
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    expect(
      resolveCardAnnotationAction(view, top.id, {
        type: 'setAbilityUsed',
        used: true,
      })
    ).toEqual({ ok: false, reason: 'no_op' });
  });

  it('submits exactly one accepted semantic command', () => {
    const view = createRendererSpikeView();
    const stadium = view.zones['zone:shared:stadium']!.cards[0]!;
    const submit = vi.fn();
    expect(
      submitCardAnnotationAction(
        view,
        stadium.id,
        { type: 'toggleAbilityUsed' },
        submit
      ).ok
    ).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
  });
});
