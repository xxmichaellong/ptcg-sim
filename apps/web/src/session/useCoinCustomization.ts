import { STANDARD_COIN } from '@ptcgsim/game-core';
import type { RemoteGameSession } from '@ptcgsim/client-session';
import { useEffect, useRef } from 'react';
import { COIN_PREFERENCES } from '../card-backs/coin-preferences.js';
import { usePreference } from '../preferences/usePreference.js';

/** A personal look becomes room state, so opponents and replays see it too. */
export const useCoinCustomization = (
  session: Pick<RemoteGameSession, 'subscribe' | 'getSnapshot' | 'submit'>
): void => {
  const { coin } = usePreference(COIN_PREFERENCES);
  const pending = useRef(new Map<string, string>());
  useEffect(() => {
    const sync = (): void => {
      const state = session.getSnapshot();
      const view = state.view;
      if (state.phase !== 'ready' || view?.viewer.kind !== 'player') return;
      const playerId = view.viewer.playerId;
      const player = view.players[playerId];
      const key = `${view.matchId}/${playerId}`;
      if (
        !player ||
        (player.coin ?? STANDARD_COIN) === coin ||
        pending.current.get(key) === coin
      )
        return;
      if (
        state.pendingCommands.some(
          ({ command }) =>
            command.type === 'SetCoin' &&
            (command.targetPlayerId ?? playerId) === playerId &&
            command.coin === coin
        )
      ) {
        pending.current.set(key, coin);
        return;
      }
      // Mark before submitting: session publication may call us again.
      pending.current.set(key, coin);
      const result = session.submit({
        type: 'SetCoin',
        targetPlayerId: playerId,
        coin,
      });
      if (!result.queued) pending.current.delete(key);
    };
    sync();
    return session.subscribe(sync);
  }, [coin, session]);
};
