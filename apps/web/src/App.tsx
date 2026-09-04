import { lazy, Suspense, useMemo, useState } from 'react';
import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  createRendererSpikeView,
  type BoardIntent,
} from '@ptcgsim/renderer-contract';
import {
  readRendererKind,
  RendererSpikeBoard,
  type RendererKind,
} from './RendererSpikeBoard.js';
import type { RemoteRoomRuntime } from './session/RemoteRoomRuntime.js';

const RemoteRoomRoute = lazy(async () => ({
  default: (await import('./session/RemoteRoomRoute.js')).RemoteRoomRoute,
}));

const initialRenderer = (): RendererKind =>
  readRendererKind(new URLSearchParams(window.location.search).get('renderer'));

const RendererSpikeApp = () => {
  const view = useMemo(createRendererSpikeView, []);
  const [renderer, setRenderer] = useState<RendererKind>(initialRenderer);
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
      <section className="board-column" aria-label="Renderer comparison board">
        <RendererSpikeBoard
          key={renderer}
          view={view}
          rendererKind={renderer}
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
          <h1>Renderer parity spike</h1>
          <label>
            Board renderer
            <select
              value={renderer}
              onChange={(event) =>
                setRenderer(event.target.value as RendererKind)
              }
            >
              <option value="pixi">Raw PixiJS</option>
              <option value="dom">React DOM</option>
            </select>
          </label>
          <p>
            Both choices consume the same 61-card immutable scene and semantic
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
      readonly kind: 'remote-room';
      readonly runtime: RemoteRoomRuntime;
      readonly rendererKind: RendererKind;
    };

export const App = ({
  route = { kind: 'renderer-spike' },
}: {
  readonly route?: AppRoute;
}) =>
  route.kind === 'remote-room' ? (
    <Suspense
      fallback={
        <main className="app-shell" data-app-route="remote-room-loading" />
      }
    >
      <RemoteRoomRoute
        runtime={route.runtime}
        rendererKind={route.rendererKind}
      />
    </Suspense>
  ) : (
    <RendererSpikeApp />
  );
