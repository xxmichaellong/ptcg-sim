import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import type { PresentationEvent } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  createPresentationEffectSink,
  presentationEffectsForEvent,
  type PresentationEffect,
} from './PresentationEffects.js';

const events: readonly PresentationEvent[] = [
  {
    type: 'CoinFlipped',
    revision: 1,
    playerId: 'spike-blue',
    result: 'heads',
  },
  { type: 'PlayerReset', revision: 2, playerId: 'spike-red' },
  {
    type: 'DeckLoaded',
    revision: 3,
    playerId: 'spike-blue',
    cardCount: 60,
  },
  {
    type: 'PlayerSetup',
    revision: 4,
    playerId: 'spike-blue',
    handCount: 7,
    prizeCount: 6,
  },
  {
    type: 'RandomCardPlayedFaceDown',
    revision: 5,
    actorPlayerId: 'spike-blue',
    targetPlayerId: 'spike-red',
  },
  {
    type: 'TurnStarted',
    revision: 6,
    playerId: 'spike-blue',
    turnNumber: 3,
  },
  {
    type: 'TurnStartFailedNoDeck',
    revision: 7,
    playerId: 'spike-red',
    turnNumber: 3,
  },
  {
    type: 'AttackDeclared',
    revision: 8,
    playerId: 'spike-blue',
    turnNumber: 3,
  },
  {
    type: 'PassDeclared',
    revision: 9,
    playerId: 'spike-red',
    turnNumber: 3,
  },
  {
    type: 'PublicCardsRevealed',
    revision: 10,
    playerId: 'spike-red',
    cardCount: 1,
  },
  {
    type: 'PublicCardsHidden',
    revision: 11,
    playerId: 'spike-blue',
    cardCount: 2,
  },
  {
    type: 'PrivateInspectionStarted',
    revision: 12,
    sourcePlayerId: 'spike-red',
    viewerPlayerId: 'spike-blue',
    cardCount: 3,
  },
  {
    type: 'PrivateInspectionEnded',
    revision: 13,
    sourcePlayerId: 'spike-blue',
    viewerPlayerId: 'spike-red',
    cardCount: 1,
  },
  {
    type: 'UndoApplied',
    revision: 14,
    actorPlayerId: 'spike-blue',
    targetPlayerId: 'spike-blue',
    revertedRevision: 13,
  },
];

const messages = (effects: readonly PresentationEffect[]) =>
  effects
    .filter((effect) => effect.kind !== 'animation')
    .map((effect) =>
      effect.kind === 'activity'
        ? `${effect.category}:${effect.message}`
        : `accessibility:${effect.message}`
    );

describe('presentationEffectsForEvent', () => {
  it('maps every recipient-safe event to parity activity and accessibility', () => {
    const view = createRendererSpikeView();
    expect(
      events.map((event) => messages(presentationEffectsForEvent(event, view)))
    ).toEqual([
      ['player:Blue flipped heads', 'accessibility:Blue flipped heads'],
      ['player:Red reset', 'accessibility:Red reset'],
      ['announcement:Blue loaded deck', 'accessibility:Blue loaded deck'],
      [
        'player:Blue drew starting hand and set prizes',
        'accessibility:Blue drew starting hand and set prizes',
      ],
      [
        "player:Blue moved a random card from Red's hand to board",
        "accessibility:Blue moved a random card from Red's hand to board",
      ],
      [
        'announcement:Turn 3',
        'player:Blue drew for turn',
        'accessibility:Blue started turn 3',
      ],
      [
        'announcement:Red has no more cards in deck!',
        'accessibility:Red has no more cards in deck!',
      ],
      ['player:Blue attacked', 'accessibility:Blue attacked'],
      ['player:Red passed', 'accessibility:Red passed'],
      [
        "player:1 of Red's cards was revealed",
        "accessibility:1 of Red's cards was revealed",
      ],
      [
        "player:2 of Blue's cards were hidden",
        "accessibility:2 of Blue's cards were hidden",
      ],
      [
        "player:Blue looked at 3 of Red's cards",
        "accessibility:Blue looked at 3 of Red's cards",
      ],
      [
        "player:Red stopped looking at 1 of Blue's cards",
        "accessibility:Red stopped looking at 1 of Blue's cards",
      ],
      [
        'announcement:Blue took back their last move!',
        'accessibility:Blue took back their last move!',
      ],
    ]);

    expect(presentationEffectsForEvent(events[0]!, view)).toContainEqual({
      kind: 'animation',
      revision: 1,
      eventType: 'CoinFlipped',
      animation: {
        kind: 'coinFlip',
        playerId: 'spike-blue',
        result: 'heads',
      },
    });
  });

  it('describes cross-player undo accurately and never prints opaque fallback IDs', () => {
    const view = createRendererSpikeView();
    const crossPlayerUndo: PresentationEvent = {
      type: 'UndoApplied',
      revision: 15,
      actorPlayerId: 'spike-blue',
      targetPlayerId: 'spike-red',
      revertedRevision: 14,
    };
    expect(
      messages(presentationEffectsForEvent(crossPlayerUndo, view))
    ).toEqual([
      "announcement:Blue took back Red's last move!",
      "accessibility:Blue took back Red's last move!",
    ]);

    const missingPlayer: PresentationEvent = {
      type: 'CoinFlipped',
      revision: 16,
      playerId: 'opaque-routing-id',
      result: 'tails',
    };
    const visibleMessages = messages(
      presentationEffectsForEvent(missingPlayer, view)
    );
    expect(visibleMessages).toEqual([
      'player:Player flipped tails',
      'accessibility:Player flipped tails',
    ]);
    expect(visibleMessages.join(' ')).not.toContain('opaque-routing-id');
  });
});

describe('createPresentationEffectSink', () => {
  it('routes in effect order and isolates adapter and diagnostic failures', () => {
    const view = createRendererSpikeView();
    const delivered: string[] = [];
    const failure = new Error('activity surface failed');
    const appendActivity = vi.fn(() => {
      delivered.push('activity');
      throw failure;
    });
    const announceAccessibility = vi.fn(() => delivered.push('accessibility'));
    const presentAnimation = vi.fn(() => delivered.push('animation'));
    const reportFailure = vi.fn(() => {
      throw new Error('diagnostics failed');
    });
    const sink = createPresentationEffectSink(
      () => view,
      { appendActivity, announceAccessibility, presentAnimation },
      reportFailure
    );

    sink(events[0]!);

    expect(delivered).toEqual(['activity', 'accessibility', 'animation']);
    expect(reportFailure).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ kind: 'activity', eventType: 'CoinFlipped' }),
      events[0]
    );
    expect(announceAccessibility).toHaveBeenCalledTimes(1);
    expect(presentAnimation).toHaveBeenCalledTimes(1);
  });
});
