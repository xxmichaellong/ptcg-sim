import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText';
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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  ReactNode,
} from 'react';

import {
  preferences as pagePreferences,
  type PreferenceStore,
} from '../preferences/preference-store.js';
import { usePreference } from '../preferences/usePreference.js';
import { PLAYER_PREFERENCES } from './player-preferences.js';
import { ROOM_DEFAULT_PREFERENCES } from './room-preferences.js';
import { TABLE_PREFERENCES } from './table-preferences.js';
import { RendererSpikeBoard } from '../RendererSpikeBoard.js';
import { AppBarSlot } from '../board/LegacyBoardChrome.js';
import {
  boardViewSettings,
  lostZoneLayout,
  oncePerGameMarkerCount,
} from '../board/view/board-view-settings.js';
import type { DeckBuilderCustody } from '../features/deck/DeckBuilderSession.js';
import { LazyDeckBuilderSession } from '../features/deck/LazyDeckBuilderSession.js';
import {
  createRemoteRoom,
  RemoteRoomInvitationError,
  type RemoteRoomCreationResult,
  type RemoteRoomInvitationShareReceipt,
} from './RemoteRoomCreation.js';
import { waitForAdmission } from './wait-for-admission.js';
import {
  RemoteRoomInvitationJoinCustody,
  type RemoteRoomInvitationHandoffReceipt,
} from './RemoteRoomInvitationHandoff.js';
import { RemoteRoomHeldInvitation } from './RemoteRoomHeldInvitation.js';
import {
  onInvitationLink,
  takeInvitationLink,
} from './invitation-link-capture.js';
import { browserInvitationDelivery } from './invitation-share.js';
import type { RoomInvitations, RoomInviteOutcome } from './room-invites.js';
import { RemoteRoomRoute } from './RemoteRoomRoute.js';
import { RemoteSessionBoard } from './RemoteSessionBoard.js';
import {
  COARSE_POINTER_QUERY,
  TOUCH_ONLY_QUERY,
  useMediaQuery,
} from '../ui/breakpoints.js';
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
import {
  AppBar,
  type AppMenuModel,
  useAppBarReserve,
} from './shell/AppMenu.js';
import { toast } from '../ui/toast.js';
import {
  startTutorial,
  takeTutorialRequest,
  tutorialRequestFromUrl,
  useTutorialRequest,
  type TutorialRequest,
} from '../tutorial/tutorial-state.js';
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

type LobbyOperation = 'solo' | 'create' | 'join' | 'resume' | 'tutorial';

interface InvitationJoinCustody {
  readonly acceptPaste: RemoteRoomInvitationJoinCustody['acceptPaste'];
  readonly acceptText: RemoteRoomInvitationJoinCustody['acceptText'];
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
  /** A resumed game's opponent invitation, until it is passed on. */
  held?: RemoteRoomHeldInvitation;
  /** The tutorial's practice table (ADR-038), while it is open. */
  tutorial?: RemoteRoomCreationResult;
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
  readonly mode: 'solo' | 'multiplayer';
}

/**
 * The invitation link the page was opened with (or given since), from the
 * capture that took it off the address (invitation-link-capture.ts): kept
 * until a join with it is seen through, so StrictMode's replaced owner, or
 * a lobby that remounts, does not lose it.
 */
let waitingInvitationLink: string | undefined;
const pendingInvitationLink = (): string | undefined => {
  waitingInvitationLink ??= takeInvitationLink();
  return waitingInvitationLink;
};
const consumeInvitationLink = (): void => {
  waitingInvitationLink = undefined;
};

const normalizeDisplayName = (
  candidate: string,
  fallback: () => string
): string => candidate.trim() || fallback();

const disposeOwner = (owner: LobbyOwner): void => {
  if (owner.disposed) return;
  owner.disposed = true;
  owner.operation?.abort.abort();
  owner.invitation.dispose();
  owner.restoration?.dispose();
  owner.held?.dispose();
  if (owner.creator) {
    owner.creator.result.dispose();
  } else {
    owner.guestRuntime?.dispose();
  }
  owner.tutorial?.dispose();
};

