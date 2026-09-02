import type { ReplayPresentationSource } from '../replay/ReplayPresentationDispatcher.js';
import {
  GamePresentationCoordinator,
  type GamePresentationFailureReporter,
} from './GamePresentationCoordinator.js';
import type { PresentationRuntimePolicy } from './PresentationRuntime.js';
import { PresentationRuntime } from './PresentationRuntime.js';
import type { SessionPresentationSource } from './SessionPresentationDispatcher.js';

export interface GamePresentationRuntimeOptions {
  readonly live: SessionPresentationSource;
  readonly replay: ReplayPresentationSource;
  readonly policy?: Partial<PresentationRuntimePolicy>;
  readonly reportFailure?: GamePresentationFailureReporter;
}

/**
 * Complete owner for local presentation state and its live/replay subscriptions.
 * Construct once per route/session owner and dispose it at the same boundary.
 */
export class GamePresentationRuntime extends PresentationRuntime {
  private readonly coordinator: GamePresentationCoordinator;

  constructor({
    live,
    replay,
    policy,
    reportFailure,
  }: GamePresentationRuntimeOptions) {
    super(policy);
    this.coordinator = new GamePresentationCoordinator({
      live,
      replay,
      adapters: this.adapters,
      replaceReplayActivity: this.replaceActivity,
      clearTransientEffects: this.clearTransientEffects,
      bindPresentationIdentity: this.bindIdentity,
      ...(reportFailure ? { reportFailure } : {}),
    });
  }

  override dispose(): void {
    this.coordinator.dispose();
    super.dispose();
  }
}
