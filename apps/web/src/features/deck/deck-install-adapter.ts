import { t } from '@lingui/core/macro';
import {
  isSessionFinished,
  type ClientSessionState,
  type RemoteGameSession,
  type SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { DeckList } from '@ptcgsim/deck-core';
import {
  isCardPresentation,
  resolveCardPresentation,
  type CardPresentation,
  type MatchViewState,
} from '@ptcgsim/game-core';
import {
  MAX_DECK_CARDS,
  MAX_DECK_ENTRIES,
  MAX_IMAGE_URL_CODE_UNITS,
  type WireGameCommand,
} from '@ptcgsim/protocol';

import {
  resolveLoadDeckAction,
  type LoadDeckEntries,
} from '../../board/resolveLifecycleAction.js';
import {
  type DeckBuilderStore,
  type DeckBuilderTarget,
  type DeckInstallReceipt,
} from './deck-builder-store.js';

const MAX_CARD_NAME_CODE_UNITS = 256;
const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

export type DeckInstallAdapterErrorCode =
  | 'aborted'
  | 'crypto_unavailable'
  | 'digest_failed'
  | 'identity_collision'
  | 'invalid_count'
  | 'invalid_deck'
  | 'missing_image'
  | 'missing_name'
  | 'too_many_cards'
  | 'too_many_entries'
  | 'url_too_long'
  | 'name_too_long';

export class DeckInstallAdapterError extends Error {
  constructor(readonly code: DeckInstallAdapterErrorCode) {
    super(`Deck install conversion failed: ${code}`);
    this.name = 'DeckInstallAdapterError';
  }
}

export interface DeckDefinitionDigest {
  digestIdentity(identity: string): Promise<string>;
}

const browserDigest: DeckDefinitionDigest = {
  async digestIdentity(identity) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new DeckInstallAdapterError('crypto_unavailable');
    let digest: ArrayBuffer;
    try {
      digest = await subtle.digest(
        'SHA-256',
        new TextEncoder().encode(identity)
      );
    } catch {
      throw new DeckInstallAdapterError('digest_failed');
    }
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  },
};

type CardCategory = LoadDeckEntries[number]['definition']['category'];

const CATEGORIES: ReadonlySet<unknown> = new Set([
  'Pokémon',
  'Trainer',
  'Energy',
]);

interface DefinitionCandidate {
  readonly identity: string;
  readonly name: string;
  readonly category: CardCategory;
  readonly imageUrl: string;
  readonly imageUrlSmall?: string;
  readonly presentation?: CardPresentation;
  count: number;
}