const sanitizeRoomCodeInput = (value: string): string =>
  value
    .toUpperCase()
    .replaceAll(/[^A-HJ-NP-Z2-9]/gu, '')
    .slice(0, 12);

const safeFailureMessage = (
  operation: LobbyOperation,
  error: unknown
): MessageDescriptor => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';
  if (operation === 'join') {
    if (code === 'missing_invitation' || code === 'invalid_handoff') {
      return msg`Paste the invitation link you were sent.`;
    }
    if (code === 'expired_invitation' || code === 'invitation_refused') {
      return msg`This invitation was used or has expired. Ask for a new one.`;
    }
    if (code === 'seat_unavailable') {
      return msg`Both seats are taken. Ask for a spectator invitation.`;
    }
    return msg`Couldn't join the room. Try again.`;
  }
  if (operation === 'solo') {
    return msg`Couldn't start Solo mode. Try again.`;
  }
  if (operation === 'tutorial') {
    return msg`Couldn't start the tutorial. Try again.`;
  }
  return msg`Couldn't create a room. Try again.`;
};

/** An invite press passed to the room's custody, as the room hears it. */
const inviteOutcome = async (
  send: () => Promise<RemoteRoomInvitationShareReceipt>
): Promise<RoomInviteOutcome> => {
  try {
    return (await send()).outcome;
  } catch (error) {
    return error instanceof RemoteRoomInvitationError &&
      error.code === 'seat_unavailable'
      ? 'seat_unavailable'
      : 'failed';
  }
};

/**
 * How this device passes a link on: the share sheet on a touch screen, the
 * clipboard with a mouse. Asked at each press, as the device may change.
 */
const currentDelivery = () =>
  browserInvitationDelivery({
    preferShare: globalThis.matchMedia?.(TOUCH_ONLY_QUERY).matches === true,
  });

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

/**
 * Isolated v2 port of the existing multiplayer lobby chrome. Bearer invitation
 * text crosses React only inside the synchronous paste/copy boundary; state and
 * rendered markup retain safe room-code/role/expiry receipts exclusively.
 */
