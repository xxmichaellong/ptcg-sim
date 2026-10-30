import { i18n } from '@lingui/core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import type { PresentationEvent } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  activityPresentationEffectsForEvents,
  createChatPresentationEffectSink,
  createPresencePresentationEffectSink,
  createPresentationEffectSink,
  presentationEffectsForChatMessage,
  presentationEffectsForEvent,
  presentationEffectsForPresence,
  type PresentationEffect,
} from './PresentationEffects.js';
import { presentationText } from './presentation-message.js';

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
    actorPlayerId: 'spike-blue',
    playerId: 'spike-red',
    scope: 'card',
    source: 'prizes',
    cardCount: 1,
    cardName: 'Pikachu',
  },
  {
    type: 'PublicCardsHidden',
    revision: 11,
    actorPlayerId: 'spike-red',
    playerId: 'spike-blue',
    scope: 'zone',
    source: 'prizes',
    cardCount: 2,
  },
  {
    type: 'PrivateInspectionStarted',
    revision: 12,
    sourcePlayerId: 'spike-red',
    viewerPlayerId: 'spike-blue',
    scope: 'zone',
    source: 'hand',
    cardCount: 3,
  },
  {
    type: 'PrivateInspectionEnded',
    revision: 13,
    sourcePlayerId: 'spike-blue',
    viewerPlayerId: 'spike-red',
    scope: 'card',
    source: 'prizes',
    cardCount: 1,
  },
  {
    type: 'UndoApplied',
    revision: 14,
    actorPlayerId: 'spike-blue',
    targetPlayerId: 'spike-blue',
    revertedRevision: 13,
  },
  {
    type: 'MulliganDeclared',
    revision: 14,
    playerId: 'spike-red',
  },
  {
    type: 'DeckViewDeclared',
    revision: 14,
    playerId: 'spike-blue',
  },
  {
    type: 'OncePerGameMarkerSet',
    revision: 15,
    playerId: 'spike-red',
    marker: 'vstar',
    used: true,
  },
  {
    type: 'OncePerGameMarkerSet',
    revision: 16,
    playerId: 'spike-blue',
    marker: 'gx',
    used: false,
  },
];

const messages = (effects: readonly PresentationEffect[]) =>
  effects
    .filter((effect) => effect.kind !== 'animation')
    .map((effect) =>
      effect.kind === 'activity'
        ? `${effect.category}:${presentationText(effect.message)}`
        : `accessibility:${presentationText(effect.message)}`
    );

/** The effects with their lines worded (the tests run in English). */
const worded = (effects: readonly PresentationEffect[]) =>
  effects.map((effect) =>
    effect.kind === 'animation'
      ? effect
      : { ...effect, message: presentationText(effect.message) }
  );

