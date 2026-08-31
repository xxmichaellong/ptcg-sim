import { useMemo, useState } from 'react';
import type { BoardIntent } from '@ptcgsim/renderer-contract';
import { RendererSpikeBoard, type RendererKind } from './RendererSpikeBoard.js';

const initialRenderer = (): RendererKind =>
  new URLSearchParams(window.location.search).get('renderer') === 'dom'
    ? 'dom'
    : 'pixi';

export const App = () => {
  const [renderer, setRenderer] = useState<RendererKind>(initialRenderer);
  const [lastIntent, setLastIntent] = useState<BoardIntent | null>(null);
  const description = useMemo(
    () =>
      lastIntent ? JSON.stringify(lastIntent) : 'No board interaction yet',
    [lastIntent]
  );
  return (
    <main className="app-shell">
      <section className="board-column" aria-label="Renderer comparison board">
        <RendererSpikeBoard
          key={renderer}
          rendererKind={renderer}
          onIntent={setLastIntent}
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