export const RemoteRoomLobby = ({
  buildId,
  landing = 'lobby',
  dependencies = defaultDependencies,
}: {
  readonly buildId: string;
  /**
   * v1 opens on the Solo table; `solo` starts a solo room as soon as the
   * lobby mounts, and `lobby` waits on the Multiplayer panel instead.
   */
  readonly landing?: 'solo' | 'lobby';
  readonly dependencies?: RemoteRoomLobbyDependencies;
}) => {
  const { t, i18n } = useLingui();
  const emptyBoardView = useMemo(createEmptyBoardView, []);
  const ownerRef = useRef<LobbyOwner | undefined>(undefined);
  const curtain = dependencies.curtain ?? tableCurtain();
  // Which table has painted since the last swap: the empty table, or a
  // game's (the room's, or a parked Solo game). The page opens behind the
  // loading screen (table-curtain.ts), and the first of them to paint lifts
  // it -- except the empty table while it only stands in for a Solo room
  // still being made, which the page never shows on the way to that room.
  const settledTableRef = useRef<'empty' | 'game'>(undefined);
  // From a hand-off's swap until the lobby draws it: a table that reports
  // in between is the one being traded away (its effects can land after
  // the swap), and is not heard.
  const swappingRef = useRef(false);
  useLayoutEffect(() => {
    swappingRef.current = false;
  });
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
  // The invitation field shows the room an accepted invitation names,
  // never the invitation itself (ADR-020).
  const [roomCode, setRoomCode] = useState('');
  const [spectator, setSpectator] = useState(false);
  const [receipt, setReceipt] = useState<RemoteRoomInvitationHandoffReceipt>();
  const [operation, setOperation] = useState<LobbyOperation>();
  // Kept as a message, so it reads in whatever language is up when shown.
  const [status, setStatus] = useState<MessageDescriptor>();
  const [connected, setConnected] = useState<ConnectedRoom>();
  const [parkedSolo, setParkedSolo] = useState<ConnectedRoom>();
  // The tutorial's practice table, shown in place of the player's own
  // table, which stays live behind it until they come back (ADR-038).
  const [tutorial, setTutorial] = useState<{
    readonly room: ConnectedRoom;
    readonly lesson?: string;
    readonly serial: number;
  }>();
  // Play online pressed on the practice table: the player's own table opens
  // to it once they are back.
  const [onlineOnReturn, setOnlineOnReturn] = useState(false);
  // Whether the player had their own table turned around, so it comes back
  // that way from the tutorial.
  const [ownTableFlip, setOwnTableFlip] = useState<{
    readonly roomCode: string;
    readonly flipped: boolean;
  }>();
  useEffect(() => {
    if (!tutorial && onlineOnReturn && connected) setOnlineOnReturn(false);
  }, [tutorial, onlineOnReturn, connected]);
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
  const appBarPx = useAppBarReserve();
  const emptyTable = useMemo(
    () => ({
      lowerShare: boardView.split,
      seamBandPx: coarsePointer ? TOUCH_SEAM_BAND_PX : POINTER_SEAM_BAND_PX,
      appBarPx,
      // The optional pieces as the room will show them.
      ...lostZoneLayout(boardView.lostZone),
      ...(oncePerGameMarkerCount(boardView) > 0
        ? { oncePerGameMarkers: oncePerGameMarkerCount(boardView) }
        : {}),
    }),
    [boardView, coarsePointer, appBarPx]
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

  /**
   * Joins the room an invitation link names (ADR-020): opened with it, the
   * page goes straight there instead of to the Solo table; given one while
   * up, it goes there from the lobby or a Solo table, never from a room.
   * Refused, Play online shows why, its fields ready to try another.
   */
  const joinFromLink = (link: string): void => {
    const owner = ownerRef.current;
    if (!owner || owner.disposed) return;
    if (connected?.mode === 'multiplayer' || owner.operation) {
      consumeInvitationLink();
      toast({
        id: 'invitation-link',
        title: owner.operation
          ? t`Open the link again in a moment.`
          : t`Leave the room to join another.`,
        tone: 'warning',
      });
      return;
    }
    setActivePanel('lobby');
    let accepted: RemoteRoomInvitationHandoffReceipt;
    try {
      accepted = owner.invitation.acceptText(link);
    } catch (error) {
      consumeInvitationLink();
      refuseInvitation(error);
      return;
    }
    showAccepted(accepted);
    void handleJoin(accepted.requestedRole === 'spectator').finally(() => {
      // A join this owner saw through has used the link; one a replaced
      // owner gave up on leaves it for the next.
      if (!owner.disposed) consumeInvitationLink();
    });
  };
  const joinFromLinkRef = useRef(joinFromLink);
  joinFromLinkRef.current = joinFromLink;
  useEffect(
    () =>
      onInvitationLink(() => {
        const link = pendingInvitationLink();
        if (link) joinFromLinkRef.current(link);
      }),
    []
  );

  useEffect(() => {
    // Guarded per owner rather than per component: StrictMode replays the
    // owner effect with a fresh owner, and the first owner's room creation
    // (or join) is discarded on arrival because that owner was disposed.
    const owner = ownerRef.current;
    if (!owner || owner.disposed || owner.landedOnSolo) return;
    const link = pendingInvitationLink();
    if (link) {
      owner.landedOnSolo = true;
      joinFromLink(link);
      return;
    }
    if (landing !== 'solo') return;
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
    if (swappingRef.current) return;
    settledTableRef.current = settled ? 'empty' : undefined;
    revealSettledTable();
  };
  const handleGameTableSettled = (settled: boolean): void => {
    if (swappingRef.current) return;
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
          } else {
            swappingRef.current = true;
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

  /**
   * Create room: makes a multiplayer room and takes its host straight into
   * it, where the room offers its invites (ADR-020, 2026-10-29).
   */
  const handleCreate = async (): Promise<void> => {
    const active = beginOperation('create');
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
      // The room's table takes the screen from whatever was on it: a live
      // Solo game (left behind, as v1 left it for its Multiplayer tab), a
      // parked one, or the lobby's empty table.
      await handOffTable(() => {
        if (owner.disposed || ownerRef.current !== owner) {
          result.dispose();
          return false;
        }
        const previous = owner.creator;
        owner.creator = { result, displayName };
        owner.guestRuntime?.dispose();
        delete owner.guestRuntime;
        owner.held?.dispose();
        delete owner.held;
        previous?.result.dispose();
        setParkedSolo(undefined);
        owner.invitation.clear();
        setName(displayName);
        rememberName();
        setRoomCode('');
        setReceipt(undefined);
        // A retry that works retires the failure it follows.
        setStatus(undefined);
        setConnected({ runtime: result.runtime, mode: 'multiplayer' });
      });
    } catch (error) {
      if (!active.owner.disposed) {
        setStatus(safeFailureMessage('create', error));
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
        signal: active.abort.signal,
      });
      // A room or table this replaces stays until Solo has admitted its
      // player: a handshake that fails after the room was made must not
      // cost them. (With nothing to replace, the table shows it connecting.)
      if (active.owner.creator || connected) {
        try {
          await waitForAdmission(result.runtime, active.abort.signal);
        } catch (error) {
          result.dispose();
          throw error;
        }
      }
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
        owner.held?.dispose();
        delete owner.held;
        owner.invitation.clear();
        // Solo's fixed name is never written back into the Multiplayer Name
        // box, which v1 leaves for the visitor to fill in themselves.
        setRoomCode('');
        setReceipt(undefined);
        setStatus(undefined);
        setConnected({ runtime: result.runtime, mode: result.mode });
      });
    } catch (error) {
      if (!active.owner.disposed) {
        setStatus(safeFailureMessage('solo', error));
      }
    } finally {
      endOperation(active.owner);
    }
  };

  /**
   * Opens the tutorial (ADR-038) on a practice table of its own: a fresh
   * Solo room, while the player's own table -- whatever game is on it --
   * waits live behind it. Asked again while it is open, it goes to the
   * lesson asked for.
   */
  const handleTutorial = async (request: TutorialRequest): Promise<void> => {
    if (tutorial) {
      setTutorial({
        ...tutorial,
        serial: request.serial,
        ...(request.lesson !== undefined ? { lesson: request.lesson } : {}),
      });
      return;
    }
    // A room's other player would be left waiting, and a room this page
    // made would be closed on the way back: the tutorial is for a Solo
    // table.
    if (
      connected?.mode === 'multiplayer' ||
      ownerRef.current?.creator?.result.mode === 'multiplayer'
    ) {
      toast({
        id: 'tutorial-failed',
        title: t`Leave the room to start the tutorial.`,
        tone: 'warning',
      });
      return;
    }
    const active = beginOperation('tutorial');
    if (!active) return;
    try {
      const result = await dependencies.createRoom({
        buildId,
        displayName: 'Blue',
        mode: 'solo',
        signal: active.abort.signal,
      });
      try {
        await waitForAdmission(result.runtime, active.abort.signal);
      } catch (error) {
        result.dispose();
        throw error;
      }
      const owner = active.owner;
      if (owner.disposed || ownerRef.current !== owner) {
        result.dispose();
        return;
      }
      await handOffTable(() => {
        if (owner.disposed || ownerRef.current !== owner) {
          result.dispose();
          return false;
        }
        owner.tutorial?.dispose();
        owner.tutorial = result;
        setTutorial({
          room: { runtime: result.runtime, mode: 'solo' },
          serial: request.serial,
          ...(request.lesson !== undefined ? { lesson: request.lesson } : {}),
        });
        setActivePanel('solo');
      });
    } catch (error) {
      if (!active.owner.disposed) {
        toast({
          id: 'tutorial-failed',
          title: i18n._(safeFailureMessage('tutorial', error)),
          tone: 'warning',
        });
      }
    } finally {
      endOperation(active.owner);
    }
  };

  /** Back from the practice table to the player's own. */
  const leaveTutorial = async (): Promise<void> => {
    const owner = ownerRef.current;
    if (!owner || owner.disposed) return;
    await handOffTable(() => {
      owner.tutorial?.dispose();
      delete owner.tutorial;
      setTutorial(undefined);
    });
    // With no table of their own to go back to, the page makes one: its
    // operation starts before the stand-in table paints, so the loading
    // screen stays down until the new table has.
    if (!connected && !parkedSolo) void handleSolo();
  };

  // A lesson in the page's address (`?tutorial=damage`) opens it once the
  // table is ready; `?tutorial` alone opens the list. The address forgets
  // it, so a reload is the player's own table again.
  useEffect(() => {
    const location = globalThis.location;
    if (!location) return;
    const lesson = tutorialRequestFromUrl(location.search);
    if (lesson === undefined) return;
    startTutorial(lesson === '' ? undefined : lesson);
    const url = new URL(location.href);
    url.searchParams.delete('tutorial');
    globalThis.history?.replaceState(globalThis.history.state, '', url);
  }, []);

  const tutorialRequest = useTutorialRequest();
  useEffect(() => {
    if (!tutorialRequest) return;
    const owner = ownerRef.current;
    if (!owner || owner.disposed || owner.operation) return;
    takeTutorialRequest(tutorialRequest);
    void handleTutorial(tutorialRequest);
  });

  /** Shows an invitation the custody accepted, as its room and role only. */
  const showAccepted = (accepted: RemoteRoomInvitationHandoffReceipt): void => {
    setReceipt(accepted);
    setRoomCode(accepted.roomCode);
    setSpectator(accepted.requestedRole === 'spectator');
    setStatus(undefined);
  };
  const refuseInvitation = (error: unknown): void => {
    setReceipt(undefined);
    setStatus(safeFailureMessage('join', error));
  };

  /**
   * A paste anywhere in Play online but the Name field takes an invitation
   * (its envelope or its link): intercepted before the browser could put
   * it in a field, kept by the custody alone (ADR-020).
   */
  const handlePaste = (event: ReactClipboardEvent<HTMLElement>): void => {
    if (event.target instanceof HTMLElement && event.target.id === 'nameInput')
      return;
    const owner = ownerRef.current;
    if (!owner || owner.disposed || owner.operation) {
      event.preventDefault();
      return;
    }
    try {
      showAccepted(
        owner.invitation.acceptPaste({
          clipboardData: event.clipboardData,
          preventDefault: () => event.preventDefault(),
        })
      );
    } catch (error) {
      refuseInvitation(error);
    }
  };

  /** An invitation's text or link dropped on Play online. */
  const handleDrop = (event: ReactDragEvent<HTMLElement>): void => {
    const types = event.dataTransfer.types;
    if (!types.includes('text/plain') && !types.includes('text/uri-list'))
      return;
    event.preventDefault();
    const owner = ownerRef.current;
    if (!owner || owner.disposed || owner.operation) return;
    const text =
      event.dataTransfer.getData('text/uri-list') ||
      event.dataTransfer.getData('text/plain');
    try {
      showAccepted(owner.invitation.acceptText(text));
    } catch (error) {
      refuseInvitation(error);
    }
  };

  /** The Paste button: the clipboard read where the browser allows it. */
  const clipboardReadable =
    typeof globalThis.navigator?.clipboard?.readText === 'function';
  const handlePasteButton = async (): Promise<void> => {
    const owner = ownerRef.current;
    if (!owner || owner.disposed || owner.operation) return;
    let text: string;
    try {
      text = await globalThis.navigator.clipboard.readText();
    } catch {
      setStatus(msg`Couldn't read the clipboard. Paste with the keyboard.`);
      return;
    }
    if (owner.disposed || ownerRef.current !== owner || owner.operation) return;
    try {
      showAccepted(owner.invitation.acceptText(text));
    } catch (error) {
      refuseInvitation(error);
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

  /**
   * Joins with the invitation the custody holds. No park here: a join that
   * succeeds replaces the live table outright, and one that is refused must
   * leave both the table and the invitation where they were.
   */
  const handleJoin = async (
    asSpectator: boolean = spectator
  ): Promise<void> => {
    const owner = ownerRef.current;
    if (!owner || owner.disposed || owner.operation) return;
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
        asSpectator,
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
        joined.guestRuntime?.dispose();
        joined.guestRuntime = result.runtime;
        joined.creator?.result.dispose();
        joined.creator = undefined;
        joined.held?.dispose();
        delete joined.held;
        setParkedSolo(undefined);
        setName(displayName);
        rememberName();
        setReceipt(undefined);
        setRoomCode('');
        setStatus(undefined);
        setConnected({ runtime: result.runtime, mode: 'multiplayer' });
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
      owner.invitation.dispose();
      owner.invitation = nextInvitation;
      owner.restoration?.dispose();
      delete owner.restoration;
      owner.held?.dispose();
      delete owner.held;
      if (owner.creator) {
        owner.creator.result.dispose();
        delete owner.creator;
      } else {
        owner.guestRuntime?.dispose();
        delete owner.guestRuntime;
      }
      setReceipt(undefined);
      setRoomCode('');
      setConnected(undefined);
      setParkedSolo(undefined);
      setStatus(undefined);
    });
  };

  const handleResumeSavedGame = async (
    contents: string,
    signal: AbortSignal
  ): Promise<void> => {
    // The restore mints the opponent's invitation; it waits here for the
    // player's Invite opponent rather than going to the clipboard unasked.
    const held = new RemoteRoomHeldInvitation();
    const deliverOpponentInvitation: RemoteRoomRestorationInput['deliverOpponentInvitation'] =
      (text) => {
        held.hold(text);
        return Promise.resolve();
      };
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
        owner.held?.dispose();
        owner.held = held;
        setParkedSolo(undefined);
        setName(displayName);
        rememberName();
        setReceipt(undefined);
        setRoomCode('');
        // The save keeps the board-flip consent it was made with.
        setConnected({
          runtime: result.runtime,
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

  /**
   * The connected room's invites (ADR-020): the creator mints links for
   * either role; a resumed game passes on the one invitation it holds.
   * One object per room, so the room's invite actions keep still.
   */
  const roomInvitations = useMemo((): RoomInvitations | undefined => {
    const owner = ownerRef.current;
    if (!connected || connected.mode !== 'multiplayer' || !owner) {
      return undefined;
    }
    const creator = owner.creator;
    if (creator?.result.runtime === connected.runtime) {
      return {
        roles: ['player', 'spectator'],
        invite: (role) =>
          inviteOutcome(() =>
            creator.result.invitations.invite(role, currentDelivery())
          ),
      };
    }
    const held = owner.held;
    if (held?.held && owner.guestRuntime === connected.runtime) {
      return {
        roles: ['player'],
        invite: () => inviteOutcome(() => held.invite(currentDelivery())),
      };
    }
    return undefined;
  }, [connected]);

  const handleMultiplayerNavigate = (): void => {
    if (!connected || connected.mode !== 'solo') return;
    setParkedSolo(connected);
    setConnected(undefined);
    setActivePanel('lobby');
    setReceipt(undefined);
    setRoomCode('');
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
        <div
          id="lobby"
          className="lobby-form"
          aria-busy={busy}
          // An invitation pasted or dropped anywhere here is taken in, but
          // into the Name field (handlePaste lets that one through).
          onPaste={handlePaste}
          onDragOver={(event) => {
            const types = event.dataTransfer.types;
            if (types.includes('text/plain') || types.includes('text/uri-list'))
              event.preventDefault();
          }}
          onDrop={handleDrop}
        >
          <section className="lobby-intro" aria-labelledby="lobbyTitle">
            <header id="p2ExplanationBox" className="lobby-intro-head">
              <span className="lobby-intro-icon">
                <UsersThreeIcon {...decorative} weight="duotone" />
              </span>
              <div className="lobby-intro-copy">
                <h2 id="lobbyTitle" className="lobby-intro-title">
                  <Trans>Play online</Trans>
                </h2>
                <p className="lobby-intro-text">
                  <Trans>Create a room, or join one with a link.</Trans>
                </p>
              </div>
            </header>
            <div className="ds-field">
              <label className="ds-label" htmlFor="nameInput">
                <Trans comment="The player's display name">Name</Trans>
              </label>
              <input
                id="nameInput"
                className="ds-input"
                type="text"
                placeholder={t({
                  message: 'Name',
                  comment: "The player's display name",
                })}
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
                  <Trans>Host a room</Trans>
                </h3>
                <p className="ds-hint">
                  <Trans>You'll invite players from the room.</Trans>
                </p>
              </div>
            </div>
            <div className="lobby-step-actions">
              <button
                id="generateIdButton"
                type="button"
                className="ds-button ds-button--primary"
                disabled={busy}
                onClick={() => void handleCreate()}
              >
                {operation === 'create' ? (
                  <CircleNotchIcon
                    {...decorative}
                    weight="bold"
                    className="ds-spin"
                  />
                ) : (
                  <PlusIcon {...decorative} weight="bold" />
                )}
                {operation === 'create'
                  ? t({ message: 'Creating…', context: 'a room' })
                  : t({ message: 'Create room', context: 'a room' })}
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
                  <Trans>Join a room</Trans>
                </h3>
                <p className="ds-hint">
                  <Trans>Paste or drop the link you were sent.</Trans>
                </p>
              </div>
            </div>
            <div id="roomId" className="ds-field">
              <label className="ds-label" htmlFor="roomIdInput">
                <Trans comment="The link or code that lets someone join a room">
                  Invitation
                </Trans>
              </label>
              <div className="lobby-invitation-row">
                {/* Shows the room an invitation names, never the invitation:
                    a paste is taken before it could reach the field. */}
                <input
                  id="roomIdInput"
                  className="ds-input lobby-room-input"
                  type="text"
                  placeholder={t`Paste the link`}
                  autoComplete="off"
                  spellCheck={false}
                  value={roomCode}
                  disabled={busy}
                  aria-describedby={receipt ? 'invitationReceipt' : undefined}
                  onChange={(event) => handleRoomCodeChange(event.target.value)}
                />
                {clipboardReadable ? (
                  <button
                    id="pasteInvitationButton"
                    type="button"
                    className="ds-button ds-button--secondary"
                    disabled={busy}
                    onClick={() => void handlePasteButton()}
                  >
                    <ClipboardTextIcon {...decorative} weight="bold" />
                    <Trans context="paste from the clipboard">Paste</Trans>
                  </button>
                ) : null}
              </div>
              {receipt ? (
                <p id="invitationReceipt" className="ds-hint">
                  {receipt.requestedRole === 'player'
                    ? t({
                        message: `Room ${receipt.roomCode} · to play`,
                        comment: 'roomCode is a short code like K7PQ2M',
                      })
                    : t({
                        message: `Room ${receipt.roomCode} · to watch`,
                        comment: 'roomCode is a short code like K7PQ2M',
                      })}
                </p>
              ) : null}
            </div>
            {receipt?.requestedRole === 'player' ? (
              // An invitation to play leaves the choice to its holder, as
              // v1's room key did; one to watch only ever watches.
              <div className="lobby-switches">
                <div id="spectatorModeLabel" className="ds-switch-row">
                  <input
                    type="checkbox"
                    id="spectatorModeCheckbox"
                    className="ds-switch"
                    checked={spectator}
                    disabled={busy}
                    onChange={(event) => setSpectator(event.target.checked)}
                  />{' '}
                  <label htmlFor="spectatorModeCheckbox">
                    <Trans>Join as spectator</Trans>
                  </label>
                </div>
              </div>
            ) : null}
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
                <SignInIcon
                  {...decorative}
                  weight="bold"
                  className="ds-mirror-rtl"
                />
              )}
              {operation === 'join' ? t`Joining…` : t`Join room`}
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
            <span>{i18n._(status)}</span>
          </p>
        )}
      </div>
    </section>
  );

  if (tutorial) {
    // The practice table in place of the player's own, which stays live
    // behind it. It installs none of the player's decks; Play online leaves
    // the tutorial first.
    const practice = tutorial.room;
    return (
      <RemoteRoomRoute
        key={practice.runtime.roomCode}
        runtime={practice.runtime}
        roomMode="solo"
        tutorial={{
          ...(tutorial.lesson !== undefined ? { lesson: tutorial.lesson } : {}),
          serial: tutorial.serial,
          onExit: () => void leaveTutorial(),
        }}
        // The practice table's seats are its own: a deck put on it isn't
        // the player's own table's (ADR-038, the table comes back as it was).
        // Their saved decks are the same library either way.
        deckSurfaceActivated={deckSurfaceActivated}
        onDeckSurfaceActivate={() => setDeckSurfaceActivated(true)}
        installDeckOnSessionAttach={false}
        deckSessionPrepared
        onTableSettledChange={handleGameTableSettled}
        onNewSoloTable={() => void leaveTutorial()}
        multiplayerPanel={renderMultiplayerPanel}
        onMultiplayerPanelOpen={() => {
          // As Play online pressed at that table would have it.
          setOnlineOnReturn(true);
          setActivePanel('lobby');
          void leaveTutorial();
        }}
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
    );
  }
  if (connected) {
    return (
      <>
        <RemoteRoomRoute
          runtime={connected.runtime}
          roomMode={connected.mode}
          {...(onlineOnReturn && connected.mode === 'solo'
            ? { initialSheet: 'online' as const }
            : {})}
          initialFlipped={
            ownTableFlip?.roomCode === connected.runtime.roomCode &&
            ownTableFlip.flipped
          }
          onFlippedChange={(flipped) =>
            setOwnTableFlip({ roomCode: connected.runtime.roomCode, flipped })
          }
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
          onNewSoloTable={() => void handleSolo()}
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
          {...(roomInvitations ? { invitations: roomInvitations } : {})}
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
    heading: activePanel === 'lobby' ? t`Play online` : t`Solo table`,
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
    onTutorial: () => startTutorial(),
  };
  const appBar = <AppBar model={menu} />;
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
            onIntent={() => undefined}
            // Turned as the player left it, and kept as they leave it here.
            initialFlipped={
              ownTableFlip?.roomCode === parkedSolo.runtime.roomCode &&
              ownTableFlip.flipped
            }
            onPerspectiveChange={({ flipped }) =>
              setOwnTableFlip({
                roomCode: parkedSolo.runtime.roomCode,
                flipped,
              })
            }
            roomMode="solo"
            hideOpponentHand={boardView.hideOpponentHand}
            // Test doubles may stand in for the runtime without a presentation.
            coinFlip={parkedSolo.runtime.presentation?.coinFlip}
            preferences={boardPreferences}
            rail={{
              bar: appBar,
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
            onIntent={() => undefined}
            submitCommand={() => undefined}
            sessionReady={false}
            table={emptyTable}
            chrome={(layout) => (
              <AppBarSlot layout={layout}>{appBar}</AppBarSlot>
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
              <Trans>Try again</Trans>
            </button>
          }
        >
          {i18n._(status)}
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
            {...(parkedSolo
              ? { shownSession: parkedSolo.runtime.session }
              : {})}
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
