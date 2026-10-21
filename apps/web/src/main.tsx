// First, so a language is active before any other module runs.
import { startLocalization } from './i18n/localization.js';
import { watchCardImageFailures } from './i18n/card-image-language.js';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppRoute } from './App.js';
import { CommandPaletteHost } from './commands/CommandPalette.js';
import { ShortcutsDialogHost } from './hotkeys/ShortcutsDialog.js';
import { installLeaveGuard } from './leave-guard.js';
import { installPageMotion } from './motion/page-motion.js';
import { readRendererKind } from './RendererSpikeBoard.js';
import { applySavedPageTheme, installTableArt } from './session/page-theme.js';
import { HelpSheetHost } from './session/shell/help-pages.js';
import { tableCurtain } from './session/shell/table-curtain.js';
import { OverlayHost } from './ui/OverlayHost.js';
import './design/tokens.css';
import './design/table-art.css';
import './styles.css';
import './design/shell.css';
import './design/card-material.css';

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

const TableDepthLab = import.meta.env.DEV
  ? lazy(async () => ({
      default: (await import('./dev/TableDepthLab.js')).TableDepthLab,
    }))
  : null;

const parameters = new URLSearchParams(window.location.search);
const rendererKind = readRendererKind(parameters.get('renderer'));
const roomMode =
  parameters.get('room-mode') === 'solo' ? 'solo' : 'multiplayer';
const devRoomRequested =
  DevRoomHost !== null && parameters.get('dev-room') === '1';
// The lobby is the application. The renderer parity spike -- a developer
// comparison of the two board renderers over one synthetic placeholder scene
// -- stays reachable at `?renderer-spike=1` for the geometry gates that use
// it, but it is never what a visitor lands on. A visitor lands on the Solo
// table, as in v1; `room-lobby=1` opens on the Multiplayer panel instead,
// which is what the browser gates and existing links use.
const rendererSpikeRequested = parameters.get('renderer-spike') === '1';
const depthLabRequested =
  TableDepthLab !== null && parameters.get('depth-lab') === '1';
const roomLobbyRoute: AppRoute | undefined = rendererSpikeRequested
  ? undefined
  : {
      kind: 'remote-room-lobby',
      buildId: import.meta.env.VITE_PTCGSIM_BUILD_ID || 'v2-web',
      rendererKind,
      landing: parameters.get('room-lobby') === '1' ? 'lobby' : 'solo',
    };

// Reduced motion and animation speed apply to the whole page from the
// first paint, not only once a room is open.
installPageMotion();
// ...and so does the saved theme, so a Day table never flashes Night.
applySavedPageTheme();
installTableArt();
// The page asks before a reload or a closed tab discards the table.
installLeaveGuard();
// A card scan in the player's language that does not exist is asked for
// once a visit; every later copy shows the deck's own scan.
watchCardImageFailures();
// index.html opens on a loading screen that the lobby lifts once its table
// is ready (table-curtain.ts); the developer pages have none to wait for.
if (depthLabRequested || devRoomRequested || !roomLobbyRoute) {
  tableCurtain().drop();
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

// The saved language is up before the first render, so a page in another
// language never flashes English (the loading screen covers the wait).
await startLocalization();

// One overlay host for the whole page: the lobby, the room, the Deck panel
// and the dev room all raise their dialogs and toasts through it.
createRoot(root).render(
  <StrictMode>
    <OverlayHost>
      {depthLabRequested && TableDepthLab ? (
        <Suspense fallback={<main className="app-shell" />}>
          <TableDepthLab />
        </Suspense>
      ) : devRoomRequested && DevRoomHost ? (
        <Suspense
          fallback={
            <main className="app-shell" data-app-route="dev-room-loading" />
          }
        >
          <DevRoomHost
            displayName={parameters.get('name')?.trim() || 'Developer'}
            mode={roomMode}
            rendererKind={rendererKind}
          />
        </Suspense>
      ) : (
        <App {...(roomLobbyRoute ? { route: roomLobbyRoute } : {})} />
      )}
      <ShortcutsDialogHost />
      <CommandPaletteHost />
      <HelpSheetHost />
    </OverlayHost>
  </StrictMode>
);
