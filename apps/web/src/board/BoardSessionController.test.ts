import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import {
  createBoardScene,
  createRendererSpikeView,
  type BoardIntent,
  type BoardScene,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  BoardSessionController,
  createInitialBoardSessionControllerState,
  reduceBoardSessionController,
  type BoardProjectionFrame,
  type BoardSessionControllerDependencies,
  type BoardSessionControllerEffect,
  type BoardSessionControllerState,
} from './BoardSessionController.js';

const viewport = { width: 1208, height: 900, devicePixelRatio: 1 } as const;
const createScene = (view: MatchViewState): BoardScene =>
  createBoardScene(view, {
    viewport,
    bottomPlayerId:
      view.viewer.kind === 'player'
        ? view.viewer.playerId
        : view.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
const dependencies: BoardSessionControllerDependencies = { createScene };

const withRevision = (
  view: MatchViewState,
  revision: number
): MatchViewState => ({ ...view, revision });
const asSpectator = (view: MatchViewState): MatchViewState => ({
  ...view,
  viewer: { kind: 'spectator' },
});
const liveFrame = (
  frameToken: number,
  view: MatchViewState | undefined,
  overrides: Partial<BoardProjectionFrame> = {}
): BoardProjectionFrame => ({
  frameToken,
  source: { kind: 'live' },
  boundary: 'advance',
  sessionPhase: 'ready',
  ...(view ? { view } : {}),
  submissionsBlocked: false,
  ...overrides,
});
const replayFrame = (
  frameToken: number,
  playbackGeneration: number,
  view: MatchViewState,
  boundary: BoardProjectionFrame['boundary'] = 'advance',
  frameIndex = playbackGeneration
): BoardProjectionFrame => ({
  frameToken,
  source: {
    kind: 'replay',
    replayId: 'replay-one',
    playbackGeneration,
    frameIndex,
  },
  boundary,
  sessionPhase: 'ready',
  view,
  submissionsBlocked: true,
});
const initialFrame = (view = createRendererSpikeView()): BoardProjectionFrame =>
  liveFrame(1, view, { boundary: 'resync' });
const apply = (
  state: BoardSessionControllerState,
  action: Parameters<typeof reduceBoardSessionController>[1],
  deps = dependencies
) => reduceBoardSessionController(state, action, deps);
const install = (
  frame = initialFrame(),
  deps = dependencies
): BoardSessionControllerState =>
  apply(
    createInitialBoardSessionControllerState(),
    { kind: 'FrameReceived', frame },
    deps
  ).state;
const cardIn = (scene: BoardScene, parentSuffix: string): ViewCardId => {
  const card = scene.cards.find((candidate) =>
    candidate.parentId.endsWith(parentSuffix)
  );
  if (!card) throw new Error(`Missing card in ${parentSuffix}`);
  return card.id;
};
const select = (
  state: BoardSessionControllerState,
  cardId: ViewCardId
): BoardSessionControllerState =>
  apply(state, {
    kind: 'RendererIntent',
    intent: { kind: 'CardSelected', cardId },
  }).state;

describe('headless board session controller', () => {
  it('installs only a recipient-safe view/scene without an event outbox', () => {
    const frame = initialFrame();
    const result = apply(createInitialBoardSessionControllerState(), {
      kind: 'FrameReceived',
      frame,
    });
    expect(result.outcome).toBe('accepted');
    expect(result.state.view).toBe(frame.view);
    expect(result.state.canSubmitCommands).toBe(true);
    expect(result.state).not.toHaveProperty('presentationEvents');
    expect(result.effects).toEqual([
      { kind: 'InstallScene', scene: result.state.scene, mode: 'replace' },
    ]);
  });

  it('orders frames by public coordinator token and consumes duplicates silently', () => {
    const view = createRendererSpikeView();
    const first = install(initialFrame(view));
    const exact = apply(first, {
      kind: 'FrameReceived',
      frame: initialFrame(view),
    });
    expect(exact.outcome).toBe('ignored');
    expect(exact.state).toBe(first);
    const newer = apply(first, {
      kind: 'FrameReceived',
      frame: liveFrame(2, view),
    });
    expect(newer.effects).toEqual([]);
    expect(newer.state.cursor?.frameToken).toBe(2);
    expect(
      apply(newer.state, {
        kind: 'FrameReceived',
        frame: liveFrame(1, withRevision(view, 2)),
      }).state
    ).toBe(newer.state);
  });

  it('requires resync for equal-revision replacement and clears aliases first', () => {
    const base = createRendererSpikeView();
    const selected = select(
      install(initialFrame(base)),
      base.zones['zone:spike-blue:hand']!.cards[0]!.id
    );
    const replacement = { ...base };
    expect(
      apply(selected, {
        kind: 'FrameReceived',
        frame: liveFrame(2, replacement),
      }).outcome
    ).toBe('rejected');
    const resync = apply(selected, {
      kind: 'FrameReceived',
      frame: liveFrame(2, replacement, { boundary: 'resync' }),
    });
    expect(resync.state.presentation.selectedCardId).toBeNull();
    expect(resync.effects.slice(0, 2)).toEqual([
      { kind: 'ResetRenderer', reason: 'identity_changed' },
      { kind: 'InstallScene', scene: resync.state.scene, mode: 'replace' },
    ]);
  });

  it('never rewinds a live projection', () => {
    const base = withRevision(createRendererSpikeView(), 5);
    const state = install(initialFrame(base));
    const result = apply(state, {
      kind: 'FrameReceived',
      frame: liveFrame(2, withRevision(base, 4), { boundary: 'resync' }),
    });
    expect(result.outcome).toBe('rejected');
    expect(result.state.view?.revision).toBe(5);
  });

  it('cancels reconnect gestures without reinstalling a phase-only scene', () => {
    let state = install();
    const cardId = cardIn(state.scene!, ':hand');
    state = apply(select(state, cardId), {
      kind: 'RendererPresentationUpdated',
      update: {
        kind: 'DragChanged',
        drag: { cardId, x: 10, y: 20, targetId: null },
      },
    }).state;
    const scene = state.scene;
    const reconnect = apply(state, {
      kind: 'FrameReceived',
      frame: liveFrame(2, undefined, { sessionPhase: 'reconnecting' }),
    });
    expect(reconnect.state.scene).toBe(scene);
    expect(reconnect.state.presentation.drag).toBeNull();
    expect(reconnect.effects).toEqual([
      { kind: 'CancelRendererInteraction', reason: 'session_not_ready' },
      {
        kind: 'InstallPresentation',
        presentation: reconnect.state.presentation,
      },
    ]);
  });

  it('suppresses every read-only drop before resolving', () => {
    const resolveDrop = vi.fn(() => {
      throw new Error('read-only frame reached resolver');
    });
    const deps = { createScene, resolveDrop };
    const player = createRendererSpikeView();
    const frames = [
      liveFrame(1, player, { boundary: 'resync', submissionsBlocked: true }),
      liveFrame(1, asSpectator(player), { boundary: 'resync' }),
      replayFrame(1, 1, player, 'resync'),
      liveFrame(1, player, {
        boundary: 'resync',
        sessionPhase: 'reconnecting',
      }),
    ];
    for (const frame of frames) {
      const state = install(frame, deps);
      const intent: BoardIntent = {
        kind: 'CardDropRequested',
        cardId: state.scene!.cards[0]!.id,
        targetId: 'zone:spike-blue:discard',
      };
      expect(
        apply(state, { kind: 'RendererIntent', intent }, deps).effects
      ).toEqual([
        {
          kind: 'IntentRejected',
          intent,
          reason: state.sessionPhase === 'ready' ? 'read_only' : 'not_ready',
        },
      ]);
    }
    expect(resolveDrop).not.toHaveBeenCalled();
  });

  it('emits one protocol-safe command from one installed pair', () => {
    const state = install();
    const cardId = cardIn(state.scene!, ':hand');
    const resolveDrop = vi.fn((view, scene, intent) => {
      expect(view).toBe(state.view);
      expect(scene).toBe(state.scene);
      return {
        ok: true as const,
        command: {
          type: 'MoveCard' as const,
          cardId: intent.cardId,
          expectedSourceZoneId: 'zone:spike-blue:hand',
          destinationZoneId: intent.targetId,
        },
      };
    });
    const result = apply(
      state,
      {
        kind: 'RendererIntent',
        intent: {
          kind: 'CardDropRequested',
          cardId,
          targetId: 'zone:spike-blue:discard',
        },
      },
      { createScene, resolveDrop }
    );
    expect(resolveDrop).toHaveBeenCalledOnce();
    expect(result.effects).toEqual([
      {
        kind: 'SubmitCommand',
        command: {
          type: 'MoveCard',
          cardId,
          expectedSourceZoneId: 'zone:spike-blue:hand',
          destinationZoneId: 'zone:spike-blue:discard',
        },
      },
    ]);
  });

  it('requires newer replay generation plus seek to rewind', () => {
    const base = createRendererSpikeView();
    const state = install(replayFrame(1, 1, withRevision(base, 5), 'resync'));
    expect(
      apply(state, {
        kind: 'FrameReceived',
        frame: replayFrame(2, 1, withRevision(base, 4), 'seek', 0),
      }).outcome
    ).toBe('rejected');
    expect(
      apply(state, {
        kind: 'FrameReceived',
        frame: replayFrame(2, 2, withRevision(base, 4)),
      }).outcome
    ).toBe('rejected');
    expect(
      apply(state, {
        kind: 'FrameReceived',
        frame: replayFrame(2, 2, withRevision(base, 6), 'advance', 1),
      }).outcome
    ).toBe('rejected');
    expect(
      apply(state, {
        kind: 'FrameReceived',
        frame: replayFrame(2, 2, { ...withRevision(base, 5) }, 'resync', 1),
      }).outcome
    ).toBe('accepted');
    expect(
      apply(state, {
        kind: 'FrameReceived',
        frame: replayFrame(2, 2, withRevision(base, 7), 'advance', 2),
      }).outcome
    ).toBe('rejected');
    const rewind = apply(state, {
      kind: 'FrameReceived',
      frame: replayFrame(2, 2, withRevision(base, 4), 'seek', 0),
    });
    expect(rewind.outcome).toBe('accepted');
    const forward = apply(rewind.state, {
      kind: 'FrameReceived',
      frame: replayFrame(3, 3, withRevision(base, 5), 'advance', 1),
    });
    expect(forward.state.sceneInstallMode).toBe('advance');
  });

  it('preserves replay-local aliases forward and clears them on seek', () => {
    const base = createRendererSpikeView();
    let state = install(replayFrame(1, 1, base, 'resync'));
    const cardId = cardIn(state.scene!, ':hand');
    state = apply(state, {
      kind: 'RendererIntent',
      intent: { kind: 'CardPreviewRequested', cardId },
    }).state;
    const forward = apply(state, {
      kind: 'FrameReceived',
      frame: replayFrame(2, 2, withRevision(base, 2)),
    });
    expect(forward.state.overlays.preview).toEqual({ kind: 'card', cardId });
    expect(
      forward.effects.some((effect) => effect.kind === 'ResetRenderer')
    ).toBe(false);
    const seek = apply(forward.state, {
      kind: 'FrameReceived',
      frame: replayFrame(3, 3, withRevision(base, 1), 'seek', 1),
    });
    expect(seek.state.overlays.preview).toBeNull();
    expect(seek.effects[0]).toEqual({
      kind: 'ResetRenderer',
      reason: 'identity_changed',
    });
  });

  it('reconciles disappearing aliases and exact scene targets', () => {
    const base = createRendererSpikeView();
    let state = install(initialFrame(base));
    const hand = base.zones['zone:spike-blue:hand']!;
    const cardId = hand.cards[0]!.id;
    state = apply(select(state, cardId), {
      kind: 'RendererPresentationUpdated',
      update: {
        kind: 'DragChanged',
        drag: {
          cardId,
          x: 1,
          y: 2,
          targetId: 'zone:spike-blue:discard',
        },
      },
    }).state;
    const nextView: MatchViewState = {
      ...base,
      revision: 2,
      zones: {
        ...base.zones,
        [hand.id]: {
          ...hand,
          cards: hand.cards.filter((card) => card.id !== cardId),
        },
      },
    };
    const result = apply(
      state,
      { kind: 'FrameReceived', frame: liveFrame(2, nextView) },
      {
        createScene: (view) => {
          const scene = createScene(view);
          return {
            ...scene,
            zones: scene.zones.filter(
              (zone) => zone.id !== 'zone:spike-blue:discard'
            ),
          };
        },
      }
    );
    expect(result.state.presentation.selectedCardId).toBeNull();
    expect(result.state.presentation.drag).toBeNull();
    expect(result.state.view?.zones['zone:spike-blue:discard']).toBeDefined();
  });

  it('closes stack preview when its focus card moves out of that stack', () => {
    const base = createRendererSpikeView();
    let state = install(initialFrame(base));
    const stack = base.stacks['stack:blue:active']!;
    const focus = stack.evolutionCards.at(-1)!;
    state = apply(state, {
      kind: 'RendererIntent',
      intent: { kind: 'CardPreviewRequested', cardId: focus.id },
    }).state;
    const hand = base.zones['zone:spike-blue:hand']!;
    const nextView: MatchViewState = {
      ...base,
      revision: 2,
      zones: {
        ...base.zones,
        [hand.id]: { ...hand, cards: [...hand.cards, focus] },
      },
      stacks: {
        ...base.stacks,
        [stack.id]: {
          ...stack,
          evolutionCards: stack.evolutionCards.filter(
            (card) => card.id !== focus.id
          ),
        },
      },
    };
    const result = apply(state, {
      kind: 'FrameReceived',
      frame: liveFrame(2, nextView),
    });
    expect(result.state.scene?.cards.some((card) => card.id === focus.id)).toBe(
      true
    );
    expect(result.state.overlays.preview).toBeNull();
  });

  it('preserves local selection/preview and spectator inspection semantics', () => {
    let state = install();
    const handCard = cardIn(state.scene!, ':hand');
    const stackCard = cardIn(state.scene!, 'stack:blue:active');
    const handZone = state.scene!.cards.find(
      (card) => card.id === handCard
    )!.parentId;
    state = apply(state, {
      kind: 'RendererIntent',
      intent: { kind: 'ZoneOpened', zoneId: handZone },
    }).state;
    state = select(state, handCard);
    expect(state.presentation.openedZoneId).toBe(handZone);
    state = apply(state, {
      kind: 'RendererIntent',
      intent: { kind: 'CardPreviewRequested', cardId: stackCard },
    }).state;
    expect(state.overlays.preview?.kind).toBe('stack');

    const spectator = asSpectator(createRendererSpikeView());
    state = install(liveFrame(1, spectator, { boundary: 'resync' }));
    const cardId = state.scene!.cards[0]!.id;
    state = select(state, cardId);
    expect(state.presentation.selectedCardId).toBe(cardId);
    const intent: BoardIntent = { kind: 'CardContextRequested', cardId };
    expect(apply(state, { kind: 'RendererIntent', intent }).effects).toEqual([
      { kind: 'IntentRejected', intent, reason: 'read_only' },
    ]);
  });

  it('purges changed recipients and makes terminal routes absorbing', () => {
    const base = createRendererSpikeView();
    let state = install(initialFrame(base));
    state = select(state, state.scene!.cards[0]!.id);
    const spectator = asSpectator(base);
    const changed = apply(state, {
      kind: 'FrameReceived',
      frame: liveFrame(2, spectator, { boundary: 'resync' }),
    });
    expect(changed.state.presentation.selectedCardId).toBeNull();
    const closed = apply(changed.state, {
      kind: 'FrameReceived',
      frame: liveFrame(3, undefined, { sessionPhase: 'closed' }),
    });
    expect(closed.state.scene).toBeUndefined();
    expect(closed.effects).toEqual([
      { kind: 'ResetRenderer', reason: 'terminal' },
    ]);
    const resurrection = apply(closed.state, {
      kind: 'FrameReceived',
      frame: liveFrame(
        4,
        { ...base, matchId: 'new-match' },
        { boundary: 'resync' }
      ),
    });
    expect(resurrection.outcome).toBe('rejected');
  });

  it('rejects invalid cursors, boundaries, and scenes with unknown aliases', () => {
    const view = createRendererSpikeView();
    const invalid = [
      { ...initialFrame(view), frameToken: -1 },
      { ...initialFrame(view), boundary: 'seek' },
      { ...initialFrame(view), boundary: 'playback' },
      { ...initialFrame(view), boundary: 'arbitrary' },
      { ...initialFrame(view), source: { kind: 'archive' } },
      { ...initialFrame(view), sessionPhase: 'recovering' },
      {
        ...replayFrame(1, 1, view, 'resync'),
        source: {
          kind: 'replay',
          replayId: '',
          playbackGeneration: 1,
          frameIndex: 0,
        },
      },
      {
        ...replayFrame(1, 1, view, 'resync'),
        source: {
          kind: 'replay',
          replayId: 'r',
          playbackGeneration: -1,
          frameIndex: 0,
        },
      },
    ] as unknown as BoardProjectionFrame[];
    for (const frame of invalid) {
      expect(
        apply(createInitialBoardSessionControllerState(), {
          kind: 'FrameReceived',
          frame,
        }).outcome
      ).toBe('rejected');
    }
    const scene = createScene(view);
    expect(
      apply(
        createInitialBoardSessionControllerState(),
        { kind: 'FrameReceived', frame: initialFrame(view) },
        {
          createScene: () => ({
            ...scene,
            cards: [
              ...scene.cards,
              { ...scene.cards[0]!, id: 'canonical-id' as ViewCardId },
            ],
          }),
        }
      ).outcome
    ).toBe('rejected');
  });

  it('does not let a no-view source transition poison the installed cursor', () => {
    const base = createRendererSpikeView();
    const live = install(initialFrame(base));
    const pendingReplay = apply(live, {
      kind: 'FrameReceived',
      frame: {
        frameToken: 2,
        source: {
          kind: 'replay',
          replayId: 'replay-two',
          playbackGeneration: 1,
          frameIndex: 0,
        },
        boundary: 'resync',
        sessionPhase: 'ready',
        submissionsBlocked: true,
      },
    });
    expect(pendingReplay.outcome).toBe('rejected');
    expect(pendingReplay.state).toBe(live);
    expect(pendingReplay.state.source).toEqual({ kind: 'live' });

    const installedReplay = apply(pendingReplay.state, {
      kind: 'FrameReceived',
      frame: {
        ...replayFrame(3, 1, withRevision(base, 2), 'resync'),
        source: {
          kind: 'replay',
          replayId: 'replay-two',
          playbackGeneration: 1,
          frameIndex: 0,
        },
      },
    });
    expect(installedReplay.outcome).toBe('accepted');
    expect(installedReplay.state.source).toEqual({
      kind: 'replay',
      replayId: 'replay-two',
      playbackGeneration: 1,
      frameIndex: 0,
    });
    expect(installedReplay.effects.slice(0, 2)).toEqual([
      { kind: 'ResetRenderer', reason: 'identity_changed' },
      {
        kind: 'InstallScene',
        scene: installedReplay.state.scene,
        mode: 'replace',
      },
    ]);
  });

  it('resets before live/replay, replay-id, and return-live replacements', () => {
    const base = createRendererSpikeView();
    const assertReplacement = (
      state: BoardSessionControllerState,
      frame: BoardProjectionFrame
    ): BoardSessionControllerState => {
      const result = apply(state, { kind: 'FrameReceived', frame });
      expect(result.outcome).toBe('accepted');
      expect(result.effects.slice(0, 2)).toEqual([
        { kind: 'ResetRenderer', reason: 'identity_changed' },
        { kind: 'InstallScene', scene: result.state.scene, mode: 'replace' },
      ]);
      return result.state;
    };

    let state = install(initialFrame(base));
    state = assertReplacement(
      state,
      replayFrame(2, 1, withRevision(base, 2), 'resync')
    );
    state = assertReplacement(state, {
      ...replayFrame(3, 1, withRevision(base, 3), 'resync'),
      source: {
        kind: 'replay',
        replayId: 'replay-two',
        playbackGeneration: 1,
        frameIndex: 0,
      },
    });
    assertReplacement(
      state,
      liveFrame(4, withRevision(base, 4), { boundary: 'resync' })
    );
  });

  it('serializes reentrant effects and preserves generation on dispose', () => {
    const order: string[] = [];
    let controller: BoardSessionController;
    let reentered = false;
    controller = new BoardSessionController({
      createScene,
      emitEffect: (effect) => {
        order.push(`effect:${effect.kind}`);
        if (effect.kind === 'InstallScene' && !reentered) {
          reentered = true;
          controller.dispatch({
            kind: 'RendererIntent',
            intent: {
              kind: 'CardSelected',
              cardId: effect.scene.cards[0]!.id,
            },
          });
        }
      },
    });
    controller.subscribe(() => {
      order.push(
        `snapshot:${controller.getSnapshot().presentation.selectedCardId ?? 'none'}`
      );
    });
    controller.dispatch({ kind: 'FrameReceived', frame: initialFrame() });
    expect(order).toEqual([
      'effect:InstallScene',
      'snapshot:none',
      'effect:InstallPresentation',
      expect.stringMatching(/^snapshot:spike-card-/),
    ]);
    const generation = controller.getSnapshot().generation;
    controller.dispose();
    expect(controller.getSnapshot().generation).toBe(generation + 1);
    controller.dispose();
  });

  it('stops later effects on effect-triggered disposal and reports failures once', () => {
    const attempted: BoardSessionControllerEffect[] = [];
    let controller: BoardSessionController;
    controller = new BoardSessionController({
      createScene,
      emitEffect: (effect) => {
        attempted.push(effect);
        if (effect.kind === 'ResetRenderer') controller.dispose();
      },
    });
    controller.dispatch({ kind: 'FrameReceived', frame: initialFrame() });
    controller.dispatch({
      kind: 'FrameReceived',
      frame: liveFrame(
        2,
        { ...createRendererSpikeView() },
        { boundary: 'resync' }
      ),
    });
    expect(attempted.at(-1)?.kind).toBe('ResetRenderer');
    expect(
      attempted.filter((effect) => effect.kind === 'InstallScene')
    ).toHaveLength(1);

    const error = new Error('effect failed');
    const reports = vi.fn();
    const failing = new BoardSessionController({
      createScene,
      emitEffect: () => {
        throw error;
      },
      reportEffectFailure: reports,
    });
    failing.dispatch({ kind: 'FrameReceived', frame: initialFrame() });
    expect(reports).toHaveBeenCalledOnce();
    expect(reports.mock.calls[0]?.[0]).toBe(error);
    failing.dispose();
  });
});
