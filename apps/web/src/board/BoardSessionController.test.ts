import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import {
  createBoardSceneForViewport,
  createRendererSpikeView,
  DEFAULT_BOARD_PRESENTATION,
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
  createBoardSceneForViewport(view, {
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

  it('refreshes local scene configuration without advancing projection cursors', () => {
    let state = install();
    const cursor = state.cursor;
    const view = state.view;
    const cardId = cardIn(state.scene!, ':hand');
    state = apply(state, {
      kind: 'RendererPresentationUpdated',
      update: {
        kind: 'DragChanged',
        drag: { cardId, x: 10, y: 20, targetId: null },
      },
    }).state;
    const result = apply(state, { kind: 'RefreshScene' });

    expect(result.outcome).toBe('accepted');
    expect(result.state.cursor).toBe(cursor);
    expect(result.state.view).toBe(view);
    expect(result.state.presentation.drag).toBeNull();
    expect(result.effects).toEqual([
      {
        kind: 'CancelRendererInteraction',
        reason: 'projection_config_changed',
      },
      { kind: 'InstallScene', scene: result.state.scene, mode: 'replace' },
      {
        kind: 'InstallPresentation',
        presentation: result.state.presentation,
      },
    ]);

    const invalid = apply(
      result.state,
      { kind: 'RefreshScene' },
      {
        createScene: () => {
          throw new Error('invalid layout');
        },
      }
    );
    expect(invalid.outcome).toBe('rejected');
    expect(invalid.state).toBe(result.state);
    expect(invalid.effects).toEqual([]);
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

  it('resolves one route-owned overlay action from the installed safe view', () => {
    let state = install();
    const activeStack = state.view!.stacks['stack:blue:active']!;
    const cardId = activeStack.evolutionCards.at(-1)!.id;
    state = apply(state, {
      kind: 'RendererIntent',
      intent: { kind: 'CardContextRequested', cardId },
    }).state;
    const request = {
      kind: 'context' as const,
      action: 'toggleAbility' as const,
      cardId,
    };
    const result = apply(state, {
      kind: 'LegacyOverlayActionRequested',
      request,
    });

    expect(result.effects).toEqual([
      {
        kind: 'SubmitCommand',
        command: expect.objectContaining({ type: 'SetAbilityUsed' }),
      },
    ]);
    expect(result.effects[0]).toMatchObject({
      command: { stackId: activeStack.id },
    });
  });

  it('owns damage-editor identity from context open through bounded submit', () => {
    let state = install();
    const activeStack = state.view!.stacks['stack:blue:active']!;
    const cardId = activeStack.evolutionCards.at(-1)!.id;
    state = apply(state, {
      kind: 'RendererIntent',
      intent: { kind: 'CardContextRequested', cardId },
    }).state;

    const opened = apply(state, {
      kind: 'LegacyOverlayActionRequested',
      request: { kind: 'context', action: 'setDamage', cardId },
    });
    expect(opened.effects).toEqual([]);
    expect(opened.state.overlays).toEqual({
      contextMenuCardId: null,
      preview: null,
      input: { kind: 'damage', cardId, initialValue: '120' },
    });

    const contextDismissed = apply(opened.state, {
      kind: 'DismissLocalPresentation',
      scope: 'context',
    });
    expect(contextDismissed.outcome).toBe('ignored');
    expect(contextDismissed.state.overlays.input).toEqual(
      opened.state.overlays.input
    );

    const invalidRequest = {
      kind: 'context' as const,
      action: 'setDamage' as const,
      cardId,
      value: '70.5',
    };
    const invalid = apply(opened.state, {
      kind: 'LegacyOverlayActionRequested',
      request: invalidRequest,
    });
    expect(invalid.state).toBe(opened.state);
    expect(invalid.effects).toEqual([
      {
        kind: 'OverlayActionRejected',
        request: invalidRequest,
        reason: 'invalid_value',
      },
    ]);

    const submitted = apply(opened.state, {
      kind: 'LegacyOverlayActionRequested',
      request: {
        kind: 'context',
        action: 'setDamage',
        cardId,
        value: '70',
      },
    });
    expect(submitted.state.overlays.input).toBeNull();
    expect(submitted.effects).toEqual([
      {
        kind: 'SubmitCommand',
        command: { type: 'SetDamage', stackId: activeStack.id, damage: 70 },
      },
    ]);

    const forged = apply(submitted.state, {
      kind: 'LegacyOverlayActionRequested',
      request: {
        kind: 'context',
        action: 'setDamage',
        cardId,
        value: '80',
      },
    });
    expect(forged.effects).toEqual([
      {
        kind: 'OverlayActionRejected',
        request: {
          kind: 'context',
          action: 'setDamage',
          cardId,
          value: '80',
        },
        reason: 'stale_card',
      },
    ]);

    const reconnect = apply(opened.state, {
      kind: 'FrameReceived',
      frame: liveFrame(2, opened.state.view, {
        sessionPhase: 'reconnecting',
      }),
    });
    expect(reconnect.state.overlays.input).toBeNull();
    expect(reconnect.state.canSubmitCommands).toBe(false);
    expect(reconnect.effects).toContainEqual({
      kind: 'CancelRendererInteraction',
      reason: 'session_not_ready',
    });
  });

  it('submits the characterized default only when opening a missing damage marker', () => {
    const view = createRendererSpikeView();
    const activeStack = view.stacks['stack:blue:active']!;
    const withoutDamage: MatchViewState = {
      ...view,
      stacks: {
        ...view.stacks,
        [activeStack.id]: { ...activeStack, damage: null },
      },
    };
    let state = install(initialFrame(withoutDamage));
    const cardId = activeStack.evolutionCards.at(-1)!.id;
    state = apply(state, {
      kind: 'RendererIntent',
      intent: { kind: 'CardContextRequested', cardId },
    }).state;
    const result = apply(state, {
      kind: 'LegacyOverlayActionRequested',
      request: { kind: 'context', action: 'setDamage', cardId },
    });

    expect(result.state.overlays.input).toEqual({
      kind: 'damage',
      cardId,
      initialValue: '10',
    });
    expect(result.effects).toEqual([
      {
        kind: 'SubmitCommand',
        command: { type: 'SetDamage', stackId: activeStack.id, damage: 10 },
      },
    ]);
  });

  it('owns special-condition editor identity and its default active marker', () => {
    let state = install();
    const activeStack = state.view!.stacks['stack:blue:active']!;
    const cardId = activeStack.evolutionCards.at(-1)!.id;
    state = apply(state, {
      kind: 'RendererIntent',
      intent: { kind: 'CardContextRequested', cardId },
    }).state;

    const opened = apply(state, {
      kind: 'LegacyOverlayActionRequested',
      request: { kind: 'context', action: 'setSpecialCondition', cardId },
    });
    expect(opened.effects).toEqual([]);
    expect(opened.state.overlays.input).toEqual({
      kind: 'specialCondition',
      cardId,
      initialValue: 'Poisoned',
    });

    const wrongEditor = apply(opened.state, {
      kind: 'LegacyOverlayActionRequested',
      request: {
        kind: 'context',
        action: 'setDamage',
        cardId,
        value: '70',
      },
    });
    expect(wrongEditor.state).toBe(opened.state);
    expect(wrongEditor.effects).toEqual([
      {
        kind: 'OverlayActionRejected',
        request: {
          kind: 'context',
          action: 'setDamage',
          cardId,
          value: '70',
        },
        reason: 'stale_card',
      },
    ]);

    const invalid = apply(opened.state, {
      kind: 'LegacyOverlayActionRequested',
      request: {
        kind: 'context',
        action: 'setSpecialCondition',
        cardId,
        value: 'condition text too long',
      },
    });
    expect(invalid.state).toBe(opened.state);
    expect(invalid.effects).toHaveLength(1);
    expect(invalid.effects[0]).toMatchObject({
      kind: 'OverlayActionRejected',
      reason: 'invalid_value',
    });

    const movedView = withRevision(
      opened.state.view!,
      opened.state.view!.revision + 1
    );
    const playerId = movedView.playerOrder.find(
      (candidate) =>
        movedView.boards[candidate]?.activeStackId === activeStack.id
    )!;
    const playerBoard = movedView.boards[playerId]!;
    const noLongerActive: MatchViewState = {
      ...movedView,
      boards: {
        ...movedView.boards,
        [playerId]: {
          ...playerBoard,
          activeStackId: null,
          benchStackIds: [...playerBoard.benchStackIds, activeStack.id],
        },
      },
      stacks: {
        ...movedView.stacks,
        [activeStack.id]: { ...activeStack, slot: 'bench' },
      },
    };
    const reconciled = apply(opened.state, {
      kind: 'FrameReceived',
      frame: liveFrame(2, noLongerActive),
    });
    expect(reconciled.state.overlays.input).toBeNull();

    const submitted = apply(opened.state, {
      kind: 'LegacyOverlayActionRequested',
      request: {
        kind: 'context',
        action: 'setSpecialCondition',
        cardId,
        value: ' Pa ',
      },
    });
    expect(submitted.state.overlays.input).toBeNull();
    expect(submitted.effects).toEqual([
      {
        kind: 'SubmitCommand',
        command: {
          type: 'SetSpecialCondition',
          stackId: activeStack.id,
          condition: 'Pa',
        },
      },
    ]);

    const withoutCondition: MatchViewState = {
      ...opened.state.view!,
      stacks: {
        ...opened.state.view!.stacks,
        [activeStack.id]: { ...activeStack, specialCondition: null },
      },
    };
    let missing = install(initialFrame(withoutCondition));
    missing = apply(missing, {
      kind: 'RendererIntent',
      intent: { kind: 'CardContextRequested', cardId },
    }).state;
    const created = apply(missing, {
      kind: 'LegacyOverlayActionRequested',
      request: { kind: 'context', action: 'setSpecialCondition', cardId },
    });
    expect(created.state.overlays.input).toEqual({
      kind: 'specialCondition',
      cardId,
      initialValue: 'P',
    });
    expect(created.effects).toEqual([
      {
        kind: 'SubmitCommand',
        command: {
          type: 'SetSpecialCondition',
          stackId: activeStack.id,
          condition: 'P',
        },
      },
    ]);
  });

  it('binds each category submenu choice to the exact open stack card', () => {
    let state = install();
    const activeStack = state.view!.stacks['stack:blue:active']!;
    const cardId = activeStack.evolutionCards.at(-1)!.id;
    const otherCardId = activeStack.evolutionCards[0]!.id;
    state = apply(state, {
      kind: 'RendererIntent',
      intent: { kind: 'CardContextRequested', cardId },
    }).state;

    const missingChoice = apply(state, {
      kind: 'LegacyOverlayActionRequested',
      request: { kind: 'context', action: 'changeCardType', cardId },
    });
    expect(missingChoice.state).toBe(state);
    expect(missingChoice.effects).toEqual([
      {
        kind: 'OverlayActionRejected',
        request: { kind: 'context', action: 'changeCardType', cardId },
        reason: 'requires_choice',
      },
    ]);

    const wrongCard = apply(state, {
      kind: 'LegacyOverlayActionRequested',
      request: {
        kind: 'context',
        action: 'changeCardType',
        cardId: otherCardId,
        category: 'Energy',
      },
    });
    expect(wrongCard.state).toBe(state);
    expect(wrongCard.effects).toEqual([
      {
        kind: 'OverlayActionRejected',
        request: {
          kind: 'context',
          action: 'changeCardType',
          cardId: otherCardId,
          category: 'Energy',
        },
        reason: 'stale_card',
      },
    ]);

    for (const category of ['Energy', 'Trainer', 'Pokémon'] as const) {
      const selected = apply(state, {
        kind: 'LegacyOverlayActionRequested',
        request: {
          kind: 'context',
          action: 'changeCardType',
          cardId,
          category,
        },
      });
      expect(selected.state).toBe(state);
      expect(selected.effects).toEqual([
        {
          kind: 'SubmitCommand',
          command: {
            type: 'ChangeCardCategory',
            cardId,
            expectedSourceId: activeStack.id,
            category,
          },
        },
      ]);
    }

    const dismissed = apply(state, {
      kind: 'DismissLocalPresentation',
      scope: 'context',
    }).state;
    const afterDismissal = apply(dismissed, {
      kind: 'LegacyOverlayActionRequested',
      request: {
        kind: 'context',
        action: 'changeCardType',
        cardId,
        category: 'Energy',
      },
    });
    expect(afterDismissal.state).toBe(dismissed);
    expect(afterDismissal.effects[0]).toMatchObject({
      kind: 'OverlayActionRejected',
      reason: 'stale_card',
    });
  });

  it('owns count-prompt action/card identity through clamp and zone departure', () => {
    let state = install();
    const playerId =
      state.view!.viewer.kind === 'player'
        ? state.view!.viewer.playerId
        : state.view!.playerOrder[0]!;
    const hand = Object.values(state.view!.zones).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'hand'
    )!;
    const deck = Object.values(state.view!.zones).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'deck'
    )!;
    const discard = Object.values(state.view!.zones).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'discard'
    )!;
    const cardId = hand.cards[0]!.id;
    state = apply(state, {
      kind: 'RendererIntent',
      intent: { kind: 'CardContextRequested', cardId },
    }).state;
    const opened = apply(state, {
      kind: 'LegacyOverlayActionRequested',
      request: { kind: 'context', action: 'discardHand', cardId },
    });
    expect(opened.effects).toEqual([]);
    expect(opened.state.overlays.input).toEqual({
      kind: 'count',
      action: 'discardHand',
      cardId,
      zoneId: hand.id,
      message: 'Draw how many cards?',
      initialValue: '0',
      minimum: 0,
      invalidMessage: 'Please enter a valid number for the draw amount.',
    });

    const wrongAction = apply(opened.state, {
      kind: 'LegacyOverlayActionRequested',
      request: {
        kind: 'context',
        action: 'shuffleHandToDeck',
        cardId,
        value: '2',
      },
    });
    expect(wrongAction.state).toBe(opened.state);
    expect(wrongAction.effects).toEqual([
      {
        kind: 'OverlayActionRejected',
        request: {
          kind: 'context',
          action: 'shuffleHandToDeck',
          cardId,
          value: '2',
        },
        reason: 'stale_card',
      },
    ]);

    const invalid = apply(opened.state, {
      kind: 'LegacyOverlayActionRequested',
      request: {
        kind: 'context',
        action: 'discardHand',
        cardId,
        value: '2.5',
      },
    });
    expect(invalid.state).toBe(opened.state);
    expect(invalid.effects[0]).toMatchObject({
      kind: 'OverlayActionRejected',
      reason: 'invalid_value',
    });

    const submitted = apply(opened.state, {
      kind: 'LegacyOverlayActionRequested',
      request: {
        kind: 'context',
        action: 'discardHand',
        cardId,
        value: '999',
      },
    });
    expect(submitted.state.overlays.input).toBeNull();
    expect(submitted.effects).toEqual([
      {
        kind: 'SubmitCommand',
        command: { type: 'DiscardHandAndDraw', count: deck.cards.length },
      },
    ]);

    const card = hand.cards.find((candidate) => candidate.id === cardId)!;
    const movedView = withRevision(
      {
        ...opened.state.view!,
        zones: {
          ...opened.state.view!.zones,
          [hand.id]: {
            ...hand,
            cards: hand.cards.filter((candidate) => candidate.id !== cardId),
          },
          [discard.id]: {
            ...discard,
            cards: [...discard.cards, card],
          },
        },
      },
      opened.state.view!.revision + 1
    );
    const reconciled = apply(opened.state, {
      kind: 'FrameReceived',
      frame: liveFrame(2, movedView),
    });
    expect(reconciled.state.overlays.input).toBeNull();
  });

  it('rejects stale, incomplete, and replay overlay actions without resolving commands', () => {
    const player = createRendererSpikeView();
    const resolveOverlayAction = vi.fn(() => {
      throw new Error('blocked overlay request reached resolver');
    });
    const deps = { createScene, resolveOverlayAction };
    let replay = install(replayFrame(1, 1, player, 'resync'), deps);
    const replayCard = cardIn(replay.scene!, ':prizes');
    replay = apply(
      replay,
      {
        kind: 'RendererIntent',
        intent: { kind: 'CardContextRequested', cardId: replayCard },
      },
      deps
    ).state;
    const replayRequest = {
      kind: 'context' as const,
      action: 'revealPrizes' as const,
      cardId: replayCard,
    };
    expect(
      apply(
        replay,
        { kind: 'LegacyOverlayActionRequested', request: replayRequest },
        deps
      ).effects
    ).toEqual([
      {
        kind: 'OverlayActionRejected',
        request: replayRequest,
        reason: 'read_only',
      },
    ]);
    expect(resolveOverlayAction).not.toHaveBeenCalled();

    let live = install();
    const handCard = cardIn(live.scene!, ':hand');
    const staleRequest = {
      kind: 'context' as const,
      action: 'revealCard' as const,
      cardId: handCard,
    };
    expect(
      apply(live, {
        kind: 'LegacyOverlayActionRequested',
        request: staleRequest,
      }).effects
    ).toEqual([
      {
        kind: 'OverlayActionRejected',
        request: staleRequest,
        reason: 'stale_card',
      },
    ]);
    live = apply(live, {
      kind: 'RendererIntent',
      intent: { kind: 'CardContextRequested', cardId: handCard },
    }).state;
    const choiceRequest = {
      kind: 'context' as const,
      action: 'moveCard' as const,
      cardId: handCard,
    };
    expect(
      apply(live, {
        kind: 'LegacyOverlayActionRequested',
        request: choiceRequest,
      }).effects
    ).toEqual([
      {
        kind: 'OverlayActionRejected',
        request: choiceRequest,
        reason: 'requires_choice',
      },
    ]);

    const openedZone = live.scene!.zones.find((zone) =>
      zone.id.endsWith(':discard')
    )!;
    const otherZone = live.scene!.zones.find((zone) =>
      zone.id.endsWith(':deck')
    )!;
    live = apply(live, {
      kind: 'RendererIntent',
      intent: { kind: 'ZoneOpened', zoneId: openedZone.id },
    }).state;
    const forgedZoneRequest = {
      kind: 'zone' as const,
      action: 'shuffleDeck' as const,
      zoneId: otherZone.id,
    };
    expect(
      apply(live, {
        kind: 'LegacyOverlayActionRequested',
        request: forgedZoneRequest,
      }).effects
    ).toEqual([
      {
        kind: 'OverlayActionRejected',
        request: forgedZoneRequest,
        reason: 'stale_zone',
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

  it('admits hidden cards only through their currently opened recipient-safe zone', () => {
    let state = install();
    const zone = state.scene!.zones.find(
      (candidate) => candidate.id.endsWith(':discard') && candidate.interactive
    )!;
    const hiddenCard = state.scene!.cards.find(
      (candidate) => candidate.parentId === zone.id && !candidate.interactive
    )!;
    const outsideCard = state.scene!.cards.find(
      (candidate) => candidate.parentId !== zone.id && candidate.interactive
    )!;
    const intent: BoardIntent = {
      kind: 'CardContextRequested',
      cardId: hiddenCard.id,
    };

    expect(apply(state, { kind: 'RendererIntent', intent }).effects).toEqual([
      { kind: 'IntentRejected', intent, reason: 'stale_card' },
    ]);
    expect(
      apply(state, { kind: 'OpenedZoneCardIntent', intent }).effects
    ).toEqual([{ kind: 'IntentRejected', intent, reason: 'stale_card' }]);

    state = apply(state, {
      kind: 'RendererIntent',
      intent: { kind: 'ZoneOpened', zoneId: zone.id },
    }).state;
    const accepted = apply(state, { kind: 'OpenedZoneCardIntent', intent });
    expect(accepted.state.presentation.openedZoneId).toBe(zone.id);
    expect(accepted.state.overlays.contextMenuCardId).toBe(hiddenCard.id);

    const forged: BoardIntent = {
      kind: 'CardPreviewRequested',
      cardId: outsideCard.id,
    };
    expect(
      apply(accepted.state, {
        kind: 'OpenedZoneCardIntent',
        intent: forged,
      }).effects
    ).toEqual([
      { kind: 'IntentRejected', intent: forged, reason: 'stale_card' },
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

  it('purges a changed recipient on scene failure but retains a same-recipient last-safe scene', () => {
    const view = createRendererSpikeView();
    const installed = install(initialFrame(view));
    const priorCursor = installed.cursor;
    const priorScene = installed.scene;
    const failingDependencies: BoardSessionControllerDependencies = {
      createScene: () => {
        throw new Error('scene construction failed');
      },
    };

    const sameRecipient = apply(
      installed,
      {
        kind: 'FrameReceived',
        frame: liveFrame(2, { ...view, revision: view.revision + 1 }),
      },
      failingDependencies
    );
    expect(sameRecipient.outcome).toBe('rejected');
    expect(sameRecipient.state).toBe(installed);
    expect(sameRecipient.state.scene).toBe(priorScene);
    expect(sameRecipient.effects).toEqual([]);

    const changedRecipient = apply(
      installed,
      {
        kind: 'FrameReceived',
        frame: liveFrame(
          2,
          { ...view, matchId: 'replacement-match' },
          { boundary: 'resync' }
        ),
      },
      failingDependencies
    );
    expect(changedRecipient.outcome).toBe('purged');
    expect(changedRecipient.state.cursor).toBe(priorCursor);
    expect(changedRecipient.state.source).toBe(installed.source);
    expect(changedRecipient.state.view).toBeUndefined();
    expect(changedRecipient.state.scene).toBeUndefined();
    expect(changedRecipient.state.canSubmitCommands).toBe(false);
    expect(changedRecipient.state.presentation).toEqual(
      DEFAULT_BOARD_PRESENTATION
    );
    expect(changedRecipient.effects).toEqual([
      { kind: 'ResetRenderer', reason: 'identity_changed' },
    ]);
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
    let reentered = false;
    const controller = new BoardSessionController({
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
    const controller = new BoardSessionController({
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
