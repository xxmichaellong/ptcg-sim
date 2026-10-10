import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { SignInIcon } from '@phosphor-icons/react/dist/csr/SignIn';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import {
  createEmptyBoardView,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, ReactNode } from 'react';

import { ROOM_DEFAULT_PREFERENCES } from './room-preferences.js';
import {
  RendererSpikeBoard,
  type RendererKind,
} from '../RendererSpikeBoard.js';
import { resolveCoachingConsentAction } from '../board/resolveCoachingConsentAction.js';
import type { LegacyDeckBuilderCustody } from '../features/deck/LegacyDeckBuilderSession.js';
import {
  createRemoteRoom,
  RemoteRoomInvitationError,
  type RemoteRoomCreationResult,
} from './RemoteRoomCreation.js';
import {
  RemoteRoomInvitationJoinCustody,
  type RemoteRoomInvitationHandoffReceipt,
} from './RemoteRoomInvitationHandoff.js';
import { LegacyWelcome } from './LegacyWelcome.js';
import { RemoteRoomRoute } from './RemoteRoomRoute.js';
import { RemoteSessionBoard } from './RemoteSessionBoard.js';
import {
  RemoteRoomRestorationCustody,
  type RemoteRoomRestorationInput,
} from './RemoteRoomRestoration.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';
import { RemoteRoomSettings } from './RemoteRoomSettings.js';
import {
  roomBackgroundCssImage,
  type BrowserRoomBackgroundRequest,
} from './browser-room-background.js';
import type { BrowserCardBackRequest } from './browser-card-back.js';
import { probeContinuationAvailability } from './browser-continuation-availability.js';
import { useRoomBackground } from './useRoomBackground.js';

import '../design/panel-controls.css';
import './lobby.css';

const LegacyDeckBuilderSession = lazy(async () => ({
  default: (await import('../features/deck/LegacyDeckBuilderSession.js'))
    .LegacyDeckBuilderSession,
}));

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

type LobbyOperation = 'solo' | 'generate' | 'copy' | 'join' | 'resume';

interface InvitationJoinCustody {
  readonly acceptPaste: RemoteRoomInvitationJoinCustody['acceptPaste'];
  readonly bootstrap: RemoteRoomInvitationJoinCustody['bootstrap'];
  readonly clear: RemoteRoomInvitationJoinCustody['clear'];
  readonly dispose: RemoteRoomInvitationJoinCustody['dispose'];
}

interface RoomRestorationCustody {
  readonly matchesHandoff: (contents: string) => boolean;
  readonly restore: (
    input: RemoteRoomRestorationInput
  ) => Promise<{ readonly runtime: RemoteRoomRuntime }>;
  readonly dispose: () => void;
}

interface LobbyOwner {
  invitation: InvitationJoinCustody;
  disposed: boolean;
  /** The Solo landing has been started for this owner. */
  landedOnSolo?: boolean;
  operation?: {
    readonly kind: LobbyOperation;
    readonly abort: AbortController;
  };
  creator?: {
    readonly result: RemoteRoomCreationResult;
    readonly displayName: string;
  };
  guestRuntime?: RemoteRoomRuntime;
  restoration?: RoomRestorationCustody;
  copyReset?: ReturnType<typeof setTimeout>;
}

export interface RemoteRoomLobbyDependencies {
  readonly createRoom: typeof createRemoteRoom;
  readonly createInvitationJoinCustody: () => InvitationJoinCustody;
  readonly fallbackDisplayName: () => string;
  readonly requestBackground?: BrowserRoomBackgroundRequest;
  readonly requestCardBack?: BrowserCardBackRequest;
  readonly createRestorationCustody?: (
    contents: string
  ) => RoomRestorationCustody;
  /** Whether the Worker answers online save and resume; absent reads as off. */
  readonly continuationAvailability?: (signal: AbortSignal) => Promise<boolean>;
}

