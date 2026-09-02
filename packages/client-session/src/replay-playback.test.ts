import {
  hydrateMatchViewState,
  type PresentationEvent,
  type SerializedMatchViewState,
} from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectedReplayArtifact } from './model.js';
import {
  InvalidProjectedReplayError,
  ReplayPlaybackController,
} from './replay-playback.js';

const view = (
  revision: number,
  matchId = 'replay-playback-match'
): SerializedMatchViewState => ({
  matchId,
  revision,
  lifecycle: 'playing',
  viewer: { kind: 'player', playerId: 'blue' },
  playerOrder: ['blue', 'red'],
  players: {
    blue: {
      id: 'blue',
      displayName: 'Blue',
      cardBackUrl: '/blue.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
    red: {
      id: 'red',
      displayName: 'Red',
      cardBackUrl: '/red.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
  },
  definitions: {},
  zones: {},
  boards: {
    blue: { activeStackId: null, benchStackIds: [] },
    red: { activeStackId: null, benchStackIds: [] },
  },
  stacks: {},
  workAreas: {
    blue: { inspection: null, attachmentResolution: null },
    red: { inspection: null, attachmentResolution: null },
  },
  privateInspections: [],
  turn: { number: revision, currentPlayerId: 'blue' },
});

const coin: PresentationEvent = {
  type: 'CoinFlipped',
  revision: 5,
  result: 'heads',
};
const attack: PresentationEvent = {
  type: 'AttackDeclared',
  revision: 6,
  playerId: 'blue',
  turnNumber: 6,
};
const pass: PresentationEvent = {
  type: 'PassDeclared',
  revision: 7,
  playerId: 'red',
  turnNumber: 7,
};

const artifact = (replayId = 'replay-playback-1'): ProjectedReplayArtifact => ({
  replayId,
  viewer: hydrateMatchViewState(view(4)).viewer,
  startRevision: 4,
  endRevision: 7,
  truncated: true,
  frames: [
    { snapshot: hydrateMatchViewState(view(4)), presentationEvents: [] },
    {
      snapshot: hydrateMatchViewState(view(5)),
      presentationEvents: [coin],
    },
    {
      snapshot: hydrateMatchViewState(view(6)),
      presentationEvents: [attack],
    },
    {
      snapshot: hydrateMatchViewState(view(7)),
      presentationEvents: [pass],
    },
  ],
});

const replaceFrame = (
  value: ProjectedReplayArtifact,
  index: number,
  replacement: ProjectedReplayArtifact['frames'][number]
): ProjectedReplayArtifact => ({
  ...value,
  frames: value.frames.map((frame, frameIndex) =>
    frameIndex === index ? replacement : frame
  ),
});

describe('ReplayPlaybackController', () => {
  it('matches restart, previous, next, and fast-forward semantics', () => {
    const playback = new ReplayPlaybackController();
    const listener = vi.fn();
    playback.subscribe(listener);
    playback.load(artifact());

    expect(playback.getSnapshot()).toMatchObject({
      phase: 'ready',
      generation: 1,
      frameIndex: 0,
      frameCount: 4,
      startRevision: 4,
      endRevision: 7,
      truncated: true,
      view: { revision: 4 },
      atStart: true,
      atEnd: false,
      timelinePresentationEvents: [],
      enteredPresentationEvents: [],
    });

    expect(playback.dispatch('next')).toBe(true);
    expect(playback.getSnapshot()).toMatchObject({
      generation: 2,
      frameIndex: 1,
      view: { revision: 5 },
      timelinePresentationEvents: [coin],
      enteredPresentationEvents: [coin],
    });
    expect(playback.stepNext()).toBe(true);
    expect(playback.stepPrevious()).toBe(true);
    expect(playback.getSnapshot()).toMatchObject({
      generation: 4,
      frameIndex: 1,
      timelinePresentationEvents: [coin],
      enteredPresentationEvents: [],
    });

    expect(playback.dispatch('fastForward')).toBe(true);
    expect(playback.getSnapshot()).toMatchObject({
      generation: 5,
      frameIndex: 3,
      view: { revision: 7 },
      atStart: false,
      atEnd: true,
      timelinePresentationEvents: [coin, attack, pass],
      enteredPresentationEvents: [attack, pass],
    });
    expect(playback.dispatch('restart')).toBe(true);
    expect(playback.getSnapshot()).toMatchObject({
      generation: 6,
      frameIndex: 0,
      view: { revision: 4 },
      atStart: true,
      timelinePresentationEvents: [],
      enteredPresentationEvents: [],
    });
    expect(listener).toHaveBeenCalledTimes(6);
  });

  it('treats playback boundaries as no-ops and clears explicitly', () => {
    const playback = new ReplayPlaybackController();
    const listener = vi.fn();
    playback.subscribe(listener);
    expect(playback.restart()).toBe(false);
    expect(playback.stepPrevious()).toBe(false);
    expect(playback.stepNext()).toBe(false);
    expect(playback.fastForward()).toBe(false);
    expect(playback.clear()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    playback.load(artifact());
    expect(playback.restart()).toBe(false);
    expect(playback.stepPrevious()).toBe(false);
    playback.fastForward();
    expect(playback.stepNext()).toBe(false);
    expect(playback.fastForward()).toBe(false);
    const generation = playback.getSnapshot().generation;
    expect(playback.clear()).toBe(true);
    expect(playback.getSnapshot()).toEqual({
      phase: 'empty',
      generation: generation + 1,
    });
    expect(playback.clear()).toBe(false);
  });

  it('replays presentation facts when crossed again without duplicating the timeline', () => {
    const playback = new ReplayPlaybackController(artifact());
    playback.stepNext();
    playback.stepNext();
    playback.stepPrevious();
    expect(playback.getSnapshot()).toMatchObject({
      frameIndex: 1,
      timelinePresentationEvents: [coin],
      enteredPresentationEvents: [],
    });

    playback.stepNext();
    expect(playback.getSnapshot()).toMatchObject({
      frameIndex: 2,
      timelinePresentationEvents: [coin, attack],
      enteredPresentationEvents: [attack],
    });
  });

  it('replaces artifacts transactionally and leaves an active replay intact on rejection', () => {
    const playback = new ReplayPlaybackController(artifact('first-replay'));
    const listener = vi.fn();
    playback.subscribe(listener);
    playback.stepNext();
    const beforeInvalidLoad = playback.getSnapshot();
    const candidate = artifact('malformed-replay');
    const malformed = replaceFrame(candidate, 1, {
      ...candidate.frames[1]!,
      snapshot: hydrateMatchViewState(view(99)),
    });
    expect(() => playback.load(malformed)).toThrow(InvalidProjectedReplayError);
    expect(playback.getSnapshot()).toBe(beforeInvalidLoad);
    expect(listener).toHaveBeenCalledTimes(1);

    const replacement = artifact('replacement-replay');
    playback.load(replacement);
    expect(playback.getSnapshot()).toMatchObject({
      replayId: 'replacement-replay',
      frameIndex: 0,
      view: { revision: 4 },
      timelinePresentationEvents: [],
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps every control bounded for a single-frame replay', () => {
    const base = hydrateMatchViewState(view(0));
    const playback = new ReplayPlaybackController({
      replayId: 'single-frame',
      viewer: base.viewer,
      startRevision: 0,
      endRevision: 0,
      truncated: false,
      frames: [{ snapshot: base, presentationEvents: [] }],
    });
    const initial = playback.getSnapshot();

    expect(initial).toMatchObject({ atStart: true, atEnd: true });
    expect(playback.restart()).toBe(false);
    expect(playback.stepPrevious()).toBe(false);
    expect(playback.stepNext()).toBe(false);
    expect(playback.fastForward()).toBe(false);
    expect(playback.getSnapshot()).toBe(initial);
  });

  it.each([
    {
      name: 'empty frames',
      make: (value: ProjectedReplayArtifact): ProjectedReplayArtifact => ({
        ...value,
        frames: [],
      }),
    },
    {
      name: 'revision gap',
      make: (value: ProjectedReplayArtifact): ProjectedReplayArtifact =>
        replaceFrame(value, 2, {
          ...value.frames[2]!,
          snapshot: hydrateMatchViewState(view(20)),
        }),
    },
    {
      name: 'wrong match',
      make: (value: ProjectedReplayArtifact): ProjectedReplayArtifact =>
        replaceFrame(value, 2, {
          ...value.frames[2]!,
          snapshot: hydrateMatchViewState(view(6, 'another-match')),
        }),
    },
    {
      name: 'changed player order',
      make: (value: ProjectedReplayArtifact): ProjectedReplayArtifact =>
        replaceFrame(value, 2, {
          ...value.frames[2]!,
          snapshot: {
            ...value.frames[2]!.snapshot,
            playerOrder: ['red', 'blue'],
          },
        }),
    },
    {
      name: 'wrong viewer',
      make: (value: ProjectedReplayArtifact): ProjectedReplayArtifact =>
        replaceFrame(value, 2, {
          ...value.frames[2]!,
          snapshot: {
            ...value.frames[2]!.snapshot,
            viewer: { kind: 'spectator' },
          },
        }),
    },
    {
      name: 'wrong event revision',
      make: (value: ProjectedReplayArtifact): ProjectedReplayArtifact =>
        replaceFrame(value, 1, {
          ...value.frames[1]!,
          presentationEvents: [{ ...coin, revision: 6 }],
        }),
    },
    {
      name: 'event on base frame',
      make: (value: ProjectedReplayArtifact): ProjectedReplayArtifact =>
        replaceFrame(value, 0, {
          ...value.frames[0]!,
          presentationEvents: [{ ...coin, revision: 4 }],
        }),
    },
    {
      name: 'false truncation marker',
      make: (value: ProjectedReplayArtifact): ProjectedReplayArtifact => ({
        ...value,
        truncated: false,
      }),
    },
  ])('rejects $name', ({ make }) => {
    const malformed = make(artifact());
    expect(() => new ReplayPlaybackController(malformed)).toThrow(
      InvalidProjectedReplayError
    );
  });

  it('does not contain transport or command capabilities', () => {
    const playback = new ReplayPlaybackController(artifact());
    expect('submit' in playback).toBe(false);
    expect('connect' in playback).toBe(false);
    expect('send' in playback).toBe(false);
  });
});
