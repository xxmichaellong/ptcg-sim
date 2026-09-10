import { describe, expect, it } from 'vitest';

import { applyEvent, applyEventBatch } from './apply-events.js';
import type { CommandContext, GameCommand } from './commands.js';
import { createEmptyMatch } from './create-match.js';
import { decideCommand } from './decide-command.js';
import { executeCommand } from './execute-command.js';
import {
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
} from './ids.js';
import { MAX_IMAGE_URL_CODE_UNITS } from './model.js';
import { projectMatch, type ProjectionIdentityAdapter } from './projection.js';

const p1 = asPlayerId('card-back-player-one');
const p2 = asPlayerId('card-back-player-two');
const context: CommandContext = {
  nextCardId: () => asCardInstanceId('unused-card'),
  nextStackId: () => asStackId('unused-stack'),
  nextInspectionId: () => asInspectionId('unused-inspection'),
  nextWorkAreaId: () => asWorkAreaId('unused-work-area'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};
const identities: ProjectionIdentityAdapter = {
  viewCardId: ({ cardId }) => cardId,
  viewDefinitionId: ({ definitionId }) => definitionId,
};

const createState = () =>
  createEmptyMatch(asMatchId('card-back-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);

describe('player card-back command', () => {
  it('preserves an arbitrary bounded URL through events, replay, and projections', () => {
    const state = createState();
    const cardBackUrl =
      'https://player-controlled.example/cards/my-back.png?variant=one#front';
    const result = executeCommand(
      state,
      { type: 'SetCardBack', playerId: p1, cardBackUrl },
      context
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.batch).toEqual({
      revision: 1,
      events: [{ type: 'PlayerCardBackSet', playerId: p1, cardBackUrl }],
    });
    expect(result.state.players[p1]?.cardBackUrl).toBe(cardBackUrl);
    expect(result.state.players[p2]?.cardBackUrl).toBe('/red.png');
    expect(applyEventBatch(state, result.batch)).toEqual(result.state);

    for (const viewer of [
      { kind: 'player' as const, playerId: p1 },
      { kind: 'player' as const, playerId: p2 },
      { kind: 'spectator' as const },
    ]) {
      expect(
        projectMatch(result.state, viewer, identities).players[p1]
      ).toMatchObject({ cardBackUrl });
    }
  });

  it.each([
    ['', 'empty'],
    ['x'.repeat(MAX_IMAGE_URL_CODE_UNITS + 1), 'oversized'],
  ])('rejects an %s card-back reference without mutation', (cardBackUrl) => {
    const state = createState();
    const result = executeCommand(
      state,
      { type: 'SetCardBack', playerId: p1, cardBackUrl },
      context
    );

    expect(result).toMatchObject({
      accepted: false,
      code: 'invalid_command',
    });
    expect(state.players[p1]?.cardBackUrl).toBe('/blue.png');
    expect(state.revision).toBe(0);
  });

  it('rejects a missing player without emitting an event', () => {
    expect(
      decideCommand(
        createState(),
        {
          type: 'SetCardBack',
          playerId: asPlayerId('missing-player'),
          cardBackUrl: 'https://example.invalid/back.png',
        },
        context
      )
    ).toMatchObject({ accepted: false, code: 'not_found' });
  });

  it('defensively rejects malformed runtime commands and events', () => {
    const state = createState();
    expect(
      decideCommand(
        state,
        {
          type: 'SetCardBack',
          playerId: p1,
          cardBackUrl: undefined,
        } as unknown as GameCommand,
        context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(() =>
      applyEvent(state, {
        type: 'PlayerCardBackSet',
        playerId: p1,
        cardBackUrl: '',
      })
    ).toThrow('Player card-back event is malformed');
  });
});
