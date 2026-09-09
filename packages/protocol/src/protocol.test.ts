import { MAX_DECK_CARDS as GAME_CORE_MAX_DECK_CARDS } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  MAX_CLIENT_FRAME_CODE_UNITS,
  MAX_DECK_CARDS,
  MAX_REPLAY_FRAMES,
  PROTOCOL_VERSION,
} from './constants.js';
import {
  parseClientFrame,
  parseRoomCreationRequest,
  parseRoomCreationResponse,
  parseRoomInvitationIssueRequest,
  parseRoomInvitationIssueResponse,
  parseRoomInvitationHandoff,
  parseRoomAdmissionTicketRequest,
  parseRoomAdmissionTicketResponse,
  parseServerFrame,
} from './ingress.js';
import { PresentationEventSchema } from './schemas.js';

describe('cross-package wire limits', () => {
  it('keeps the aggregate deck cap aligned with the game reducer', () => {
    expect(MAX_DECK_CARDS).toBe(GAME_CORE_MAX_DECK_CARDS);
  });
});

describe('room admission HTTP schemas', () => {
  it('accepts only bounded exact ticket exchanges', () => {
    expect(
      parseRoomAdmissionTicketRequest({
        capability: 'seat-capability-00000000000000000001',
        displayName: 'Blue',
        requestedRole: 'player',
      }).ok
    ).toBe(true);
    expect(
      parseRoomAdmissionTicketRequest({
        capability: 'seat-capability-00000000000000000001',
        displayName: 'Blue',
        requestedRole: 'player',
        injected: true,
      }).ok
    ).toBe(false);
    expect(
      parseRoomAdmissionTicketResponse({
        admissionTicket: 'socket-ticket-0000000000000000000001',
        expiresAt: 40_000,
      }).ok
    ).toBe(true);
    expect(
      parseRoomAdmissionTicketResponse({
        admissionTicket: 'short',
        expiresAt: 40_000,
      }).ok
    ).toBe(false);
  });
});

describe('room creation HTTP schemas', () => {
  const response = {
    mode: 'multiplayer' as const,
    roomCode: 'ABCDEFGH2345',
    credentials: {
      playerOneSeatCapability: 'player-one-capability-0000000000000001',
      playerTwoSeatCapability: 'player-two-capability-0000000000000002',
      spectatorCapability: 'spectator-capability-000000000000000003',
    },
  };

  it('accepts only a supported mode and an exact mode-bound credential bundle', () => {
    expect(parseRoomCreationRequest({})).toMatchObject({
      ok: true,
      value: { mode: 'multiplayer' },
    });
    expect(parseRoomCreationRequest({ mode: 'solo' })).toMatchObject({
      ok: true,
      value: { mode: 'solo' },
    });
    expect(parseRoomCreationRequest({ mode: 'coaching' }).ok).toBe(false);
    expect(parseRoomCreationRequest({ injected: true }).ok).toBe(false);
    expect(parseRoomCreationResponse(response).ok).toBe(true);
    expect(
      parseRoomCreationResponse({ ...response, roomCode: 'ambiguous-I0' }).ok
    ).toBe(false);
    expect(
      parseRoomCreationResponse({ ...response, roomCode: 'ABCDEFGHI234' }).ok
    ).toBe(false);
    expect(parseRoomCreationResponse({ ...response, injected: true }).ok).toBe(
      false
    );
    expect(
      parseRoomCreationResponse({
        ...response,
        credentials: {
          ...response.credentials,
          playerTwoSeatCapability: 'short',
        },
      }).ok
    ).toBe(false);
    expect(
      parseRoomCreationResponse({
        mode: 'solo',
        roomCode: response.roomCode,
        credentials: {
          playerOneSeatCapability: response.credentials.playerOneSeatCapability,
          spectatorCapability: response.credentials.spectatorCapability,
        },
      }).ok
    ).toBe(true);
    expect(
      parseRoomCreationResponse({
        mode: 'solo',
        roomCode: response.roomCode,
        credentials: response.credentials,
      }).ok
    ).toBe(false);
  });
});

