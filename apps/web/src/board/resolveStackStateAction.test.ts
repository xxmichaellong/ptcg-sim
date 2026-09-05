import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveStackStateAction,
  submitStackStateAction,
} from './resolveStackStateAction.js';

const activeCard = (view: MatchViewState) =>
  view.stacks['stack:blue:active']!.evolutionCards.at(-1)!;

describe('stack-state application actions', () => {
  it('maps marker target values and clockwise rotation to wire commands', () => {
    const view = createRendererSpikeView();
    const card = activeCard(view);
    expect(
      resolveStackStateAction(view, card.id, {
        type: 'setDamage',
        damage: 40,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'SetDamage',
        stackId: 'stack:blue:active',
        damage: 40,
      },
    });
    expect(
      resolveStackStateAction(view, card.id, {
        type: 'setSpecialCondition',
        condition: ' Pa ',
      })
    ).toMatchObject({
      ok: true,
      command: { type: 'SetSpecialCondition', condition: 'Pa' },
    });
    expect(
      resolveStackStateAction(view, card.id, { type: 'toggleAbilityUsed' })
    ).toMatchObject({
      ok: true,
      command: { type: 'SetAbilityUsed', used: false },
    });
    expect(
      resolveStackStateAction(view, card.id, { type: 'rotateClockwise' })
    ).toMatchObject({
      ok: true,
      command: { type: 'RotateStack', rotationQuarterTurns: 1 },
    });
  });

  it('preserves numeric-key and condition-cycle behavior as explicit targets', () => {
    const view = createRendererSpikeView();
    const card = activeCard(view);
    expect(
      resolveStackStateAction(view, card.id, {
        type: 'adjustDamage',
        delta: -120,
      })
    ).toMatchObject({
      ok: true,
      command: { type: 'SetDamage', damage: null },
    });
    for (const [condition, target] of [
      [null, 'P'],
      ['P', 'B'],
      ['B', 'Pa'],
      ['Pa', 'C'],
      ['C', 'A'],
      ['A', 'P'],
    ] as const) {
      const conditioned: MatchViewState = {
        ...view,
        stacks: {
          ...view.stacks,
          'stack:blue:active': {
            ...view.stacks['stack:blue:active']!,
            specialCondition: condition,
          },
        },
      };
      expect(
        resolveStackStateAction(conditioned, card.id, {
          type: 'cycleSpecialCondition',
        })
      ).toMatchObject({
        ok: true,
        command: { type: 'SetSpecialCondition', condition: target },
      });
    }
  });

  it('fails closed for spectators, stale/non-stack cards, invalid values, and no-ops', () => {
    const view = createRendererSpikeView();
    const stack = view.stacks['stack:blue:active']!;
    const card = stack.evolutionCards.at(-1)!;
    expect(
      resolveStackStateAction(
        { ...view, viewer: { kind: 'spectator' } },
        card.id,
        { type: 'toggleAbilityUsed' }
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(
      resolveStackStateAction(view, 'missing-card', {
        type: 'rotateClockwise',
      })
    ).toEqual({ ok: false, reason: 'stale_card' });
    expect(
      resolveStackStateAction(view, stack.attachmentCards[0]!.id, {
        type: 'setDamage',
        damage: 10,
      })
    ).toMatchObject({
      ok: true,
      command: { type: 'SetDamage', stackId: stack.id, damage: 10 },
    });
    const hand = view.zones['zone:spike-blue:hand']!;
    expect(
      resolveStackStateAction(view, hand.cards[0]!.id, {
        type: 'setDamage',
        damage: 10,
      })
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    expect(
      resolveStackStateAction(view, card.id, {
        type: 'setDamage',
        damage: 10_000,
      })
    ).toEqual({ ok: false, reason: 'invalid_value' });
    for (const damage of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveStackStateAction(view, card.id, {
          type: 'setDamage',
          damage,
        })
      ).toEqual({ ok: false, reason: 'invalid_value' });
    }
    expect(
      resolveStackStateAction(view, card.id, {
        type: 'setDamage',
        damage: 'legacy free-form text',
      } as unknown as Parameters<typeof resolveStackStateAction>[2])
    ).toEqual({ ok: false, reason: 'invalid_value' });
    expect(
      resolveStackStateAction(view, card.id, {
        type: 'setSpecialCondition',
        condition: 'legacy text beyond the bounded editor limit',
      })
    ).toEqual({ ok: false, reason: 'invalid_value' });
    expect(
      resolveStackStateAction(view, card.id, {
        type: 'setAbilityUsed',
        used: true,
      })
    ).toEqual({ ok: false, reason: 'no_op' });
  });

  it('submits exactly one accepted command and never submits a rejection', () => {
    const view = createRendererSpikeView();
    const card = activeCard(view);
    const submit = vi.fn();
    expect(
      submitStackStateAction(view, card.id, { type: 'rotateClockwise' }, submit)
        .ok
    ).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
    expect(
      submitStackStateAction(
        view,
        card.id,
        { type: 'setDamage', damage: 120 },
        submit
      )
    ).toEqual({ ok: false, reason: 'no_op' });
    expect(submit).toHaveBeenCalledOnce();
  });

  it('turns a damage-removal shortcut into one command without keydown fallthrough', () => {
    const view = createRendererSpikeView();
    const card = activeCard(view);
    const submit = vi.fn();

    expect(
      submitStackStateAction(
        view,
        card.id,
        { type: 'adjustDamage', delta: -130 },
        submit
      )
    ).toEqual({
      ok: true,
      command: {
        type: 'SetDamage',
        stackId: 'stack:blue:active',
        damage: null,
      },
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenLastCalledWith({
      type: 'SetDamage',
      stackId: 'stack:blue:active',
      damage: null,
    });
  });
});
