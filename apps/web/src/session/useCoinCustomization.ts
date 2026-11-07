import { STANDARD_COIN } from '@ptcgsim/game-core';
import type {
  ClientSessionState,
  RemoteGameSession,
} from '@ptcgsim/client-session';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  deckCoinRevision,
  setDeckCoinSelection,
  deckCoinSelection,
  subscribeDeckCoin,
} from './deck-coin-selection.js';
import { COIN_PREFERENCES } from '../card-backs/coin-preferences.js';
import { usePreference } from '../preferences/usePreference.js';

/** Only the last queued change determines the coin the seat will wear. */
export const pendingCoinChange = (
  state: Pick<ClientSessionState, 'view' | 'pendingCommands'>,
  playerId: string
): { readonly commandId: string; readonly coin: string } | undefined => {
  const viewer = state.view?.viewer;
  const pending = state.pendingCommands.findLast(
    ({ command }) =>
      command.type === 'SetCoin' &&
      (command.targetPlayerId ??
        (viewer?.kind === 'player' ? viewer.playerId : undefined)) === playerId
  );
  return pending?.command.type === 'SetCoin'
    ? { commandId: pending.commandId, coin: pending.command.coin }
    : undefined;
};

interface CoinAttempt {
  readonly key: string;
  readonly coin: string;
  readonly commandId?: string;
}
const memories = new WeakMap<
  object,
  { coin: string; deckRevision: number; attempted: CoinAttempt | undefined }
>();
const initialized = new WeakSet<object>();
const RETRYABLE = new Set([
  'stale_reference',
  'precondition_failed',
  'rate_limited',
  'room_not_ready',
  'internal_retryable',
]);

/** A personal look becomes room state, so opponents and replays see it too. */
export const useCoinCustomization = (
  session: Pick<RemoteGameSession, 'subscribe' | 'getSnapshot' | 'submit'>
): void => {
  const { coin: personalCoin } = usePreference(COIN_PREFERENCES);
  const deckRevision = useSyncExternalStore(
    useCallback((listener) => subscribeDeckCoin(session, listener), [session]),
    useCallback(() => deckCoinRevision(session), [session])
  );
  const coin = deckCoinSelection(session) ?? personalCoin;
  useEffect(() => {
    const effectCoin = deckCoinSelection(session) ?? personalCoin;
    const effectRevision = deckCoinRevision(session);
    const remembered = memories.get(session);
    let attempted =
      remembered?.coin === effectCoin &&
      remembered.deckRevision === effectRevision
        ? remembered.attempted
        : undefined;
    let retry: number | undefined;
    let delay = 500;
    const clearRetry = (): void => {
      window.clearTimeout(retry);
      retry = undefined;
    };
    const sync = (): void => {
      const state = session.getSnapshot();
      const view = state.view;
      if (state.phase !== 'ready' || view?.viewer.kind !== 'player') {
        clearRetry();
        return;
      }
      const playerId = view.viewer.playerId;
      const player = view.players[playerId];
      if (!player) return;
      if (!initialized.has(session)) {
        initialized.add(session);
        const board = view.boards[playerId];
        const areas = view.workAreas[playerId];
        const hasOwnTable =
          state.roomMode !== undefined &&
          (Object.values(view.zones).some(
            (zone) => zone.ownerId === playerId && zone.cards.length > 0
          ) ||
            board?.activeStackId ||
            board?.benchStackIds.length ||
            areas?.inspection?.cards.length ||
            areas?.attachmentResolution?.cards.length);
        // An existing table is authoritative, including Standard after Undo.
        // A fresh empty seat still takes its personal default.
        if (
          deckCoinRevision(session) === 0 &&
          (player.coin ?? STANDARD_COIN) !== personalCoin &&
          (player.coin !== undefined ||
            hasOwnTable ||
            (state.roomMode === 'solo' && view.revision > 0))
        )
          setDeckCoinSelection(session, player.coin ?? STANDARD_COIN);
      }
      // A child can restore its deck override before this effect's first sync.
      const coin = deckCoinSelection(session) ?? personalCoin;
      const key = `${view.matchId}/${playerId}`;
      const pending = pendingCoinChange(state, playerId);
      if (pending?.coin === coin) {
        clearRetry();
        attempted = { key, coin, commandId: pending.commandId };
        return;
      }
      if ((player.coin ?? STANDARD_COIN) === coin && !pending) {
        clearRetry();
        attempted = { key, coin };
        delay = 500;
        return;
      }
      const previous = attempted;
      if (!pending && previous?.key === key && previous.coin === coin) {
        const result = state.completedCommands.find(
          (entry) => entry.commandId === previous.commandId
        );
        // A submit publishes synchronously. Its placeholder prevents re-entry;
        // accepted changes also stay accepted when the player later uses Undo.
        if (
          !result ||
          result.accepted ||
          !result.code ||
          !RETRYABLE.has(result.code)
        )
          return;
        if (retry === undefined) {
          retry = window.setTimeout(() => {
            retry = undefined;
            if (attempted === previous) attempted = undefined;
            sync();
          }, delay);
          delay = Math.min(delay * 2, 30_000);
        }
        return;
      }
      clearRetry();
      // A different coin queued later must be followed by this choice, even
      // when an older matching command remains earlier in the same queue.
      attempted = { key, coin };
      const result = session.submit({
        type: 'SetCoin',
        targetPlayerId: playerId,
        coin,
      });
      attempted = result.queued
        ? { key, coin, commandId: result.commandId }
        : undefined;
    };
    sync();
    const unsubscribe = session.subscribe(sync);
    return () => {
      clearRetry();
      unsubscribe();
      memories.set(session, {
        coin: effectCoin,
        deckRevision: effectRevision,
        attempted,
      });
    };
  }, [coin, personalCoin, session, deckRevision]);
};
