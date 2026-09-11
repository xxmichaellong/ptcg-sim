import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  useCardBackSelection,
  type CardBackSelectionOptions,
} from '../../session/useCardBackSelection.js';
import { LegacyDeckBuilderWorkspace } from './LegacyDeckBuilderWorkspace.js';
import {
  LegacyDeckImportPanel,
  type PastedDecklistImporter,
} from './LegacyDeckImportPanel.js';
import {
  type DeckBeforeUnloadTarget,
  installDeckBeforeUnloadGuard,
} from './deck-browser-io.js';
import {
  DeckBuilderStore,
  type DeckBuilderTarget,
} from './deck-builder-store.js';
import {
  DeckInstallCoordinator,
  type DeckDefinitionDigest,
  type DeckInstallCoordinatorFailure,
  type DeckInstallSession,
} from './deck-install-adapter.js';
import {
  popularDecklistSource,
  type PopularDecklistSource,
} from './popular-decklists.js';
import { createTcgdexCardCatalog } from './tcgdex-card-catalog.js';
import type { TcgdexCardCatalog } from './tcgdex-catalog-contract.js';

export interface LegacyDeckBuilderSessionProps {
  readonly session?: DeckInstallSession;
  readonly open: boolean;
  readonly alternateEnabled: boolean;
  readonly installOnSessionAttach?: boolean;
  readonly onRequestClose: () => void;
  readonly store?: DeckBuilderStore;
  readonly catalog?: TcgdexCardCatalog;
  readonly samples?: PopularDecklistSource;
  readonly importDecklist?: PastedDecklistImporter;
  readonly requestCardBack?: CardBackSelectionOptions['requestCardBack'];
  readonly beforeUnloadTarget?: DeckBeforeUnloadTarget;
  readonly digest?: DeckDefinitionDigest;
  readonly onInstallFailure?: (failure: DeckInstallCoordinatorFailure) => void;
}

const otherPlayerId = (
  session: DeckInstallSession,
  target: DeckBuilderTarget
): string | undefined => {
  const state = session.getSnapshot();
  const view = state.view;
  if (
    target === 'main' ||
    state.phase !== 'ready' ||
    view?.viewer.kind !== 'player'
  ) {
    return undefined;
  }
  const viewerPlayerId = view.viewer.playerId;
  return view.playerOrder.find((playerId) => playerId !== viewerPlayerId);
};

/**
 * Route-neutral owner for the complete Deck surface. Route navigation supplies
 * only open/close state; this boundary owns editor/catalog lifetime, guarded
 * dirty state, acknowledged installs, and foreground card-back requests.
 */
export const LegacyDeckBuilderSession = ({
  session,
  open,
  alternateEnabled,
  installOnSessionAttach = false,
  onRequestClose,
  store: suppliedStore,
  catalog: suppliedCatalog,
  samples = popularDecklistSource,
  importDecklist,
  requestCardBack,
  beforeUnloadTarget,
  digest,
  onInstallFailure,
}: LegacyDeckBuilderSessionProps) => {
  const [ownedStore] = useState(
    () => suppliedStore ?? new DeckBuilderStore({ alternateEnabled })
  );
  const [ownedCatalog] = useState(
    () => suppliedCatalog ?? createTcgdexCardCatalog()
  );
  const store = suppliedStore ?? ownedStore;
  const catalog = suppliedCatalog ?? ownedCatalog;
  const coordinator = useRef<DeckInstallCoordinator | undefined>(undefined);
  const preparedBinding = useRef<
    | {
        readonly session: DeckInstallSession;
        readonly store: DeckBuilderStore;
      }
    | undefined
  >(undefined);
  const failureHandler = useRef(onInstallFailure);
  const wasOpen = useRef(open);
  failureHandler.current = onInstallFailure;

  useLayoutEffect(() => {
    store.setAlternateEnabled(alternateEnabled);
  }, [alternateEnabled, store]);

  useEffect(() => {
    if (!session) {
      preparedBinding.current = undefined;
      coordinator.current = undefined;
      return;
    }
    if (installOnSessionAttach) {
      const isNewBinding =
        preparedBinding.current?.session !== session ||
        preparedBinding.current.store !== store;
      preparedBinding.current = { session, store };
      if (isNewBinding) store.prepareForNewSession();
    } else {
      preparedBinding.current = undefined;
    }
    const current = new DeckInstallCoordinator({
      store,
      session,
      ...(digest ? { digest } : {}),
      onFailure: (failure) => failureHandler.current?.(failure),
    });
    coordinator.current = current;
    if (installOnSessionAttach) current.flush();
    return () => {
      if (coordinator.current === current) coordinator.current = undefined;
      current.dispose();
    };
  }, [digest, installOnSessionAttach, session, store]);

  useEffect(
    () => installDeckBeforeUnloadGuard(store, beforeUnloadTarget),
    [beforeUnloadTarget, store]
  );

  const submit = useCallback(
    (command: WireGameCommand) =>
      session?.submit(command) ?? { queued: false, reason: 'not_ready' },
    [session]
  );
  const { chooseCardBack } = useCardBackSelection({
    submit,
    ...(requestCardBack ? { requestCardBack } : {}),
  });

  const flush = useCallback(
    (): boolean => coordinator.current?.flush() ?? false,
    []
  );

  useEffect(() => {
    if (wasOpen.current && !open) flush();
    wasOpen.current = open;
  }, [flush, open]);

  const closeAndFlush = useCallback(() => {
    flush();
    onRequestClose();
  }, [flush, onRequestClose]);

  const changeCardBack = useCallback(
    (target: DeckBuilderTarget): void => {
      if (!session) return;
      const state = session.getSnapshot();
      if (state.phase !== 'ready' || state.view?.viewer.kind !== 'player') {
        return;
      }
      if (target === 'main') {
        chooseCardBack();
        return;
      }
      const targetPlayerId = otherPlayerId(session, target);
      if (targetPlayerId) chooseCardBack(targetPlayerId);
    },
    [chooseCardBack, session]
  );

  return (
    <>
      <LegacyDeckImportPanel
        store={store}
        open={open}
        samples={samples}
        {...(importDecklist ? { importDecklist } : {})}
        onChangeCardBack={changeCardBack}
      />
      <LegacyDeckBuilderWorkspace
        store={store}
        catalog={catalog}
        open={open}
        onPlay={closeAndFlush}
      />
    </>
  );
};