const fail = (code: DeckInstallAdapterErrorCode): never => {
  throw new DeckInstallAdapterError(code);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Converts a deck list into one closed wire deck. Definition IDs are
 * content-addressed so equal visible definitions share an ID across targets
 * and reloads without embedding player-controlled text. A deck comes from
 * storage the page doesn't fully control (a saved deck, a file), so every
 * field is checked again here.
 */
export const deckToLoadDeckEntries = async (
  deck: DeckList,
  dependencies: {
    readonly digest?: DeckDefinitionDigest;
    readonly signal?: AbortSignal;
  } = {}
): Promise<LoadDeckEntries> => {
  if (!Array.isArray(deck)) fail('invalid_deck');
  const candidates = new Map<string, DefinitionCandidate>();
  let totalCards = 0;

  for (const entry of deck as readonly unknown[]) {
    if (dependencies.signal?.aborted) fail('aborted');
    if (!isRecord(entry) || !isRecord(entry.card)) fail('invalid_deck');
    const { card, count } = entry as {
      readonly card: Record<string, unknown>;
      readonly count: unknown;
    };
    if (
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      count > MAX_DECK_CARDS
    ) {
      fail('invalid_count');
    }
    totalCards += count as number;
    if (totalCards > MAX_DECK_CARDS) fail('too_many_cards');

    const name = typeof card.name === 'string' ? card.name : '';
    if (name === '') fail('missing_name');
    if (name.length > MAX_CARD_NAME_CODE_UNITS) fail('name_too_long');
    const imageUrl = typeof card.image === 'string' ? card.image : '';
    if (imageUrl === '') fail('missing_image');
    if (imageUrl.length > MAX_IMAGE_URL_CODE_UNITS) fail('url_too_long');
    const small = card.imageSmall;
    if (typeof small === 'string' && small.length > MAX_IMAGE_URL_CODE_UNITS) {
      fail('url_too_long');
    }
    if (!CATEGORIES.has(card.category)) fail('invalid_deck');
    const category = card.category as CardCategory;
    if (
      card.presentation !== undefined &&
      !isCardPresentation(card.presentation)
    )
      fail('invalid_deck');
    const presentation = resolveCardPresentation({
      name,
      imageUrl,
      presentation: card.presentation as CardPresentation | undefined,
    });
    const imageUrlSmall =
      typeof small === 'string' && small !== '' && small !== imageUrl
        ? small
        : undefined;
    const identity = JSON.stringify([
      name,
      category,
      imageUrl,
      imageUrlSmall ?? null,
      ...(presentation ? [presentation] : []),
    ]);
    const existing = candidates.get(identity);
    if (existing) existing.count += count as number;
    else {
      candidates.set(identity, {
        identity,
        name,
        category,
        imageUrl,
        ...(presentation ? { presentation } : {}),
        ...(imageUrlSmall === undefined ? {} : { imageUrlSmall }),
        count: count as number,
      });
      if (candidates.size > MAX_DECK_ENTRIES) fail('too_many_entries');
    }
  }

  const digest = dependencies.digest ?? browserDigest;
  const identitiesByDigest = new Map<string, string>();
  const entries = await Promise.all(
    [...candidates.values()].map(async (candidate) => {
      let hash: string;
      try {
        hash = await digest.digestIdentity(candidate.identity);
      } catch (error) {
        if (error instanceof DeckInstallAdapterError) throw error;
        throw new DeckInstallAdapterError('digest_failed');
      }
      if (!SHA_256_HEX_PATTERN.test(hash)) fail('digest_failed');
      const previousIdentity = identitiesByDigest.get(hash);
      if (previousIdentity && previousIdentity !== candidate.identity) {
        fail('identity_collision');
      }
      identitiesByDigest.set(hash, candidate.identity);
      const definition = Object.freeze({
        id: `deck:sha256:${hash}`,
        name: candidate.name,
        category: candidate.category,
        imageUrl: candidate.imageUrl,
        ...(candidate.presentation
          ? { presentation: candidate.presentation }
          : {}),
        ...(candidate.imageUrlSmall === undefined
          ? {}
          : { imageUrlSmall: candidate.imageUrlSmall }),
      });
      return Object.freeze({ definition, count: candidate.count });
    })
  );
  if (dependencies.signal?.aborted) fail('aborted');
  return entries;
};

export type DeckInstallSession = Pick<
  RemoteGameSession,
  'getSnapshot' | 'subscribe' | 'submit'
>;

export type DeckInstallCoordinatorFailure =
  | {
      readonly stage: 'conversion';
      readonly code: DeckInstallAdapterErrorCode;
    }
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
  | {
      readonly stage: 'authority';
      readonly code?: string;
    }
  | { readonly stage: 'session'; readonly reason: 'ended' };

export interface DeckInstallCoordinatorOptions {
  readonly store: DeckBuilderStore;
  readonly session: DeckInstallSession;
  readonly digest?: DeckDefinitionDigest;
  readonly resolveTargetPlayerId?: (
    view: MatchViewState,
    target: DeckBuilderTarget
  ) => string | undefined;
  readonly onFailure?: (failure: DeckInstallCoordinatorFailure) => void;
}

interface PreparedInstall {
  readonly receipt: DeckInstallReceipt;
  readonly entries: LoadDeckEntries;
}

interface SubmittedInstall {
  readonly receipt: DeckInstallReceipt;
  readonly commandId: string;
}

/** The seat a deck slot installs into: the viewer's, or Solo's other. */
export const defaultTargetPlayerId = (
  view: MatchViewState,
  target: DeckBuilderTarget
): string | undefined => {
  if (view.viewer.kind !== 'player') return undefined;
  const viewerPlayerId = view.viewer.playerId;
  if (target === 'main') return viewerPlayerId;
  return view.playerOrder.find((playerId) => playerId !== viewerPlayerId);
};

// A connection that failed may be retried, and the command waiting on it
// land: only a session that won't come back ends an install.
const terminalSession = isSessionFinished;

/**
 * Drains store receipts through the acknowledged remote command stream. It
 * waits for an empty session outbox before each LoadDeck, then waits for that
 * command's published result before preparing the next target/revision.
 */
export class DeckInstallCoordinator {
  readonly #store: DeckBuilderStore;
  readonly #session: DeckInstallSession;
  readonly #digest?: DeckDefinitionDigest;
  readonly #resolveTargetPlayerId: NonNullable<
    DeckInstallCoordinatorOptions['resolveTargetPlayerId']
  >;
  readonly #onFailure?: (failure: DeckInstallCoordinatorFailure) => void;
  readonly #unsubscribe: () => void;
  #active?: SubmittedInstall;
  #prepared?: PreparedInstall;
  #converting?: DeckInstallReceipt;
  #draining = false;
  #disposed = false;
  #generation = 0;

  constructor(options: DeckInstallCoordinatorOptions) {
    this.#store = options.store;
    this.#session = options.session;
    this.#digest = options.digest;
    this.#resolveTargetPlayerId =
      options.resolveTargetPlayerId ?? defaultTargetPlayerId;
    this.#onFailure = options.onFailure;
    this.#unsubscribe = this.#session.subscribe(this.#handleSession);
  }

  flush(): boolean {
    if (this.#disposed) return false;
    this.#draining = true;
    void this.#pump();
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#draining = false;
    this.#generation += 1;
    const receipt = this.#prepared?.receipt ?? this.#converting;
    if (receipt) this.#store.settleInstall(receipt, 'failed');
    this.#prepared = undefined;
    this.#converting = undefined;
    // A LoadDeck already sent lands all the same: its result still settles
    // it, so a deck screen mounted again doesn't send it twice.
    if (!this.#active) this.#unsubscribe();
  }

  readonly #handleSession = (): void => {
    if (this.#disposed && !this.#active) return;
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
        if (this.#disposed) {
          this.#unsubscribe();
          return;
        }
        if (!completion.accepted) {
          this.#draining = false;
          this.#report({
            stage: 'authority',
            ...(completion.code ? { code: completion.code } : {}),
          });
          return;
        }
        if (this.#draining) void this.#pump();
        return;
      }
    }
    if (
      terminalSession(state) &&
      (this.#active || this.#prepared || this.#converting)
    ) {
      this.#failWaiting({ stage: 'session', reason: 'ended' });
      return;
    }
    if (this.#prepared) this.#submitPrepared(state);
    else if (this.#draining) void this.#pump();
  };

  async #pump(): Promise<void> {
    if (
      this.#disposed ||
      !this.#draining ||
      this.#active ||
      this.#prepared ||
      this.#converting
    ) {
      return;
    }
    const receipt = this.#store.beginNextDirtyInstall();
    if (!receipt) {
      // An install left waiting by a deck screen now gone goes first; this
      // one goes on once it settles.
      this.#draining = this.#store.hasPendingInstall();
      return;
    }
    this.#converting = receipt;
    const generation = this.#generation;
    let entries: LoadDeckEntries;
    try {
      entries = await deckToLoadDeckEntries(receipt.deck, {
        ...(this.#digest ? { digest: this.#digest } : {}),
      });
    } catch (error) {
      if (this.#converting !== receipt) return;
      this.#converting = undefined;
      const settled = this.#store.settleInstall(receipt, 'failed');
      this.#draining = false;
      if (settled && !this.#disposed) {
        this.#report({
          stage: 'conversion',
          code:
            error instanceof DeckInstallAdapterError
              ? error.code
              : 'digest_failed',
        });
      }
      return;
    }
    if (
      this.#disposed ||
      generation !== this.#generation ||
      this.#converting !== receipt
    ) {
      return;
    }
    this.#converting = undefined;
    const slot = this.#store.getSnapshot().slots[receipt.target];
    if (slot.installingRevision !== receipt.revision) {
      if (this.#draining) void this.#pump();
      return;
    }
    this.#prepared = { receipt, entries };
    this.#submitPrepared(this.#session.getSnapshot());
  }

  #submitPrepared(state: ClientSessionState): void {
    const prepared = this.#prepared;
    if (!prepared || this.#disposed || this.#active) return;
    if (
      this.#store.getSnapshot().slots[prepared.receipt.target]
        .installingRevision !== prepared.receipt.revision
    ) {
      this.#prepared = undefined;
      if (this.#draining) void this.#pump();
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
    const targetPlayerId = this.#resolveTargetPlayerId(
      state.view,
      prepared.receipt.target
    );
    const resolution = resolveLoadDeckAction(
      state.view,
      targetPlayerId ?? '',
      prepared.entries
    );
    if (!resolution.ok) {
      this.#failWaiting({ stage: 'resolution', reason: resolution.reason });
      return;
    }

    const submission = this.#session.submit(
      resolution.command as Extract<WireGameCommand, { type: 'LoadDeck' }>
    );
    if (!submission.queued) {
      this.#failWaiting({
        stage: 'submission',
        reason: submission.reason,
      });
      return;
    }
    this.#prepared = undefined;
    this.#active = {
      receipt: prepared.receipt,
      commandId: submission.commandId,
    };
    // A test double or future synchronous transport may have completed during
    // submit; inspect once after ownership is recorded so that cannot be lost.
    this.#handleSession();
  }

  #failWaiting(failure: DeckInstallCoordinatorFailure): void {
    const receipt =
      this.#prepared?.receipt ?? this.#active?.receipt ?? this.#converting;
    if (this.#converting) this.#generation += 1;
    this.#prepared = undefined;
    this.#active = undefined;
    this.#converting = undefined;
    this.#draining = false;
    if (receipt) this.#store.settleInstall(receipt, 'failed');
    if (this.#disposed) {
      this.#unsubscribe();
      return;
    }
    this.#report(failure);
  }

  #report(failure: DeckInstallCoordinatorFailure): void {
    try {
      this.#onFailure?.(Object.freeze(failure));
    } catch {
      // UI reporting cannot alter deck or authority transaction state.
    }
  }
}

/**
 * What a player is told when a deck doesn't reach the table, or nothing
 * when there is nothing to tell (the install was superseded, or the room
 * is gone and says so itself).
 */
export const deckInstallFailureNotice = (
  failure: DeckInstallCoordinatorFailure
): string | undefined => {
  switch (failure.stage) {
    case 'conversion':
      switch (failure.code) {
        case 'aborted':
          return undefined;
        case 'too_many_cards':
          return t`The table takes at most ${{ max: MAX_DECK_CARDS }} cards.`;
        case 'too_many_entries':
          return t`The table takes at most ${{ max: MAX_DECK_ENTRIES }} different cards.`;
        case 'missing_image':
          return t`A card in it has no picture.`;
        case 'url_too_long':
          return t`A card's picture address is too long.`;
        case 'name_too_long':
          return t`A card's name is too long.`;
        default:
          return t`Its cards couldn't be read.`;
      }
    case 'session':
      return undefined;
    default:
      return t`The room didn't take it. Try again.`;
  }
};
