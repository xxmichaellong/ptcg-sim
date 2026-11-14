import { asViewCardId } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BOARD_PRESENTATION } from './defaults.js';
import {
  cardSelectionModeOf,
  NO_SELECTION,
  sameSelection,
  selectedCardIdOf,
} from './presentation-selection.js';

const a = asViewCardId('a');
const b = asViewCardId('b');

describe('the selection as surfaces for one card read it', () => {
  it('is the one item, and none for several', () => {
    expect(selectedCardIdOf(DEFAULT_BOARD_PRESENTATION)).toBeNull();
    expect(selectedCardIdOf({ selection: [a] })).toBe(a);
    expect(selectedCardIdOf({ selection: [a, b] })).toBeNull();
  });

  it('starts empty, with the one shared empty selection', () => {
    expect(DEFAULT_BOARD_PRESENTATION.selection).toBe(NO_SELECTION);
    expect(DEFAULT_BOARD_PRESENTATION.selectionMode).toBe(false);
    expect(Object.isFrozen(NO_SELECTION)).toBe(true);
  });

  it('reads the old toggle flag as a plain press', () => {
    expect(cardSelectionModeOf({ kind: 'CardSelected', cardId: a })).toBe(
      'replace'
    );
    expect(
      cardSelectionModeOf({ kind: 'CardSelected', cardId: a, toggle: true })
    ).toBe('toggle');
    expect(
      cardSelectionModeOf({
        kind: 'CardSelected',
        cardId: a,
        toggle: true,
        mode: 'add',
      })
    ).toBe('add');
  });

  it('compares selections by their items in order', () => {
    expect(sameSelection([a, b], [a, b])).toBe(true);
    expect(sameSelection([a, b], [b, a])).toBe(false);
    expect(sameSelection([a], [a, b])).toBe(false);
    expect(sameSelection(NO_SELECTION, [])).toBe(true);
  });
});
