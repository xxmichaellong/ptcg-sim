import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { readRendererKind } from './RendererSpikeBoard.js';
import './styles.css';

// Developer-only escape hatch: `?dev-room=1` boots the real remote-room stack
// (durable room creation, ADR-018 ticket exchange, socket session, projection,
// presentation, board) instead of the static renderer spike. Guarded by
// `import.meta.env.DEV` so the branch and its module drop out of production
// builds entirely.
// The `lazy` call must itself sit behind `import.meta.env.DEV`. Guarding only
// the usage still leaves the dynamic `import()` reachable, and the bundler then
// emits the dev chunk into production output.
const DevRoomHost = import.meta.env.DEV
  ? lazy(async () => ({
      default: (await import('./dev/DevRoomHost.js')).DevRoomHost,
    }))
  : null;

const parameters = new URLSearchParams(window.location.search);
const rendererKind = readRendererKind(parameters.get('renderer'));
const devRoomRequested =
  DevRoomHost !== null && parameters.get('dev-room') === '1';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

createRoot(root).render(
  <StrictMode>
    {devRoomRequested && DevRoomHost ? (
      <Suspense
        fallback={
          <main className="app-shell" data-app-route="dev-room-loading" />
        }
      >
        <DevRoomHost
          displayName={parameters.get('name')?.trim() || 'Developer'}
          rendererKind={rendererKind}
        />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
);
