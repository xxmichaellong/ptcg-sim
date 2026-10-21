import type { PlaySlot } from './model.js';

/** A board's Pokémon by stack id: the Active, then the Bench in order. */
export interface PlayStackBoardLayout<Id extends string = string> {
  readonly activeStackId: Id | null;
  readonly benchStackIds: readonly Id[];
}

/**
 * A Pokémon moved whole onto the other player's board, laid out on both
 * boards after: it leaves its own board, where nothing comes up in its
 * place, and lands where it was put on the other one --
 *   - onto a Pokémon (`targetStackId`): the two trade places, the other
 *     taking the spot this one left;
 *   - into the Active Spot: an Active already there goes to the end of that
 *     Bench, as when a Pokémon is played there;
 *   - onto the Bench: at `benchIndex` among the Benched ones, the end if none.
 * Null when the move does not fit the boards as they are. The room
 * (MovePlayStack, RestoreStagedStack) and the client's prediction share it.
 */
export const layOutPlayStackAcrossBoards = <Id extends string>(move: {
  readonly stackId: Id;
  readonly source: PlayStackBoardLayout<Id>;
  readonly destination: PlayStackBoardLayout<Id>;
  readonly destinationSlot: PlaySlot;
  readonly targetStackId?: Id;
  readonly benchIndex?: number;
}): {
  readonly source: PlayStackBoardLayout<Id>;
  readonly destination: PlayStackBoardLayout<Id>;
} | null => {
  const { stackId, source, destination } = move;
  const fromActive = source.activeStackId === stackId;
  const sourceBenchIndex = source.benchStackIds.indexOf(stackId);
  if (!fromActive && sourceBenchIndex < 0) return null;
  if (
    destination.activeStackId === stackId ||
    destination.benchStackIds.includes(stackId)
  ) {
    return null;
  }
  let sourceActive = fromActive ? null : source.activeStackId;
  const sourceBench = source.benchStackIds.filter((id) => id !== stackId);
  let destinationActive = destination.activeStackId;
  const destinationBench = [...destination.benchStackIds];
  const target = move.targetStackId;
  if (target !== undefined) {
    if (move.destinationSlot === 'active') {
      if (destinationActive !== target) return null;
      destinationActive = stackId;
    } else {
      const at = destinationBench.indexOf(target);
      if (at < 0) return null;
      destinationBench[at] = stackId;
    }
    if (fromActive) sourceActive = target;
    else sourceBench.splice(sourceBenchIndex, 0, target);
  } else if (move.destinationSlot === 'active') {
    if (destinationActive !== null) destinationBench.push(destinationActive);
    destinationActive = stackId;
  } else {
    destinationBench.splice(
      Math.max(
        0,
        Math.min(
          move.benchIndex ?? destinationBench.length,
          destinationBench.length
        )
      ),
      0,
      stackId
    );
  }
  return {
    source: { activeStackId: sourceActive, benchStackIds: sourceBench },
    destination: {
      activeStackId: destinationActive,
      benchStackIds: destinationBench,
    },
  };
};
