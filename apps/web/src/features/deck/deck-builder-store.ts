import {
  addCard,
  deckTotals,
  EMPTY_DECK_LIST,
  removeCard,
  sameDeckList,
  type DeckCard,
  type DeckFormatId,
  type DeckList,
} from '@ptcgsim/deck-core';

export type DeckBuilderTarget = 'main' | 'alternate';

/** Which deck a seat holds: a saved one, or one picked without saving. */
export interface DeckSlotLabel {
  /** The saved deck it is, when it is one. */
  readonly deckId?: string;
  readonly name: string;
  readonly format?: DeckFormatId;
}

export interface DeckBuilderSlotSnapshot {
  readonly deck: DeckList;
  readonly label?: DeckSlotLabel;
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
  readonly deck: DeckList;
}

export type DeckInstallOutcome = 'installed' | 'failed';

export interface DeckBuilderStoreOptions {
  readonly alternateEnabled?: boolean;
  readonly initialTarget?: DeckBuilderTarget;
  readonly mainDeck?: DeckList;
  readonly alternateDeck?: DeckList;
}

type Listener = () => void;

const sameLabel = (
  left: DeckSlotLabel | undefined,
  right: DeckSlotLabel | undefined
): boolean =>
  left?.deckId === right?.deckId &&
  left?.name === right?.name &&
  left?.format === right?.format;

const nextRevision = (revision: number): number => {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Deck-builder revision limit reached.');
  }
  return revision + 1;
};

const createSlot = (
  deck: DeckList,
  revision = 0,
  installedRevision = revision,
  installingRevision?: number,
  label?: DeckSlotLabel
): DeckBuilderSlotSnapshot =>
  Object.freeze({
    deck,
    ...(label ? { label } : {}),
    revision,
    installedRevision,
    dirty: revision !== installedRevision,
    ...(installingRevision === undefined ? {} : { installingRevision }),
  });

const createInitialSlot = (
  deck: DeckList | undefined
): DeckBuilderSlotSnapshot => createSlot(deck ?? EMPTY_DECK_LIST);

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
 * Owns the deck on each seat -- main, and the alternate in Solo --
 * independently of React, the saved-deck library, network commands and the
 * live board. Install receipts make async success acknowledgement
 * generation-safe, so edits made during a load stay dirty.
 */
