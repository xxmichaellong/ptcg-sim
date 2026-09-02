import type { MatchViewState } from '@ptcgsim/game-core';
import type { PresentationEvent } from '@ptcgsim/protocol';

type PresentationEventType = PresentationEvent['type'];

interface PresentationEffectBase {
  readonly revision: number;
  readonly eventType: PresentationEventType;
}

export interface ActivityPresentationEffect extends PresentationEffectBase {
  readonly kind: 'activity';
  readonly category: 'player' | 'announcement';
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

export type PresentationEventSink = (event: PresentationEvent) => void;

export type PresentationView = Pick<MatchViewState, 'players'>;

const playerName = (
  view: PresentationView | undefined,
  playerId: string
): string => {
  const displayName = view?.players[playerId]?.displayName.trim();
  // Opaque player IDs are routing metadata, not safe fallback UI labels.
  return displayName ? displayName : 'Player';
};

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
      const message = `${event.cardCount} of ${playerName(
        view,
        event.playerId
      )}'s cards ${event.cardCount === 1 ? 'was' : 'were'} revealed`;
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'PublicCardsHidden': {
      const message = `${event.cardCount} of ${playerName(
        view,
        event.playerId
      )}'s cards ${event.cardCount === 1 ? 'was' : 'were'} hidden`;
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'PrivateInspectionStarted': {
      const message = `${playerName(
        view,
        event.viewerPlayerId
      )} looked at ${event.cardCount} of ${playerName(
        view,
        event.sourcePlayerId
      )}'s cards`;
      return [
        activity(event, 'player', message, event.viewerPlayerId),
        accessibility(event, message),
      ];
    }
    case 'PrivateInspectionEnded': {
      const message = `${playerName(
        view,
        event.viewerPlayerId
      )} stopped looking at ${event.cardCount} of ${playerName(
        view,
        event.sourcePlayerId
      )}'s cards`;
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
