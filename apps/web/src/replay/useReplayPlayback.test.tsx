// @vitest-environment happy-dom

import {
  ReplayPlaybackController,
  type ProjectedReplayArtifact,
} from '@ptcgsim/client-session';
import {
  hydrateMatchViewState,
  type SerializedMatchViewState,
} from '@ptcgsim/protocol';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';

import { useReplayPlayback } from './useReplayPlayback.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const view = (revision: number): SerializedMatchViewState => ({
  matchId: 'replay-hook-match',
  revision,
  lifecycle: 'playing',
  viewer: { kind: 'spectator' },
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

const artifact = (): ProjectedReplayArtifact => ({
  replayId: 'replay-hook',
  viewer: { kind: 'spectator' },
  startRevision: 0,
  endRevision: 1,
  truncated: false,
  frames: [
    { snapshot: hydrateMatchViewState(view(0)), presentationEvents: [] },
    { snapshot: hydrateMatchViewState(view(1)), presentationEvents: [] },
  ],
});

describe('useReplayPlayback', () => {
  beforeEach(() => document.body.replaceChildren());

  it('publishes controller frames without owning playback state in React', async () => {
    const playback = new ReplayPlaybackController();
    const Probe = () => {
      const state = useReplayPlayback(playback);
      return (
        <output>
          {state.phase === 'ready'
            ? `${state.frameIndex}:${state.view.revision}`
            : state.phase}
        </output>
      );
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => root.render(<Probe />));
    expect(host.textContent).toBe('empty');
    await act(async () => playback.load(artifact()));
    expect(host.textContent).toBe('0:0');
    await act(async () => playback.stepNext());
    expect(host.textContent).toBe('1:1');
    await act(async () => root.unmount());
    playback.restart();
    expect(host.textContent).toBe('');
  });
});
