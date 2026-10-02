import { describe, expect, it } from 'vitest';
import type { CommandContext, DeckEntry } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
import { executeCommand } from './execute-command.js';
import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  asViewCardId,
  asViewDefinitionId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import { projectMatch, type ProjectionIdentityAdapter } from './projection.js';
import { stableHash, stableSerialize } from './stable-hash.js';

const p1 = asPlayerId('p1');
const p2 = asPlayerId('p2');

const createContext = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`card-${++card}`),
    nextStackId: () => asStackId(`stack-${++stack}`),
    nextInspectionId: () => asInspectionId(`inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`work-area-${++workArea}`),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const deckEntries = (prefix: string, count = 20): readonly DeckEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`${prefix}-definition-${index}`),
      name: `${prefix} card ${index}`,
      category: index % 3 === 0 ? ('Pokémon' as const) : ('Trainer' as const),
      imageUrl: `https://cards.invalid/${prefix}/${index}.png`,
    },
    count: 1,
  }));

const identities: ProjectionIdentityAdapter = {
  viewCardId: ({ viewerKey, visibilityGeneration, known, cardId }) =>
    asViewCardId(
      `opaque:${viewerKey}:${known ? 'known' : 'hidden'}:${visibilityGeneration}:${String(cardId).replace(/\d/g, 'x')}`
    ),
  viewDefinitionId: ({ viewerKey, definitionId }) =>
    asViewDefinitionId(
      `definition:${viewerKey}:${String(definitionId).length}`
    ),
};

describe('normalized match core', () => {
  it('loads, sets up, and resets a deck without using DOM identity', () => {
    const context = createContext();
    let state = createEmptyMatch(asMatchId('match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/back-blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/back-red.png' },
    ]);
    const loaded = executeCommand(
      state,
      { type: 'LoadDeck', playerId: p1, entries: deckEntries('one') },
      context
    );
    expect(loaded.accepted).toBe(true);
    if (!loaded.accepted) return;
    state = loaded.state;
    expect(state.zones[playerZoneId(p1, 'deck')]?.cardIds).toHaveLength(20);

    const setup = executeCommand(
      state,
      { type: 'SetupPlayer', playerId: p1 },
      context
    );
    expect(setup.accepted).toBe(true);
    if (!setup.accepted) return;
    state = setup.state;
    expect(state.zones[playerZoneId(p1, 'hand')]?.cardIds).toHaveLength(7);
    expect(state.zones[playerZoneId(p1, 'prizes')]?.cardIds).toHaveLength(6);
    expect(state.zones[playerZoneId(p1, 'deck')]?.cardIds).toHaveLength(7);
    assertMatchInvariants(state);

    const reset = executeCommand(
      state,
      { type: 'ResetPlayer', playerId: p1 },
      context
    );
    expect(reset.accepted).toBe(true);
    if (!reset.accepted) return;
    expect(reset.state.zones[playerZoneId(p1, 'deck')]?.cardIds).toHaveLength(
      20
    );
    expect(reset.state.zones[playerZoneId(p1, 'hand')]?.cardIds).toHaveLength(
      0
    );
    assertMatchInvariants(reset.state);
  });

  it('creates a stable play stack and applies markers atomically', () => {
    const context = createContext();
    let state = createEmptyMatch(asMatchId('match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/back-blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/back-red.png' },
    ]);
    const loaded = executeCommand(
      state,
      { type: 'LoadDeck', playerId: p1, entries: deckEntries('one', 2) },
      context
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    state = loaded.state;
    const cardId = state.zones[playerZoneId(p1, 'deck')]!.cardIds[0]!;
    const moved = executeCommand(
      state,
      {
        type: 'MoveCardToPlay',
        cardId,
        expectedSourceZoneId: playerZoneId(p1, 'deck'),
        boardPlayerId: p1,
        slot: 'active',
      },
      context
    );
    if (!moved.accepted) throw new Error(moved.message);
    state = moved.state;
    const stackId = state.boards[p1]!.activeStackId!;
    const damaged = executeCommand(
      state,
      { type: 'SetDamage', stackId, damage: 120 },
      context
    );
    if (!damaged.accepted) throw new Error(damaged.message);
    expect(damaged.state.stacks[stackId]?.damage).toBe(120);
    expect(damaged.state.revision).toBe(state.revision + 1);
    assertMatchInvariants(damaged.state);
  });

  it('keeps hidden definitions and canonical card IDs out of opponent projections', () => {
    const context = createContext();
    let state = createEmptyMatch(asMatchId('match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/back-blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/back-red.png' },
    ]);
    const loaded = executeCommand(
      state,
      { type: 'LoadDeck', playerId: p1, entries: deckEntries('secret', 2) },
      context
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    state = loaded.state;
    const cardId = state.zones[playerZoneId(p1, 'deck')]!.cardIds[0]!;
    const definitionId = state.cards[cardId]!.definitionId;
    const view = projectMatch(
      state,
      { kind: 'player', playerId: p2 },
      identities
    );
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(cardId);
    expect(serialized).not.toContain(definitionId);
    expect(serialized).not.toContain('secret card');
    expect(Object.keys(view.definitions)).toHaveLength(0);
    expect(view.zones[playerZoneId(p1, 'deck')]?.cards[0]?.kind).toBe(
      'concealed'
    );
  });

  it('changes concealment identity generation after a shuffle', () => {
    const context = createContext();
    let state = createEmptyMatch(asMatchId('match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/back-blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/back-red.png' },
    ]);
    const loaded = executeCommand(
      state,
      { type: 'LoadDeck', playerId: p1, entries: deckEntries('secret', 2) },
      context
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    state = loaded.state;
    const before = projectMatch(
      state,
      { kind: 'player', playerId: p2 },
      identities
    );
    const shuffled = executeCommand(
      state,
      { type: 'ShuffleZone', zoneId: playerZoneId(p1, 'deck') },
      context
    );
    if (!shuffled.accepted) throw new Error(shuffled.message);
    const after = projectMatch(
      shuffled.state,
      { kind: 'player', playerId: p2 },
      identities
    );
    expect(before.zones[playerZoneId(p1, 'deck')]?.cards[0]?.id).not.toBe(
      after.zones[playerZoneId(p1, 'deck')]?.cards[1]?.id
    );
  });

  it('keeps rejected commands byte-identical and hashes object keys canonically', () => {
    const context = createContext();
    const state = createEmptyMatch(asMatchId('match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/back-blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/back-red.png' },
    ]);
    const before = stableSerialize(state);
    const result = executeCommand(
      state,
      { type: 'DrawCards', playerId: p1, count: 1 },
      context
    );
    expect(result.accepted).toBe(false);
    expect(stableSerialize(state)).toBe(before);
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
  });
});
