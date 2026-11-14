import { lazy, Suspense, useMemo, useState } from 'react';
import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  createRendererSpikeView,
  type BoardIntent,
} from '@ptcgsim/renderer-contract';
import { RendererSpikeBoard } from './RendererSpikeBoard.js';
import type { RemoteRoomRuntime } from './session/RemoteRoomRuntime.js';

const RemoteRoomRoute = lazy(async () => ({
  default: (await import('./session/RemoteRoomRoute.js')).RemoteRoomRoute,
}));

const RemoteRoomLobby = lazy(async () => ({
  default: (await import('./session/RemoteRoomLobby.js')).RemoteRoomLobby,
}));

const RendererSpikeApp = () => {
  const view = useMemo(createRendererSpikeView, []);
  const [lastIntent, setLastIntent] = useState<BoardIntent | null>(null);
  const [lastCommand, setLastCommand] = useState<WireGameCommand | null>(null);
  const description = useMemo(
    () =>
      lastIntent
        ? JSON.stringify({ intent: lastIntent, command: lastCommand })
        : 'No board interaction yet',
    [lastCommand, lastIntent]
  );
  return (
    <main className="app-shell">
      <section className="board-column" aria-label="Renderer fixture board">
        <RendererSpikeBoard
          view={view}
          onIntent={setLastIntent}
          submitCommand={setLastCommand}
        />
      </section>
      <aside className="legacy-sidebar">
        <nav className="legacy-tabs" aria-label="Application sections">
          <button type="button" className="selected-page">
            Solo
          </button>
          <button type="button">Multiplayer</button>
          <button type="button">Deck</button>
          <button type="button">Settings</button>
        </nav>
        <div className="spike-controls">
          <h1>Renderer fixture</h1>
          <p>
            The board renderer over the 61-card immutable scene and semantic
            interaction contract.
          </p>
          <output aria-live="polite">{description}</output>
        </div>
      </aside>
    </main>
  );
};

export type AppRoute =
  | { readonly kind: 'renderer-spike' }
  | {
      readonly kind: 'remote-room-lobby';
      readonly buildId: string;
      readonly landing?: 'solo' | 'lobby';
    }
  | {
      readonly kind: 'remote-room';
      readonly runtime: RemoteRoomRuntime;
      readonly roomMode?: 'solo' | 'multiplayer';
    };

export const App = ({
  route = { kind: 'renderer-spike' },
}: {
  readonly route?: AppRoute;
}) => {
  if (route.kind === 'remote-room') {
    return (
      <Suspense
        fallback={
          <main className="app-shell" data-app-route="remote-room-loading" />
        }
      >
        <RemoteRoomRoute
          runtime={route.runtime}
          {...(route.roomMode ? { roomMode: route.roomMode } : {})}
        />
      </Suspense>
    );
  }
  if (route.kind === 'remote-room-lobby') {
    return (
      <Suspense
        fallback={
          <main
            className="app-shell"
            data-app-route="remote-room-lobby-loading"
          />
        }
      >
        <RemoteRoomLobby
          buildId={route.buildId}
          {...(route.landing ? { landing: route.landing } : {})}
        />
      </Suspense>
    );
  }
  return <RendererSpikeApp />;
};
