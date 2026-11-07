import { describe, expect, it } from 'vitest';
import type { ViewCardId } from '@ptcgsim/game-core';

import {
  createInitialBoardSessionControllerState,
  type BoardSessionControllerState,
} from './BoardSessionController.js';
import { onlyHeldCardMovedOn } from './held-card-moves.js';

const holding = (
  state: BoardSessionControllerState,
  x: number,
  targetId: string | null = 'zone:bench'
): BoardSessionControllerState => ({
  ...state,
  generation: state.generation + 1,
  presentation: {
    ...state.presentation,
    drag: { cardId: 'card-1' as ViewCardId, x, y: 40, targetId },
  },
});

describe('onlyHeldCardMovedOn', () => {
  const resting = createInitialBoardSessionControllerState();
  const held = holding(resting, 10);

  it('is the held card carried on, and nothing else', () => {
    expect(onlyHeldCardMovedOn(held, holding(held, 30))).toBe(true);
  });

  it('is not a pick-up, a new target, or a change elsewhere on the board', () => {
    expect(onlyHeldCardMovedOn(resting, held)).toBe(false);
    expect(onlyHeldCardMovedOn(held, holding(held, 30, null))).toBe(false);
    expect(
      onlyHeldCardMovedOn(held, {
        ...holding(held, 30),
        canSubmitCommands: !held.canSubmitCommands,
      })
    ).toBe(false);
  });
});
