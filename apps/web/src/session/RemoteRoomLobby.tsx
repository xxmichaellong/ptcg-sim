import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent } from 'react';

import {
  RendererSpikeBoard,
  type RendererKind,
} from '../RendererSpikeBoard.js';
import { resolveCoachingConsentAction } from '../board/resolveCoachingConsentAction.js';
import {
  createRemoteRoom,
  type RemoteRoomCreationResult,
} from './RemoteRoomCreation.js';
import {
  RemoteRoomInvitationJoinCustody,
  type RemoteRoomInvitationHandoffReceipt,
} from './RemoteRoomInvitationHandoff.js';
import { RemoteRoomRoute } from './RemoteRoomRoute.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

const LEGACY_FALLBACK_NAMES = Object.freeze([
  'Froakie',
  'Shauna',
  'Avery',
  'Peonia',
  'Korrina',
  'Guzma',
  'Bridgette',
  'AZ',
  'Xerosic',
  'Colress',
  'Melony',
  'Serena',
  'Thorton',
  'Cyllene',
  'Acerola',
  'Marnie',
  'Arven',
  'Giovanni',
  'Judge',
  'Boss',
  'Penny',
  'Leon',
  'Cheren',
  'Elesa',
  'Volo',
  'Raihan',
  'Ash',
  'Brock',
  'Misty',
  'Cynthia',
  'Oak',
  'N',
  'Roxanne',
  'Iono',
  'Irida',
  'Lysandre',
  'Cyrus',
  'Hex',
  'Skyla',
  'Juniper',
  'Sycamore',
]);

type LobbyOperation = 'generate' | 'copy' | 'join';

interface InvitationJoinCustody {
  readonly acceptPaste: RemoteRoomInvitationJoinCustody['acceptPaste'];
  readonly bootstrap: RemoteRoomInvitationJoinCustody['bootstrap'];
  readonly clear: RemoteRoomInvitationJoinCustody['clear'];
  readonly dispose: RemoteRoomInvitationJoinCustody['dispose'];
}

interface LobbyOwner {
  readonly invitation: InvitationJoinCustody;
  disposed: boolean;
  operation?: {
    readonly kind: LobbyOperation;
    readonly abort: AbortController;
  };
  creator?: {
    readonly result: RemoteRoomCreationResult;
    readonly displayName: string;
  };
  guestRuntime?: RemoteRoomRuntime;
  copyReset?: ReturnType<typeof setTimeout>;
}

export interface RemoteRoomLobbyDependencies {
  readonly createRoom: typeof createRemoteRoom;
  readonly createInvitationJoinCustody: () => InvitationJoinCustody;
  readonly fallbackDisplayName: () => string;
}

const defaultDependencies: RemoteRoomLobbyDependencies = {
  createRoom: createRemoteRoom,
  createInvitationJoinCustody: () => new RemoteRoomInvitationJoinCustody(),
  fallbackDisplayName: () => {
    const index = Math.floor(Math.random() * LEGACY_FALLBACK_NAMES.length);
    return LEGACY_FALLBACK_NAMES[index] ?? 'Player';
  },
};

interface ConnectedRoom {
  readonly runtime: RemoteRoomRuntime;
  readonly rendererKind: RendererKind;
  readonly coachingConsent: boolean;
}

const normalizeDisplayName = (
  candidate: string,
  fallback: () => string
): string => candidate.trim() || fallback();

const disposeOwner = (owner: LobbyOwner): void => {
  if (owner.disposed) return;
  owner.disposed = true;
  owner.operation?.abort.abort();
  if (owner.copyReset !== undefined) clearTimeout(owner.copyReset);
  owner.invitation.dispose();
  if (owner.creator) {
    owner.creator.result.dispose();
  } else {
    owner.guestRuntime?.dispose();
  }
};

const sanitizeRoomCodeInput = (value: string): string =>
  value
    .toUpperCase()
    .replaceAll(/[^A-HJ-NP-Z2-9]/gu, '')
    .slice(0, 12);

