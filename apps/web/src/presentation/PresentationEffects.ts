import type { MatchViewState } from '@ptcgsim/game-core';
import type { PresentationEvent, ServerMessage } from '@ptcgsim/protocol';

export type ChatMessage = Extract<ServerMessage, { type: 'ChatMessage' }>;
export type PresenceMessage = Extract<ServerMessage, { type: 'Presence' }>;
type PresentationEventType =
  PresentationEvent['type'] | ChatMessage['type'] | PresenceMessage['type'];

interface PresentationEffectBase {
  /** Chat uses the locally observed live revision; it is still not replayed. */
  readonly revision: number;
  readonly eventType: PresentationEventType;
}

export interface ActivityPresentationEffect extends PresentationEffectBase {
  readonly kind: 'activity';
  readonly category: 'player' | 'announcement' | 'message' | 'spectator';
  readonly message: string;
  /** Used only for existing blue/red visual treatment, never message content. */
  readonly playerId?: string;
}

export interface AccessibilityPresentationEffect extends PresentationEffectBase {
  readonly kind: 'accessibility';
  readonly message: string;
  readonly politeness: 'polite';
}

export interface AnimationPresentationEffect extends PresentationEffectBase {
  readonly kind: 'animation';
  readonly eventType: 'CoinFlipped';
  readonly animation: {
    readonly kind: 'coinFlip';
    readonly playerId: string;
    readonly result: 'heads' | 'tails';
  };
}

export type PresentationEffect =
  | ActivityPresentationEffect
  | AccessibilityPresentationEffect
  | AnimationPresentationEffect;

export interface PresentationEffectAdapters {
  readonly appendActivity?: (effect: ActivityPresentationEffect) => void;
  readonly announceAccessibility?: (
    effect: AccessibilityPresentationEffect
  ) => void;
  readonly presentAnimation?: (effect: AnimationPresentationEffect) => void;
}

export type PresentationEffectFailureReporter = (
  error: unknown,
  effect: PresentationEffect,
  event: PresentationEvent
) => void;

export type ChatPresentationEffectFailureReporter = (
  error: unknown,
  effect: PresentationEffect,
  message: ChatMessage
) => void;

export type PresencePresentationEffectFailureReporter = (
  error: unknown,
  effect: PresentationEffect,
  message: PresenceMessage
) => void;

export type PresentationEventSink = (event: PresentationEvent) => void;

export type PresentationView = Pick<MatchViewState, 'players'>;

type PresentationCardSource = Extract<
  PresentationEvent,
  { readonly type: 'PublicCardsRevealed' }
>['source'];

const playerName = (
  view: PresentationView | undefined,
  playerId: string
): string => {
  const displayName = view?.players[playerId]?.displayName.trim();
  // Opaque player IDs are routing metadata, not safe fallback UI labels.
  return displayName ? displayName : 'Player';
};

const cardSourceName = (source: PresentationCardSource): string => {
  switch (source) {
    case 'lostZone':
      return 'lost zone';
    case 'attachmentResolution':
      return 'attached cards';
    case 'deck':
    case 'hand':
    case 'prizes':
    case 'discard':
    case 'board':
    case 'stadium':
    case 'active':
    case 'bench':
    case 'inspection':
      return source;
  }
  const unhandled: never = source;
  return unhandled;
};

/**
 * v1 names the deck-viewer popup "deck" in its messages (`convertZoneName`
 * maps `viewCards` to `deck`); the inspection work area is its counterpart.
 */
const narratedSourceName = (source: PresentationCardSource): string =>
  source === 'inspection' ? 'deck' : cardSourceName(source);

const cardsPhrase = (count: number): string => `${count} card(s)`;

const narratedCardName = (cardName: string | undefined): string =>
  cardName ?? 'card';

const playerEffects = (
  event: PresentationEvent,
  playerId: string,
  message: string
): readonly PresentationEffect[] => [
  activity(event, 'player', message, playerId),
  accessibility(event, message),
];

