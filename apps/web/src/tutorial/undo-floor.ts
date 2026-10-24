import type { ClientSessionState } from '@ptcgsim/client-session';
import { useEffect, useState } from 'react';

/**
 * Undo's floor on the practice table (ADR-038 §2). A lesson's deal is
 * made of the room's own moves, and Undo would take them back one by one:
 * the floor lets it take back the player's moves since, and no further.
 *
 * What Undo can take back the room keeps to itself (resolveSoloUndoAction).
 * Each move it takes is a revision of the table, an Undo too, and an Undo
 * says so (`UndoApplied`): the player's moves still standing are the
 * revisions since the floor, less two for each Undo among them.
 */
export interface UndoFloor {
  /** The table's revision, counted up to. */
  readonly revision: number;
  /** The player's moves on the floor that an Undo can still take back. */
  readonly standing: number;
}

/** A floor under the table as it is: nothing before it is taken back. */
export const undoFloorAt = (revision: number): UndoFloor => ({
  revision,
  standing: 0,
});

/** The floor counted up to the table the session shows now. */
export const followUndoFloor = (
  floor: UndoFloor,
  state: Pick<ClientSessionState, 'view' | 'presentationEvents'>
): UndoFloor => {
  const revision = state.view?.revision;
  if (revision === undefined || revision <= floor.revision) return floor;
  const undos = new Set(
    state.presentationEvents
      .filter(
        (event) =>
          event.type === 'UndoApplied' &&
          event.revision > floor.revision &&
          event.revision <= revision
      )
      .map((event) => event.revision)
  ).size;
  const moves = revision - floor.revision - undos;
  return {
    revision,
    standing: Math.max(0, floor.standing + moves - undos),
  };
};

/**
 * Whether Undo is blocked on the practice table: while a lesson is dealt,
 * and from where its deal ends (or the table the tutorial found) until the
 * player has a move of their own on it.
 */
export const useUndoBlocked = (
  state: Pick<ClientSessionState, 'view' | 'presentationEvents'>,
  dealing: boolean
): boolean => {
  const [floor, setFloor] = useState<UndoFloor | null>(null);
  useEffect(() => {
    if (dealing) {
      setFloor(null);
      return;
    }
    setFloor((current) =>
      current
        ? followUndoFloor(current, state)
        : state.view
          ? undoFloorAt(state.view.revision)
          : null
    );
  }, [dealing, state]);
  return floor === null || floor.standing === 0;
};
