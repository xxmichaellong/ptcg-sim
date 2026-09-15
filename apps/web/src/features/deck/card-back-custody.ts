import type {
  ClientSessionState,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { MatchViewState } from '@ptcgsim/game-core';
import {
  MAX_IMAGE_URL_CODE_UNITS,
  type WireGameCommand,
} from '@ptcgsim/protocol';

import type { DeckBuilderTarget } from './deck-builder-store.js';
import type { DeckInstallSession } from './deck-install-adapter.js';

export interface CardBackSlotSnapshot {
  readonly url?: string;
  readonly revision: number;
  readonly installedRevision: number;
  readonly dirty: boolean;
  readonly installingRevision?: number;
}

export interface CardBackCustodySnapshot {
  readonly alternateEnabled: boolean;
  readonly slots: Readonly<Record<DeckBuilderTarget, CardBackSlotSnapshot>>;
  readonly hasDirtyCardBacks: boolean;
}

export interface CardBackInstallReceipt {
  readonly target: DeckBuilderTarget;
  readonly revision: number;
  readonly url: string;
}

export interface CardBackCustodyOptions {
  readonly alternateEnabled?: boolean;
  readonly mainUrl?: string;
  readonly alternateUrl?: string;
}

type Listener = () => void;

const nextRevision = (revision: number): number => {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Card-back custody revision limit reached.');
  }
  return revision + 1;
};

const validUrl = (url: string): boolean =>
  url.length > 0 && url.length <= MAX_IMAGE_URL_CODE_UNITS;

const createSlot = (
  url: string | undefined,
  revision = 0,
  installedRevision = revision,
  installingRevision?: number
): CardBackSlotSnapshot =>
  Object.freeze({
    ...(url === undefined ? {} : { url }),
    revision,
    installedRevision,
    dirty: revision !== installedRevision,
    ...(installingRevision === undefined ? {} : { installingRevision }),
  });

const createInitialSlot = (url: string | undefined): CardBackSlotSnapshot => {
  if (url !== undefined && !validUrl(url)) {
    throw new Error('Initial card-back URL is invalid.');
  }
  return createSlot(url);
};

const createSnapshot = (
  alternateEnabled: boolean,
  main: CardBackSlotSnapshot,
  alternate: CardBackSlotSnapshot
): CardBackCustodySnapshot => {
  const slots = Object.freeze({ main, alternate });
  return Object.freeze({
    alternateEnabled,
    slots,
    hasDirtyCardBacks: main.dirty || alternate.dirty,
  });
};

/** Retains loaded custom card backs independently from any room generation. */
export class CardBackCustodyStore {
  #alternateEnabled: boolean;
  readonly #listeners = new Set<Listener>();
  #pending?: CardBackInstallReceipt;
  #state: CardBackCustodySnapshot;

