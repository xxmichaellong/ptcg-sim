import { describe, expect, it, vi } from 'vitest';

import { applyEventBatch } from './apply-events.js';
import { cloneMatchState } from './clone.js';
import type { CommandContext, DeckEntry } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
import { executeCommand } from './execute-command.js';
import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import { stableHash } from './stable-hash.js';

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');

const context = (): CommandContext => {
  let card = 0;
  return {
    nextCardId: () => asCardInstanceId(`undo-card-${++card}`),
    nextStackId: () => asStackId('undo-stack'),
    nextInspectionId: () => asInspectionId('undo-inspection'),
    nextWorkAreaId: () => asWorkAreaId('undo-work-area'),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const entries: readonly DeckEntry[] = Array.from({ length: 8 }, (_, index) => ({
  definition: {
    id: asCardDefinitionId(`undo-definition-${index}`),
    name: `Undo card ${index}`,
    category: index === 0 ? ('Pokémon' as const) : ('Trainer' as const),
    imageUrl: `https://cards.invalid/undo-${index}.png`,
  },
  count: 1,
}));

const preparedState = () => {
  const source = createEmptyMatch(asMatchId('undo-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const loaded = executeCommand(
    source,
    { type: 'LoadDeck', playerId: p1, entries },
    context()
  );
  if (!loaded.accepted) throw new Error(loaded.message);
  return loaded.state;
};

describe('solo undo domain transition', () => {
  it('restores the approved checkpoint in a new monotonic revision', () => {
    const adapter = context();
    const checkpoint = preparedState();
    const drawn = executeCommand(
      checkpoint,
      { type: 'DrawCards', playerId: p1, count: 2 },
      adapter
    );
    if (!drawn.accepted) throw new Error(drawn.message);

    const undone = executeCommand(
      drawn.state,
      {
        type: 'ApplySoloUndo',
        actorPlayerId: p1,
        targetPlayerId: p1,
        revertedCommandId: 'draw-command',
        revertedRevision: drawn.state.revision,
        checkpoint,
      },
      adapter
    );
    if (!undone.accepted) throw new Error(undone.message);

    expect(undone.state).toEqual({
      ...checkpoint,
      revision: drawn.state.revision + 1,
    });
    expect(undone.batch.events).toEqual([
      {
        type: 'UndoApplied',
        actorPlayerId: p1,
        targetPlayerId: p1,
        revertedCommandId: 'draw-command',
        revertedRevision: drawn.state.revision,
        fromRevision: drawn.state.revision,
        checkpointRevision: checkpoint.revision,
        checkpointHash: stableHash(checkpoint),
        restoredState: checkpoint,
      },
    ]);
    expect(undone.state.zones[playerZoneId(p1, 'hand')]?.cardIds).toHaveLength(
      0
    );
    assertMatchInvariants(undone.state);
  });

  it('does not re-run randomness while restoring a randomized checkpoint', () => {
    const adapter = context();
    const loaded = preparedState();
    const setup = executeCommand(
      loaded,
      { type: 'SetupPlayer', playerId: p1 },
      adapter
    );
    if (!setup.accepted) throw new Error(setup.message);
    const randomInt = vi.fn(() => 1);

    const undone = executeCommand(
      setup.state,
      {
        type: 'ApplySoloUndo',
        actorPlayerId: p1,
        targetPlayerId: p1,
        revertedCommandId: 'setup-command',
        revertedRevision: setup.state.revision,
        checkpoint: loaded,
      },
      { ...adapter, randomInt }
    );
    expect(undone.accepted).toBe(true);
    expect(randomInt).not.toHaveBeenCalled();
  });

  it('rejects foreign, current, invalid, and missing-player checkpoints', () => {
    const state = preparedState();
    const foreign = {
      ...cloneMatchState(state),
      matchId: asMatchId('another-match'),
      revision: 0,
    };
    const invalid = {
      ...cloneMatchState(state),
      revision: 0,
      playerOrder: [p1, p1],
    };
    for (const checkpoint of [foreign, state, invalid]) {
      const result = executeCommand(
        state,
        {
          type: 'ApplySoloUndo',
          actorPlayerId: p1,
          targetPlayerId: p1,
          revertedCommandId: 'command',
          revertedRevision: checkpoint.revision + 1,
          checkpoint,
        },
        context()
      );
      expect(result.accepted).toBe(false);
    }
    const missingPlayer = executeCommand(
      state,
      {
        type: 'ApplySoloUndo',
        actorPlayerId: asPlayerId('missing'),
        targetPlayerId: p1,
        revertedCommandId: 'command',
        revertedRevision: 1,
        checkpoint: { ...cloneMatchState(state), revision: 0 },
      },
      context()
    );
    expect(missingPlayer).toMatchObject({
      accepted: false,
      code: 'not_found',
    });
  });

  it('rejects tampered replay facts before mutating source state', () => {
    const checkpoint = preparedState();
    const current = { ...cloneMatchState(checkpoint), revision: 2 };
    const sourceHash = stableHash(current);
    expect(() =>
      applyEventBatch(current, {
        revision: 3,
        events: [
          {
            type: 'UndoApplied',
            actorPlayerId: p1,
            targetPlayerId: p2,
            revertedCommandId: 'command',
            revertedRevision: checkpoint.revision + 1,
            fromRevision: 2,
            checkpointRevision: checkpoint.revision,
            checkpointHash: 'fnv1a32:tampered',
            restoredState: checkpoint,
          },
        ],
      })
    ).toThrow('Undo event is malformed');
    expect(stableHash(current)).toBe(sourceHash);
  });

  it('rejects an undo mixed with another event in one replay revision', () => {
    const checkpoint = preparedState();
    const current = { ...cloneMatchState(checkpoint), revision: 2 };
    expect(() =>
      applyEventBatch(current, {
        revision: 3,
        events: [
          {
            type: 'UndoApplied',
            actorPlayerId: p1,
            targetPlayerId: p1,
            revertedCommandId: 'command',
            revertedRevision: checkpoint.revision + 1,
            fromRevision: 2,
            checkpointRevision: checkpoint.revision,
            checkpointHash: stableHash(checkpoint),
            restoredState: checkpoint,
          },
          { type: 'CoinFlipped', result: 'heads' },
        ],
      })
    ).toThrow('Undo event must be the only event');
  });
});