const activity = (
  event: PresentationEvent,
  category: ActivityPresentationEffect['category'],
  message: string,
  playerId?: string
): ActivityPresentationEffect => ({
  kind: 'activity',
  revision: event.revision,
  eventType: event.type,
  category,
  message,
  ...(playerId ? { playerId } : {}),
});

const accessibility = (
  event: PresentationEvent,
  message: string
): AccessibilityPresentationEffect => ({
  kind: 'accessibility',
  revision: event.revision,
  eventType: event.type,
  message,
  politeness: 'polite',
});

/**
 * Pure exhaustive mapping from a recipient-safe fact to local-only UI effects.
 * Messages use projected display names and never fall back to opaque IDs.
 */
export const presentationEffectsForEvent = (
  event: PresentationEvent,
  view?: PresentationView
): readonly PresentationEffect[] => {
  switch (event.type) {
    case 'CardMoved': {
      const actor = playerName(view, event.playerId);
      const card = narratedCardName(event.cardName);
      const source = narratedSourceName(event.source);
      const target =
        event.targetCardName ??
        (event.destination ? narratedSourceName(event.destination) : 'deck');
      const message = (() => {
        switch (event.verb) {
          case 'moved':
            return `${actor} moved ${card} from ${source} to ${target}`;
          case 'attached':
            return `${actor} attached ${card} from ${source} to ${target}`;
          case 'evolved':
            return `${actor} evolved ${target} into ${card}`;
          case 'shuffledIntoDeck':
            return `${actor} shuffled ${card} from ${source} into deck`;
          case 'movedToDeckTop':
            return `${actor} moved ${card} from ${source} to top of deck`;
          case 'movedToDeckBottom':
            return `${actor} moved ${card} from ${source} to bottom of deck`;
          case 'switchedWithDeckTop':
            return `${actor} switched ${card} from ${source} with top of deck`;
        }
      })();
      return playerEffects(event, event.playerId, message);
    }
    case 'CardsDrawn':
      return playerEffects(
        event,
        event.playerId,
        event.cardCount === 1
          ? `${playerName(view, event.playerId)} drew a card`
          : `${playerName(view, event.playerId)} drew ${event.cardCount} cards`
      );
    case 'ZoneShuffled':
      return playerEffects(
        event,
        event.playerId,
        `${playerName(view, event.playerId)} shuffled ${narratedSourceName(
          event.source
        )}`
      );
    case 'DeckCardsLooked':
      return playerEffects(
        event,
        event.playerId,
        `${playerName(view, event.playerId)} looked at ${event.edge} ${cardsPhrase(
          event.cardCount
        )} of deck`
      );
    case 'CardsResolved': {
      const actor = playerName(view, event.playerId);
      const count = cardsPhrase(event.cardCount);
      const source = narratedSourceName(event.source);
      const message = (() => {
        switch (event.verb) {
          case 'left':
            return `${actor} left ${event.cardCount} attached card(s) in play`;
          case 'discarded':
            return event.source === 'attachmentResolution'
              ? `${actor} discarded ${event.cardCount} attached card(s)`
              : `${actor} discarded ${count}`;
          case 'shuffled':
            if (event.destination === 'deckBottom') {
              return event.source === 'prizes'
                ? `${actor} shuffled prizes to bottom of deck`
                : `${actor} shuffled ${count} to bottom of deck`;
            }
            return event.source === 'discard'
              ? `${actor} shuffled discard into deck`
              : event.source === 'attachmentResolution'
                ? `${actor} shuffled ${event.cardCount} attached card(s) into deck`
                : event.source === 'board'
                  ? `${actor} shuffled ${count} from board to deck`
                  : `${actor} shuffled ${count} into deck`;
          case 'moved': {
            const destination =
              event.destination === 'lostZone'
                ? 'lost zone'
                : event.destination === 'deckBottom'
                  ? 'bottom of deck'
                  : event.destination;
            return `${actor} moved ${count} from ${source} to ${destination}`;
          }
        }
      })();
      return playerEffects(event, event.playerId, message);
    }
    case 'HandReplaced': {
      const actor = playerName(view, event.playerId);
      const base =
        event.mode === 'discard'
          ? `${actor} discarded hand`
          : event.mode === 'shuffleIntoDeck'
            ? `${actor} shuffled hand into deck`
            : `${actor} shuffled hand to bottom of deck`;
      return playerEffects(
        event,
        event.playerId,
        event.drawCount > 0
          ? `${base} and drew ${cardsPhrase(event.drawCount)}`
          : base
      );
    }
    case 'CardCategoryChanged': {
      const typeName =
        event.category === 'Energy'
          ? 'an energy'
          : event.category === 'Pokémon'
            ? 'a Pokémon'
            : event.category === 'Trainer'
              ? 'a tool'
              : 'an unknown type';
      return playerEffects(
        event,
        event.playerId,
        `${playerName(view, event.playerId)} changed ${narratedCardName(
          event.cardName
        )} into ${typeName}`
      );
    }
    case 'AbilityUsed':
      return playerEffects(
        event,
        event.playerId,
        event.source === 'stadium'
          ? `${playerName(view, event.playerId)} used ${narratedCardName(
              event.cardName
            )}`
          : `${playerName(view, event.playerId)} used ${narratedCardName(
              event.cardName
            )}'s ability`
      );
    case 'CoinFlipped': {
      const name = playerName(view, event.playerId);
      const message = `${name} flipped ${event.result}`;
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
        {
          kind: 'animation',
          revision: event.revision,
          eventType: event.type,
          animation: {
            kind: 'coinFlip',
            playerId: event.playerId,
            result: event.result,
          },
        },
      ];
    }
    case 'PlayerReset': {
      const message = `${playerName(view, event.playerId)} reset`;
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'DeckLoaded': {
      const message = `${playerName(view, event.playerId)} loaded deck`;
      return [
        activity(event, 'announcement', message),
        accessibility(event, message),
      ];
    }
    case 'PlayerSetup': {
      // Set Up with no deck loaded still resets the board, but there is
      // nothing to draw. v1 announces that as an invalid deck rather than
      // claiming a hand was drawn.
      if (event.handCount === 0 && event.prizeCount === 0) {
        const message = `${playerName(view, event.playerId)} has an invalid deck!`;
        return [
          activity(event, 'announcement', message),
          accessibility(event, message),
        ];
      }
      const message = `${playerName(
        view,
        event.playerId
      )} drew starting hand and set prizes`;
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'RandomCardPlayedFaceDown': {
      const message = `${playerName(
        view,
        event.actorPlayerId
      )} moved a random card from ${playerName(
        view,
        event.targetPlayerId
      )}'s hand to board`;
      return [
        activity(event, 'player', message, event.actorPlayerId),
        accessibility(event, message),
      ];
    }
    case 'TurnStarted': {
      const name = playerName(view, event.playerId);
      return [
        activity(event, 'announcement', `Turn ${event.turnNumber}`),
        activity(event, 'player', `${name} drew for turn`, event.playerId),
        accessibility(event, `${name} started turn ${event.turnNumber}`),
      ];
    }
    case 'TurnStartFailedNoDeck': {
      const message = `${playerName(
        view,
        event.playerId
      )} has no more cards in deck!`;
      return [
        activity(event, 'announcement', message),
        accessibility(event, message),
      ];
    }
    case 'AttackDeclared': {
      const message = `${playerName(view, event.playerId)} attacked`;
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'PassDeclared': {
      const message = `${playerName(view, event.playerId)} passed`;
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'PublicCardsRevealed': {
      const actor = playerName(view, event.actorPlayerId);
      const owner = playerName(view, event.playerId);
      const source = cardSourceName(event.source);
      const message =
        event.scope === 'zone'
          ? `${actor} revealed ${owner}'s ${source}`
          : `${actor} revealed ${event.cardName ?? 'card'} in ${owner}'s ${source}`;
      return [
        activity(event, 'player', message, event.actorPlayerId),
        accessibility(event, message),
      ];
    }
    case 'PublicCardsHidden': {
      const actor = playerName(view, event.actorPlayerId);
      const owner = playerName(view, event.playerId);
      const source = cardSourceName(event.source);
      const message =
        event.scope === 'zone'
          ? `${actor} hid ${owner}'s ${source}`
          : `${actor} hid card in ${owner}'s ${source}`;
      return [
        activity(event, 'player', message, event.actorPlayerId),
        accessibility(event, message),
      ];
    }
    case 'PrivateInspectionStarted': {
      const viewer = playerName(view, event.viewerPlayerId);
      const owner = playerName(view, event.sourcePlayerId);
      const source = cardSourceName(event.source);
      const message =
        event.scope === 'zone'
          ? `${viewer} looked at ${owner}'s ${source}`
          : `${viewer} looked at card in ${owner}'s ${source}`;
      return [
        activity(event, 'player', message, event.viewerPlayerId),
        accessibility(event, message),
      ];
    }
    case 'PrivateInspectionEnded': {
      const viewer = playerName(view, event.viewerPlayerId);
      const owner = playerName(view, event.sourcePlayerId);
      const source = cardSourceName(event.source);
      const message =
        event.scope === 'zone'
          ? `${viewer} stopped looking at ${owner}'s ${source}`
          : `${viewer} stopped looking at card in ${owner}'s ${source}`;
      return [
        activity(event, 'player', message, event.viewerPlayerId),
        accessibility(event, message),
      ];
    }
    case 'UndoApplied': {
      const actorName = playerName(view, event.actorPlayerId);
      const targetName = playerName(view, event.targetPlayerId);
      const message =
        event.actorPlayerId === event.targetPlayerId
          ? `${targetName} took back their last move!`
          : `${actorName} took back ${targetName}'s last move!`;
      return [
        activity(event, 'announcement', message),
        accessibility(event, message),
      ];
    }
    case 'OncePerGameMarkerSet': {
      const marker = event.marker === 'gx' ? 'GX' : 'VSTAR';
      const message = event.used
        ? `${playerName(view, event.playerId)} used their ${marker}!`
        : `${playerName(view, event.playerId)} reset their ${marker}`;
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'MulliganDeclared': {
      const message = `${playerName(view, event.playerId)} mulligans`;
      return [
        activity(event, 'announcement', message),
        accessibility(event, message),
      ];
    }
    case 'DeckViewDeclared': {
      const name = playerName(view, event.playerId);
      const message = `${name} is looking through ${name}'s deck`;
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
  }
  const unhandled: never = event;
  return unhandled;
};

/** Rebuilds seekable activity state without replaying one-shot local effects. */
export const activityPresentationEffectsForEvents = (
  events: readonly PresentationEvent[],
  view?: PresentationView
): readonly ActivityPresentationEffect[] =>
  events.flatMap((event) =>
    presentationEffectsForEvent(event, view).filter(
      (effect): effect is ActivityPresentationEffect =>
        effect.kind === 'activity'
    )
  );

/** Maps authenticated ephemeral chat into the same bounded local feed. */
export const presentationEffectsForChatMessage = (
  message: ChatMessage,
  observedRevision = 0
): readonly PresentationEffect[] => {
  const visibleMessage = `${message.displayName}: ${message.message}`;
  return [
    {
      kind: 'activity',
      revision: observedRevision,
      eventType: 'ChatMessage',
      category: message.playerId ? 'message' : 'spectator',
      message: visibleMessage,
      ...(message.playerId ? { playerId: message.playerId } : {}),
    },
    {
      kind: 'accessibility',
      revision: observedRevision,
      eventType: 'ChatMessage',
      message: visibleMessage,
      politeness: 'polite',
    },
  ];
};

/** Maps authenticated session lifecycle into the legacy announcement style. */
export const presentationEffectsForPresence = (
  presence: PresenceMessage,
  observedRevision = 0
): readonly PresentationEffect[] => {
  const message =
    presence.status === 'joined'
      ? `${presence.displayName} joined`
      : presence.status === 'disconnected'
        ? `${presence.displayName} disconnected`
        : presence.status === 'reconnected'
          ? `${presence.displayName} reconnected!`
          : `${presence.displayName} left the room`;
  return [
    {
      kind: 'activity',
      revision: observedRevision,
      eventType: 'Presence',
      category: 'announcement',
      message,
    },
    {
      kind: 'accessibility',
      revision: observedRevision,
      eventType: 'Presence',
      message,
      politeness: 'polite',
    },
  ];
};

const deliverEffect = (
  effect: PresentationEffect,
  adapters: PresentationEffectAdapters
): void => {
  switch (effect.kind) {
    case 'activity':
      adapters.appendActivity?.(effect);
      return;
    case 'accessibility':
      adapters.announceAccessibility?.(effect);
      return;
    case 'animation':
      adapters.presentAnimation?.(effect);
      return;
  }
  const unhandled: never = effect;
  return unhandled;
};

/** Creates the same isolated sink for live publications and replay playback. */
export const createPresentationEffectSink =
  (
    getView: () => PresentationView | undefined,
    adapters: PresentationEffectAdapters,
    reportFailure: PresentationEffectFailureReporter = (error, effect) =>
      console.error('Presentation effect failed', effect, error),
    shouldDeliver: () => boolean = () => true
  ): PresentationEventSink =>
  (event) => {
    const effects = presentationEffectsForEvent(event, getView());
    for (const effect of effects) {
      if (!shouldDeliver()) return;
      try {
        deliverEffect(effect, adapters);
      } catch (error) {
        try {
          reportFailure(error, effect, event);
        } catch {
          // One diagnostics adapter cannot suppress later UI effects.
        }
      }
    }
  };

/** Creates the live-only isolated sink for authenticated ephemeral chat. */
export const createChatPresentationEffectSink =
  (
    getObservedRevision: () => number,
    adapters: PresentationEffectAdapters,
    reportFailure: ChatPresentationEffectFailureReporter = (error, effect) =>
      console.error('Chat presentation effect failed', effect, error),
    shouldDeliver: () => boolean = () => true
  ) =>
  (message: ChatMessage): void => {
    if (!shouldDeliver()) return;
    for (const effect of presentationEffectsForChatMessage(
      message,
      getObservedRevision()
    )) {
      try {
        deliverEffect(effect, adapters);
      } catch (error) {
        try {
          reportFailure(error, effect, message);
        } catch {
          // Diagnostics must not prevent later deterministic effects.
        }
      }
    }
  };

/** Creates the live-only isolated sink for authenticated presence notices. */
export const createPresencePresentationEffectSink =
  (
    getObservedRevision: () => number,
    adapters: PresentationEffectAdapters,
    reportFailure: PresencePresentationEffectFailureReporter = (
      error,
      effect
    ) => console.error('Presence presentation effect failed', effect, error),
    shouldDeliver: () => boolean = () => true
  ) =>
  (presence: PresenceMessage): void => {
    if (!shouldDeliver()) return;
    for (const effect of presentationEffectsForPresence(
      presence,
      getObservedRevision()
    )) {
      try {
        deliverEffect(effect, adapters);
      } catch (error) {
        try {
          reportFailure(error, effect, presence);
        } catch {
          // Diagnostics must not prevent later deterministic effects.
        }
      }
    }
  };
