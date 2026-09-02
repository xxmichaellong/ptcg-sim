import type { PresentationEvent } from '@ptcgsim/protocol';

import {
  ReplayPresentationDispatcher,
  type ReplayPresentationSource,
} from '../replay/ReplayPresentationDispatcher.js';
import {
  createPresentationEffectSink,
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
    };

export type GamePresentationFailureReporter = (
  error: unknown,
  context: GamePresentationFailureContext
) => void;

export interface GamePresentationCoordinatorOptions {
  readonly live: SessionPresentationSource;
  readonly replay: ReplayPresentationSource;
  readonly adapters: PresentationEffectAdapters;
  readonly reportFailure?: GamePresentationFailureReporter;
}

/**
 * Owns the live/replay presentation pipelines. Live facts received during
 * replay are consumed silently, so they neither bleed through nor burst later.
 */
export class GamePresentationCoordinator {
  private readonly liveDispatcher: SessionPresentationDispatcher;
  private readonly replayDispatcher: ReplayPresentationDispatcher;
  private disposed = false;

  constructor({
    live,
    replay,
    adapters,
    reportFailure = (error, context) =>
      console.error('Game presentation failed', context, error),
  }: GamePresentationCoordinatorOptions) {
    const reportEffectFailure =
      (source: 'live' | 'replay') =>
      (error: unknown, effect: PresentationEffect, event: PresentationEvent) =>
        reportFailure(error, { stage: 'effect', source, effect, event });
    const liveEffectSink = createPresentationEffectSink(
      () => live.getSnapshot().view,
      adapters,
      reportEffectFailure('live')
    );
    const replayEffectSink = createPresentationEffectSink(
      () => replay.getSnapshot().view,
      adapters,
      reportEffectFailure('replay')
    );
    this.liveDispatcher = new SessionPresentationDispatcher(
      live,
      (event) => {
        if (replay.getSnapshot().mode === 'live') liveEffectSink(event);
      },
      (error, event) =>
        reportFailure(error, { stage: 'event', source: 'live', event })
    );
    this.replayDispatcher = new ReplayPresentationDispatcher(
      replay,
      (event) => {
        if (replay.getSnapshot().mode === 'replay') replayEffectSink(event);
      },
      (error, event) =>
        reportFailure(error, { stage: 'event', source: 'replay', event })
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.liveDispatcher.dispose();
    this.replayDispatcher.dispose();
  }
}