describe('room invitation HTTP schemas', () => {
  const capability = 'seat-capability-00000000000000000001';
  const invitation = 'invite-capability-00000000000000000001';

  it('accepts exact bounded issue requests and responses', () => {
    expect(
      parseRoomInvitationIssueRequest({
        capability,
        requestedRole: 'player',
      }).ok
    ).toBe(true);
    expect(
      parseRoomInvitationIssueRequest({
        capability,
        requestedRole: 'player',
        displayName: 'not-bound-until-ticket-exchange',
      }).ok
    ).toBe(false);
    expect(
      parseRoomInvitationIssueResponse({
        invitation,
        requestedRole: 'spectator',
        expiresAt: 900_000,
      }).ok
    ).toBe(true);
    expect(
      parseRoomInvitationIssueResponse({
        invitation: 'short',
        requestedRole: 'spectator',
        expiresAt: 900_000,
      }).ok
    ).toBe(false);
    expect(
      parseRoomInvitationHandoff({
        roomCode: 'ABCDEFGH2345',
        invitation,
        requestedRole: 'player',
        expiresAt: 900_000,
      }).ok
    ).toBe(true);
    expect(
      parseRoomInvitationHandoff({
        roomCode: 'ABCDEFGH2345',
        invitation,
        requestedRole: 'player',
        expiresAt: 900_000,
        injected: true,
      }).ok
    ).toBe(false);
  });
});

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

  it('accepts only the closed atomic play-stack placement shape', () => {
    const command = {
      type: 'PlaceCardOnPlayStack',
      cardId: 'source-card-alias',
      expectedSourceId: 'source-zone',
      targetStackId: 'target-stack',
      expectedTargetTopCardId: 'target-top-alias',
      mode: 'attachment',
    } as const;
    const frame = (candidate: unknown) =>
      parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'place-stack-command',
          lastSeenRevision: 0,
          command: candidate,
        })
      );

    expect(frame(command).ok).toBe(true);
    expect(frame({ ...command, mode: 'evolution' }).ok).toBe(true);
    for (const invalid of [
      { ...command, cardId: '' },
      { ...command, expectedSourceId: undefined },
      { ...command, targetStackId: undefined },
      { ...command, expectedTargetTopCardId: undefined },
      { ...command, mode: 'newStack' },
      { ...command, playerId: 'forged-player' },
    ]) {
      expect(frame(invalid).ok).toBe(false);
    }
  });

  it('requires explicit source and incumbent preconditions for stadium placement', () => {
    for (const expectedStadiumCardId of [null, 'stadium-card-alias']) {
      const result = parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'stadium-command',
          lastSeenRevision: 0,
          command: {
            type: 'MoveCardToStadium',
            cardId: 'selected-card-alias',
            expectedSourceId: 'source-zone',
            expectedStadiumCardId,
          },
        })
      );
      expect(result.ok).toBe(true);
    }

    for (const command of [
      {
        type: 'MoveCardToStadium',
        cardId: 'selected-card-alias',
        expectedStadiumCardId: null,
      },
      {
        type: 'MoveCardToStadium',
        cardId: 'selected-card-alias',
        expectedSourceId: 'source-zone',
      },
    ]) {
      const result = parseClientFrame(
        JSON.stringify({
          type: 'Command',
          protocolVersion: PROTOCOL_VERSION,
          sessionId: 'session',
          clientSequence: 1,
          commandId: 'stadium-command',
          lastSeenRevision: 0,
          command,
        })
      );
      expect(result.ok).toBe(false);
    }
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

  it('accepts only the parameterless mulligan declaration intent', () => {
    const parsed = parseClientFrame(
      JSON.stringify({
        type: 'DeclareMulligan',
        protocolVersion: PROTOCOL_VERSION,
        playerId: 'forged-player',
      })
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        type: 'DeclareMulligan',
        protocolVersion: PROTOCOL_VERSION,
      },
    });
  });

  it('accepts only the parameterless deck-view declaration intent', () => {
    const parsed = parseClientFrame(
      JSON.stringify({
        type: 'DeclareDeckView',
        protocolVersion: PROTOCOL_VERSION,
        playerId: 'forged-player',
        zoneId: 'forged-zone',
      })
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        type: 'DeclareDeckView',
        protocolVersion: PROTOCOL_VERSION,
      },
    });
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
      {
        type: 'MulliganDeclared',
        revision: 8,
        playerId: 'actor',
      },
      {
        type: 'DeckViewDeclared',
        revision: 9,
        playerId: 'actor',
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

  it('accepts only a typed mulligan announcement from the server', () => {
    expect(
      parseServerFrame(
        JSON.stringify({
          type: 'MulliganAnnouncement',
          protocolVersion: PROTOCOL_VERSION,
          event: {
            type: 'MulliganDeclared',
            revision: 12,
            playerId: 'blue',
          },
        })
      )
    ).toEqual({
      ok: true,
      value: {
        type: 'MulliganAnnouncement',
        protocolVersion: PROTOCOL_VERSION,
        event: {
          type: 'MulliganDeclared',
          revision: 12,
          playerId: 'blue',
        },
      },
    });
    expect(
      parseServerFrame(
        JSON.stringify({
          type: 'MulliganAnnouncement',
          protocolVersion: PROTOCOL_VERSION,
          event: {
            type: 'CoinFlipped',
            revision: 12,
            playerId: 'blue',
            result: 'heads',
          },
        })
      ).ok
    ).toBe(false);
  });

  it('accepts only a typed deck-view announcement from the server', () => {
    expect(
      parseServerFrame(
        JSON.stringify({
          type: 'DeckViewAnnouncement',
          protocolVersion: PROTOCOL_VERSION,
          event: {
            type: 'DeckViewDeclared',
            revision: 12,
            playerId: 'blue',
          },
        })
      )
    ).toEqual({
      ok: true,
      value: {
        type: 'DeckViewAnnouncement',
        protocolVersion: PROTOCOL_VERSION,
        event: {
          type: 'DeckViewDeclared',
          revision: 12,
          playerId: 'blue',
        },
      },
    });
    expect(
      parseServerFrame(
        JSON.stringify({
          type: 'DeckViewAnnouncement',
          protocolVersion: PROTOCOL_VERSION,
          event: {
            type: 'MulliganDeclared',
            revision: 12,
            playerId: 'blue',
          },
        })
      ).ok
    ).toBe(false);
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

  it('accepts only bounded strict replay-local disclosure wire records', () => {
    const definition = {
      id: 'opaque-local-definition-0001',
      name: 'Locally disclosed card',
      category: 'Pokémon',
      imageUrl: '/local-card.png',
    };
    const started = {
      type: 'ReplayStarted',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay-local',
      viewer: { kind: 'player', playerId: 'blue' },
      startRevision: 0,
      endRevision: 0,
      truncated: false,
      frameCount: 1,
      localDisclosureDefinitions: [definition],
    };
    expect(parseServerFrame(JSON.stringify(started)).ok).toBe(true);
    expect(
      parseServerFrame(
        JSON.stringify({
          ...started,
          localDisclosureDefinitions: Array.from(
            { length: MAX_DECK_CARDS * 2 + 1 },
            (_, index) => ({ ...definition, id: `opaque-definition-${index}` })
          ),
        })
      ).ok
    ).toBe(false);

    const snapshot = {
      matchId: 'local-disclosure-match',
      revision: 0,
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
      turn: { number: 0, currentPlayerId: 'blue' },
    };
    const card = {
      kind: 'known',
      id: 'opaque-local-card-0000001',
      definitionId: definition.id,
      ownerId: 'blue',
      category: 'Pokémon',
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
      publiclyRevealed: false,
    };
    const frame = {
      type: 'ReplayFrame',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay-local',
      index: 0,
      snapshot,
      localDisclosure: { zoneIds: ['blue-prizes'], cards: [card] },
    };
    expect(parseServerFrame(JSON.stringify(frame)).ok).toBe(true);
    const orderedWorkArea = {
      id: 'work-area-blue-1',
      sourceStackId: 'stack-blue-1',
      cards: [card],
      evolutionCards: [card],
      attachmentCards: [],
      suggestedSlot: 'active',
    };
    expect(
      parseServerFrame(
        JSON.stringify({
          ...frame,
          snapshot: {
            ...snapshot,
            workAreas: {
              ...snapshot.workAreas,
              blue: {
                inspection: null,
                attachmentResolution: orderedWorkArea,
              },
            },
          },
        })
      ).ok
    ).toBe(true);
    const workAreaWithoutOrder = {
      id: orderedWorkArea.id,
      sourceStackId: orderedWorkArea.sourceStackId,
      evolutionCards: orderedWorkArea.evolutionCards,
      attachmentCards: orderedWorkArea.attachmentCards,
      suggestedSlot: orderedWorkArea.suggestedSlot,
    };
    expect(
      parseServerFrame(
        JSON.stringify({
          ...frame,
          snapshot: {
            ...snapshot,
            workAreas: {
              ...snapshot.workAreas,
              blue: {
                inspection: null,
                attachmentResolution: workAreaWithoutOrder,
              },
            },
          },
        })
      ).ok
    ).toBe(false);
    for (const malformed of [
      { ...card, face: 'down' },
      { ...card, publiclyRevealed: true },
      { ...card, canonicalCardId: 'secret' },
    ]) {
      expect(
        parseServerFrame(
          JSON.stringify({
            ...frame,
            localDisclosure: { zoneIds: ['blue-prizes'], cards: [malformed] },
          })
        ).ok
      ).toBe(false);
    }
    expect(
      parseServerFrame(
        JSON.stringify({
          ...frame,
          localDisclosure: {
            zoneIds: ['one', 'two', 'three', 'four'],
            cards: [],
          },
        })
      ).ok
    ).toBe(false);
    expect(
      parseServerFrame(
        JSON.stringify({
          ...frame,
          localDisclosure: {
            zoneIds: [],
            cards: Array.from(
              { length: MAX_DECK_CARDS * 2 + 1 },
              (_, index) => ({ ...card, id: `opaque-card-${index}` })
            ),
          },
        })
      ).ok
    ).toBe(false);
  });
});
