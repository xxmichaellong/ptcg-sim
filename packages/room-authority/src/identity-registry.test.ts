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
import { identitiesSurvivingUndo } from './undo-identities.js';

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
  it('discloses only the persisted Solo controller opponent hand', () => {
    const loaded = loadedMatch();
    const opponentDeckId = playerZoneId(p2, 'deck');
    const opponentHandId = playerZoneId(p2, 'hand');
    const cardId = loaded.state.zones[opponentDeckId]!.cardIds[0]!;
    const state = run(
      loaded.state,
      {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: opponentDeckId,
        destinationZoneId: opponentHandId,
      },
      loaded.context
    );
    const source = createIdSource();
    const ordinary = projectRecipient(
      state,
      asPlayer(p1),
      emptyProjectionIdentityState(),
      source
    );
    const ordinaryCard = ordinary.snapshot.zones[opponentHandId]!.cards[0]!;
    expect(ordinaryCard).toMatchObject({
      kind: 'concealed',
      ownerId: p2,
      cardBackUrl: '/red.png',
    });

    const solo = projectRecipient(
      state,
      asPlayer(p1),
      ordinary.identities,
      source,
      'solo'
    );
    const disclosed = solo.snapshot.zones[opponentHandId]!.cards[0]!;
    expect(disclosed).toMatchObject({
      kind: 'known',
      id: ordinaryCard.id,
      ownerId: p2,
      face: 'up',
      publiclyRevealed: false,
    });
    expect(
      disclosed.kind === 'known'
        ? solo.snapshot.definitions[disclosed.definitionId]
        : undefined
    ).toMatchObject({
      name: 'red 0',
      imageUrl: '/red-0.png',
    });
    expect(
      Object.keys(solo.snapshot.definitions),
      'canonical definition IDs must remain authority-private'
    ).not.toContain('red-definition-0');

    expect(
      projectRecipient(state, spectator, solo.identities, source, 'solo')
        .snapshot.zones[opponentHandId]!.cards[0]
    ).toMatchObject({ kind: 'concealed' });
    expect(
      projectRecipient(
        state,
        asPlayer(p1),
        solo.identities,
        source,
        'multiplayer'
      ).snapshot.zones[opponentHandId]!.cards[0]
    ).toMatchObject({ kind: 'concealed' });

    const ordinaryResolution = resolveViewCard(
      state,
      solo.identities,
      asPlayer(p1),
      ordinaryCard.id
    );
    expect(ordinaryResolution).toMatchObject({ known: false });
    expect(
      resolveViewCard(
        state,
        solo.identities,
        asPlayer(p1),
        ordinaryCard.id,
        'solo'
      )
    ).toMatchObject({ known: true, cardId });
  });

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

  // An undo restores an older state. Only the cards the move taken back
  // carried across a concealment boundary may change alias; everything else
  // keeps its alias, so the table leaves it where it lies.
  describe('through an undo', () => {
    const viewers = [asPlayer(p1), asPlayer(p2), spectator];
    const deckId = playerZoneId(p1, 'deck');
    /** Every alias each viewer is shown, and the deck's in order. */
    const allAliases = (
      state: MatchState,
      identities: ProjectionIdentityState,
      source: OpaqueIdSource
    ) => {
      let next = identities;
      const shown = viewers.map((viewer) => {
        const projected = project(state, viewer, next, source);
        next = projected.identities;
        const zones = projected.snapshot.zones;
        return {
          all: Object.values(zones).flatMap((zone) =>
            zone.cards.map((card) => card.id as string)
          ),
          deck: zones[deckId]!.cards.map((card) => card.id as string),
        };
      });
      return { shown, next };
    };

    it('keeps every alias the move left alone and rotates the card it drew', () => {
      const { state: before, context } = loadedMatch();
      const source = createIdSource();
      const seen = allAliases(before, emptyProjectionIdentityState(), source);
      const drawn = run(
        before,
        { type: 'DrawCards', playerId: p1, count: 1 },
        context
      );
      const branch = allAliases(drawn, seen.next, source);
      const restored = allAliases(
        before,
        identitiesSurvivingUndo(branch.next, drawn, before),
        source
      );
      const drawnCardId = drawn.zones[playerZoneId(p1, 'hand')]!.cardIds[0]!;
      const deckIndex = before.zones[deckId]!.cardIds.indexOf(drawnCardId);
      restored.shown.forEach(({ all, deck }, viewer) => {
        const changed = all.filter(
          (alias) => !seen.shown[viewer]!.all.includes(alias)
        );
        // Eleven of the twelve cards on the table are exactly as they were;
        // the one that changed is the card that went back to the deck.
        expect(changed).toEqual([deck[deckIndex]]);
        // Its alias is one neither branch ever showed, so the draw cannot
        // be tied to the restored deck.
        expect(branch.shown[viewer]!.all).not.toContain(changed[0]);
      });
    });

    it('rotates a whole pile when the move taken back shuffled it', () => {
      const { state: before, context } = loadedMatch();
      const source = createIdSource();
      const seen = concealedAliasesFor(
        before,
        asPlayer(p2),
        emptyProjectionIdentityState(),
        source,
        deckId
      );
      const shuffled = run(
        before,
        { type: 'ShuffleZone', zoneId: deckId },
        context
      );
      const branch = concealedAliasesFor(
        shuffled,
        asPlayer(p2),
        seen.next,
        source,
        deckId
      );
      const restored = concealedAliasesFor(
        before,
        asPlayer(p2),
        identitiesSurvivingUndo(branch.next, shuffled, before),
        source,
        deckId
      );
      for (const alias of restored.aliases) {
        expect(seen.aliases).not.toContain(alias);
        expect(branch.aliases).not.toContain(alias);
      }
    });

    it('drops discarded-branch aliases of viewers who were away during the move', () => {
      const { state: before, context } = loadedMatch();
      const source = createIdSource();
      // The spectator saw the deck before the shuffle and nothing since; its
      // stale entries must not outlive the generation the undo threw away.
      const away = concealedAliasesFor(
        before,
        spectator,
        emptyProjectionIdentityState(),
        source,
        deckId
      );
      const shuffled = run(
        before,
        { type: 'ShuffleZone', zoneId: deckId },
        context
      );
      const branch = project(shuffled, asPlayer(p2), away.next, source);
      const kept = identitiesSurvivingUndo(branch.identities, shuffled, before);
      expect(
        kept.cardAliases.filter(
          (entry) =>
            entry.cardId && before.zones[deckId]!.cardIds.includes(entry.cardId)
        )
      ).toEqual([]);
      expect(kept.definitionAliases).toEqual(
        branch.identities.definitionAliases
      );
    });
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
