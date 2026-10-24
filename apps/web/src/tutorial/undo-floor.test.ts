import type { ClientSessionState } from '@ptcgsim/client-session';
import type { MatchViewState } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { realPracticeRoom, you } from './practice-room.test-support.js';
import { dealScenario } from './scenario-runner.js';
import { tutorialCardKeyOf } from './tutorial-cards.js';
import { MIDGAME_SCENARIO } from './tutorial-scenarios.js';
import { findCard, zoneCards, zoneId } from './tutorial-world.js';
import { followUndoFloor, undoFloorAt } from './undo-floor.js';

/** The table at a revision, with an Undo at each of `undos`. */
const at = (
  revision: number,
  undos: readonly number[] = []
): Pick<ClientSessionState, 'view' | 'presentationEvents'> => ({
  view: { revision } as MatchViewState,
  presentationEvents: undos.map((undo) => ({
    type: 'UndoApplied' as const,
    revision: undo,
    actorPlayerId: 'you',
    targetPlayerId: 'you',
    revertedRevision: undo - 1,
  })),
});

/** Where every card is, by name: the same table, whatever the room calls them. */
const layout = (view: MatchViewState): string =>
  JSON.stringify([
    Object.values(view.zones).map((zone) => [
      zone.id,
      zone.cards.map((card) => tutorialCardKeyOf(view, card)).sort(),
    ]),
    Object.values(view.stacks).map((stack) => [
      stack.evolutionCards.map((card) => tutorialCardKeyOf(view, card)),
      stack.attachmentCards.map((card) => tutorialCardKeyOf(view, card)),
      stack.damage,
    ]),
  ]);

describe('Undo’s floor', () => {
  it('counts the moves since it, less those an Undo took back', () => {
    const floor = undoFloorAt(26);
    expect(followUndoFloor(floor, at(26))).toBe(floor);
    // Two moves, then an Undo of the second.
    const moved = followUndoFloor(floor, at(28));
    expect(moved).toEqual({ revision: 28, standing: 2 });
    expect(followUndoFloor(moved, at(29, [29]))).toEqual({
      revision: 29,
      standing: 1,
    });
    // Counted at once, an Undo seen twice counts once.
    expect(followUndoFloor(floor, at(31, [29, 30, 30]))).toEqual({
      revision: 31,
      standing: 1,
    });
    // Never below the floor, whatever the room took back.
    expect(followUndoFloor(floor, at(27, [27])).standing).toBe(0);
  });

  it('stands at a lesson’s deal on the room, under the player’s moves and Undos', async () => {
    const room = await realPracticeRoom();
    try {
      await dealScenario(
        room.session,
        MIDGAME_SCENARIO,
        new AbortController().signal
      );
      await room.settle();
      const view = () => room.session.getSnapshot().view!;
      const dealt = layout(view());
      let floor = undoFloorAt(view().revision);
      const standing = () => {
        floor = followUndoFloor(floor, room.session.getSnapshot());
        return floor.standing;
      };
      const send = async (
        command: Parameters<typeof room.session.submit>[0]
      ) => {
        expect(room.session.submit(command).queued).toBe(true);
        await room.settle();
      };
      const undo = () => send({ type: 'ApplySoloUndo', targetPlayerId: you });
      const discard = (key: 'research' | 'pidgey') =>
        send({
          type: 'MoveCard',
          cardId: findCard(view(), zoneCards(view(), you, 'hand'), key)!.id,
          expectedSourceZoneId: zoneId(you, 'hand'),
          destinationZoneId: zoneId(you, 'discard'),
        });
      expect(standing()).toBe(0);
      await discard('research');
      await discard('pidgey');
      expect(standing()).toBe(2);
      await undo();
      expect(standing()).toBe(1);
      await undo();
      expect(standing()).toBe(0);
      expect(layout(view())).toBe(dealt);
      // The room would go on into the deal: the floor is what stops it.
      await undo();
      expect(layout(view())).not.toBe(dealt);
    } finally {
      room.dispose();
    }
  });
});
