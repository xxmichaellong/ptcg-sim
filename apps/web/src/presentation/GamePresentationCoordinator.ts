import type { PresentationEvent } from '@ptcgsim/protocol';

import {
  ReplayPresentationDispatcher,
  type ReplayPresentationSource,
} from '../replay/ReplayPresentationDispatcher.js';
import {
  activityPresentationEffectsForEvents,
  createPresentationEffectSink,
  type ActivityPresentationEffect,
  type PresentationEffect,
  type PresentationEffectAdapters,
} from './PresentationEffects.js';
import {
  SessionPresentationDispatcher,
  type SessionPresentationSource,
} from './SessionPresentationDispatcher.js';

export type GamePresentationFailureContext =
  | {
      readonly stage: 'event';
      readonly source: 'live' | 'replay';
      readonly event: PresentationEvent;
    }
  | {
      readonly stage: 'effect';
      readonly source: 'live' | 'replay';
      readonly event: PresentationEvent;
      readonly effect: PresentationEffect;
    }
  | {
      readonly stage: 'timeline';
      readonly source: 'replay';
      readonly events: readonly PresentationEvent[];
    }
  | {
      readonly stage: 'lifecycle';
      readonly source: 'replay';
      readonly operation: 'clearTransientEffects';
      readonly reason: 'mode_changed' | 'replay_replaced' | 'rewound';
    }
  | {
      readonly stage: 'lifecycle';
      readonly source: 'live';
      readonly operation: 'bindPresentationIdentity';
      readonly identity?: string;
    };

export type GamePresentationFailureReporter = (
  error: unknown,
  context: GamePresentationFailureContext
) => void;

export interface GamePresentationCoordinatorOptions {
  readonly live: SessionPresentationSource;
  readonly replay: ReplayPresentationSource;
  readonly adapters: PresentationEffectAdapters;
  /** Replaces seekable replay log state instead of appending crossed entries. */
  readonly replaceReplayActivity?: (
    effects: readonly ActivityPresentationEffect[]
  ) => void;
  /** Cancels queued one-shot work after a mode change or backward seek. */
  readonly clearTransientEffects?: () => void;
  /** Clears local data when the authoritative room/viewer identity changes. */
  readonly bindPresentationIdentity?: (identity?: string) => void;
  readonly reportFailure?: GamePresentationFailureReporter;
}

const withoutActivityAdapter = (
  adapters: PresentationEffectAdapters
): PresentationEffectAdapters => ({
  ...(adapters.announceAccessibility
    ? { announceAccessibility: adapters.announceAccessibility }
    : {}),
  ...(adapters.presentAnimation
    ? { presentAnimation: adapters.presentAnimation }
    : {}),
});

/**
 * Owns the live/replay presentation pipelines. Live facts received during
 * replay are consumed silently, so they neither bleed through nor burst later.
 */
export class GamePresentationCoordinator {
  private readonly liveDispatcher: SessionPresentationDispatcher;
  private readonly replayDispatcher: ReplayPresentationDispatcher;
  private readonly unsubscribeLiveState: () => void;
  private readonly unsubscribeReplayState: () => void;
  private disposed = false;

