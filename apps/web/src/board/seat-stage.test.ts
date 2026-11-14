import {
  asPlayerId,
  asViewCardId,
  type MatchViewState,
} from '@ptcgsim/game-core';
import {
  createEmptyBoardView,
  createRendererSpikeView,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { seatStage } from './seat-stage.js';

const blue = asPlayerId('lobby-blue');
const red = asPlayerId('lobby-red');

const facedown = (index: number, ownerId: typeof blue) => ({
  kind: 'concealed' as const,
  id: asViewCardId(`seat-card-${index}`),
  ownerId,
  cardBackUrl: '/back.png',
  publiclyRevealed: false as const,
});

/** The empty table with `count` cards in a zone of Blue's. */
const withBlueCards = (
  kind: 'deck' | 'hand',
  count: number,
  base: MatchViewState = createEmptyBoardView()
): MatchViewState => {
  const id = `zone:${blue}:${kind}`;
  return {
    ...base,
    zones: {
      ...base.zones,
      [id]: {
        ...base.zones[id]!,
        cards: [
          ...base.zones[id]!.cards,
          ...Array.from({ length: count }, (_, index) =>
            facedown(index + (kind === 'hand' ? 100 : 0), blue)
          ),
        ],
      },
    },
  };
};

describe('seatStage', () => {
  it('is empty without a view or a seat to ask about', () => {
    expect(seatStage(undefined, blue)).toBe('empty');
    expect(seatStage(createEmptyBoardView(), undefined)).toBe('empty');
  });

  it('is empty for a seat with no cards anywhere', () => {
    const view = createEmptyBoardView();
    expect(seatStage(view, blue)).toBe('empty');
    expect(seatStage(view, red)).toBe('empty');
  });

  it('is loaded while every card a seat has is still in its deck', () => {
    const view = withBlueCards('deck', 60);
    expect(seatStage(view, blue)).toBe('loaded');
    // The other seat is unaffected.
    expect(seatStage(view, red)).toBe('empty');
  });

  it('is playing once any card has left the deck', () => {
    expect(
      seatStage(withBlueCards('hand', 7, withBlueCards('deck', 53)), blue)
    ).toBe('playing');
    // Even a deck that ran out: a hand without a deck is a game under way.
    expect(seatStage(withBlueCards('hand', 3), blue)).toBe('playing');
  });

  it('is playing with a Pokémon on the board, whatever the zones hold', () => {
    const base = createEmptyBoardView();
    const view: MatchViewState = {
      ...base,
      boards: {
        ...base.boards,
        [blue]: { activeStackId: 'stack:blue:active', benchStackIds: [] },
      },
    };
    expect(seatStage(view, blue)).toBe('playing');
    const benched: MatchViewState = {
      ...base,
      boards: {
        ...base.boards,
        [blue]: { activeStackId: null, benchStackIds: ['stack:blue:bench'] },
      },
    };
    expect(seatStage(benched, blue)).toBe('playing');
  });

  it('does not count the shared Stadium toward either seat', () => {
    const base = createEmptyBoardView();
    const view: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        'zone:shared:stadium': {
          ...base.zones['zone:shared:stadium']!,
          cards: [facedown(500, blue)],
        },
      },
    };
    expect(seatStage(view, blue)).toBe('empty');
  });

  it('reads a game in progress as playing for both seats', () => {
    const view = createRendererSpikeView();
    for (const playerId of view.playerOrder) {
      expect(seatStage(view, playerId)).toBe('playing');
    }
  });

  it('is playing with the whole deck out in a window, not empty', () => {
    const base = createEmptyBoardView();
    const view: MatchViewState = {
      ...base,
      workAreas: {
        ...base.workAreas,
        [blue]: {
          ...(base.workAreas[blue] ?? { attachmentResolution: null }),
          inspection: {
            id: 'whole-deck-look',
            sourceZoneId: `zone:${blue}:deck`,
            cards: Array.from({ length: 60 }, (_, index) =>
              facedown(index, blue)
            ),
          },
        },
      },
    };
    expect(seatStage(view, blue)).toBe('playing');
  });
});