const safeFailureMessage = (
  operation: LobbyOperation,
  error: unknown
): string => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';
  if (operation === 'copy') {
    if (code === 'clipboard_unavailable' || code === 'clipboard_failed') {
      return 'Clipboard access failed. Allow clipboard access and try again.';
    }
    return 'Could not copy an invitation. Please try again.';
  }
  if (operation === 'join') {
    if (code === 'missing_invitation' || code === 'invalid_handoff') {
      return 'Paste a valid invitation into Room ID before joining.';
    }
    if (code === 'expired_invitation') {
      return 'That invitation has expired. Ask the room creator to copy a new one.';
    }
    return 'Could not join the room. Please try again.';
  }
  return 'Could not generate a room. Please try again.';
};

const InitialCoachingConsent = ({
  runtime,
  consent,
}: {
  readonly runtime: RemoteRoomRuntime;
  readonly consent: boolean;
}) => {
  useEffect(() => {
    let settled = false;
    let attempting = false;
    const apply = (): void => {
      if (settled || attempting) return;
      const state = runtime.session.getSnapshot();
      if (state.phase !== 'ready' || !state.view) return;
      const resolution = resolveCoachingConsentAction(state.view, consent);
      if (!resolution.ok) {
        if (resolution.reason !== 'stale_player') settled = true;
        return;
      }
      attempting = true;
      const submission = runtime.session.submit(resolution.command);
      if (submission.queued) settled = true;
      attempting = false;
    };
    const unsubscribe = runtime.session.subscribe(apply);
    apply();
    return unsubscribe;
  }, [consent, runtime]);
  return null;
};

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" role="img" aria-label="Copy" focusable="false">
    <rect x="8" y="8" width="11" height="12" rx="1.5" fill="none" />
    <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H8" />
  </svg>
);

/**
 * Isolated v2 port of the existing multiplayer lobby chrome. Bearer invitation
 * text crosses React only inside the synchronous paste/copy boundary; state and
 * rendered markup retain safe room-code/role/expiry receipts exclusively.
 */