describe('presentationEffectsForEvent', () => {
  it('maps authenticated player and spectator chat without a replay fact', () => {
    const player = {
      type: 'ChatMessage' as const,
      protocolVersion: 2 as const,
      messageId: 'chat-player',
      playerId: 'spike-blue',
      displayName: 'Blue',
      message: '<safe text>',
      createdAtMs: 1_000,
    };
    expect(worded(presentationEffectsForChatMessage(player, 14))).toEqual([
      {
        kind: 'activity',
        revision: 14,
        eventType: 'ChatMessage',
        category: 'message',
        playerId: 'spike-blue',
        message: 'Blue: <safe text>',
      },
      {
        kind: 'accessibility',
        revision: 14,
        eventType: 'ChatMessage',
        message: 'Blue: <safe text>',
        politeness: 'polite',
      },
    ]);
    expect(
      worded(
        presentationEffectsForChatMessage({
          type: 'ChatMessage',
          protocolVersion: 2,
          messageId: 'chat-spectator',
          displayName: 'Watcher',
          message: '<safe text>',
          createdAtMs: 1_000,
        })
      )
    ).toEqual([
      expect.objectContaining({
        kind: 'activity',
        revision: 0,
        category: 'spectator',
        message: 'Watcher: <safe text>',
      }),
      expect.objectContaining({
        kind: 'accessibility',
        revision: 0,
        message: 'Watcher: <safe text>',
      }),
    ]);
    // v1's flower button is gone (PX-032), so a lone flower is a named line.
    expect(
      worded(
        presentationEffectsForChatMessage({ ...player, message: '🌺' }, 15)
      )[0]
    ).toMatchObject({ category: 'message', message: 'Blue: 🌺' });
    // What was said is shown as written, braces and all: it is a value,
    // never read as a message.
    expect(
      worded(
        presentationEffectsForChatMessage(
          { ...player, message: "{count, plural, one {#} other {'#'}}" },
          16
        )
      )[0]
    ).toMatchObject({
      message: "Blue: {count, plural, one {#} other {'#'}}",
    });
  });

  it('gates chat delivery and isolates effect failures', () => {
    const message = {
      type: 'ChatMessage' as const,
      protocolVersion: 2 as const,
      messageId: 'chat-player',
      playerId: 'spike-blue',
      displayName: 'Blue',
      message: 'hello',
      createdAtMs: 1_000,
    };
    const activity = vi.fn(() => {
      throw new Error('chat surface failed');
    });
    const accessibility = vi.fn();
    const reportFailure = vi.fn();
    let enabled = false;
    const sink = createChatPresentationEffectSink(
      () => 14,
      { appendActivity: activity, announceAccessibility: accessibility },
      reportFailure,
      () => enabled
    );

    sink(message);
    expect(activity).not.toHaveBeenCalled();
    enabled = true;
    sink(message);
    expect(activity).toHaveBeenCalledOnce();
    expect(accessibility).toHaveBeenCalledOnce();
    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'chat surface failed' }),
      expect.objectContaining({ eventType: 'ChatMessage' }),
      message
    );
  });

  it('maps legacy-compatible presence text and gates live-only delivery', () => {
    const variants = [
      ['joined', 'Viewer joined'],
      ['disconnected', 'Viewer disconnected'],
      ['reconnected', 'Viewer reconnected'],
      ['left', 'Viewer left the room'],
    ] as const;
    for (const [status, visible] of variants) {
      expect(
        worded(
          presentationEffectsForPresence(
            {
              type: 'Presence',
              protocolVersion: 2,
              displayName: 'Viewer',
              status,
            },
            14
          )
        )
      ).toEqual([
        {
          kind: 'activity',
          revision: 14,
          eventType: 'Presence',
          category: 'announcement',
          message: visible,
        },
        {
          kind: 'accessibility',
          revision: 14,
          eventType: 'Presence',
          message: visible,
          politeness: 'polite',
        },
      ]);
    }

    const activity = vi.fn();
    let live = false;
    const sink = createPresencePresentationEffectSink(
      () => 14,
      { appendActivity: activity },
      undefined,
      () => live
    );
    const entry = {
      type: 'Presence' as const,
      protocolVersion: 2 as const,
      displayName: 'Viewer',
      status: 'joined' as const,
    };
    sink(entry);
    live = true;
    sink(entry);
    expect(activity).toHaveBeenCalledOnce();
  });

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
        'announcement:Red has no cards left to draw',
        'accessibility:Red has no cards left to draw',
      ],
      ['player:Blue attacked', 'accessibility:Blue attacked'],
      ['player:Red passed', 'accessibility:Red passed'],
      [
        "player:Blue revealed Pikachu in Red's prizes",
        "accessibility:Blue revealed Pikachu in Red's prizes",
      ],
      ["player:Red hid Blue's prizes", "accessibility:Red hid Blue's prizes"],
      [
        "player:Blue looked at Red's hand",
        "accessibility:Blue looked at Red's hand",
      ],
      [
        "player:Red stopped looking at card in Blue's prizes",
        "accessibility:Red stopped looking at card in Blue's prizes",
      ],
      [
        'announcement:Blue took back their last move',
        'accessibility:Blue took back their last move',
      ],
      ['announcement:Red mulligans', 'accessibility:Red mulligans'],
      [
        "player:Blue is looking through Blue's deck",
        "accessibility:Blue is looking through Blue's deck",
      ],
      ['player:Red used their VSTAR', 'accessibility:Red used their VSTAR'],
      ['player:Blue reset their GX', 'accessibility:Blue reset their GX'],
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

  it('names each of several coins in order, and how many came up heads', () => {
    const view = createRendererSpikeView();
    const three: PresentationEvent = {
      type: 'CoinFlipped',
      revision: 7,
      playerId: 'spike-blue',
      result: 'heads',
      results: ['heads', 'tails', 'heads'],
    };
    expect(messages(presentationEffectsForEvent(three, view))).toEqual([
      'player:Blue flipped 3 coins: heads, tails, heads (2 heads)',
      'accessibility:Blue flipped 3 coins: heads, tails, heads (2 heads)',
    ]);
    const until: PresentationEvent = {
      type: 'CoinFlipped',
      revision: 8,
      playerId: 'spike-red',
      result: 'tails',
      results: ['heads', 'heads', 'tails'],
      untilTails: true,
    };
    expect(messages(presentationEffectsForEvent(until, view))).toEqual([
      'player:Red flipped until tails: heads, heads, tails (2 heads)',
      'accessibility:Red flipped until tails: heads, heads, tails (2 heads)',
    ]);
    expect(
      messages(
        presentationEffectsForEvent(
          { ...until, result: 'tails', results: ['tails'] },
          view
        )
      )[0]
    ).toBe('player:Red flipped until tails: tails (0 heads)');
    // The coin lands on the last, and the table reads the tally from all.
    expect(presentationEffectsForEvent(until, view)).toContainEqual({
      kind: 'animation',
      revision: 8,
      eventType: 'CoinFlipped',
      animation: {
        kind: 'coinFlip',
        playerId: 'spike-red',
        result: 'tails',
        results: ['heads', 'heads', 'tails'],
        untilTails: true,
      },
    });
  });

  it('narrates card actions in the v1 battle-log grammar', () => {
    const view = createRendererSpikeView();
    const line = (event: PresentationEvent) =>
      messages(presentationEffectsForEvent(event, view))[0];
    const at = { revision: 9, playerId: 'spike-blue' } as const;
    expect(
      line({
        type: 'CardMoved',
        ...at,
        verb: 'moved',
        source: 'hand',
        destination: 'bench',
        cardName: 'Pikachu',
      })
    ).toBe('player:Blue moved Pikachu from hand to bench');
    expect(
      line({
        type: 'CardMoved',
        ...at,
        verb: 'moved',
        source: 'active',
        destination: 'bench',
        destinationPlayerId: 'spike-red',
        cardName: 'Pikachu',
      })
    ).toBe("player:Blue moved Pikachu from active to Red's bench");
    expect(
      line({
        type: 'CardMoved',
        ...at,
        verb: 'moved',
        source: 'hand',
        destination: 'deck',
      })
    ).toBe('player:Blue moved card from hand to deck');
    expect(
      line({
        type: 'CardMoved',
        ...at,
        verb: 'moved',
        source: 'inspection',
        destination: 'lostZone',
        cardName: 'Pikachu',
      })
    ).toBe('player:Blue moved Pikachu from deck to lost zone');
    expect(
      line({
        type: 'CardMoved',
        ...at,
        verb: 'attached',
        source: 'hand',
        destination: 'active',
        cardName: 'Lightning Energy',
        targetCardName: 'Pikachu',
      })
    ).toBe('player:Blue attached Lightning Energy from hand to Pikachu');
    expect(
      line({
        type: 'CardMoved',
        ...at,
        verb: 'evolved',
        source: 'hand',
        destination: 'bench',
        cardName: 'Raichu',
        targetCardName: 'Pikachu',
      })
    ).toBe('player:Blue evolved Pikachu into Raichu');
    expect(
      line({ type: 'CardMoved', ...at, verb: 'movedToDeckTop', source: 'deck' })
    ).toBe('player:Blue moved card from deck to top of deck');
    expect(
      line({
        type: 'CardMoved',
        ...at,
        verb: 'switchedWithDeckTop',
        source: 'inspection',
        cardName: 'Pikachu',
      })
    ).toBe('player:Blue switched Pikachu from deck with top of deck');
    expect(line({ type: 'CardsDrawn', ...at, cardCount: 1 })).toBe(
      'player:Blue drew a card'
    );
    expect(line({ type: 'CardsDrawn', ...at, cardCount: 3 })).toBe(
      'player:Blue drew 3 cards'
    );
    expect(line({ type: 'ZoneShuffled', ...at, source: 'deck' })).toBe(
      'player:Blue shuffled deck'
    );
    expect(
      line({ type: 'DeckCardsLooked', ...at, cardCount: 2, edge: 'top' })
    ).toBe('player:Blue looked at top 2 cards of deck');
    expect(
      line({
        type: 'CardsResolved',
        ...at,
        verb: 'moved',
        cardCount: 3,
        source: 'board',
        destination: 'discard',
      })
    ).toBe('player:Blue moved 3 cards from board to discard');
    expect(
      line({
        type: 'CardsResolved',
        ...at,
        verb: 'shuffled',
        cardCount: 3,
        source: 'board',
        destination: 'deck',
      })
    ).toBe('player:Blue shuffled 3 cards from board to deck');
    expect(
      line({
        type: 'CardsResolved',
        ...at,
        verb: 'shuffled',
        cardCount: 6,
        source: 'prizes',
        destination: 'deckBottom',
      })
    ).toBe('player:Blue shuffled prizes to bottom of deck');
    expect(
      line({
        type: 'CardsResolved',
        ...at,
        verb: 'shuffled',
        cardCount: 6,
        source: 'discard',
        destination: 'deck',
      })
    ).toBe('player:Blue shuffled discard into deck');
    expect(
      line({
        type: 'CardsResolved',
        ...at,
        verb: 'discarded',
        cardCount: 2,
        source: 'attachmentResolution',
        destination: 'discard',
      })
    ).toBe('player:Blue discarded 2 attached cards');
    expect(
      line({
        type: 'CardsResolved',
        ...at,
        verb: 'left',
        cardCount: 2,
        source: 'attachmentResolution',
        destination: 'play',
      })
    ).toBe('player:Blue left 2 attached cards in play');
    expect(
      line({ type: 'HandReplaced', ...at, mode: 'discard', drawCount: 0 })
    ).toBe('player:Blue discarded hand');
    expect(
      line({
        type: 'HandReplaced',
        ...at,
        mode: 'shuffleIntoDeck',
        drawCount: 5,
      })
    ).toBe('player:Blue shuffled hand into deck and drew 5 cards');
    expect(
      line({
        type: 'CardCategoryChanged',
        ...at,
        category: 'Trainer',
        cardName: 'Pikachu',
      })
    ).toBe('player:Blue changed Pikachu into a tool');
    expect(
      line({
        type: 'AbilityUsed',
        ...at,
        source: 'active',
        cardName: 'Pikachu',
      })
    ).toBe("player:Blue used Pikachu's ability");
    expect(
      line({
        type: 'AbilityUsed',
        ...at,
        source: 'stadium',
        cardName: 'Path to the Peak',
      })
    ).toBe('player:Blue used Path to the Peak');
  });

  it("names a group's cards after its line, counting the ones it hides (ADR-042 §6)", () => {
    const view = createRendererSpikeView();
    const line = (event: PresentationEvent) =>
      messages(presentationEffectsForEvent(event, view))[0];
    const at = { revision: 9, playerId: 'spike-blue' } as const;
    const moved = {
      type: 'CardsResolved',
      ...at,
      verb: 'moved',
      source: 'hand',
    } as const;
    expect(
      line({
        ...moved,
        cardCount: 3,
        destination: 'discard',
        cardNames: ['Fire Energy', 'Fire Energy', 'Switch'],
      })
    ).toBe(
      'player:Blue moved 3 cards from hand to discard: Fire Energy, Fire Energy, Switch'
    );
    // Face-down prizes are named by none.
    expect(
      line({
        ...moved,
        cardCount: 2,
        destination: 'prizes',
        cardNames: [null, null],
      })
    ).toBe('player:Blue moved 2 cards from hand to prizes');
    expect(
      line({
        ...moved,
        source: 'discard',
        cardCount: 3,
        destination: 'board',
        cardNames: ['Pikachu', null, null],
      })
    ).toBe(
      'player:Blue moved 3 cards from discard to board: Pikachu, 2 other cards'
    );
    expect(
      line({
        type: 'PublicCardsRevealed',
        revision: 9,
        actorPlayerId: 'spike-blue',
        playerId: 'spike-blue',
        scope: 'card',
        source: 'hand',
        cardCount: 2,
        cardNames: ['Pikachu', 'Switch'],
      })
    ).toBe("player:Blue revealed 2 cards in Blue's hand: Pikachu, Switch");
    expect(
      line({
        type: 'PublicCardsHidden',
        revision: 9,
        actorPlayerId: 'spike-blue',
        playerId: 'spike-blue',
        scope: 'card',
        source: 'hand',
        cardCount: 2,
      })
    ).toBe("player:Blue hid 2 cards in Blue's hand");
  });

  it('announces an invalid deck when setup had nothing to draw', () => {
    const view = createRendererSpikeView();
    expect(
      messages(
        presentationEffectsForEvent(
          {
            type: 'PlayerSetup',
            revision: 9,
            playerId: 'spike-blue',
            handCount: 0,
            prizeCount: 0,
          },
          view
        )
      )
    ).toEqual([
      'announcement:Blue has no deck loaded',
      'accessibility:Blue has no deck loaded',
    ]);
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
      "announcement:Blue took back Red's last move",
      "accessibility:Blue took back Red's last move",
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

  it('rebuilds only ordered activity entries for a seekable timeline', () => {
    const effects = activityPresentationEffectsForEvents(
      [events[0]!, events[5]!],
      createRendererSpikeView()
    );

    expect(effects.map((effect) => presentationText(effect.message))).toEqual([
      'Blue flipped heads',
      'Turn 3',
      'Blue drew for turn',
    ]);
    expect(effects.every((effect) => effect.kind === 'activity')).toBe(true);
  });

  it('keeps lines as messages, worded in whatever language is up', () => {
    const view = createRendererSpikeView();
    const [line] = activityPresentationEffectsForEvents(
      [
        {
          type: 'CardsDrawn',
          revision: 2,
          playerId: 'spike-blue',
          cardCount: 3,
        },
      ],
      view
    );
    // Names and counts are values; the sentence is the catalog's.
    expect(line!.message.values).toEqual({ name: 'Blue', count: 3 });
    expect(presentationText(line!.message)).toBe('Blue drew 3 cards');
    try {
      i18n.loadAndActivate({
        locale: 'xx',
        messages: {
          [line!.message.id]:
            '{name} a pioché {count, plural, one {une carte} other {# cartes}}',
        },
      });
      expect(presentationText(line!.message)).toBe('Blue a pioché 3 cartes');
    } finally {
      i18n.loadAndActivate({ locale: 'en', messages: {} });
    }
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
