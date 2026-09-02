import type { MatchViewState } from '@ptcgsim/game-core';
import { MAX_REPLAY_FRAMES, type PresentationEvent } from '@ptcgsim/protocol';

import type { ProjectedReplayArtifact } from './model.js';

export type ReplayPlaybackAction =
  'restart' | 'previous' | 'next' | 'fastForward';

export interface EmptyReplayPlaybackState {
  readonly phase: 'empty';
  readonly generation: number;
}

export interface ReadyReplayPlaybackState {
  readonly phase: 'ready';
  readonly generation: number;
  readonly replayId: string;
  readonly frameIndex: number;
  readonly frameCount: number;
  readonly startRevision: number;
  readonly endRevision: number;
  readonly truncated: boolean;
  readonly view: MatchViewState;
  readonly atStart: boolean;
  readonly atEnd: boolean;
  /** Complete deterministic log/timeline through the installed frame. */
  readonly timelinePresentationEvents: readonly PresentationEvent[];
  /** Events crossed by this forward generation; effects dedupe by generation. */
  readonly enteredPresentationEvents: readonly PresentationEvent[];
}

export type ReplayPlaybackState =
  EmptyReplayPlaybackState | ReadyReplayPlaybackState;

export class InvalidProjectedReplayError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid projected replay:\n${problems.join('\n')}`);
    this.name = 'InvalidProjectedReplayError';
    this.problems = problems;
  }
}

const sameViewer = (
  left: MatchViewState['viewer'],
  right: MatchViewState['viewer']
): boolean =>
  left.kind === right.kind &&
  (left.kind === 'spectator' ||
    (right.kind === 'player' && left.playerId === right.playerId));

const samePlayerOrder = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  left.every((playerId, index) => playerId === right[index]);

export const collectProjectedReplayProblems = (
  artifact: ProjectedReplayArtifact
): readonly string[] => {
  const problems: string[] = [];
  if (artifact.replayId.length < 1 || artifact.replayId.length > 128) {
    problems.push('replay ID must be a bounded non-empty string');
  }
  if (
    !Number.isSafeInteger(artifact.startRevision) ||
    artifact.startRevision < 0 ||
    !Number.isSafeInteger(artifact.endRevision) ||
    artifact.endRevision < artifact.startRevision
  ) {
    problems.push('replay revision bounds are invalid');
  }
  if (
    artifact.frames.length < 1 ||
    artifact.frames.length > MAX_REPLAY_FRAMES
  ) {
    problems.push('replay frame count is outside the protocol bound');
  }
  if (
    artifact.frames.length !==
    artifact.endRevision - artifact.startRevision + 1
  ) {
    problems.push('replay frame count does not cover its revision range');
  }
  if (artifact.truncated !== artifact.startRevision > 0) {
    problems.push('replay truncation marker does not match its start revision');
  }

  const first = artifact.frames[0];
  const matchId = first?.snapshot.matchId;
  const playerOrder = first?.snapshot.playerOrder;
  for (const [index, frame] of artifact.frames.entries()) {
    if (frame.snapshot.revision !== artifact.startRevision + index) {
      problems.push(`replay frame ${index} has a noncontiguous revision`);
    }
    if (frame.snapshot.matchId !== matchId) {
      problems.push(`replay frame ${index} belongs to another match`);
    }
    if (
      playerOrder &&
      !samePlayerOrder(frame.snapshot.playerOrder, playerOrder)
    ) {
      problems.push(`replay frame ${index} changes player order`);
    }
    if (!sameViewer(frame.snapshot.viewer, artifact.viewer)) {
      problems.push(`replay frame ${index} has another viewer perspective`);
    }
    if (
      frame.presentationEvents.some(
        (event) => event.revision !== frame.snapshot.revision
      )
    ) {
      problems.push(`replay frame ${index} has an event at another revision`);
    }
    if (index === 0 && frame.presentationEvents.length > 0) {
      problems.push('replay base frame cannot contain presentation events');
    }
  }
  return problems;
};

export const assertProjectedReplayArtifact = (
  artifact: ProjectedReplayArtifact
): void => {
  const problems = collectProjectedReplayProblems(artifact);
  if (problems.length > 0) throw new InvalidProjectedReplayError(problems);
};

/**
 * Read-only client playback over an already role-projected artifact. It never
 * owns a live session, submits a command, or re-executes canonical events.
 */
export class ReplayPlaybackController {
  private readonly listeners = new Set<() => void>();
  private artifact?: ProjectedReplayArtifact;
  private generation = 0;
  private state: ReplayPlaybackState = { phase: 'empty', generation: 0 };

  constructor(artifact?: ProjectedReplayArtifact) {
    if (artifact) this.load(artifact);
  }

  getSnapshot = (): ReplayPlaybackState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  load(artifact: ProjectedReplayArtifact): void {
    assertProjectedReplayArtifact(artifact);
    this.artifact = artifact;
    this.installFrame(0, []);
  }

  clear(): boolean {
    if (!this.artifact) return false;
    this.artifact = undefined;
    this.generation += 1;
    this.state = { phase: 'empty', generation: this.generation };
    this.emit();
    return true;
  }

  dispatch(action: ReplayPlaybackAction): boolean {
    switch (action) {
      case 'restart':
        return this.restart();
      case 'previous':
        return this.stepPrevious();
      case 'next':
        return this.stepNext();
      case 'fastForward':
        return this.fastForward();
    }
  }

  restart(): boolean {
    const current = this.readyState();
    if (!current || current.frameIndex === 0) return false;
    this.installFrame(0, []);
    return true;
  }

  stepPrevious(): boolean {
    const current = this.readyState();
    if (!current || current.frameIndex === 0) return false;
    this.installFrame(current.frameIndex - 1, []);
    return true;
  }

  stepNext(): boolean {
    const current = this.readyState();
    const artifact = this.artifact;
    if (
      !current ||
      !artifact ||
      current.frameIndex >= artifact.frames.length - 1
    ) {
      return false;
    }
    const nextIndex = current.frameIndex + 1;
    this.installFrame(
      nextIndex,
      artifact.frames[nextIndex]!.presentationEvents
    );
    return true;
  }

  fastForward(): boolean {
    const current = this.readyState();
    const artifact = this.artifact;
    if (
      !current ||
      !artifact ||
      current.frameIndex >= artifact.frames.length - 1
    ) {
      return false;
    }
    const finalIndex = artifact.frames.length - 1;
    const enteredPresentationEvents = artifact.frames
      .slice(current.frameIndex + 1, finalIndex + 1)
      .flatMap((frame) => frame.presentationEvents);
    this.installFrame(finalIndex, enteredPresentationEvents);
    return true;
  }

  private readyState(): ReadyReplayPlaybackState | undefined {
    return this.state.phase === 'ready' ? this.state : undefined;
  }

  private installFrame(
    frameIndex: number,
    enteredPresentationEvents: readonly PresentationEvent[]
  ): void {
    const artifact = this.artifact;
    if (!artifact)
      throw new Error('Cannot install a replay frame without an artifact');
    const frame = artifact.frames[frameIndex];
    if (!frame) throw new Error('Replay frame index is outside the artifact');
    this.generation += 1;
    this.state = {
      phase: 'ready',
      generation: this.generation,
      replayId: artifact.replayId,
      frameIndex,
      frameCount: artifact.frames.length,
      startRevision: artifact.startRevision,
      endRevision: artifact.endRevision,
      truncated: artifact.truncated,
      view: frame.snapshot,
      atStart: frameIndex === 0,
      atEnd: frameIndex === artifact.frames.length - 1,
      timelinePresentationEvents: artifact.frames
        .slice(0, frameIndex + 1)
        .flatMap((candidate) => candidate.presentationEvents),
      enteredPresentationEvents,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