  constructor({
    live,
    replay,
    adapters,
    replaceReplayActivity,
    clearTransientEffects,
    bindPresentationIdentity,
    reportFailure = (error, context) =>
      console.error('Game presentation failed', context, error),
  }: GamePresentationCoordinatorOptions) {
    const reportSafely = (
      error: unknown,
      context: GamePresentationFailureContext
    ): void => {
      try {
        reportFailure(error, context);
      } catch {
        // Diagnostics must not prevent later deterministic effects.
      }
    };
    const reportEffectFailure =
      (source: 'live' | 'replay') =>
      (error: unknown, effect: PresentationEffect, event: PresentationEvent) =>
        reportSafely(error, { stage: 'effect', source, effect, event });

    const presentationIdentity = (): string | undefined => {
      const session = live.getSnapshot();
      if (
        session.phase === 'closed' ||
        session.phase === 'failed' ||
        session.phase === 'superseded' ||
        !session.view
      )
        return undefined;
      const viewer =
        session.view.viewer.kind === 'player'
          ? `player:${session.view.viewer.playerId}`
          : 'spectator';
      return JSON.stringify([session.view.matchId, viewer]);
    };
    let hasSynchronizedIdentity = false;
    let synchronizedIdentity: string | undefined;
    const synchronizeLiveIdentity = (): void => {
      if (this.disposed || !bindPresentationIdentity) return;
      const identity = presentationIdentity();
      if (hasSynchronizedIdentity && identity === synchronizedIdentity) return;
      hasSynchronizedIdentity = true;
      synchronizedIdentity = identity;
      try {
        bindPresentationIdentity(identity);
      } catch (error) {
        reportSafely(error, {
          stage: 'lifecycle',
          source: 'live',
          operation: 'bindPresentationIdentity',
          ...(identity ? { identity } : {}),
        });
      }
    };

    if (bindPresentationIdentity) {
      synchronizeLiveIdentity();
      this.unsubscribeLiveState = live.subscribe(synchronizeLiveIdentity);
    } else {
      this.unsubscribeLiveState = () => undefined;
    }

    let previousReplayState = replay.getSnapshot();
    let synchronizedPlayback: typeof previousReplayState.playback | undefined;
    let synchronizingPlayback: typeof previousReplayState.playback | undefined;
    const synchronizeReplayState = (): void => {
      if (this.disposed) return;
      const state = replay.getSnapshot();
      const previousPlayback =
        previousReplayState.mode === 'replay' &&
        previousReplayState.playback.phase === 'ready'
          ? previousReplayState.playback
          : undefined;
      const playback =
        state.mode === 'replay' && state.playback.phase === 'ready'
          ? state.playback
          : undefined;
      const modeChanged = state.mode !== previousReplayState.mode;
      const replayReplaced = Boolean(
        playback &&
        previousPlayback &&
        playback.replayId !== previousPlayback.replayId
      );
      const rewound = Boolean(
        playback &&
        previousPlayback &&
        playback.replayId === previousPlayback.replayId &&
        playback.frameIndex < previousPlayback.frameIndex
      );

      // Advance cursors before calling application code so reentrant replay
      // publications cannot duplicate timeline or lifecycle work.
      previousReplayState = state;
      if (modeChanged || replayReplaced || rewound) {
        try {
          clearTransientEffects?.();
        } catch (error) {
          reportSafely(error, {
            stage: 'lifecycle',
            source: 'replay',
            operation: 'clearTransientEffects',
            reason: modeChanged
              ? 'mode_changed'
              : replayReplaced
                ? 'replay_replaced'
                : 'rewound',
          });
        }
      }

      if (!playback) {
        synchronizedPlayback = undefined;
        return;
      }
      if (
        playback === synchronizedPlayback ||
        playback === synchronizingPlayback
      )
        return;
      if (!replaceReplayActivity) {
        synchronizedPlayback = playback;
        return;
      }
      synchronizingPlayback = playback;
      try {
        replaceReplayActivity(
          activityPresentationEffectsForEvents(
            playback.timelinePresentationEvents,
            state.view
          )
        );
        synchronizedPlayback = playback;
      } catch (error) {
        reportSafely(error, {
          stage: 'timeline',
          source: 'replay',
          events: playback.timelinePresentationEvents,
        });
      } finally {
        synchronizingPlayback = undefined;
      }
    };

    if (replaceReplayActivity || clearTransientEffects) {
      synchronizeReplayState();
      this.unsubscribeReplayState = replay.subscribe(synchronizeReplayState);
    } else {
      this.unsubscribeReplayState = () => undefined;
    }

    const liveEffectSink = createPresentationEffectSink(
      () => live.getSnapshot().view,
      adapters,
      reportEffectFailure('live'),
      () => replay.getSnapshot().mode === 'live'
    );
    const replayEffectSink = createPresentationEffectSink(
      () => replay.getSnapshot().view,
      replaceReplayActivity ? withoutActivityAdapter(adapters) : adapters,
      reportEffectFailure('replay'),
      () => replay.getSnapshot().mode === 'replay'
    );
    this.liveDispatcher = new SessionPresentationDispatcher(
      live,
      (event) => {
        if (replay.getSnapshot().mode === 'live') liveEffectSink(event);
      },
      (error, event) =>
        reportSafely(error, { stage: 'event', source: 'live', event })
    );
    this.replayDispatcher = new ReplayPresentationDispatcher(
      replay,
      (event) => {
        if (replay.getSnapshot().mode === 'replay') replayEffectSink(event);
      },
      (error, event) =>
        reportSafely(error, { stage: 'event', source: 'replay', event })
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeLiveState();
    this.unsubscribeReplayState();
    this.liveDispatcher.dispose();
    this.replayDispatcher.dispose();
  }
}
