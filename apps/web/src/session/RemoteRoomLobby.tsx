import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { SignInIcon } from '@phosphor-icons/react/dist/csr/SignIn';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import {
  createEmptyBoardView,
  DEFAULT_BOARD_PREFERENCES,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ClipboardEvent as ReactClipboardEvent, ReactNode } from 'react';

import {
  preferences as pagePreferences,
  type PreferenceStore,
} from '../preferences/preference-store.js';
import { usePreference } from '../preferences/usePreference.js';
import { PLAYER_PREFERENCES } from './player-preferences.js';
import { ROOM_DEFAULT_PREFERENCES } from './room-preferences.js';
import { TABLE_PREFERENCES } from './table-preferences.js';
import {
  RendererSpikeBoard,
  type RendererKind,
} from '../RendererSpikeBoard.js';
import { resolveCoachingConsentAction } from '../board/resolveCoachingConsentAction.js';
import { TableRail } from '../board/rail/TableRail.js';
import {
  boardViewSettings,
  oncePerGameMarkerCount,
} from '../board/view/board-view-settings.js';
import type { DeckBuilderCustody } from '../features/deck/DeckBuilderSession.js';
import { LazyDeckBuilderSession } from '../features/deck/LazyDeckBuilderSession.js';
import {
  createRemoteRoom,
  type RemoteRoomCreationResult,
} from './RemoteRoomCreation.js';
import { waitForAdmission } from './wait-for-admission.js';
import {
  RemoteRoomInvitationJoinCustody,
  type RemoteRoomInvitationHandoffReceipt,
} from './RemoteRoomInvitationHandoff.js';
import { RemoteRoomRoute } from './RemoteRoomRoute.js';
import { RemoteSessionBoard } from './RemoteSessionBoard.js';
import { COARSE_POINTER_QUERY, useMediaQuery } from '../ui/breakpoints.js';
import {
  RemoteRoomRestorationCustody,
  type RemoteRoomRestorationInput,
} from './RemoteRoomRestoration.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';
import type { BrowserRoomBackgroundRequest } from './browser-room-background.js';
import type { BrowserCardBackRequest } from './browser-card-back.js';
import { probeContinuationAvailability } from './browser-continuation-availability.js';
import { requestBrowserFullscreen } from './browser-room-options.js';
import { useBoardLook } from './useBoardLook.js';
import {
  POINTER_SEAM_BAND_PX,
  TOUCH_SEAM_BAND_PX,
} from '../board/table-seam.js';
import { useRoomBackground } from './useRoomBackground.js';
import { AppMenu, type AppMenuModel } from './shell/AppMenu.js';
import { DeckLayer } from './shell/DeckLayer.js';
import { OnlineSheet } from './shell/OnlineSheet.js';
import { SettingsSheet } from './shell/SettingsSheet.js';
import { tableCurtain, type TableCurtain } from './shell/table-curtain.js';
import { TableBanner, TableShell } from './shell/TableShell.js';

