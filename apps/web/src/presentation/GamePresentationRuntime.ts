import type { ReplayPresentationSource } from '../replay/ReplayPresentationDispatcher.js';
import {
  GamePresentationCoordinator,
  type GamePresentationFailureReporter,
} from './GamePresentationCoordinator.js';
import {
  PresentationConsumerRuntime,
  type PresentationConsumerRuntimeOptions,
} from './PresentationConsumerRuntime.js';
import type { PresentationRuntimePolicy } from './PresentationRuntime.js';
import { PresentationRuntime } from './PresentationRuntime.js';
import type { SessionPresentationSource } from './SessionPresentationDispatcher.js';

export interface GamePresentationRuntimeOptions {
  readonly live: SessionPresentationSource;
  readonly replay: ReplayPresentationSource;
  readonly policy?: Partial<PresentationRuntimePolicy>;
  readonly reportFailure?: GamePresentationFailureReporter;
  /** v1's solo table announces no arrivals or departures; multiplayer does. */
  readonly announcePresence?: boolean;
  /** Optional renderer-facing consumers owned at the same lifecycle boundary. */
  readonly consumers?: PresentationConsumerRuntimeOptions;
}

/**
 * Complete owner for local presentation state and its live/replay subscriptions.
 * Construct once per route/session owner and dispose it at the same boundary.
 */
export class GamePresentationRuntime extends PresentationRuntime {
  private readonly coordinator: GamePresentationCoordinator;
  readonly consumers?: PresentationConsumerRuntime;

  constructor({
    live,
    replay,
    policy,
    reportFailure,
    announcePresence,
    consumers,
  }: GamePresentationRuntimeOptions) {
    super(policy);
    this.coordinator = new GamePresentationCoordinator({
      live,
      replay,
      adapters: this.adapters,
      ...(announcePresence === undefined ? {} : { announcePresence }),
      replaceReplayActivity: this.replaceActivity,
      clearTransientEffects: this.clearTransientEffects,
      bindPresentationIdentity: this.bindIdentity,
      ...(reportFailure ? { reportFailure } : {}),
    });
    try {
      if (consumers)
        this.consumers = new PresentationConsumerRuntime(this, consumers);
    } catch (error) {
      try {
        this.coordinator.dispose();
      } finally {
        super.dispose();
      }
      throw error;
    }
  }

  override dispose(): void {
    try {
      this.coordinator.dispose();
    } finally {
      try {
        this.consumers?.dispose();
      } finally {
        super.dispose();
      }
    }
  }
}
