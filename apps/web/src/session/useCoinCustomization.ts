import { STANDARD_COIN } from '@ptcgsim/game-core';
import type {
  ClientSessionState,
  RemoteGameSession,
} from '@ptcgsim/client-session';
import { useEffect } from 'react';
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
  const { coin } = usePreference(COIN_PREFERENCES);
  useEffect(() => {
    let attempted: CoinAttempt | undefined;
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
        attempted = undefined;
        return;
      }
      const playerId = view.viewer.playerId;
      const player = view.players[playerId];
      if (!player) return;
      const key = `${view.matchId}/${playerId}`;
      const pending = pendingCoinChange(state, playerId);
      if (pending?.coin === coin) {
        clearRetry();
        attempted = { key, coin, commandId: pending.commandId };
        return;
      }
      if ((player.coin ?? STANDARD_COIN) === coin && !pending) {
        clearRetry();
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
    };
  }, [coin, session]);
};
