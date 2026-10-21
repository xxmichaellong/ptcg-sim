import { applyEventBatch } from './apply-events.js';
import type { CommandContext, GameCommand } from './commands.js';
import { decideCommand, type CommandDecision } from './decide-command.js';
import type { DomainEvent, EventBatch } from './events.js';
import { assertMatchInvariants } from './invariants.js';
import type { PlayerId } from './ids.js';
import type { MatchState } from './model.js';
import { activeWentAway, loneBenchedPromotions } from './play-stack-boards.js';

export type CommandExecution =
  | {
      readonly accepted: true;
      readonly state: MatchState;
      readonly batch: EventBatch;
    }
  | Exclude<CommandDecision, { accepted: true }>;

/** The most cards one zone, Pokémon, bench or window shows on the wire. */
const MAX_SHOWN_CARDS = 200;

/** Every place that holds cards, by a key that names it, and how many. */
const cardHolders = (state: MatchState): Map<string, number> => {
  const sizes = new Map<string, number>();
  for (const zone of Object.values(state.zones))
    sizes.set(`zone:${zone.id}`, zone.cardIds.length);
  for (const stack of Object.values(state.stacks)) {
    sizes.set(`evolution:${stack.id}`, stack.evolutionCardIds.length);
    sizes.set(`attachments:${stack.id}`, stack.attachmentCardIds.length);
  }
  for (const [playerId, board] of Object.entries(state.boards))
    sizes.set(`bench:${playerId}`, board.benchStackIds.length);
  for (const [playerId, areas] of Object.entries(state.workAreas)) {
    if (areas.inspection)
      sizes.set(`inspection:${playerId}`, areas.inspection.cardIds.length);
    if (areas.attachmentResolution)
      sizes.set(
        `resolution:${playerId}`,
        areas.attachmentResolution.cardIds.length
      );
  }
  return sizes;
};

/**
 * A command that would fill a place past what the wire can show is refused
 * like any other move that cannot be made (moving a card into another
 * player's full deck, say), rather than committed and then failing every
 * view of it. A place already over (an older state) may still shrink.
 */
const overfills = (current: MatchState, next: MatchState): boolean => {
  const before = cardHolders(current);
  for (const [holder, size] of cardHolders(next)) {
    if (size > MAX_SHOWN_CARDS && size > (before.get(holder) ?? 0)) return true;
  }
  return false;
};

/**
 * The lone Benched Pokémon that come up into Active Spots the command left
 * empty (loneBenchedPromotions), as layout events to follow it.
 */
const promotionsAfter = (
  state: MatchState,
  next: MatchState
): readonly DomainEvent[] =>
  loneBenchedPromotions(state.boards, next.boards, (playerId) =>
    activeWentAway(
      {
        activeStackId: state.boards[playerId]?.activeStackId ?? null,
        window: state.workAreas[playerId]?.attachmentResolution ?? null,
      },
      { window: next.workAreas[playerId]?.attachmentResolution ?? null }
    )
  ).map(({ boardPlayerId, stackId }) => ({
    type: 'PlayStackLayoutSet',
    boardPlayerId: boardPlayerId as PlayerId,
    expectedActiveStackId: null,
    expectedBenchStackIds: [stackId],
    activeStackId: stackId,
    benchStackIds: [],
  }));

export interface ExecuteOptions {
  /**
   * Bring up a lone Benched Pokémon wherever the command emptied an Active
   * Spot, in the same batch. The room plays this way; replaying a v1 log
   * does not, since v1 only did it for an Active benched beside one.
   * Never for a Solo undo, which puts the table back as it was.
   */
  readonly promoteLoneBenched?: boolean;
}

export const executeCommand = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext,
  options: ExecuteOptions = {}
): CommandExecution => {
  assertMatchInvariants(state);
  const decision = decideCommand(state, command, context);
  if (!decision.accepted) return decision;
  let batch: EventBatch = {
    revision: state.revision + 1,
    events: decision.events,
  };
  let next = applyEventBatch(state, batch);
  if (options.promoteLoneBenched && command.type !== 'ApplySoloUndo') {
    const promotions = promotionsAfter(state, next);
    if (promotions.length > 0) {
      batch = { ...batch, events: [...batch.events, ...promotions] };
      next = applyEventBatch(state, batch);
    }
  }
  assertMatchInvariants(next);
  if (overfills(state, next)) {
    return {
      accepted: false,
      code: 'precondition_failed',
      message: `No zone, Pokémon or window may hold more than ${MAX_SHOWN_CARDS} cards`,
    };
  }
  return { accepted: true, state: next, batch };
};
