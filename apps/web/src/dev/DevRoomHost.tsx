import { useEffect, useState } from 'react';

import { App, type AppRoute } from '../App.js';
import type { RendererKind } from '../RendererSpikeBoard.js';
import {
  createRemoteRoom,
  type RemoteRoomCreationResult,
} from '../session/RemoteRoomCreation.js';

type DevRoomState =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected'; readonly route: AppRoute }
  | { readonly kind: 'failed'; readonly reason: string };

const DEV_BUILD_ID = 'local-development';
const CONNECT_TIMEOUT_MS = 10_000;
const DEV_ROOM_HANDLE = '__ptcgsimDevRoom';

const failureReason = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';

/**
 * Developer-only entry that exercises the real remote-room path end to end:
 * it creates a durable room, redeems the creator's own credential through the
 * ADR-018 ticket exchange, and mounts the connected route.
 *
 * This deliberately does not touch ADR-020, which governs how a handoff
 * reaches a *second* browser. Only the creator's self-contained path runs
 * here, so no invitation is ever presented or transported.
 */
export const DevRoomHost = ({
  displayName,
  rendererKind,
}: {
  readonly displayName: string;
  readonly rendererKind: RendererKind;
}) => {
  const [state, setState] = useState<DevRoomState>({ kind: 'connecting' });

  useEffect(() => {
    const abort = new AbortController();
    let created: RemoteRoomCreationResult | undefined;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    // React development StrictMode performs an immediate setup/cleanup/setup
    // cycle. Defer the irreversible POST by one microtask so the abandoned
    // setup is cancelled before it can create an orphaned durable room.
    queueMicrotask(() => {
      if (cancelled) return;
      // Without this the whole flow hangs silently when the authority is not
      // running: the dev proxy holds the connection open and the creation
      // fetch never settles.
      timeout = setTimeout(() => abort.abort(), CONNECT_TIMEOUT_MS);

      createRemoteRoom({
        buildId: DEV_BUILD_ID,
        displayName,
        rendererKind,
        signal: abort.signal,
      })
        .then((result) => {
          if (timeout !== undefined) clearTimeout(timeout);
          created = result;
          if (cancelled) {
            result.dispose();
            return;
          }
          // Dev-only handle so the room can be driven from the console or a
          // smoke test without a lobby UI. Never reachable in a production
          // build: the whole module is behind `import.meta.env.DEV`.
          (globalThis as Record<string, unknown>)[DEV_ROOM_HANDLE] = result;
          setState({ kind: 'connected', route: result.route });
        })
        .catch((error: unknown) => {
          if (timeout !== undefined) clearTimeout(timeout);
          if (cancelled) return;
          setState({ kind: 'failed', reason: failureReason(error) });
        });
    });

    return () => {
      cancelled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      abort.abort();
      const globals = globalThis as Record<string, unknown>;
      if (globals[DEV_ROOM_HANDLE] === created) {
        delete globals[DEV_ROOM_HANDLE];
      }
      created?.dispose();
    };
  }, [displayName, rendererKind]);

  if (state.kind === 'connected') return <App route={state.route} />;
  return (
    <main className="app-shell" data-app-route={`dev-room-${state.kind}`}>
      <section className="spike-controls">
        <h1>v2 development room</h1>
        {state.kind === 'connecting' ? (
          <p>Creating a room and connecting as the creator…</p>
        ) : (
          <>
            <p>Could not start a development room: {state.reason}</p>
            <p>
              Start the authority with{' '}
              <code>pnpm --filter @ptcgsim/server-v2 dev</code>, then reload.
              The dev server proxies <code>/v2</code> to it so the browser sees
              a single origin.
            </p>
          </>
        )}
      </section>
    </main>
  );
};

export default DevRoomHost;