export const RemoteRoomLobby = ({
  buildId,
  rendererKind,
  dependencies = defaultDependencies,
}: {
  readonly buildId: string;
  readonly rendererKind: RendererKind;
  readonly dependencies?: RemoteRoomLobbyDependencies;
}) => {
  const boardView = useMemo(createRendererSpikeView, []);
  const ownerRef = useRef<LobbyOwner | undefined>(undefined);
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [coachingConsent, setCoachingConsent] = useState(false);
  const [spectator, setSpectator] = useState(false);
  const [receipt, setReceipt] = useState<RemoteRoomInvitationHandoffReceipt>();
  const [operation, setOperation] = useState<LobbyOperation>();
  const [status, setStatus] = useState<string>();
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [connected, setConnected] = useState<ConnectedRoom>();

  useEffect(() => {
    const owner: LobbyOwner = {
      invitation: dependencies.createInvitationJoinCustody(),
      disposed: false,
    };
    ownerRef.current = owner;
    const handlePageHide = (event: PageTransitionEvent): void => {
      if (!event.persisted) disposeOwner(owner);
    };
    globalThis.addEventListener('pagehide', handlePageHide);
    return () => {
      globalThis.removeEventListener('pagehide', handlePageHide);
      if (ownerRef.current === owner) ownerRef.current = undefined;
      disposeOwner(owner);
    };
  }, [dependencies]);

  const beginOperation = (
    kind: LobbyOperation
  ):
    | { readonly owner: LobbyOwner; readonly abort: AbortController }
    | undefined => {
    const owner = ownerRef.current;
    if (!owner || owner.disposed || owner.operation) return undefined;
    const abort = new AbortController();
    owner.operation = { kind, abort };
    setOperation(kind);
    return { owner, abort };
  };

  const endOperation = (owner: LobbyOwner): void => {
    owner.operation = undefined;
    if (ownerRef.current === owner && !owner.disposed) setOperation(undefined);
  };

  const handleGenerate = async (): Promise<void> => {
    const active = beginOperation('generate');
    if (!active) return;
    const displayName = normalizeDisplayName(
      name,
      dependencies.fallbackDisplayName
    );
    setStatus('Generating room…');
    try {
      const result = await dependencies.createRoom({
        buildId,
        displayName,
        mode: 'multiplayer',
        rendererKind,
        signal: active.abort.signal,
      });
      if (active.owner.disposed || ownerRef.current !== active.owner) {
        result.dispose();
        return;
      }
      const previous = active.owner.creator;
      active.owner.creator = { result, displayName };
      active.owner.guestRuntime = undefined;
      previous?.result.dispose();
      active.owner.invitation.clear();
      setName(displayName);
      setRoomCode(result.invitations.roomCode);
      setReceipt(undefined);
      setCopyConfirmed(false);
      setStatus('Room generated. Copy a temporary invitation to share it.');
    } catch (error) {
      if (!active.owner.disposed) {
        setStatus(safeFailureMessage('generate', error));
      }
    } finally {
      endOperation(active.owner);
    }
  };

  const handleCopy = async (): Promise<void> => {
    const active = beginOperation('copy');
    if (!active) return;
    const creator = active.owner.creator;
    if (
      !creator ||
      roomCode.trim().toUpperCase() !== creator.result.invitations.roomCode
    ) {
      setStatus('Generate a room before copying an invitation.');
      endOperation(active.owner);
      return;
    }
    setStatus('Copying temporary invitation…');
    setCopyConfirmed(false);
    try {
      const copy = spectator
        ? creator.result.invitations.copySpectatorInvitation(
            undefined,
            active.abort.signal
          )
        : creator.result.invitations.copyPlayerInvitation(
            undefined,
            active.abort.signal
          );
      const copied = await copy;
      if (active.owner.disposed) return;
      if (active.owner.copyReset !== undefined) {
        clearTimeout(active.owner.copyReset);
      }
      setCopyConfirmed(true);
      active.owner.copyReset = setTimeout(() => {
        if (ownerRef.current === active.owner && !active.owner.disposed) {
          setCopyConfirmed(false);
        }
      }, 1_000);
      setStatus(
        `${copied.requestedRole === 'spectator' ? 'Spectator' : 'Player'} invitation copied.`
      );
    } catch (error) {
      if (!active.owner.disposed) {
        setStatus(safeFailureMessage('copy', error));
      }
    } finally {
      endOperation(active.owner);
    }
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLInputElement>): void => {
    const owner = ownerRef.current;
    if (!owner || owner.disposed) {
      event.preventDefault();
      return;
    }
    try {
      const accepted = owner.invitation.acceptPaste({
        clipboardData: event.clipboardData,
        preventDefault: () => event.preventDefault(),
      });
      setReceipt(accepted);
      setRoomCode(accepted.roomCode);
      setSpectator(accepted.requestedRole === 'spectator');
      setStatus(
        `${accepted.requestedRole === 'spectator' ? 'Spectator' : 'Player'} invitation ready.`
      );
    } catch (error) {
      setReceipt(undefined);
      setStatus(safeFailureMessage('join', error));
    }
  };

  const handleRoomCodeChange = (value: string): void => {
    const owner = ownerRef.current;
    if (receipt && owner && !owner.disposed && !owner.operation) {
      owner.invitation.clear();
      setReceipt(undefined);
    }
    setRoomCode(sanitizeRoomCodeInput(value));
  };

  const handleJoin = async (): Promise<void> => {
    const owner = ownerRef.current;
    if (!owner || owner.disposed || owner.operation) return;
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    const creator = owner.creator;
    if (
      !receipt &&
      creator &&
      normalizedRoomCode === creator.result.invitations.roomCode
    ) {
      if (name.trim() !== creator.displayName) {
        setStatus('Your name changed. Generate a new room before joining.');
        return;
      }
      setConnected({
        runtime: creator.result.runtime,
        rendererKind,
        coachingConsent,
      });
      return;
    }

    const active = beginOperation('join');
    if (!active) return;
    const displayName = normalizeDisplayName(
      name,
      dependencies.fallbackDisplayName
    );
    setStatus('Joining room…');
    try {
      const result = await active.owner.invitation.bootstrap({
        buildId,
        displayName,
        rendererKind,
        signal: active.abort.signal,
      });
      if (active.owner.disposed || ownerRef.current !== active.owner) {
        result.runtime.dispose();
        return;
      }
      active.owner.guestRuntime = result.runtime;
      active.owner.creator?.result.dispose();
      active.owner.creator = undefined;
      setName(displayName);
      setConnected({
        runtime: result.runtime,
        rendererKind,
        coachingConsent,
      });
    } catch (error) {
      if (!active.owner.disposed) setStatus(safeFailureMessage('join', error));
    } finally {
      endOperation(active.owner);
    }
  };

  if (connected) {
    return (
      <>
        <InitialCoachingConsent
          runtime={connected.runtime}
          consent={connected.coachingConsent}
        />
        <RemoteRoomRoute
          runtime={connected.runtime}
          rendererKind={connected.rendererKind}
        />
      </>
    );
  }

  const busy = operation !== undefined;
  return (
    <main className="app-shell" data-app-route="remote-room-lobby">
      <section className="board-column" aria-label="Game board">
        <RendererSpikeBoard
          view={boardView}
          rendererKind={rendererKind}
          onIntent={() => undefined}
          submitCommand={() => undefined}
          sessionReady={false}
        />
      </section>
      <aside className="legacy-sidebar legacy-room-sidebar">
        <nav
          id="topButtonContainer"
          className="legacy-tabs legacy-room-tabs"
          aria-label="Application sections"
        >
          <button id="p1Button" type="button" className="not-selected-page">
            Solo
          </button>
          <button
            id="p2Button"
            type="button"
            className="selected-page"
            aria-current="page"
          >
            Multiplayer
          </button>
          <button
            id="deckImportButton"
            type="button"
            className="not-selected-page"
          >
            Deck
          </button>
          <button
            id="settingsButton"
            type="button"
            className="not-selected-page"
          >
            Settings
          </button>
        </nav>
        <section
          id="p2Box"
          className="legacy-room-sidebox legacy-lobby-sidebox"
        >
          <div id="p2ExplanationBox">
            <strong>Online Multiplayer Mode</strong>
            <div className="legacy-explanation-gap" />
            Generate a room, then copy a temporary invitation to share only with
            the intended player or spectator. Recipients paste it into Room ID
            before joining.
          </div>
          <div id="lobby" aria-busy={busy}>
            <input
              id="nameInput"
              type="text"
              placeholder="Name"
              aria-label="Name"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
            <div id="roomId">
              <input
                id="roomIdInput"
                type="text"
                placeholder="Room ID"
                aria-label="Room ID"
                value={roomCode}
                disabled={busy}
                onPaste={handlePaste}
                onDrop={(event) => {
                  event.preventDefault();
                  setStatus('Paste a temporary invitation into Room ID.');
                }}
                onChange={(event) => handleRoomCodeChange(event.target.value)}
              />
              <button
                id="copyButton"
                type="button"
                className={copyConfirmed ? 'copied' : undefined}
                aria-label="Copy invitation"
                disabled={busy}
                onClick={() => void handleCopy()}
              >
                <CopyIcon />
              </button>
              <button
                id="generateIdButton"
                type="button"
                disabled={busy}
                onClick={() => void handleGenerate()}
              >
                Generate
              </button>
            </div>
            <div id="coachingModeLabel">
              <input
                type="checkbox"
                id="coachingModeCheckbox"
                checked={coachingConsent}
                disabled={busy}
                onChange={(event) => setCoachingConsent(event.target.checked)}
              />
              <label htmlFor="coachingModeCheckbox">
                Enable board flip <span>(both players must enable)</span>
              </label>
            </div>
            <div id="spectatorModeLabel">
              <input
                type="checkbox"
                id="spectatorModeCheckbox"
                checked={spectator}
                disabled={busy || receipt !== undefined}
                onChange={(event) => setSpectator(event.target.checked)}
              />
              <label htmlFor="spectatorModeCheckbox">Join as spectator</label>
            </div>
            <button
              id="joinRoomButton"
              type="button"
              disabled={busy}
              onClick={() => void handleJoin()}
            >
              Join Room
            </button>
          </div>
          {status && (
            <p className="lobby-status" role="status" aria-live="polite">
              {status}
            </p>
          )}
        </section>
      </aside>
    </main>
  );
};
