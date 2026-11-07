/** The deck's coin overrides the personal default only at this live table. */
const coins = new WeakMap<object, string>();
const revisions = new WeakMap<object, number>();
export const deckCoinRevision = (session: object): number =>
  revisions.get(session) ?? 0;
const listeners = new WeakMap<object, Set<() => void>>();
export const deckCoinSelection = (session: object): string | undefined =>
  coins.get(session);
export const subscribeDeckCoin = (
  session: object,
  listener: () => void
): (() => void) => {
  const set = listeners.get(session) ?? new Set();
  listeners.set(session, set);
  set.add(listener);
  return () => {
    set.delete(listener);
  };
};
export const setDeckCoinSelection = (
  session: object,
  coin: string | undefined,
  force = false
): void => {
  if (coins.get(session) === coin && !force) return;
  revisions.set(session, deckCoinRevision(session) + 1);
  if (coin === undefined) coins.delete(session);
  else coins.set(session, coin);
  for (const listener of listeners.get(session) ?? []) listener();
};
