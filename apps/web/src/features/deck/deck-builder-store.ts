import {
  addCard,
  createEmptyDeck,
  getDeckCounts,
  removeCard,
  type Deck,
  type DeckCard,
} from '@ptcgsim/deck-core';

export type DeckBuilderTarget = 'main' | 'alternate';

export interface DeckBuilderSlotSnapshot {
  readonly deck: Deck;
  readonly revision: number;
  readonly installedRevision: number;
  readonly dirty: boolean;
  readonly installingRevision?: number;
}

export interface DeckBuilderSnapshot {
  readonly target: DeckBuilderTarget;
  readonly alternateEnabled: boolean;
  readonly slots: Readonly<Record<DeckBuilderTarget, DeckBuilderSlotSnapshot>>;
  readonly hasDirtyDecks: boolean;
}

export interface DeckInstallReceipt {
  readonly target: DeckBuilderTarget;
  readonly revision: number;
  readonly deck: Deck;
}

export type DeckInstallOutcome = 'installed' | 'failed';

export interface DeckBuilderStoreOptions {
  readonly alternateEnabled?: boolean;
  readonly initialTarget?: DeckBuilderTarget;
  readonly mainDeck?: Deck;
  readonly alternateDeck?: Deck;
}

type Listener = () => void;

const deepFreeze = <Value>(
  value: Value,
  seen = new WeakSet<object>()
): Value => {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
};

const cloneDeck = (deck: Deck): Deck => deepFreeze(structuredClone(deck));

const freezeOwnedDeck = (deck: Deck): Deck => deepFreeze(deck);

const nextRevision = (revision: number): number => {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Deck-builder revision limit reached.');
  }
  return revision + 1;
};

const createSlot = (
  deck: Deck,
  revision = 0,
  installedRevision = revision,
  installingRevision?: number
): DeckBuilderSlotSnapshot =>
  Object.freeze({
    deck,
    revision,
    installedRevision,
    dirty: revision !== installedRevision,
    ...(installingRevision === undefined ? {} : { installingRevision }),
  });

const createInitialSlot = (deck: Deck | undefined): DeckBuilderSlotSnapshot =>
  createSlot(cloneDeck(deck ?? createEmptyDeck()));

const createSnapshot = (
  target: DeckBuilderTarget,
  alternateEnabled: boolean,
  main: DeckBuilderSlotSnapshot,
  alternate: DeckBuilderSlotSnapshot
): DeckBuilderSnapshot => {
  const slots = Object.freeze({ main, alternate });
  return Object.freeze({
    target,
    alternateEnabled,
    slots,
    hasDirtyDecks: main.dirty || alternate.dirty,
  });
};

/**
 * Owns the editable main and alternate decks independently of React, files,
 * network commands, and the live board. Install receipts make async success
 * acknowledgement generation-safe, so edits made during a load stay dirty.
 */
export class DeckBuilderStore {
  readonly #alternateEnabled: boolean;
  readonly #listeners = new Set<Listener>();
  #pending?: DeckInstallReceipt;
  #state: DeckBuilderSnapshot;

