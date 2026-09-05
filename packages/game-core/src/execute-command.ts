import { applyEventBatch } from './apply-events.js';
import type { CommandContext, GameCommand } from './commands.js';
import { decideCommand, type CommandDecision } from './decide-command.js';
import type { EventBatch } from './events.js';
import { assertMatchInvariants } from './invariants.js';
import type { MatchState } from './model.js';

export type CommandExecution =
  | {
      readonly accepted: true;
      readonly state: MatchState;
      readonly batch: EventBatch;
    }
  | Exclude<CommandDecision, { accepted: true }>;

export const executeCommand = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): CommandExecution => {
  assertMatchInvariants(state);
  const decision = decideCommand(state, command, context);
  if (!decision.accepted) return decision;
  const batch: EventBatch = {
    revision: state.revision + 1,
    events: decision.events,
  };
  const next = applyEventBatch(state, batch);
  assertMatchInvariants(next);
  return { accepted: true, state: next, batch };
};