  constructor(options: CardBackCustodyOptions = {}) {
    this.#alternateEnabled = options.alternateEnabled ?? true;
    this.#state = createSnapshot(
      this.#alternateEnabled,
      createInitialSlot(options.mainUrl),
      createInitialSlot(options.alternateUrl)
    );
  }

  getSnapshot = (): CardBackCustodySnapshot => this.#state;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  };

  replace(target: DeckBuilderTarget, url: string): boolean {
    if (!validUrl(url) || (target === 'alternate' && !this.#alternateEnabled)) {
      return false;
    }
    const current = this.#state.slots[target];
    if (current.url === url) return false;
    this.#replaceSlot(
      target,
      createSlot(
        url,
        nextRevision(current.revision),
        current.installedRevision,
        current.installingRevision
      )
    );
    return true;
  }

  setAlternateEnabled(enabled: boolean): boolean {
    if (enabled === this.#alternateEnabled) return false;
    let alternate = this.#state.slots.alternate;
    if (!enabled && this.#pending?.target === 'alternate') {
      this.#pending = undefined;
      alternate = createSlot(
        alternate.url,
        alternate.revision,
        alternate.installedRevision
      );
    }
    this.#alternateEnabled = enabled;
    this.#publish(createSnapshot(enabled, this.#state.slots.main, alternate));
    return true;
  }

  /** Queues retained choices for a fresh authority without duplicating dirt. */
  prepareForNewSession(): boolean {
    const prepare = (
      slot: CardBackSlotSnapshot,
      enabled: boolean
    ): CardBackSlotSnapshot => {
      const settled =
        slot.installingRevision === undefined
          ? slot
          : createSlot(slot.url, slot.revision, slot.installedRevision);
      if (!enabled || settled.dirty || settled.url === undefined) {
        return settled;
      }
      return createSlot(
        settled.url,
        nextRevision(settled.revision),
        settled.installedRevision
      );
    };
    const main = prepare(this.#state.slots.main, true);
    const alternate = prepare(
      this.#state.slots.alternate,
      this.#alternateEnabled
    );
    if (
      main === this.#state.slots.main &&
      alternate === this.#state.slots.alternate
    ) {
      return false;
    }
    this.#pending = undefined;
    this.#publish(createSnapshot(this.#alternateEnabled, main, alternate));
    return true;
  }

  beginNextDirtyInstall(): CardBackInstallReceipt | undefined {
    if (this.#pending) return undefined;
    for (const target of ['main', 'alternate'] as const) {
      if (target === 'alternate' && !this.#alternateEnabled) continue;
      const slot = this.#state.slots[target];
      if (!slot.dirty || slot.url === undefined) continue;
      const receipt = Object.freeze({
        target,
        revision: slot.revision,
        url: slot.url,
      });
      this.#pending = receipt;
      this.#replaceSlot(
        target,
        createSlot(
          slot.url,
          slot.revision,
          slot.installedRevision,
          slot.revision
        )
      );
      return receipt;
    }
    return undefined;
  }

  settleInstall(
    receipt: CardBackInstallReceipt,
    outcome: 'installed' | 'failed'
  ): boolean {
    if (this.#pending !== receipt) return false;
    this.#pending = undefined;
    const slot = this.#state.slots[receipt.target];
    this.#replaceSlot(
      receipt.target,
      createSlot(
        slot.url,
        slot.revision,
        outcome === 'installed'
          ? Math.max(slot.installedRevision, receipt.revision)
          : slot.installedRevision
      )
    );
    return true;
  }

  #replaceSlot(target: DeckBuilderTarget, slot: CardBackSlotSnapshot): void {
    this.#publish(
      createSnapshot(
        this.#alternateEnabled,
        target === 'main' ? slot : this.#state.slots.main,
        target === 'alternate' ? slot : this.#state.slots.alternate
      )
    );
  }

  #publish(state: CardBackCustodySnapshot): void {
    this.#state = state;
    for (const listener of [...this.#listeners]) listener();
  }
}

export type CardBackInstallFailure =
  | {
      readonly stage: 'resolution';
      readonly reason: 'not_player' | 'stale_player';
    }
  | {
      readonly stage: 'submission';
      readonly reason: Extract<
        SubmitCommandResult,
        { queued: false }
      >['reason'];
    }
  | { readonly stage: 'authority'; readonly code?: string }
  | { readonly stage: 'session'; readonly reason: 'ended' };

export interface CardBackInstallCoordinatorOptions {
  readonly store: CardBackCustodyStore;
  readonly session: DeckInstallSession;
  readonly resolveTargetPlayerId?: (
    view: MatchViewState,
    target: DeckBuilderTarget
  ) => string | undefined;
  readonly onFailure?: (failure: CardBackInstallFailure) => void;
}

interface SubmittedInstall {
  readonly receipt: CardBackInstallReceipt;
  readonly commandId: string;
}

const defaultTargetPlayerId = (
  view: MatchViewState,
  target: DeckBuilderTarget
): string | undefined => {
  if (view.viewer.kind !== 'player') return undefined;
  const viewerPlayerId = view.viewer.playerId;
  if (target === 'main') return viewerPlayerId;
  return view.playerOrder.find((playerId) => playerId !== viewerPlayerId);
};

const terminalSession = (state: ClientSessionState): boolean =>
  state.phase === 'closed' ||
  state.phase === 'failed' ||
  state.phase === 'superseded';

/** Serializes retained card backs through the acknowledged room command lane. */
export class CardBackInstallCoordinator {
  readonly #store: CardBackCustodyStore;
  readonly #session: DeckInstallSession;
  readonly #resolveTargetPlayerId: NonNullable<
    CardBackInstallCoordinatorOptions['resolveTargetPlayerId']
  >;
  readonly #onFailure?: (failure: CardBackInstallFailure) => void;
  readonly #unsubscribe: () => void;
  #waiting?: CardBackInstallReceipt;
  #active?: SubmittedInstall;
  #draining = false;
  #disposed = false;

  constructor(options: CardBackInstallCoordinatorOptions) {
    this.#store = options.store;
    this.#session = options.session;
    this.#resolveTargetPlayerId =
      options.resolveTargetPlayerId ?? defaultTargetPlayerId;
    this.#onFailure = options.onFailure;
    this.#unsubscribe = this.#session.subscribe(this.#handleSession);
  }

  flush(): boolean {
    if (this.#disposed) return false;
    this.#draining = true;
    this.#pump();
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#draining = false;
    this.#unsubscribe();
    const receipt = this.#active?.receipt ?? this.#waiting;
    if (receipt) this.#store.settleInstall(receipt, 'failed');
    this.#active = undefined;
    this.#waiting = undefined;
  }

  readonly #handleSession = (): void => {
    if (this.#disposed) return;
    const state = this.#session.getSnapshot();
    if (this.#active) {
      const completion = state.completedCommands.find(
        (command) => command.commandId === this.#active?.commandId
      );
      if (completion) {
        const active = this.#active;
        this.#active = undefined;
        this.#store.settleInstall(
          active.receipt,
          completion.accepted ? 'installed' : 'failed'
        );
        if (!completion.accepted) {
          this.#draining = false;
          this.#report({
            stage: 'authority',
            ...(completion.code ? { code: completion.code } : {}),
          });
          return;
        }
        this.#pump();
        return;
      }
    }
    if (terminalSession(state) && (this.#active || this.#waiting)) {
      this.#failWaiting({ stage: 'session', reason: 'ended' });
      return;
    }
    if (this.#waiting) this.#submitWaiting(state);
  };

  #pump(): void {
    if (this.#disposed || !this.#draining || this.#active || this.#waiting) {
      return;
    }
    const receipt = this.#store.beginNextDirtyInstall();
    if (!receipt) {
      this.#draining = false;
      return;
    }
    this.#waiting = receipt;
    this.#submitWaiting(this.#session.getSnapshot());
  }

  #submitWaiting(state: ClientSessionState): void {
    const receipt = this.#waiting;
    if (!receipt || this.#disposed || this.#active) return;
    if (
      this.#store.getSnapshot().slots[receipt.target].installingRevision !==
      receipt.revision
    ) {
      this.#waiting = undefined;
      this.#pump();
      return;
    }
    if (terminalSession(state)) {
      this.#failWaiting({ stage: 'session', reason: 'ended' });
      return;
    }
    if (
      state.phase !== 'ready' ||
      !state.view ||
      state.pendingCommands.length > 0
    ) {
      return;
    }
    if (state.view.viewer.kind !== 'player') {
      this.#failWaiting({ stage: 'resolution', reason: 'not_player' });
      return;
    }
    const targetPlayerId = this.#resolveTargetPlayerId(
      state.view,
      receipt.target
    );
    if (!targetPlayerId || !state.view.players[targetPlayerId]) {
      this.#failWaiting({ stage: 'resolution', reason: 'stale_player' });
      return;
    }
    const command: WireGameCommand = {
      type: 'SetCardBack',
      ...(receipt.target === 'alternate' ? { targetPlayerId } : {}),
      cardBackUrl: receipt.url,
    };
    const submission = this.#session.submit(command);
    if (!submission.queued) {
      this.#failWaiting({
        stage: 'submission',
        reason: submission.reason,
      });
      return;
    }
    this.#waiting = undefined;
    this.#active = {
      receipt,
      commandId: submission.commandId,
    };
    this.#handleSession();
  }

  #failWaiting(failure: CardBackInstallFailure): void {
    const receipt = this.#active?.receipt ?? this.#waiting;
    this.#active = undefined;
    this.#waiting = undefined;
    this.#draining = false;
    if (receipt) this.#store.settleInstall(receipt, 'failed');
    this.#report(failure);
  }

  #report(failure: CardBackInstallFailure): void {
    try {
      this.#onFailure?.(Object.freeze(failure));
    } catch {
      // UI reporting cannot alter retained selection or authority state.
    }
  }
}