  constructor(options: DeckBuilderStoreOptions = {}) {
    this.#alternateEnabled = options.alternateEnabled ?? true;
    const target =
      options.initialTarget === 'alternate' && this.#alternateEnabled
        ? 'alternate'
        : 'main';
    this.#state = createSnapshot(
      target,
      this.#alternateEnabled,
      createInitialSlot(options.mainDeck),
      createInitialSlot(options.alternateDeck)
    );
  }

  getSnapshot = (): DeckBuilderSnapshot => this.#state;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  };

  selectTarget(target: DeckBuilderTarget): boolean {
    if (
      target === this.#state.target ||
      (target === 'alternate' && !this.#alternateEnabled)
    ) {
      return false;
    }
    this.#publish(
      createSnapshot(
        target,
        this.#alternateEnabled,
        this.#state.slots.main,
        this.#state.slots.alternate
      )
    );
    return true;
  }

  addCard(card: DeckCard, target = this.#state.target): boolean {
    if (!card.name || !this.#canEdit(target)) return false;
    const slot = this.#state.slots[target];
    return this.#replaceEditedSlot(target, addCard(slot.deck, card), false);
  }

  removeCard(card: DeckCard, target = this.#state.target): boolean {
    if (!card.name || !this.#canEdit(target)) return false;
    const slot = this.#state.slots[target];
    const nextDeck = removeCard(slot.deck, card);
    if (
      Object.is(getDeckCounts(nextDeck).total, getDeckCounts(slot.deck).total)
    ) {
      return false;
    }
    return this.#replaceEditedSlot(target, nextDeck, false);
  }

  replaceDeck(target: DeckBuilderTarget, deck: Deck): boolean {
    if (!this.#canEdit(target)) return false;
    return this.#replaceEditedSlot(target, deck, true);
  }

  clearDeck(target = this.#state.target): boolean {
    if (
      !this.#canEdit(target) ||
      getDeckCounts(this.#state.slots[target].deck).total === 0
    ) {
      return false;
    }
    return this.#replaceEditedSlot(target, createEmptyDeck(), false);
  }

  /** Replaces one editor slot from an already-installed external deck. */
  synchronizeDeck(target: DeckBuilderTarget, deck: Deck): void {
    const current = this.#state.slots[target];
    const revision = nextRevision(current.revision);
    if (this.#pending?.target === target) this.#pending = undefined;
    this.#replaceSlot(target, createSlot(cloneDeck(deck), revision, revision));
  }

  /**
   * Starts one install at a time, ordered main before alternate. Serializing
   * receipts prevents a second LoadDeck command from carrying the authority
   * revision that the first command is about to replace. Empty decks are
   * intentional install candidates.
   */
  beginNextDirtyInstall(): DeckInstallReceipt | undefined {
    if (this.#pending) return undefined;
    for (const target of ['main', 'alternate'] as const) {
      if (!this.#canEdit(target)) continue;
      const slot = this.#state.slots[target];
      if (!slot.dirty) continue;
      const receipt = Object.freeze({
        target,
        revision: slot.revision,
        deck: slot.deck,
      });
      this.#pending = receipt;
      this.#replaceSlot(
        target,
        createSlot(
          slot.deck,
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
    receipt: DeckInstallReceipt,
    outcome: DeckInstallOutcome
  ): boolean {
    if (this.#pending !== receipt) return false;
    this.#pending = undefined;
    const slot = this.#state.slots[receipt.target];
    const installedRevision =
      outcome === 'installed'
        ? Math.max(slot.installedRevision, receipt.revision)
        : slot.installedRevision;
    this.#replaceSlot(
      receipt.target,
      createSlot(slot.deck, slot.revision, installedRevision)
    );
    return true;
  }

  #canEdit(target: DeckBuilderTarget): boolean {
    return target === 'main' || this.#alternateEnabled;
  }

  #replaceEditedSlot(
    target: DeckBuilderTarget,
    deck: Deck,
    clone: boolean
  ): boolean {
    const current = this.#state.slots[target];
    this.#replaceSlot(
      target,
      createSlot(
        clone ? cloneDeck(deck) : freezeOwnedDeck(deck),
        nextRevision(current.revision),
        current.installedRevision,
        current.installingRevision
      )
    );
    return true;
  }

  #replaceSlot(target: DeckBuilderTarget, slot: DeckBuilderSlotSnapshot): void {
    this.#publish(
      createSnapshot(
        this.#state.target,
        this.#alternateEnabled,
        target === 'main' ? slot : this.#state.slots.main,
        target === 'alternate' ? slot : this.#state.slots.alternate
      )
    );
  }

  #publish(state: DeckBuilderSnapshot): void {
    this.#state = state;
    for (const listener of [...this.#listeners]) listener();
  }
}
