import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  type CommandContext,
  type DeckEntry,
  type GameCommand,
  type MatchState,
  type ViewerRole,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  emptyProjectionIdentityState,
  projectRecipient,
  resolveViewCard,
  type OpaqueIdSource,
  type ProjectionIdentityState,
} from './identity-registry.js';

const p1 = asPlayerId('identity-player-one');
const p2 = asPlayerId('identity-player-two');
const asPlayer = (playerId: typeof p1): ViewerRole => ({
  kind: 'player',
  playerId,
});
const spectator: ViewerRole = { kind: 'spectator' };

const createContext = (
  shuffle: CommandContext['shuffle'] = (values) => [...values].reverse()
): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`identity-card-${++card}`),
    nextStackId: () => asStackId(`identity-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`identity-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`identity-work-${++workArea}`),
    shuffle,
    randomInt: () => 0,
  };
};

/** Deterministic, so a repeated alias is a real reuse rather than a collision. */
const createIdSource = (): OpaqueIdSource => {
  let next = 0;
  return {
    nextOpaqueId: (kind) => `alias_${kind}_${String(++next).padStart(6, '0')}`,
  };
};

const entries = (prefix: string, count: number): readonly DeckEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`${prefix}-definition-${index}`),
      name: `${prefix} ${index}`,
      category: 'Pokémon' as const,
      imageUrl: `/${prefix}-${index}.png`,
    },
    count: 1,
  }));

const run = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const loadedMatch = (): { state: MatchState; context: CommandContext } => {
  const context = createContext();
  let state = createEmptyMatch(asMatchId('identity-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = run(
    state,
    { type: 'LoadDeck', playerId: p1, entries: entries('blue', 6) },
    context
  );
  state = run(
    state,
    { type: 'LoadDeck', playerId: p2, entries: entries('red', 6) },
    context
  );
  return { state, context };
};

const project = (
  state: MatchState,
  viewer: ViewerRole,
  identities: ProjectionIdentityState,
  source: OpaqueIdSource
) => projectRecipient(state, viewer, identities, source);

const concealedAliasesFor = (
  state: MatchState,
  viewer: ViewerRole,
  identities: ProjectionIdentityState,
  source: OpaqueIdSource,
  zoneId: string
): {
  readonly aliases: readonly string[];
  readonly next: ProjectionIdentityState;
} => {
  const projected = project(state, viewer, identities, source);
  const zone = projected.snapshot.zones[zoneId];
  if (!zone) throw new Error(`Projection is missing zone ${zoneId}`);
  return {
    aliases: zone.cards.map((card) => card.id as string),
    next: projected.identities,
  };
};

// The opaque handle is what stops a viewer tracking a hidden card through the
// deck. These pin that contract directly rather than relying on the broader
// generative model to happen to cover it.
describe('projection identity registry', () => {
  it('reuses one alias while a card keeps its visibility generation', () => {
    const { state } = loadedMatch();
    const source = createIdSource();
    const deckId = playerZoneId(p1, 'deck');
    const first = concealedAliasesFor(
      state,
      asPlayer(p1),
      emptyProjectionIdentityState(),
      source,
      deckId
    );
    const second = concealedAliasesFor(
      state,
      asPlayer(p1),
      first.next,
      source,
      deckId
    );
    expect(second.aliases).toEqual(first.aliases);
  });

  it('mints fresh aliases when a shuffle bumps the visibility generation', () => {
    const { state, context } = loadedMatch();
    const source = createIdSource();
    const deckId = playerZoneId(p1, 'deck');
    const before = concealedAliasesFor(
      state,
      asPlayer(p1),
      emptyProjectionIdentityState(),
      source,
      deckId
    );

    const shuffled = run(
      state,
      { type: 'ShuffleZone', zoneId: deckId },
      context
    );
    const after = concealedAliasesFor(
      shuffled,
      asPlayer(p1),
      before.next,
      source,
      deckId
    );

    // A carried-over alias would let the viewer follow one card through the
    // shuffle, which is exactly what the generation exists to prevent.
    expect(after.aliases).toHaveLength(before.aliases.length);
    for (const alias of after.aliases) {
      expect(
        before.aliases,
        `alias ${alias} survived the shuffle`
      ).not.toContain(alias);
    }
  });

  it('gives each recipient a different alias for the same card', () => {
    const { state } = loadedMatch();
    const source = createIdSource();
    const deckId = playerZoneId(p1, 'deck');
    let identities = emptyProjectionIdentityState();
    const seen: string[][] = [];
    for (const viewer of [asPlayer(p1), asPlayer(p2), spectator]) {
      const projected = concealedAliasesFor(
        state,
        viewer,
        identities,
        source,
        deckId
      );
      identities = projected.next;
      seen.push([...projected.aliases]);
    }
    const [owner, opponent, watcher] = seen;
    expect(owner).toBeDefined();
    for (const other of [opponent, watcher]) {
      for (const alias of other ?? []) {
        expect(
          owner,
          'aliases must not be shared between recipients'
        ).not.toContain(alias);
      }
    }
    expect(new Set([...(opponent ?? []), ...(watcher ?? [])]).size).toBe(
      (opponent?.length ?? 0) + (watcher?.length ?? 0)
    );
  });

  it('stops resolving an alias once its generation moves on', () => {
    const { state, context } = loadedMatch();
    const source = createIdSource();
    const deckId = playerZoneId(p1, 'deck');
    const projected = project(
      state,
      asPlayer(p1),
      emptyProjectionIdentityState(),
      source
    );
    const alias = projected.snapshot.zones[deckId]?.cards[0]?.id as string;
    expect(alias).toBeDefined();
    expect(
      resolveViewCard(state, projected.identities, asPlayer(p1), alias)
    ).toBeDefined();

    const shuffled = run(
      state,
      { type: 'ShuffleZone', zoneId: deckId },
      context
    );
    expect(
      resolveViewCard(shuffled, projected.identities, asPlayer(p1), alias),
      'a stale alias must not resolve after the generation changes'
    ).toBeUndefined();
  });

  it('never resolves one recipient alias for another recipient', () => {
    const { state } = loadedMatch();
    const source = createIdSource();
    const deckId = playerZoneId(p1, 'deck');
    const projected = project(
      state,
      asPlayer(p1),
      emptyProjectionIdentityState(),
      source
    );
    const alias = projected.snapshot.zones[deckId]?.cards[0]?.id as string;
    for (const viewer of [asPlayer(p2), spectator]) {
      expect(
        resolveViewCard(state, projected.identities, viewer, alias)
      ).toBeUndefined();
    }
  });

  it('drops aliases for cards a new deck load removed', () => {
    const { state, context } = loadedMatch();
    const source = createIdSource();
    const first = project(
      state,
      asPlayer(p1),
      emptyProjectionIdentityState(),
      source
    );
    expect(first.identities.cardAliases.length).toBeGreaterThan(0);

    const reloaded = run(
      state,
      { type: 'LoadDeck', playerId: p1, entries: entries('fresh', 4) },
      context
    );
    const second = project(reloaded, asPlayer(p1), first.identities, source);
    const survivingCardIds = new Set(
      second.identities.cardAliases.map((entry) => entry.cardId as string)
    );
    for (const cardId of survivingCardIds) {
      expect(
        reloaded.cards[cardId],
        `${cardId} must still exist`
      ).toBeDefined();
    }
  });
});
