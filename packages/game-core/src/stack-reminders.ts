/**
 * A reminder a player puts on a Pokémon for an effect that lasts (an
 * attack's "can't attack during your next turn", "takes 30 less damage"):
 * the table only shows it -- nothing reads it, as ADR-001 keeps the table
 * manual -- and players take it off when the effect ends. It also comes off
 * as a Special Condition does: when the Pokémon evolves, goes from the
 * Active Spot to the Bench, or leaves play.
 */
export const STACK_REMINDERS = [
  'cantAttack',
  'cantRetreat',
  'takesLess',
  'hitsHarder',
  'noAbilities',
] as const;
export type StackReminder = (typeof STACK_REMINDERS)[number];

export const isStackReminder = (value: unknown): value is StackReminder =>
  typeof value === 'string' &&
  (STACK_REMINDERS as readonly string[]).includes(value);