export class DeckBuilderStore {
  #alternateEnabled: boolean;
  readonly #listeners = new Set<Listener>();
  #pending?: DeckInstallReceipt;
  #state: DeckBuilderSnapshot;
  /** Seats whose installed revision is another room's (a restored game's). */
  #installedElsewhere: Record<DeckBuilderTarget, boolean> = {
    main: false,
    alternate: false,
  };

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

  /**
   * Applies the current room's ownership capability without discarding an
   * offline alternate deck. Disabling the alternate target also invalidates
   * any receipt captured for it, because that work can no longer be owned by
   * the attached session.
   */
  setAlternateEnabled(enabled: boolean): boolean {
    if (enabled === this.#alternateEnabled) return false;

    let alternate = this.#state.slots.alternate;
    if (!enabled && this.#pending?.target === 'alternate') {
      this.#pending = undefined;
      alternate = createSlot(
        alternate.deck,
        alternate.revision,
        alternate.installedRevision,
        undefined,
        alternate.label
      );
    }
    this.#alternateEnabled = enabled;
    this.#publish(
      createSnapshot(
        !enabled && this.#state.target === 'alternate'
          ? 'main'
          : this.#state.target,
        enabled,
        this.#state.slots.main,
        alternate
      )
    );
    return true;
  }

  /**
   * A room that keeps its own table (a restored game) attached: nothing goes
   * on it by itself -- neither the deck a seat had nor an edit left waiting
   * from before, which is set aside -- but a deck then chosen or edited for
   * a seat is installed, even when it is the one the last room had.
   */
  forgetInstalls(): void {
    this.#installedElsewhere = { main: true, alternate: true };
    for (const target of ['main', 'alternate'] as const) {
      const slot = this.#state.slots[target];
      if (!slot.dirty || slot.installingRevision !== undefined) continue;
      this.#replaceSlot(
        target,
        createSlot(
          slot.deck,
          slot.revision,
          slot.revision,
          undefined,
          slot.label
        )
      );
    }
  }

  /**
   * Transfers retained editor state to a fresh authority generation. Clean,
   * nonempty decks become dirty so the new session receives them; existing
   * dirty work (including an intentional empty deck) keeps its exact revision.
   * Disabled alternate state remains retained locally until solo ownership is
   * restored.
   */
  prepareForNewSession(): boolean {
    const prepare = (
      slot: DeckBuilderSlotSnapshot,
      enabled: boolean
    ): DeckBuilderSlotSnapshot => {
      const settled =
        slot.installingRevision === undefined
          ? slot
          : createSlot(
              slot.deck,
              slot.revision,
              slot.installedRevision,
              undefined,
              slot.label
            );
      if (!enabled || settled.dirty || deckTotals(settled.deck).total === 0) {
        return settled;
      }
      return createSlot(
        settled.deck,
        nextRevision(settled.revision),
        settled.installedRevision,
        undefined,
        settled.label
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
    this.#publish(
      createSnapshot(
        this.#state.target,
        this.#alternateEnabled,
        main,
        alternate
      )
    );
    return true;
  }

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
    return this.#replaceEditedSlot(
      target,
      addCard(slot.deck, card),
      slot.label
    );
  }

  removeCard(card: DeckCard, target = this.#state.target): boolean {
    if (!card.name || !this.#canEdit(target)) return false;
    const slot = this.#state.slots[target];
    const nextDeck = removeCard(slot.deck, card);
    if (nextDeck === slot.deck) return false;
    return this.#replaceEditedSlot(target, nextDeck, slot.label);
  }

  /**
   * Puts a deck on a seat. With a label, the seat now holds that deck (a
   * saved one, or one picked from a list); without, it keeps its label.
   * The same cards under the same label change nothing.
   */
  /**
   * Puts a deck on a seat. `chosen`: the player picked it (a saved deck, an
   * import), so in a restored game it goes on the table even when it is the
   * last room's; a rename or a cover synced from the library never does.
   */
  replaceDeck(
    target: DeckBuilderTarget,
    deck: DeckList,
    label?: DeckSlotLabel | null,
    options: { readonly chosen?: boolean } = {}
  ): boolean {
    if (!this.#canEdit(target)) return false;
    const current = this.#state.slots[target];
    const nextLabel =
      label === undefined ? current.label : (label ?? undefined);
    if (
      sameDeckList(current.deck, deck) &&
      !(options.chosen && this.#installedElsewhere[target])
    ) {
      // The same cards under a new name (a rename, a deleted saved deck)
      // are not a new deck for the table.
      if (sameLabel(current.label, nextLabel)) return false;
      this.#replaceSlot(
        target,
        createSlot(
          current.deck,
          current.revision,
          current.installedRevision,
          current.installingRevision,
          nextLabel
        )
      );
      return true;
    }
    this.#installedElsewhere[target] = false;
    return this.#replaceEditedSlot(target, deck, nextLabel);
  }

  clearDeck(target = this.#state.target): boolean {
    if (
      !this.#canEdit(target) ||
      (deckTotals(this.#state.slots[target].deck).total === 0 &&
        !this.#state.slots[target].label)
    ) {
      return false;
    }
    return this.#replaceEditedSlot(target, EMPTY_DECK_LIST, undefined);
  }

  /** Replaces one editor slot from an already-installed external deck. */
  synchronizeDeck(
    target: DeckBuilderTarget,
    deck: DeckList,
    label?: DeckSlotLabel
  ): void {
    const current = this.#state.slots[target];
    const revision = nextRevision(current.revision);
    if (this.#pending?.target === target) this.#pending = undefined;
    this.#replaceSlot(
      target,
      createSlot(deck, revision, revision, undefined, label ?? current.label)
    );
  }

  /** Whether a deck is out for the room and not yet settled. */
  hasPendingInstall(): boolean {
    return this.#pending !== undefined;
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
          slot.revision,
          slot.label
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
      createSlot(
        slot.deck,
        slot.revision,
        installedRevision,
        undefined,
        slot.label
      )
    );
    return true;
  }

  #canEdit(target: DeckBuilderTarget): boolean {
    return target === 'main' || this.#alternateEnabled;
  }

  /** `label` is the seat's label after: undefined clears it. */
  #replaceEditedSlot(
    target: DeckBuilderTarget,
    deck: DeckList,
    label: DeckSlotLabel | undefined
  ): boolean {
    const current = this.#state.slots[target];
    this.#replaceSlot(
      target,
      createSlot(
        deck,
        nextRevision(current.revision),
        current.installedRevision,
        current.installingRevision,
        label
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
