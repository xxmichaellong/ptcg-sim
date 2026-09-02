import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  MAX_CLIENT_FRAME_CODE_UNITS,
  MAX_REPLAY_FRAMES,
  PROTOCOL_VERSION,
} from './constants.js';
import { parseClientFrame, parseServerFrame } from './ingress.js';
import { PresentationEventSchema } from './schemas.js';

describe('client protocol ingress', () => {
  it('accepts a bounded typed command and strips unknown keys', () => {
    const result = parseClientFrame(
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 1,
        commandId: 'command',
        lastSeenRevision: 0,
        ignored: 'not delivered',
        command: { type: 'DrawCards', count: 1, ignored: true },
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('ignored' in result.value).toBe(false);
    expect('ignored' in result.value.command).toBe(false);
  });

  it('rejects unknown command variants and invalid sequences', () => {
    const unknown = parseClientFrame(
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 1,
        commandId: 'command',
        lastSeenRevision: 0,
        command: { type: 'ExecuteArbitraryFunction', name: 'reset' },
      })
    );
    expect(unknown.ok).toBe(false);

    const invalidSequence = parseClientFrame(
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 0,
        commandId: 'command',
        lastSeenRevision: 0,
        command: { type: 'FlipCoin' },
      })
    );
    expect(invalidSequence.ok).toBe(false);

    for (const type of ['ResolveStagedCards', 'ResolveInspectionCards']) {
      const invalidDestination = parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'command',
          lastSeenRevision: 0,
          command: {
            type,
            expectedWorkAreaId: 'work-area',
            destination: 'arbitrary-zone',
          },
        })
      );
      expect(invalidDestination.ok).toBe(false);
    }
  });

  it('strips client-supplied attribution from the parameterless coin intent', () => {
    const result = parseClientFrame(
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 1,
        commandId: 'coin-command',
        lastSeenRevision: 0,
        command: { type: 'FlipCoin', playerId: 'forged-player' },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.type !== 'Command') return;
    expect(result.value.command).toEqual({ type: 'FlipCoin' });
  });

  it('rejects oversized input before JSON traversal', () => {
    const result = parseClientFrame(
      ' '.repeat(MAX_CLIENT_FRAME_CODE_UNITS + 1)
    );
    expect(result).toEqual({ ok: false, reason: 'frame_too_large' });
  });

  it('accepts only bounded deck-relative intent shapes', () => {
    for (const command of [
      {
        type: 'MoveCardToDeckTop',
        cardId: 'view-card',
        expectedSourceId: 'source-zone',
      },
      {
        type: 'MoveCardToDeckBottom',
        cardId: 'view-card',
        expectedSourceId: 'source-zone',
      },
      {
        type: 'ShuffleCardIntoDeck',
        cardId: 'view-card',
        expectedSourceId: 'source-work-area',
      },
      {
        type: 'SwapCardWithDeckTop',
        cardId: 'view-card',
        expectedSourceId: 'source-stack',
      },
      { type: 'MovePrizesToDeckBottom' },
    ]) {
      const result = parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'command',
          lastSeenRevision: 0,
          command,
        })
      );
      expect(result.ok).toBe(true);
    }
    const missingSource = parseClientFrame(
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 1,
        commandId: 'command',
        lastSeenRevision: 0,
        command: { type: 'SwapCardWithDeckTop', cardId: 'view-card' },
      })
    );
    expect(missingSource.ok).toBe(false);
  });

  it('accepts bounded stack-state targets and rejects malformed values', () => {
    const parseCommand = (command: unknown) =>
      parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'command',
          lastSeenRevision: 0,
          command,
        })
      );
    for (const command of [
      { type: 'SetDamage', stackId: 'stack', damage: 120 },
      { type: 'SetDamage', stackId: 'stack', damage: null },
      { type: 'SetSpecialCondition', stackId: 'stack', condition: 'Pa' },
      { type: 'SetAbilityUsed', stackId: 'stack', used: true },
      { type: 'RotateStack', stackId: 'stack', rotationQuarterTurns: 3 },
    ]) {
      expect(parseCommand(command).ok).toBe(true);
    }
    for (const command of [
      { type: 'SetDamage', stackId: 'stack', damage: -10 },
      { type: 'SetDamage', stackId: 'stack', damage: 10_000 },
      {
        type: 'SetSpecialCondition',
        stackId: 'stack',
        condition: 'x'.repeat(17),
      },
      { type: 'SetAbilityUsed', stackId: 'stack', used: 'yes' },
      { type: 'RotateStack', stackId: 'stack', rotationQuarterTurns: 4 },
    ]) {
      expect(parseCommand(command).ok).toBe(false);
    }
  });

  it('accepts semantic card annotations and rejects the low-level category setter', () => {
    const parseCommand = (command: unknown) =>
      parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'command',
          lastSeenRevision: 0,
          command,
        })
      );
    for (const command of [
      {
        type: 'SetCardOrientation',
        cardId: 'view-card',
        orientationQuarterTurns: 1,
      },
      { type: 'SetCardAbilityUsed', cardId: 'view-card', used: true },
      {
        type: 'ChangeCardCategory',
        cardId: 'view-card',
        expectedSourceId: 'source-stack',
        category: 'Energy',
      },
    ]) {
      expect(parseCommand(command).ok).toBe(true);
    }
    for (const command of [
      {
        type: 'SetCardOrientation',
        cardId: 'view-card',
        orientationQuarterTurns: 4,
      },
      {
        type: 'ChangeCardCategory',
        cardId: 'view-card',
        expectedSourceId: 'source-stack',
        category: 'Unknown',
      },
      {
        type: 'ChangeCardCategory',
        cardId: 'view-card',
        category: 'Trainer',
      },
      {
        type: 'SetCardCategory',
        cardId: 'view-card',
        category: 'Trainer',
      },
    ]) {
      expect(parseCommand(command).ok).toBe(false);
    }
  });

  it('requires an explicit target for once-per-game marker commands', () => {
    const parseCommand = (command: unknown) =>
      parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'command',
          lastSeenRevision: 0,
          command,
        })
      );
    expect(
      parseCommand({
        type: 'SetOncePerGameMarker',
        targetPlayerId: 'target-player',
        marker: 'vstar',
        used: true,
      }).ok
    ).toBe(true);
    for (const command of [
      { type: 'SetOncePerGameMarker', marker: 'gx', used: true },
      {
        type: 'SetOncePerGameMarker',
        targetPlayerId: 'target-player',
        marker: 'ace-spec',
        used: true,
      },
      {
        type: 'SetOncePerGameMarker',
        targetPlayerId: 'target-player',
        marker: 'gx',
        used: 'yes',
      },
    ]) {
      expect(parseCommand(command).ok).toBe(false);
    }
  });

  it('accepts bounded source-aware public visibility intents', () => {
    const parseCommand = (command: unknown) =>
      parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'command',
          lastSeenRevision: 0,
          command,
        })
      );
    expect(
      parseCommand({
        type: 'SetPublicReveal',
        cardId: 'view-card',
        expectedSourceId: 'source-zone',
        revealed: true,
      }).ok
    ).toBe(true);
    expect(
      parseCommand({
        type: 'SetZonePublicReveal',
        targetPlayerId: 'target-player',
        zoneId: 'prize-zone',
        expectedCardIds: ['prize-one', 'prize-two'],
        revealed: false,
      }).ok
    ).toBe(true);
    for (const command of [
      { type: 'SetPublicReveal', cardId: 'view-card', revealed: true },
      {
        type: 'SetZonePublicReveal',
        targetPlayerId: 'target-player',
        zoneId: 'prize-zone',
        expectedCardIds: [],
        revealed: true,
      },
      {
        type: 'SetZonePublicReveal',
        targetPlayerId: 'target-player',
        zoneId: 'prize-zone',
        expectedCardIds: Array.from(
          { length: 201 },
          (_, index) => `prize-${index}`
        ),
        revealed: true,
      },
    ]) {
      expect(parseCommand(command).ok).toBe(false);
    }
  });

  it('accepts bounded private inspection grant intents', () => {
    const parseCommand = (command: unknown) =>
      parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'command',
          lastSeenRevision: 0,
          command,
        })
      );
    for (const command of [
      {
        type: 'BeginZoneInspection',
        targetPlayerId: 'target-player',
        zoneId: 'prize-zone',
        expectedCardIds: ['private-card-one', 'private-card-two'],
      },
      {
        type: 'BeginCardInspection',
        cardId: 'private-card',
        expectedSourceId: 'private-source',
      },
      {
        type: 'EndPrivateInspection',
        inspectionId: 'private-inspection',
      },
    ]) {
      expect(parseCommand(command).ok).toBe(true);
    }
    for (const command of [
      {
        type: 'BeginZoneInspection',
        targetPlayerId: 'target-player',
        zoneId: 'prize-zone',
        expectedCardIds: [],
      },
      {
        type: 'BeginZoneInspection',
        targetPlayerId: 'target-player',
        zoneId: 'prize-zone',
        expectedCardIds: Array.from(
          { length: 201 },
          (_, index) => `private-card-${index}`
        ),
      },
      { type: 'BeginCardInspection', cardId: 'private-card' },
      { type: 'EndPrivateInspection', inspectionId: '' },
    ]) {
      expect(parseCommand(command).ok).toBe(false);
    }
  });

  it('accepts random face-down intent without a client-selected card', () => {
    const base = {
      type: 'Command',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 'session',
      clientSequence: 1,
      commandId: 'random-face-down-command',
      lastSeenRevision: 4,
    } as const;
    expect(
      parseClientFrame(
        JSON.stringify({
          ...base,
          command: {
            type: 'PlayRandomCardFaceDown',
            targetPlayerId: 'target-player',
          },
        })
      ).ok
    ).toBe(true);
    for (const command of [
      { type: 'PlayRandomCardFaceDown' },
      { type: 'PlayRandomCardFaceDown', targetPlayerId: '' },
      {
        type: 'PlayRandomCardFaceDown',
        targetPlayerId: 'target-player',
        cardId: 'client-chosen-card',
      },
    ]) {
      const parsed = parseClientFrame(JSON.stringify({ ...base, command }));
      expect(parsed.ok).toBe(false);
    }
  });

  it('accepts selector-free solo undo intent and rejects injected history', () => {
    const base = {
      type: 'Command',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 'session',
      clientSequence: 1,
      commandId: 'undo-command',
      lastSeenRevision: 4,
    } as const;
    expect(
      parseClientFrame(
        JSON.stringify({
          ...base,
          command: { type: 'ApplySoloUndo', targetPlayerId: 'player-one' },
        })
      ).ok
    ).toBe(true);
    for (const command of [
      { type: 'ApplySoloUndo' },
      { type: 'ApplySoloUndo', targetPlayerId: '' },
      {
        type: 'ApplySoloUndo',
        targetPlayerId: 'player-one',
        checkpointRevision: 2,
      },
    ]) {
      expect(parseClientFrame(JSON.stringify({ ...base, command })).ok).toBe(
        false
      );
    }
  });

  it('bounds semantic loose-board batch commands', () => {
    const parseCommand = (command: unknown) =>
      parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'command',
          lastSeenRevision: 0,
          command,
        })
      );
    for (const destination of [
      'discard',
      'hand',
      'lostZone',
      'shuffleIntoDeck',
    ]) {
      expect(
        parseCommand({
          type: 'ResolveLooseBoardCards',
          targetPlayerId: 'target-player',
          expectedBoardCardIds: ['board-card-one', 'board-card-two'],
          destination,
        }).ok
      ).toBe(true);
    }
    for (const command of [
      {
        type: 'ResolveLooseBoardCards',
        targetPlayerId: 'target-player',
        expectedBoardCardIds: [],
        destination: 'discard',
      },
      {
        type: 'ResolveLooseBoardCards',
        targetPlayerId: 'target-player',
        expectedBoardCardIds: Array.from(
          { length: 201 },
          (_, index) => `card-${index}`
        ),
        destination: 'discard',
      },
      {
        type: 'ResolveLooseBoardCards',
        targetPlayerId: 'target-player',
        expectedBoardCardIds: ['board-card'],
        destination: 'shuffleToDeckBottom',
      },
      {
        type: 'ResolveLooseBoardCards',
        expectedBoardCardIds: ['board-card'],
        destination: 'hand',
      },
    ]) {
      expect(parseCommand(command).ok).toBe(false);
    }
  });

  it('accepts only target-aware table-action intents', () => {
    const parseCommand = (command: unknown) =>
      parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'command',
          lastSeenRevision: 0,
          command,
        })
      );
    for (const type of ['StartTurn', 'DeclareAttack', 'PassTurn']) {
      expect(parseCommand({ type, targetPlayerId: 'target-player' }).ok).toBe(
        true
      );
      expect(parseCommand({ type }).ok).toBe(false);
      expect(parseCommand({ type, targetPlayerId: '' }).ok).toBe(false);
    }
  });

  it('accepts backward-compatible or explicit lifecycle targets', () => {
    const parseCommand = (command: unknown) =>
      parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'command',
          lastSeenRevision: 0,
          command,
        })
      );
    for (const type of ['SetupPlayer', 'ResetPlayer']) {
      expect(parseCommand({ type }).ok).toBe(true);
      expect(parseCommand({ type, targetPlayerId: 'target-player' }).ok).toBe(
        true
      );
      expect(parseCommand({ type, targetPlayerId: '' }).ok).toBe(false);
    }
    expect(parseCommand({ type: 'LoadDeck', entries: [] }).ok).toBe(true);
    expect(
      parseCommand({
        type: 'LoadDeck',
        targetPlayerId: 'target-player',
        entries: [],
      }).ok
    ).toBe(true);
    expect(
      parseCommand({ type: 'LoadDeck', targetPlayerId: '', entries: [] }).ok
    ).toBe(false);
  });

  it('bounds client-supplied expected stack layouts', () => {
    const expectedBenchStackIds = Array.from(
      { length: 201 },
      (_, index) => `bench-stack-${index}`
    );
    for (const command of [
      {
        type: 'MovePlayStack',
        stackId: 'source-stack',
        expectedSourceSlot: 'bench',
        expectedActiveStackId: 'active-stack',
        expectedBenchStackIds,
        destinationSlot: 'active',
      },
      {
        type: 'RestoreStagedStack',
        expectedWorkAreaId: 'work-area',
        expectedActiveStackId: 'active-stack',
        expectedBenchStackIds,
        destinationSlot: 'active',
      },
    ]) {
      const result = parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'command',
          lastSeenRevision: 0,
          command,
        })
      );
      expect(result.ok).toBe(false);
    }
  });

  it('never echoes rejected values in issue summaries', () => {
    const secret = 'SECRET-DECK-VALUE';
    const result = parseClientFrame(
      JSON.stringify({ type: 'SendChat', protocolVersion: 99, message: secret })
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('validates bounded recipient-safe activity detail', () => {
    const events = [
      {
        type: 'PublicCardsRevealed',
        revision: 4,
        actorPlayerId: 'actor',
        playerId: 'owner',
        scope: 'card',
        source: 'deck',
        cardCount: 1,
        cardName: 'Pikachu',
      },
      {
        type: 'PublicCardsHidden',
        revision: 5,
        actorPlayerId: 'actor',
        playerId: 'owner',
        scope: 'zone',
        source: 'prizes',
        cardCount: 6,
      },
      {
        type: 'PrivateInspectionStarted',
        revision: 6,
        sourcePlayerId: 'owner',
        viewerPlayerId: 'viewer',
        scope: 'zone',
        source: 'hand',
        cardCount: 7,
      },
      {
        type: 'PrivateInspectionEnded',
        revision: 7,
        sourcePlayerId: 'owner',
        viewerPlayerId: 'viewer',
        scope: 'card',
        source: 'bench',
        cardCount: 1,
      },
    ] as const;

    for (const event of events) {
      const result = v.safeParse(PresentationEventSchema, event);
      expect(result.success).toBe(true);
      if (result.success) expect(result.output).toEqual(event);
    }

    for (const event of [
      {
        type: 'PublicCardsRevealed',
        revision: 4,
        playerId: 'owner',
        scope: 'card',
        source: 'deck',
        cardCount: 1,
        cardName: 'Pikachu',
      },
      { ...events[0], source: 'secret-pile' },
      { ...events[0], scope: 'cards' },
      { ...events[0], cardName: 'x'.repeat(257) },
      { ...events[2], scope: undefined },
      { ...events[3], cardCount: 0 },
    ]) {
      expect(v.safeParse(PresentationEventSchema, event).success).toBe(false);
    }
  });

  it('allows replay requests without accepting a perspective selector', () => {
    expect(
      parseClientFrame(
        JSON.stringify({
          type: 'RequestReplay',
          protocolVersion: PROTOCOL_VERSION,
        })
      ).ok
    ).toBe(true);
    for (const injected of [
      { playerId: 'another-player' },
      { viewer: { kind: 'spectator' } },
      { startRevision: 0 },
    ]) {
      expect(
        parseClientFrame(
          JSON.stringify({
            type: 'RequestReplay',
            protocolVersion: PROTOCOL_VERSION,
            ...injected,
          })
        ).ok
      ).toBe(false);
    }
  });

  it('bounds streamed replay transfer metadata', () => {
    expect(
      parseServerFrame(
        JSON.stringify({
          type: 'ReplayStarted',
          protocolVersion: PROTOCOL_VERSION,
          replayId: 'replay-1',
          viewer: { kind: 'spectator' },
          startRevision: 0,
          endRevision: MAX_REPLAY_FRAMES - 1,
          truncated: false,
          frameCount: MAX_REPLAY_FRAMES,
        })
      ).ok
    ).toBe(true);
    expect(
      parseServerFrame(
        JSON.stringify({
          type: 'ReplayStarted',
          protocolVersion: PROTOCOL_VERSION,
          replayId: 'replay-1',
          viewer: { kind: 'spectator' },
          startRevision: 0,
          endRevision: MAX_REPLAY_FRAMES,
          truncated: false,
          frameCount: MAX_REPLAY_FRAMES + 1,
        })
      ).ok
    ).toBe(false);
  });
});