const defaultDependencies: RemoteRoomLobbyDependencies = {
  createRoom: createRemoteRoom,
  continuationAvailability: probeContinuationAvailability,
  createInvitationJoinCustody: () => new RemoteRoomInvitationJoinCustody(),
  fallbackDisplayName: () => {
    const index = Math.floor(Math.random() * LEGACY_FALLBACK_NAMES.length);
    return LEGACY_FALLBACK_NAMES[index] ?? 'Player';
  },
};

interface ConnectedRoom {
  readonly runtime: RemoteRoomRuntime;
  readonly rendererKind: RendererKind;
  readonly mode: 'solo' | 'multiplayer';
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
  owner.restoration?.dispose();
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
  if (operation === 'solo') {
    return 'Could not start Solo mode. Please try again.';
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

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

/**
 * Isolated v2 port of the existing multiplayer lobby chrome. Bearer invitation
 * text crosses React only inside the synchronous paste/copy boundary; state and
 * rendered markup retain safe room-code/role/expiry receipts exclusively.
 */
export const RemoteRoomLobby = ({
  buildId,
  rendererKind,
  landing = 'lobby',
  dependencies = defaultDependencies,
}: {
  readonly buildId: string;
  readonly rendererKind: RendererKind;
  /**
   * v1 opens on the Solo table; `solo` starts a solo room as soon as the
   * lobby mounts, and `lobby` waits on the Multiplayer panel instead.
   */
  readonly landing?: 'solo' | 'lobby';
  readonly dependencies?: RemoteRoomLobbyDependencies;
}) => {
  const emptyBoardView = useMemo(createEmptyBoardView, []);
  const ownerRef = useRef<LobbyOwner | undefined>(undefined);
  const preparedDeckSessions = useRef(new WeakSet<object>());
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [coachingConsent, setCoachingConsent] = useState(false);
  const [spectator, setSpectator] = useState(false);
  const [receipt, setReceipt] = useState<RemoteRoomInvitationHandoffReceipt>();
  const [operation, setOperation] = useState<LobbyOperation>();
  const [status, setStatus] = useState<string>();
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [connected, setConnected] = useState<ConnectedRoom>();
  const [parkedSolo, setParkedSolo] = useState<ConnectedRoom>();
  // 'solo' is the Solo panel while its room is still being created (or has
  // failed): v1 opens on Solo, so the page must not flash Multiplayer first.
  const [activePanel, setActivePanel] = useState<
    'lobby' | 'deck' | 'settings' | 'solo'
  >(landing === 'solo' ? 'solo' : 'lobby');
  const [deckSurfaceActivated, setDeckSurfaceActivated] = useState(false);
  const [deckCustody, setDeckCustody] = useState<LegacyDeckBuilderCustody>();
  const [preferences, setPreferences] = useState<
    BoardPreferences | undefined
  >();
  const [hideOpponentHand, setHideOpponentHand] = useState(false);
  const [continuationAvailable, setContinuationAvailable] = useState<
    boolean | undefined
  >();
  const backgroundSelection = useRoomBackground({
    ...(dependencies.requestBackground
      ? { requestBackground: dependencies.requestBackground }
      : {}),
  });
  const effectivePreferences = preferences ?? ROOM_DEFAULT_PREFERENCES;
  const setDarkMode = (enabled: boolean): void => {
    setPreferences((current) => ({
      ...(current ?? ROOM_DEFAULT_PREFERENCES),
      darkMode: enabled,
    }));
  };
  const setZoneOutlines = (visible: boolean): void => {
    setPreferences((current) => ({
      ...(current ?? ROOM_DEFAULT_PREFERENCES),
      showZoneOutlines: visible,
    }));
  };

  // The lobby page wears the table's theme (Night or Day) like the room
  // route does; once a room is connected the route owns it.
  useEffect(() => {
    if (connected) return;
    document.documentElement.dataset.theme = effectivePreferences.darkMode
      ? 'night'
      : 'day';
  }, [connected, effectivePreferences.darkMode]);

  // Asked once, and only when a multiplayer room opens: Solo has no save or
  // resume controls, and the lobby makes no authority request on its own.
  const inMultiplayerRoom = connected?.mode === 'multiplayer';
  useEffect(() => {
    const probe = dependencies.continuationAvailability;
    if (!probe || !inMultiplayerRoom || continuationAvailable !== undefined) {
      return;
    }
    const abort = new AbortController();
    void probe(abort.signal).then(
      (available) => {
        if (!abort.signal.aborted) setContinuationAvailable(available);
      },
      () => undefined
    );
    return () => abort.abort();
  }, [dependencies, inMultiplayerRoom, continuationAvailable]);

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

  useEffect(() => {
    // Guarded per owner rather than per component: StrictMode replays the
    // owner effect with a fresh owner, and the first owner's room creation
    // is discarded on arrival because that owner was disposed.
    const owner = ownerRef.current;
    if (landing !== 'solo' || !owner || owner.disposed || owner.landedOnSolo)
      return;
    owner.landedOnSolo = true;
    void handleSolo();
  });

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
      // Reading the Multiplayer panel leaves a live Solo table alone; a room
      // that actually exists is the real transition, and that is where v1's
      // park belongs. A refused generate leaves the table where it was.
      parkSoloForMultiplayer();
      const previous = active.owner.creator;
      active.owner.creator = { result, displayName };
      active.owner.guestRuntime?.dispose();
      delete active.owner.guestRuntime;
      previous?.result.dispose();
      setParkedSolo(undefined);
      active.owner.invitation.clear();
      setName(displayName);
      setRoomCode(result.invitations.roomCode);
      setReceipt(undefined);
      setCopyConfirmed(false);
      // A retry that works retires the failure it follows.
      setStatus(undefined);
    } catch (error) {
      if (!active.owner.disposed) {
        setStatus(safeFailureMessage('generate', error));
      }
    } finally {
      endOperation(active.owner);
    }
  };

