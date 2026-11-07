import { useCallback, useEffect, useRef } from 'react';
import { STANDARD_COIN } from '@ptcgsim/game-core';
import { setDeckCoinSelection } from '../../session/deck-coin-selection.js';
import type { DeckBuilderTarget } from './deck-builder-store.js';
export type DeckLookField = 'coin' | 'playmat';
import type { DeckBuilderStore } from './deck-builder-store.js';
import type { DeckLibrary } from './deck-library.js';
import type { DeckInstallSession } from './deck-install-adapter.js';
interface LookMemory {
  readonly attempted: Map<string, { value: string; commandId?: string }>;
  readonly observed: Map<
    string,
    { signature: string; revision: number; deckId: string | undefined }
  >;
  readonly active: Set<string>;
  readonly ownCoins: Map<string, string>;
}
// The table and its seats outlive an editor (for example, while a tutorial is open).
const memories = new WeakMap<
  DeckInstallSession,
  WeakMap<DeckBuilderStore, LookMemory>
>();
const memoryFor = (
  session: DeckInstallSession,
  store: DeckBuilderStore
): LookMemory => {
  let stores = memories.get(session);
  if (!stores) {
    stores = new WeakMap();
    memories.set(session, stores);
  }
  let memory = stores.get(store);
  if (!memory) {
    memory = {
      attempted: new Map(),
      observed: new Map(),
      active: new Set(),
      ownCoins: new Map(),
    };
    stores.set(store, memory);
  }
  return memory;
};
/** Apply a newly chosen deck's looks once; Undo and restored games remain authoritative. */
export const useDeckLooks = (
  session: DeckInstallSession | undefined,
  store: DeckBuilderStore,
  library: DeckLibrary,
  alternateEnabled: boolean,
  installInitially: () => boolean
) => {
  const force = useRef<
    | ((target: DeckBuilderTarget, fields: readonly DeckLookField[]) => void)
    | undefined
  >(undefined);
  useEffect(() => {
    if (!session) return;
    const memory = memoryFor(session, store);
    const { attempted } = memory;
    const retryDelays = new Map<string, number>();
    const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const sync = () => {
      const state = session.getSnapshot(),
        view = state.view;
      if (state.phase !== 'ready' || view?.viewer.kind !== 'player') return;
      const ownId = view.viewer.playerId;
      const otherId = view.playerOrder.find((id) => id !== ownId);
      for (const target of ['main', 'alternate'] as const) {
        if (target === 'alternate' && !alternateEnabled) continue;
        const playerId = target === 'main' ? ownId : otherId;
        if (!playerId) continue;
        const slot = store.getSnapshot().slots[target];
        const deck = slot.label?.deckId
          ? library.get(slot.label.deckId)
          : undefined;
        const selectionKey = `${view.matchId}/${target}`;
        const signature = JSON.stringify([deck?.id, deck?.coin, deck?.playmat]);
        const previousSelection = memory.observed.get(selectionKey);
        const replaced =
          previousSelection !== undefined &&
          previousSelection.revision !== slot.revision;
        const changed =
          previousSelection !== undefined &&
          previousSelection.signature !== signature;
        const choseDefaults =
          !deck &&
          (replaced ||
            (changed &&
              previousSelection?.deckId !== undefined &&
              library.get(previousSelection.deckId) !== undefined));
        memory.observed.set(selectionKey, {
          signature,
          revision: slot.revision,
          deckId: slot.label?.deckId,
        });
        if (!previousSelection && !installInitially()) {
          if (target === 'main')
            memory.ownCoins.set(
              selectionKey,
              JSON.stringify([deck?.id, deck?.coin])
            );
          continue;
        }
        if (
          (!previousSelection && deck) ||
          ((changed || replaced) && (deck || choseDefaults))
        )
          memory.active.add(selectionKey);
        else if (changed && !deck && !choseDefaults)
          memory.active.delete(selectionKey); // Deleting a saved list keeps the live table dressed.
        if (!memory.active.has(selectionKey)) continue;
        if (target === 'main') {
          const next = JSON.stringify([deck?.id, deck?.coin]);
          if (next !== memory.ownCoins.get(selectionKey) || choseDefaults) {
            memory.ownCoins.set(selectionKey, next);
            if (deck || choseDefaults)
              setDeckCoinSelection(session, deck?.coin);
          }
        }
        const choiceId = deck?.id ?? `unsaved:${String(slot.revision)}`;
        const choices = [
          ...(target === 'alternate'
            ? [{ type: 'SetCoin' as const, coin: deck?.coin ?? STANDARD_COIN }]
            : []),
          {
            type: 'SetPlayerProfile' as const,
            playmat: deck?.playmat ?? 'style:default',
          },
        ];
        for (const choice of choices) {
          const key = `${view.matchId}/${playerId}/${choice.type}`;
          const value = JSON.stringify([choiceId, choice]);
          const previous = attempted.get(key);
          if (previous?.value === value) {
            const result = state.completedCommands.find(
              (entry) => entry.commandId === previous.commandId
            );
            if (result?.accepted) retryDelays.delete(key);
            if (
              result &&
              !result.accepted &&
              result.code &&
              [
                'stale_reference',
                'precondition_failed',
                'rate_limited',
                'room_not_ready',
                'internal_retryable',
              ].includes(result.code) &&
              !retryTimers.has(key)
            ) {
              const delay = retryDelays.get(key) ?? 500;
              retryDelays.set(key, Math.min(30_000, delay * 2));
              retryTimers.set(
                key,
                setTimeout(() => {
                  retryTimers.delete(key);
                  if (attempted.get(key) === previous) attempted.delete(key);
                  sync();
                }, delay)
              );
            }
            continue;
          }
          retryDelays.delete(key);
          const queued = state.pendingCommands.findLast(
            (entry) =>
              entry.command.type === choice.type &&
              (entry.command.type !== 'SetPlayerProfile' ||
                entry.command.playmat !== undefined) &&
              ('targetPlayerId' in entry.command
                ? (entry.command.targetPlayerId ?? ownId)
                : ownId) === playerId
          );
          const worn =
            choice.type === 'SetCoin'
              ? (view.players[playerId]?.coin ?? STANDARD_COIN)
              : (view.players[playerId]?.playmat ?? 'style:default');
          const wanted =
            choice.type === 'SetCoin' ? choice.coin : choice.playmat;
          const queuedValue =
            queued?.command.type === 'SetCoin'
              ? queued.command.coin
              : queued?.command.type === 'SetPlayerProfile'
                ? queued.command.playmat
                : undefined;
          if (queuedValue === wanted && queued) {
            attempted.set(key, { value, commandId: queued.commandId });
            continue;
          }
          attempted.set(key, { value });
          if (!queued && worn === wanted) continue;
          const result = session.submit({
            ...choice,
            targetPlayerId: playerId,
          });
          if (result.queued)
            attempted.set(key, { value, commandId: result.commandId });
          else attempted.delete(key);
        }
      }
    };
    force.current = (target, fields) => {
      const view = session.getSnapshot().view;
      if (
        view?.viewer.kind !== 'player' ||
        (target === 'alternate' && !alternateEnabled)
      )
        return;
      const slot = store.getSnapshot().slots[target];
      const deck = slot.label?.deckId
        ? library.get(slot.label.deckId)
        : undefined;
      memory.active.add(`${view.matchId}/${target}`);
      const ownId = view.viewer.playerId;
      const playerId =
        target === 'main' ? ownId : view.playerOrder.find((id) => id !== ownId);
      if (!playerId) return;
      for (const field of fields) {
        if (target === 'main' && field === 'coin')
          setDeckCoinSelection(session, deck?.coin, true);
        else
          attempted.delete(
            `${view.matchId}/${playerId}/${field === 'coin' ? 'SetCoin' : 'SetPlayerProfile'}`
          );
      }
      sync();
    };
    sync();
    const stops = [
      session.subscribe(sync),
      store.subscribe(sync),
      library.subscribe(sync),
    ];
    return () => {
      force.current = undefined;
      stops.forEach((stop) => stop());
      for (const timer of retryTimers.values()) clearTimeout(timer);
    };
  }, [session, store, library, alternateEnabled, installInitially]);
  return useCallback(
    (target: DeckBuilderTarget, fields: readonly DeckLookField[]) =>
      force.current?.(target, fields),
    []
  );
};
