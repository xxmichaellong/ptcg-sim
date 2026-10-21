import type { PlaySlot } from './model.js';

/** A board's Pokémon by stack id: the Active, then the Bench in order. */
export interface PlayStackBoardLayout<Id extends string = string> {
  readonly activeStackId: Id | null;
  readonly benchStackIds: readonly Id[];
}

/**
 * A Pokémon moved whole onto the other player's board, laid out on both
 * boards after: it leaves its own board and lands where it was put on the
 * other one, and nothing of theirs comes across in exchange --
 *   - into the Active Spot (or onto the Active, `targetStackId`): an Active
 *     already there goes to the end of that Bench, as when a Pokémon is
 *     played there;
 *   - onto the Bench: at `benchIndex` among the Benched ones (the place of
 *     `targetStackId`, when dropped on one), the end if none.
 * Null when the move does not fit the boards as they are. The room
 * (MovePlayStack, RestoreStagedStack) and the client's prediction share it;
 * whether a Pokémon then comes up on the board it left is
 * loneBenchedPromotions'.
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
  const sourceActive = fromActive ? null : source.activeStackId;
  const sourceBench = source.benchStackIds.filter((id) => id !== stackId);
  let destinationActive = destination.activeStackId;
  const destinationBench = [...destination.benchStackIds];
  const target = move.targetStackId;
  if (move.destinationSlot === 'active') {
    if (target !== undefined && destinationActive !== target) return null;
    if (destinationActive !== null) destinationBench.push(destinationActive);
    destinationActive = stackId;
  } else {
    const at =
      target === undefined
        ? (move.benchIndex ?? destinationBench.length)
        : destinationBench.indexOf(target);
    if (at < 0 && target !== undefined) return null;
    destinationBench.splice(
      Math.max(0, Math.min(at, destinationBench.length)),
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

/**
 * The Pokémon that come up into an Active Spot a command left empty, one
 * per board: where the Active went away (`activeWentAway`: to a pile, to the
 * other board or to its own Bench, or its attached-card window was cleared
 * without it going back) and exactly one Pokémon stays on that Bench, one
 * that was already there, there is no choice to make, so it comes up. With
 * more on the Bench the player picks, and a Pokémon just put on the Bench
 * (the Active itself, or one put back together) stays where it was put.
 */
export const loneBenchedPromotions = <Id extends string>(
  before: Readonly<Record<string, PlayStackBoardLayout<Id>>>,
  after: Readonly<Record<string, PlayStackBoardLayout<Id>>>,
  activeWentAway: (boardPlayerId: string) => boolean
): readonly { readonly boardPlayerId: string; readonly stackId: Id }[] =>
  Object.entries(after).flatMap(([boardPlayerId, board]) => {
    const [lone, ...others] = board.benchStackIds;
    return board.activeStackId === null &&
      lone !== undefined &&
      others.length === 0 &&
      before[boardPlayerId]?.benchStackIds.includes(lone) === true &&
      activeWentAway(boardPlayerId)
      ? [{ boardPlayerId, stackId: lone }]
      : [];
  });

/**
 * Whether a board's Active went away in a command, for
 * loneBenchedPromotions: it left the Active Spot without any of its cards
 * waiting in an attached-card window (taken apart, they wait there, in a
 * window of their own or one already open); or that window, opened when the
 * Active was taken apart, closed. Works on the room's state and the client's
 * view alike.
 */
export const activeWentAway = (
  before: {
    readonly activeStackId: string | null;
    /** Every card of the Active's stack, before the command. */
    readonly activeCardIds: readonly string[];
    readonly window: ActiveWindow | null;
  },
  after: { readonly window: ActiveWindow | null }
): boolean =>
  before.activeStackId !== null
    ? !(
        after.window?.cardIds.some((id) => before.activeCardIds.includes(id)) ??
        false
      )
    : before.window?.suggestedSlot === 'active' &&
      after.window?.id !== before.window.id;

/** What activeWentAway reads of a player's attached-card window. */
export interface ActiveWindow {
  readonly id: string;
  readonly suggestedSlot: PlaySlot;
  readonly cardIds: readonly string[];
}