  const handleSolo = async (): Promise<void> => {
    setActivePanel('solo');
    if (parkedSolo) {
      setParkedSolo(undefined);
      setConnected(parkedSolo);
      return;
    }
    const active = beginOperation('solo');
    if (!active) return;
    // v1's solo table is always Blue against Red, whatever the Multiplayer
    // Name box says.
    const displayName = 'Blue';
    try {
      const result = await dependencies.createRoom({
        buildId,
        displayName,
        mode: 'solo',
        rendererKind,
        signal: active.abort.signal,
      });
      if (active.owner.disposed || ownerRef.current !== active.owner) {
        result.dispose();
        return;
      }
      const previous = active.owner.creator;
      active.owner.creator = { result, displayName };
      active.owner.guestRuntime?.dispose();
      delete active.owner.guestRuntime;
      previous?.result.dispose();
      active.owner.invitation.clear();
      // Solo's fixed name is never written back into the Multiplayer Name
      // box, which v1 leaves for the visitor to fill in themselves.
      setRoomCode('');
      setReceipt(undefined);
      setCoachingConsent(false);
      setCopyConfirmed(false);
      setStatus(undefined);
      setConnected({
        runtime: result.runtime,
        rendererKind,
        mode: result.mode,
        coachingConsent: false,
      });
    } catch (error) {
      if (!active.owner.disposed) {
        setStatus(safeFailureMessage('solo', error));
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
      await copy;
      if (active.owner.disposed) return;
      if (active.owner.copyReset !== undefined) {
        clearTimeout(active.owner.copyReset);
      }
      setCopyConfirmed(true);
      setStatus(undefined);
      active.owner.copyReset = setTimeout(() => {
        if (ownerRef.current === active.owner && !active.owner.disposed) {
          setCopyConfirmed(false);
        }
      }, 1_000);
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
    // No park here: a join that succeeds replaces the live table outright,
    // and one that is refused must leave both the table and the pasted
    // invitation where they were.
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
        mode: creator.result.mode,
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
    try {
      const result = await active.owner.invitation.bootstrap({
        buildId,
        displayName,
        rendererKind,
        asSpectator: spectator,
        signal: active.abort.signal,
      });
      if (active.owner.disposed || ownerRef.current !== active.owner) {
        result.runtime.dispose();
        return;
      }
      active.owner.guestRuntime = result.runtime;
      active.owner.creator?.result.dispose();
      active.owner.creator = undefined;
      setParkedSolo(undefined);
      setName(displayName);
      setConnected({
        runtime: result.runtime,
        rendererKind,
        mode: 'multiplayer',
        coachingConsent,
      });
    } catch (error) {
      if (!active.owner.disposed) setStatus(safeFailureMessage('join', error));
    } finally {
      endOperation(active.owner);
    }
  };

  const handleLeave = (): void => {
    const owner = ownerRef.current;
    if (!owner || owner.disposed || owner.operation) return;
    const nextInvitation = dependencies.createInvitationJoinCustody();
    if (owner.copyReset !== undefined) {
      clearTimeout(owner.copyReset);
      delete owner.copyReset;
    }
    owner.invitation.dispose();
    owner.invitation = nextInvitation;
    owner.restoration?.dispose();
    delete owner.restoration;
    if (owner.creator) {
      owner.creator.result.dispose();
      delete owner.creator;
    } else {
      owner.guestRuntime?.dispose();
      delete owner.guestRuntime;
    }
    setReceipt(undefined);
    setRoomCode('');
    setCoachingConsent(false);
    setCopyConfirmed(false);
    setConnected(undefined);
    setParkedSolo(undefined);
    setStatus(undefined);
  };

  const handleResumeSavedGame = async (
    contents: string,
    deliverOpponentInvitation: RemoteRoomRestorationInput['deliverOpponentInvitation'],
    signal: AbortSignal
  ): Promise<void> => {
    const active = beginOperation('resume');
    if (!active) throw new Error('A room operation is already in progress');
    const displayName = normalizeDisplayName(
      name,
      dependencies.fallbackDisplayName
    );
    try {
      let restoration = active.owner.restoration;
      if (!restoration?.matchesHandoff(contents)) {
        const replacement = dependencies.createRestorationCustody
          ? dependencies.createRestorationCustody(contents)
          : new RemoteRoomRestorationCustody(contents);
        restoration?.dispose();
        restoration = replacement;
        active.owner.restoration = replacement;
      }
      const combinedSignal = AbortSignal.any([active.abort.signal, signal]);
      const result = await restoration.restore({
        buildId,
        displayName,
        rendererKind,
        deliverOpponentInvitation,
        signal: combinedSignal,
      });
      if (
        combinedSignal.aborted ||
        active.owner.disposed ||
        ownerRef.current !== active.owner
      ) {
        result.runtime.dispose();
        return;
      }

      const previousCreator = active.owner.creator;
      const previousGuest = active.owner.guestRuntime;
      active.owner.guestRuntime = result.runtime;
      delete active.owner.creator;
      delete active.owner.restoration;
      setParkedSolo(undefined);
      setName(displayName);
      setReceipt(undefined);
      setRoomCode(result.runtime.roomCode);
      setCoachingConsent(false);
      setCopyConfirmed(false);
      setConnected({
        runtime: result.runtime,
        rendererKind,
        mode: 'multiplayer',
        coachingConsent: false,
      });
      previousCreator?.result.dispose();
      if (previousGuest && previousGuest !== result.runtime) {
        previousGuest.dispose();
      }
    } finally {
      endOperation(active.owner);
    }
  };

  /** In-room copy for the creator: v1's room header copy button. */
  const handleCopyInvitationFromRoom = async (
    role: 'player' | 'spectator'
  ): Promise<boolean> => {
    const owner = ownerRef.current;
    const creator = owner?.creator;
    if (!owner || owner.disposed || !creator) return false;
    const invitations = creator.result.invitations;
    if (role === 'spectator') {
      await invitations.copySpectatorInvitation();
      return true;
    }
    // One key, as in v1: a player invitation while a seat is free (its
    // holder may still choose to watch), a spectator invitation once both
    // seats are taken.
    try {
      await invitations.copyPlayerInvitation();
    } catch (error) {
      if (
        !(error instanceof RemoteRoomInvitationError) ||
        error.code !== 'seat_unavailable'
      ) {
        throw error;
      }
      await invitations.copySpectatorInvitation();
    }
    return true;
  };

  /**
   * Moves a live Solo table into the park so the Multiplayer panel's own
   * room can take the screen. Doing nothing when Solo is not live keeps this
   * safe to call from every entry point into a multiplayer room.
   */
  const parkSoloForMultiplayer = (): void => {
    if (connected?.mode === 'solo') handleMultiplayerNavigate();
  };

  const handleMultiplayerNavigate = (): void => {
    if (!connected || connected.mode !== 'solo') return;
    setParkedSolo(connected);
    setConnected(undefined);
    setActivePanel('lobby');
    setReceipt(undefined);
    setRoomCode('');
    setCopyConfirmed(false);
    // v1 says nothing when you leave the Solo tab; the game simply waits.
    setStatus(undefined);
  };

  const busy = operation !== undefined;

  /**
   * v1's Multiplayer tab is a panel in the sidebar, not another page. The
   * lobby owns its state, so it renders the panel and hands it to whoever
   * shows the sidebar: itself, or a live Solo room that must stay mounted
   * while its owner reads it.
   */
  const renderMultiplayerPanel = (hidden: boolean): ReactNode => (
    <section
      id="p2Box"
      className="legacy-room-sidebox legacy-lobby-sidebox"
      hidden={hidden}
    >
      <div className="lobby-panel">
        <div id="lobby" className="lobby-form" aria-busy={busy}>
          <section className="lobby-intro" aria-labelledby="lobbyTitle">
            <header id="p2ExplanationBox" className="lobby-intro-head">
              <span className="lobby-intro-icon">
                <UsersThreeIcon {...decorative} weight="duotone" />
              </span>
              <div className="lobby-intro-copy">
                <h2 id="lobbyTitle" className="lobby-intro-title">
                  Online Multiplayer Mode
                </h2>
                <p className="lobby-intro-text">
                  Generate a room, then copy a temporary invitation for one
                  player or spectator. They paste it into Room ID to join.
                </p>
              </div>
            </header>
            <div className="ds-field">
              <label className="ds-label" htmlFor="nameInput">
                Name
              </label>
              <input
                id="nameInput"
                className="ds-input"
                type="text"
                placeholder="Name"
                autoComplete="nickname"
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </section>
          <section className="lobby-step" aria-labelledby="lobbyHostTitle">
            <div className="lobby-step-head">
              <span className="lobby-step-number" aria-hidden="true">
                1
              </span>
              <div className="lobby-step-copy">
                <h3 id="lobbyHostTitle" className="lobby-step-title">
                  Host a room
                </h3>
                <p className="ds-hint">
                  Generate a room, copy an invitation and send it to your
                  opponent. Turn on <em>Join as spectator</em> to copy a
                  spectator invitation instead.
                </p>
              </div>
            </div>
            <div className="lobby-step-actions">
              <button
                id="generateIdButton"
                type="button"
                className="ds-button ds-button--primary"
                disabled={busy}
                onClick={() => void handleGenerate()}
              >
                {operation === 'generate' ? (
                  <CircleNotchIcon
                    {...decorative}
                    weight="bold"
                    className="ds-spin"
                  />
                ) : (
                  <PlusIcon {...decorative} weight="bold" />
                )}
                {operation === 'generate' ? 'Generating…' : 'Generate'}
              </button>
              <button
                id="copyButton"
                type="button"
                className={`ds-button ds-button--secondary lobby-copy${
                  copyConfirmed ? ' copied' : ''
                }`}
                aria-label="Copy invitation"
                disabled={busy}
                onClick={() => void handleCopy()}
              >
                <span className="lobby-copy-icon">
                  {copyConfirmed ? (
                    <CheckIcon key="copied" {...decorative} weight="bold" />
                  ) : (
                    <CopyIcon key="copy" {...decorative} weight="bold" />
                  )}
                </span>
                <span aria-hidden="true">
                  {copyConfirmed ? 'Copied' : 'Copy invitation'}
                </span>
              </button>
            </div>
          </section>
          <section className="lobby-step" aria-labelledby="lobbyJoinTitle">
            <div className="lobby-step-head">
              <span className="lobby-step-number" aria-hidden="true">
                2
              </span>
              <div className="lobby-step-copy">
                <h3 id="lobbyJoinTitle" className="lobby-step-title">
                  Join a room
                </h3>
                <p className="ds-hint">
                  Paste the invitation you were sent, or join the room you
                  generated.
                </p>
              </div>
            </div>
            <div id="roomId" className="ds-field">
              <label className="ds-label" htmlFor="roomIdInput">
                Room ID
              </label>
              <input
                id="roomIdInput"
                className="ds-input lobby-room-input"
                type="text"
                placeholder="Paste an invitation"
                autoComplete="off"
                spellCheck={false}
                value={roomCode}
                disabled={busy}
                onPaste={handlePaste}
                onDrop={(event) => {
                  event.preventDefault();
                  setStatus('Paste a temporary invitation into Room ID.');
                }}
                onChange={(event) => handleRoomCodeChange(event.target.value)}
              />
            </div>
            <div className="lobby-switches">
              <div id="spectatorModeLabel" className="ds-switch-row">
                <input
                  type="checkbox"
                  id="spectatorModeCheckbox"
                  className="ds-switch"
                  checked={spectator}
                  // A spectator invitation only ever watches; a player
                  // invitation leaves the choice to its holder, as v1's room
                  // key did.
                  disabled={busy || receipt?.requestedRole === 'spectator'}
                  onChange={(event) => setSpectator(event.target.checked)}
                />{' '}
                <label htmlFor="spectatorModeCheckbox">Join as spectator</label>
              </div>
              <div id="coachingModeLabel" className="ds-switch-row">
                <input
                  type="checkbox"
                  id="coachingModeCheckbox"
                  className="ds-switch"
                  checked={coachingConsent}
                  disabled={busy}
                  onChange={(event) => setCoachingConsent(event.target.checked)}
                />{' '}
                <label htmlFor="coachingModeCheckbox">
                  Enable board flip <span>(both players must enable)</span>
                </label>
              </div>
            </div>
            <button
              id="joinRoomButton"
              type="button"
              className="ds-button ds-button--primary ds-button--block"
              disabled={busy}
              onClick={() => void handleJoin()}
            >
              {operation === 'join' ? (
                <CircleNotchIcon
                  {...decorative}
                  weight="bold"
                  className="ds-spin"
                />
              ) : (
                <SignInIcon {...decorative} weight="bold" />
              )}
              {operation === 'join' ? 'Joining…' : 'Join Room'}
            </button>
          </section>
        </div>
        {status && (
          <p
            className="lobby-status ds-notice ds-notice--danger"
            role="status"
            aria-live="polite"
          >
            <WarningCircleIcon {...decorative} weight="bold" />
            <span>{status}</span>
          </p>
        )}
      </div>
    </section>
  );

  if (connected) {
    return (
      <>
        {connected.mode === 'multiplayer' && (
          <InitialCoachingConsent
            runtime={connected.runtime}
            consent={connected.coachingConsent}
          />
        )}
        <RemoteRoomRoute
          runtime={connected.runtime}
          rendererKind={connected.rendererKind}
          roomMode={connected.mode}
          {...(deckCustody
            ? {
                deckStore: deckCustody.store,
                cardBackStore: deckCustody.cardBackStore,
              }
            : {})}
          deckSurfaceActivated={deckSurfaceActivated}
          onDeckSurfaceActivate={() => setDeckSurfaceActivated(true)}
          onDeckCustodyChange={setDeckCustody}
          deckSessionPrepared={preparedDeckSessions.current.has(
            connected.runtime.session
          )}
          onDeckSessionAttach={() =>
            preparedDeckSessions.current.add(connected.runtime.session)
          }
          onLeave={handleLeave}
          continuationAvailable={continuationAvailable ?? false}
          onResumeSavedGame={handleResumeSavedGame}
          onMultiplayerNavigate={handleMultiplayerNavigate}
          {...(connected.mode === 'solo'
            ? {
                multiplayerPanel: renderMultiplayerPanel,
                onMultiplayerPanelOpen: () => setActivePanel('lobby'),
              }
            : {})}
          {...(connected.mode === 'multiplayer' && ownerRef.current?.creator
            ? { onCopyInvitation: handleCopyInvitationFromRoom }
            : {})}
          {...(preferences ? { preferences } : {})}
          onPreferencesChange={setPreferences}
          hideOpponentHand={hideOpponentHand}
          onHideOpponentHandChange={setHideOpponentHand}
          {...(backgroundSelection.background
            ? { background: backgroundSelection.background }
            : {})}
          onBackgroundChange={backgroundSelection.setBackground}
          {...(dependencies.requestBackground
            ? { requestBackground: dependencies.requestBackground }
            : {})}
          {...(dependencies.requestCardBack
            ? { requestCardBack: dependencies.requestCardBack }
            : {})}
        />
      </>
    );
  }
  return (
    <main
      className={`app-shell remote-room-route${
        effectivePreferences.darkMode ? ' remote-room-route--dark' : ''
      }`}
      data-app-route="remote-room-lobby"
      data-dark-mode={String(effectivePreferences.darkMode)}
      data-room-background={backgroundSelection.background?.kind ?? 'default'}
      style={
        backgroundSelection.background
          ? {
              backgroundImage: roomBackgroundCssImage(
                backgroundSelection.background
              ),
              backgroundSize: '100% 100%',
              backgroundRepeat: 'no-repeat',
            }
          : undefined
      }
    >
      <section className="board-column" aria-label="Game board">
        {parkedSolo ? (
          // v1 keeps the table on screen while the Multiplayer panel is
          // open; the parked solo game stays live and playable here too.
          <RemoteSessionBoard
            session={parkedSolo.runtime.session}
            replay={parkedSolo.runtime.replay}
            rendererKind={parkedSolo.rendererKind}
            onIntent={() => undefined}
            roomMode="solo"
            hideOpponentHand={hideOpponentHand}
            // Test doubles may stand in for the runtime without a presentation.
            coinFlip={parkedSolo.runtime.presentation?.coinFlip}
            {...(preferences ? { preferences } : {})}
          />
        ) : (
          <RendererSpikeBoard
            view={emptyBoardView}
            rendererKind={rendererKind}
            onIntent={() => undefined}
            submitCommand={() => undefined}
            sessionReady={false}
            {...(preferences ? { preferences } : {})}
          />
        )}
      </section>
      <aside className="legacy-sidebar legacy-room-sidebar">
        <nav
          id="topButtonContainer"
          className="legacy-tabs legacy-room-tabs"
          aria-label="Application sections"
        >
          <button
            id="p1Button"
            type="button"
            className={
              activePanel === 'solo' ? 'selected-page' : 'not-selected-page'
            }
            aria-current={activePanel === 'solo' ? 'page' : undefined}
            disabled={busy}
            onClick={() => void handleSolo()}
          >
            Solo
          </button>
          <button
            id="p2Button"
            type="button"
            className={
              activePanel === 'lobby' ? 'selected-page' : 'not-selected-page'
            }
            aria-current={activePanel === 'lobby' ? 'page' : undefined}
            onClick={() => setActivePanel('lobby')}
          >
            Multiplayer
          </button>
          <button
            id="deckImportButton"
            type="button"
            className={
              activePanel === 'deck' ? 'selected-page' : 'not-selected-page'
            }
            aria-current={activePanel === 'deck' ? 'page' : undefined}
            onClick={() => {
              setDeckSurfaceActivated(true);
              setActivePanel('deck');
            }}
          >
            Deck
          </button>
          <button
            id="settingsButton"
            type="button"
            className={
              activePanel === 'settings' ? 'selected-page' : 'not-selected-page'
            }
            aria-current={activePanel === 'settings' ? 'page' : undefined}
            onClick={() => setActivePanel('settings')}
          >
            Settings
          </button>
        </nav>
        <section
          id="p1Box"
          className="legacy-room-sidebox"
          hidden={activePanel !== 'solo'}
          aria-busy={operation === 'solo'}
        >
          <div className="legacy-presentation-surface">
            <div
              id="chatbox"
              className="legacy-activity-feed"
              role="log"
              aria-label="Game activity"
            >
              <div className="legacy-activity-intro" data-activity-intro="true">
                <LegacyWelcome
                  onLoadDeck={() => {
                    setDeckSurfaceActivated(true);
                    setActivePanel('deck');
                  }}
                />
              </div>
              {status && activePanel === 'solo' && (
                <p className="announcement solo-status" role="status">
                  {status}
                </p>
              )}
            </div>
          </div>
          <div id="chatboxButtonContainer" className="chat-button-container">
            <button
              id="attackButton"
              type="button"
              className="self-color"
              disabled
            >
              Attack
            </button>
            <button
              id="passButton"
              type="button"
              className="self-color"
              disabled
            >
              Pass
            </button>
            <button
              id="undoButton"
              type="button"
              className="self-color"
              disabled
            >
              Undo
            </button>
            <button
              id="FREEBUTTON"
              type="button"
              className="self-color"
              disabled
            >
              🌺
            </button>
          </div>
          <input
            id="messageInput"
            type="text"
            placeholder="Type your message here..."
            disabled
          />
          <div
            id="bottomP1ButtonContainer"
            className="sidebox-button-container"
          >
            <button
              id="setupButton"
              type="button"
              className="self-color"
              disabled
            >
              Set Up
            </button>
            <button
              id="resetButton"
              type="button"
              className="self-color"
              disabled
            >
              Reset
            </button>
            <button
              id="setupBothButton"
              type="button"
              className="neutral-color"
              disabled
            >
              Set Up Both
            </button>
            <button
              id="resetBothButton"
              type="button"
              className="neutral-color"
              disabled
            >
              Reset Both
            </button>
            <button
              id="optionsButton"
              type="button"
              className="neutral-color"
              disabled
            >
              Options
            </button>
          </div>
        </section>
        {renderMultiplayerPanel(activePanel !== 'lobby')}
        <RemoteRoomSettings
          hidden={activePanel !== 'settings'}
          preferences={effectivePreferences}
          hideOpponentHand={hideOpponentHand}
          onDarkModeChange={setDarkMode}
          onZoneOutlinesChange={setZoneOutlines}
          onHideOpponentHandChange={setHideOpponentHand}
          onChangeBackground={backgroundSelection.chooseBackground}
        />
        {deckSurfaceActivated && (
          <Suspense fallback={null}>
            <LegacyDeckBuilderSession
              open={activePanel === 'deck'}
              alternateEnabled={parkedSolo?.mode === 'solo'}
              installOnSessionAttach
              onRequestClose={() => void handleSolo()}
              onCustodyChange={setDeckCustody}
              {...(deckCustody
                ? {
                    store: deckCustody.store,
                    cardBackStore: deckCustody.cardBackStore,
                  }
                : {})}
              {...(dependencies.requestCardBack
                ? { requestCardBack: dependencies.requestCardBack }
                : {})}
            />
          </Suspense>
        )}
      </aside>
    </main>
  );
};