import '../design/panel-controls.css';
import './lobby.css';

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
  /** Where the table settings and name are remembered: the page's. */
  readonly preferences?: PreferenceStore;
  /** The loading screen over the table: the page's (index.html). */
  readonly curtain?: TableCurtain;
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
  /** Set once admitted; left out, the room keeps its own (a restored game). */
  readonly coachingConsent?: boolean;
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
  const curtain = dependencies.curtain ?? tableCurtain();
  // Which table has painted since the last swap: the empty table, or a
  // game's (the room's, or a parked Solo game). The page opens behind the
  // loading screen (table-curtain.ts), and the first of them to paint lifts
  // it -- except the empty table while it only stands in for a Solo room
  // still being made, which the page never shows on the way to that room.
  const settledTableRef = useRef<'empty' | 'game'>(undefined);
  const preparedDeckSessions = useRef(new WeakSet<object>());
  const restoredDeckSessions = useRef(new WeakSet<object>());
  const store = dependencies.preferences ?? pagePreferences();
  // The name last hosted or joined with, so a returning player need not
  // type it again.
  const [name, setName] = useState(
    () => store.get(PLAYER_PREFERENCES).displayName
  );
  const rememberName = (): void => {
    const typed = name.trim();
    if (typed !== '') store.set(PLAYER_PREFERENCES, { displayName: typed });
  };
  const [roomCode, setRoomCode] = useState('');
  const [coachingConsent, setCoachingConsent] = useState(false);
  const [spectator, setSpectator] = useState(false);
  const [receipt, setReceipt] = useState<RemoteRoomInvitationHandoffReceipt>();
  const [operation, setOperation] = useState<LobbyOperation>();
  const [status, setStatus] = useState<string>();
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [connected, setConnected] = useState<ConnectedRoom>();
  const [parkedSolo, setParkedSolo] = useState<ConnectedRoom>();
  // 'solo' is the Solo table while its room is still being created (or has
  // failed): v1 opens on Solo, so the page must not flash Play online first.
  const [activePanel, setActivePanel] = useState<'lobby' | 'solo'>(
    landing === 'solo' ? 'solo' : 'lobby'
  );
  // The deck screen or Settings, over whichever of those is showing.
  const [overlay, setOverlay] = useState<'deck' | 'settings'>();
  const [deckSurfaceActivated, setDeckSurfaceActivated] = useState(false);
  const [deckCustody, setDeckCustody] = useState<DeckBuilderCustody>();
  // Dark mode is remembered on this device (the page's preferences); the
  // board still receives v1's shape, and nothing while it is the default.
  const table = usePreference(TABLE_PREFERENCES, store);
  const preferences = useMemo(
    (): BoardPreferences | undefined =>
      table.darkMode === ROOM_DEFAULT_PREFERENCES.darkMode
        ? undefined
        : { ...ROOM_DEFAULT_PREFERENCES, darkMode: table.darkMode },
    [table.darkMode]
  );
  const setPreferences = (next: BoardPreferences): void =>
    store.patch(TABLE_PREFERENCES, { darkMode: next.darkMode });
  // How the table is shown is kept on this device (the Board view panel).
  const boardView = useSyncExternalStore(
    boardViewSettings().subscribe,
    boardViewSettings().getSnapshot
  );
  const [continuationAvailable, setContinuationAvailable] = useState<
    boolean | undefined
  >();
  const backgroundSelection = useRoomBackground({
    ...(table.background ? { background: table.background } : {}),
    onBackgroundChange: (background) =>
      store.patch(TABLE_PREFERENCES, { background }),
    ...(dependencies.requestBackground
      ? { requestBackground: dependencies.requestBackground }
      : {}),
  });
  const restoreDefaultBackground = (): void =>
    store.patch(TABLE_PREFERENCES, { background: null });
  const effectivePreferences = preferences ?? ROOM_DEFAULT_PREFERENCES;
  const setDarkMode = (enabled: boolean): void =>
    store.patch(TABLE_PREFERENCES, { darkMode: enabled });
  // Both lobby boards wear the table's look as the room will (its view,
  // outlines and motion), each over its own default preferences, so the
  // table keeps its tilt when the room takes over.
  const boardPreferences = useBoardLook(
    preferences ?? ROOM_DEFAULT_PREFERENCES
  );
  const coarsePointer = useMediaQuery(COARSE_POINTER_QUERY);
  const emptyTable = useMemo(
    () => ({
      lowerShare: boardView.split,
      seamBandPx: coarsePointer ? TOUCH_SEAM_BAND_PX : POINTER_SEAM_BAND_PX,
      // The optional pieces as the room will show them.
      ...(boardView.lostZone ? {} : { hideEmptyLostZone: true }),
      ...(oncePerGameMarkerCount(boardView) > 0
        ? { oncePerGameMarkers: oncePerGameMarkerCount(boardView) }
        : {}),
    }),
    [boardView, coarsePointer]
  );
  const emptyBoardPreferences = useBoardLook(
    preferences ?? DEFAULT_BOARD_PREFERENCES
  );

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

  const awaitingSoloRoom = (): boolean => {
    const owner = ownerRef.current;
    if (!owner) return landing === 'solo';
    return (
      owner.operation?.kind === 'solo' ||
      (landing === 'solo' && !owner.landedOnSolo)
    );
  };
  const revealSettledTable = (): void => {
    const settled = settledTableRef.current;
    if (settled === undefined) return;
    if (settled === 'empty' && awaitingSoloRoom()) return;
    curtain.reveal();
  };
  const handleEmptyTableSettled = (settled: boolean): void => {
    settledTableRef.current = settled ? 'empty' : undefined;
    revealSettledTable();
  };
  const handleGameTableSettled = (settled: boolean): void => {
    settledTableRef.current = settled ? 'game' : undefined;
    revealSettledTable();
  };
  // A Solo room that could not be made leaves the empty table to show,
  // with what went wrong.
  useEffect(() => {
    revealSettledTable();
  });

  /**
   * Trades the table on screen for another under the loading screen, so
   * the one never vanishes before the other has painted: the curtain covers
   * the old table, `swap` puts the new one in, and its first paint lifts
   * the curtain. A `swap` that finds nothing to do any more returns false,
   * and the old table lifts it again. Settles once `swap` has run.
   */
  const handOffTable = (swap: () => boolean | void): Promise<void> =>
    new Promise((resolve, reject) => {
      curtain.handOff(() => {
        const previous = settledTableRef.current;
        settledTableRef.current = undefined;
        try {
          if (swap() === false) {
            settledTableRef.current = previous;
            revealSettledTable();
          }
          resolve();
        } catch (error) {
          settledTableRef.current = previous;
          revealSettledTable();
          reject(error);
        }
      });
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
      // The table stays until the new room has admitted its host: a
      // handshake that fails after the room was made must not cost it.
      try {
        await waitForAdmission(result.runtime, active.abort.signal);
      } catch (error) {
        result.dispose();
        throw error;
      }
      if (active.owner.disposed || ownerRef.current !== active.owner) {
        result.dispose();
        return;
      }
      const owner = active.owner;
      const settle = (): boolean => {
        if (owner.disposed || ownerRef.current !== owner) {
          result.dispose();
          return false;
        }
        // Reading the Multiplayer panel leaves a live Solo table alone; a
        // room that actually exists is the real transition, and that is
        // where v1's park belongs. A refused generate leaves the table where
        // it was.
        parkSoloForMultiplayer();
        const previous = owner.creator;
        owner.creator = { result, displayName };
        owner.guestRuntime?.dispose();
        delete owner.guestRuntime;
        previous?.result.dispose();
        setParkedSolo(undefined);
        owner.invitation.clear();
        setName(displayName);
        rememberName();
        setRoomCode(result.invitations.roomCode);
        setReceipt(undefined);
        setCopyConfirmed(false);
        // A retry that works retires the failure it follows.
        setStatus(undefined);
        return true;
      };
      // Leaving a live Solo table for the lobby's trades the table.
      if (connected?.mode === 'solo') await handOffTable(settle);
      else settle();
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
      const parked = parkedSolo;
      await handOffTable(() => {
        setParkedSolo(undefined);
        setConnected(parked);
      });
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
      const owner = active.owner;
      await handOffTable(() => {
        if (owner.disposed || ownerRef.current !== owner) {
          result.dispose();
          return false;
        }
        const previous = owner.creator;
        owner.creator = { result, displayName };
        owner.guestRuntime?.dispose();
        delete owner.guestRuntime;
        previous?.result.dispose();
        owner.invitation.clear();
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
      await handOffTable(() => {
        if (owner.disposed) return false;
        setConnected({
          runtime: creator.result.runtime,
          rendererKind,
          mode: creator.result.mode,
          coachingConsent,
        });
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
      // The table this replaces stays until the room has admitted the new
      // session: a ticket that lapses before then must not cost it.
      try {
        await waitForAdmission(result.runtime, active.abort.signal);
      } catch (error) {
        result.runtime.dispose();
        throw error;
      }
      if (active.owner.disposed || ownerRef.current !== active.owner) {
        result.runtime.dispose();
        return;
      }
      const joined = active.owner;
      await handOffTable(() => {
        if (joined.disposed || ownerRef.current !== joined) {
          result.runtime.dispose();
          return false;
        }
        // Admitted: the invitation is used up.
        joined.invitation.clear();
        joined.guestRuntime = result.runtime;
        joined.creator?.result.dispose();
        joined.creator = undefined;
        setParkedSolo(undefined);
        setName(displayName);
        rememberName();
        setConnected({
          runtime: result.runtime,
          rendererKind,
          mode: 'multiplayer',
          coachingConsent,
        });
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
    void handOffTable(() => {
      if (owner.disposed || ownerRef.current !== owner) return false;
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
    });
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

      const owner = active.owner;
      const settle = (): boolean => {
        if (
          combinedSignal.aborted ||
          owner.disposed ||
          ownerRef.current !== owner
        ) {
          result.runtime.dispose();
          return false;
        }
        // A restored table already owns its deck. Retained editor drafts
        // must wait for an explicit edit/play action instead of overwriting
        // the save.
        restoredDeckSessions.current.add(result.runtime.session);
        const previousCreator = owner.creator;
        const previousGuest = owner.guestRuntime;
        owner.guestRuntime = result.runtime;
        delete owner.creator;
        delete owner.restoration;
        setParkedSolo(undefined);
        setName(displayName);
        rememberName();
        setReceipt(undefined);
        setRoomCode(result.runtime.roomCode);
        setCoachingConsent(false);
        setCopyConfirmed(false);
        // The save keeps the consent it was made with.
        setConnected({
          runtime: result.runtime,
          rendererKind,
          mode: 'multiplayer',
        });
        previousCreator?.result.dispose();
        if (previousGuest && previousGuest !== result.runtime) {
          previousGuest.dispose();
        }
        return true;
      };
      // A new room's table takes the screen; the same one stays put.
      if (connected?.runtime === result.runtime) settle();
      else await handOffTable(settle);
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
    await invitations.copyPlayerOrSpectatorInvitation();
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
        {connected.mode === 'multiplayer' &&
          connected.coachingConsent !== undefined && (
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
          installDeckOnSessionAttach={
            !restoredDeckSessions.current.has(connected.runtime.session)
          }
          deckSessionPrepared={preparedDeckSessions.current.has(
            connected.runtime.session
          )}
          onDeckSessionAttach={() =>
            preparedDeckSessions.current.add(connected.runtime.session)
          }
          onLeave={handleLeave}
          onTableSettledChange={handleGameTableSettled}
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
          {...(backgroundSelection.background
            ? { background: backgroundSelection.background }
            : {})}
          onBackgroundChange={backgroundSelection.setBackground}
          onBackgroundReset={restoreDefaultBackground}
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
  const openDeck = (): void => {
    setDeckSurfaceActivated(true);
    setOverlay('deck');
  };
  const menu: AppMenuModel = {
    heading: activePanel === 'lobby' ? 'Play online' : 'Solo table',
    ...(activePanel === 'lobby' && !busy
      ? { onPlaySolo: () => void handleSolo() }
      : {}),
    ...(activePanel === 'lobby'
      ? {}
      : { onPlayOnline: () => setActivePanel('lobby') }),
    onDeck: openDeck,
    onSettings: () => setOverlay('settings'),
    onFullscreen: () => {
      requestBrowserFullscreen();
    },
  };
  const railStart = <AppMenu model={menu} />;
  return (
    <TableShell
      route="remote-room-lobby"
      darkMode={effectivePreferences.darkMode}
      {...(backgroundSelection.background
        ? { background: backgroundSelection.background }
        : {})}
      board={
        parkedSolo ? (
          // The parked Solo game stays on the table, live and playable,
          // while Play online is open.
          <RemoteSessionBoard
            session={parkedSolo.runtime.session}
            replay={parkedSolo.runtime.replay}
            rendererKind={parkedSolo.rendererKind}
            onIntent={() => undefined}
            roomMode="solo"
            hideOpponentHand={boardView.hideOpponentHand}
            // Test doubles may stand in for the runtime without a presentation.
            coinFlip={parkedSolo.runtime.presentation?.coinFlip}
            preferences={boardPreferences}
            rail={{
              start: railStart,
              compose: (own) => ({
                actions: [own.turn, own.coin, own.switchSide].filter(
                  (action) => action !== undefined
                ),
              }),
            }}
            keysSuspended={overlay === 'deck'}
            onSettledChange={handleGameTableSettled}
          />
        ) : (
          <RendererSpikeBoard
            view={emptyBoardView}
            rendererKind={rendererKind}
            onIntent={() => undefined}
            submitCommand={() => undefined}
            sessionReady={false}
            table={emptyTable}
            chrome={(layout) => (
              <TableRail
                anchor={layout.shared.boardControlsAnchor}
                width={layout.playAreaBounds.width}
                start={railStart}
                actions={[]}
              />
            )}
            preferences={emptyBoardPreferences}
            onSettledChange={handleEmptyTableSettled}
          />
        )
      }
    >
      {activePanel === 'solo' && status ? (
        <TableBanner
          action={
            <button
              type="button"
              className="ds-button ds-button--secondary"
              disabled={busy}
              onClick={() => void handleSolo()}
            >
              Try again
            </button>
          }
        >
          {status}
        </TableBanner>
      ) : null}
      <OnlineSheet
        open={activePanel === 'lobby' && overlay === undefined}
        onDeck={openDeck}
        onSettings={() => setOverlay('settings')}
        onOpenChange={(open) => {
          // Put away, Play online gives way to the Solo table, as v1's Solo
          // tab did; never while a room is being made or joined.
          if (!open && !busy) void handleSolo();
        }}
      >
        {renderMultiplayerPanel(false)}
      </OnlineSheet>
      <SettingsSheet
        open={overlay === 'settings'}
        onOpenChange={(open) => setOverlay(open ? 'settings' : undefined)}
        solo={parkedSolo !== undefined}
        darkMode={effectivePreferences.darkMode}
        onDarkModeChange={setDarkMode}
        onChangeBackground={backgroundSelection.chooseBackground}
        {...(table.background
          ? { onUseDefaultBackground: restoreDefaultBackground }
          : {})}
      />
      {deckSurfaceActivated ? (
        <DeckLayer
          open={overlay === 'deck'}
          onClose={() => setOverlay(undefined)}
        >
          <LazyDeckBuilderSession
            open={overlay === 'deck'}
            alternateEnabled={parkedSolo?.mode === 'solo'}
            installOnSessionAttach
            onRequestClose={() => {
              setOverlay(undefined);
              void handleSolo();
            }}
            onBack={() => setOverlay(undefined)}
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
        </DeckLayer>
      ) : null}
    </TableShell>
  );
};
