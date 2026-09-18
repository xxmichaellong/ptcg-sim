import type {
  KnownViewCard,
  MatchViewState,
  ViewCardDefinition,
} from '@ptcgsim/game-core';
import {
  MAX_DECK_CARDS,
  MAX_REPLAY_FRAMES,
  type PresentationEvent,
} from '@ptcgsim/protocol';

import type { ProjectedReplayArtifact } from './model.js';

export type ReplayPlaybackAction =
  'restart' | 'previous' | 'next' | 'fastForward';

export interface EmptyReplayPlaybackState {
  readonly phase: 'empty';
  readonly generation: number;
}

interface ReplayLocalDisclosureState {
  readonly definitions: readonly ViewCardDefinition[];
  readonly zoneIds: readonly string[];
  readonly cards: readonly KnownViewCard[];
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
  /** Solo-only display data. It is never merged into the authoritative view. */
  readonly localDisclosure?: ReplayLocalDisclosureState;
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

const hasUniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const sameStringSet = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  hasUniqueStrings(left) &&
  hasUniqueStrings(right) &&
  left.every((value) => right.includes(value));

const projectedCardIds = (view: MatchViewState): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const zone of Object.values(view.zones)) {
    for (const card of zone.cards) ids.add(card.id);
  }
  for (const stack of Object.values(view.stacks)) {
    for (const card of stack.evolutionCards) ids.add(card.id);
    for (const card of stack.attachmentCards) ids.add(card.id);
  }
  for (const workArea of Object.values(view.workAreas)) {
    if (workArea.inspection) {
      for (const card of workArea.inspection.cards) ids.add(card.id);
    }
    if (workArea.attachmentResolution) {
      for (const card of workArea.attachmentResolution.evolutionCards)
        ids.add(card.id);
      for (const card of workArea.attachmentResolution.attachmentCards)
        ids.add(card.id);
    }
  }
  return ids;
};

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

  const carriesLocalDisclosure =
    artifact.localDisclosureDefinitions !== undefined;
  const localDefinitionIds = new Set<string>();
  const referencedLocalDefinitionIds = new Set<string>();
  if (carriesLocalDisclosure) {
    if (artifact.viewer.kind !== 'player') {
      problems.push('replay local disclosure requires a player perspective');
    }
    if (
      (artifact.localDisclosureDefinitions?.length ?? 0) >
      MAX_DECK_CARDS * 2
    ) {
      problems.push('replay local disclosure catalog exceeds its bound');
    }
    for (const definition of artifact.localDisclosureDefinitions ?? []) {
      if (localDefinitionIds.has(definition.id)) {
        problems.push('replay local disclosure definition IDs must be unique');
      }
      localDefinitionIds.add(definition.id);
    }
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

    if (!carriesLocalDisclosure && frame.localDisclosure) {
      problems.push(
        `replay frame ${index} has local disclosure without a catalog`
      );
    }
    if (carriesLocalDisclosure && !frame.localDisclosure) {
      problems.push(`replay frame ${index} is missing local disclosure`);
    }
    if (!frame.localDisclosure || artifact.viewer.kind !== 'player') continue;
    const viewerPlayerId = artifact.viewer.playerId;
    if (
      frame.localDisclosure.zoneIds.length > 3 ||
      frame.localDisclosure.cards.length > MAX_DECK_CARDS * 2
    ) {
      problems.push(`replay frame ${index} local disclosure exceeds its bound`);
    }

    const eligibleZones = Object.values(frame.snapshot.zones).filter(
      (zone) =>
        zone.ownerId !== null &&
        (zone.kind === 'prizes' ||
          (zone.kind === 'hand' && zone.ownerId !== viewerPlayerId))
    );
    const eligibleZoneIds = eligibleZones.map((zone) => zone.id);
    if (!sameStringSet(frame.localDisclosure.zoneIds, eligibleZoneIds)) {
      problems.push(
        `replay frame ${index} local disclosure zones are not the exact eligible zones`
      );
    }

    const concealedCards = new Map(
      eligibleZones.flatMap((zone) =>
        zone.cards
          .filter((card) => card.kind === 'concealed')
          .map((card) => [card.id, card] as const)
      )
    );
    const disclosureCardIds = frame.localDisclosure.cards.map(
      (card) => card.id
    );
    if (!sameStringSet(disclosureCardIds, [...concealedCards.keys()])) {
      problems.push(
        `replay frame ${index} local disclosure cards do not exactly cover concealed eligible cards`
      );
    }
    for (const card of frame.localDisclosure.cards) {
      if (
        card.kind !== 'known' ||
        card.face !== 'up' ||
        card.publiclyRevealed
      ) {
        problems.push(
          `replay frame ${index} local disclosure card visibility is invalid`
        );
      }
      const concealed = concealedCards.get(card.id);
      if (!concealed || concealed.ownerId !== card.ownerId) {
        problems.push(
          `replay frame ${index} local disclosure card ownership is inconsistent`
        );
      }
      if (!localDefinitionIds.has(card.definitionId)) {
        problems.push(
          `replay frame ${index} local disclosure references an unknown definition`
        );
      }
      referencedLocalDefinitionIds.add(card.definitionId);
    }
    const frameCardIds = projectedCardIds(frame.snapshot);
    for (const definitionId of localDefinitionIds) {
      if (
        frame.snapshot.definitions[definitionId] ||
        frameCardIds.has(definitionId)
      ) {
        problems.push(
          `replay frame ${index} local disclosure collides with a projected identifier`
        );
      }
    }
  }
  for (const definitionId of localDefinitionIds) {
    if (!referencedLocalDefinitionIds.has(definitionId)) {
      problems.push(
        'replay local disclosure contains an unreferenced definition'
      );
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
      ...(artifact.localDisclosureDefinitions && frame.localDisclosure
        ? {
            localDisclosure: {
              definitions: artifact.localDisclosureDefinitions,
              zoneIds: frame.localDisclosure.zoneIds,
              cards: frame.localDisclosure.cards,
            },
          }
        : {}),
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
