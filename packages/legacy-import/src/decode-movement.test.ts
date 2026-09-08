import { MAX_DECK_CARDS } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { decodeLegacyV1MovementActions } from './decode-movement.js';
import { parseLegacyExportJson } from './parse-export.js';

const action = (user: 'self' | 'opp', name: string, parameters: unknown[]) => ({
  user,
  emit: true,
  action: name,
  parameters,
});

const payload = (...actions: unknown[]) => [
  { version: '1.5.1' },
  action('self', 'loadDeckData', ['']),
  action('opp', 'loadDeckData', ['']),
  ...actions,
];

const CARD_SOURCE_ZONES = [
  'deck',
  'deckCover',
  'hand',
  'prizes',
  'discard',
  'discardCover',
  'lostZone',
  'lostZoneCover',
  'board',
  'stadium',
  'active',
  'bench',
  'attachedCards',
  'viewCards',
] as const;

const SWITCH_SOURCE_ZONES = CARD_SOURCE_ZONES.filter(
  (zone) => zone !== 'deck' && zone !== 'deckCover'
);

const decode = (...actions: unknown[]) => {
  const parsed = parseLegacyExportJson(JSON.stringify(payload(...actions)));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('Expected envelope admission');
  return decodeLegacyV1MovementActions(parsed.value);
};

const firstIssue = (...actions: unknown[]) => {
  const result = decode(...actions);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected movement decode rejection');
  return result.issues[0]!;
};

describe('legacy v1 movement positional decoder', () => {
  it('decodes draw target, independent initiator, count, and source index', () => {
    expect(
      decode(
        action('self', 'draw', ['self', 2]),
        action('self', 'pass', ['ignored']),
        action('opp', 'draw', ['self', 1]),
        action('opp', 'draw', ['opp', MAX_DECK_CARDS])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'draw',
          recordIndex: 3,
          player: 'self',
          initiator: 'self',
          count: 2,
        },
        {
          type: 'draw',
          recordIndex: 5,
          player: 'opp',
          initiator: 'self',
          count: 1,
        },
        {
          type: 'draw',
          recordIndex: 6,
          player: 'opp',
          initiator: 'opp',
          count: MAX_DECK_CARDS,
        },
      ],
    });
  });

  it('decodes only source-authentic direct prize shuffles', () => {
    expect(
      decode(
        action('opp', 'shuffleZone', ['self', 'prizes', [2, 0, 1], true]),
        action('self', 'shuffleZone', ['opp', 'prizes', [], true])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'shuffleZone',
          recordIndex: 3,
          player: 'opp',
          initiator: 'self',
          zone: 'prizes',
          shuffleIndices: [2, 0, 1],
          message: true,
        },
        {
          type: 'shuffleZone',
          recordIndex: 4,
          player: 'self',
          initiator: 'opp',
          zone: 'prizes',
          shuffleIndices: [],
          message: true,
        },
      ],
    });
  });

  it('decodes move-to-top target, initiator, every source container, and index', () => {
    const result = decode(
      ...CARD_SOURCE_ZONES.map((zone, index) =>
        action(index % 2 === 0 ? 'self' : 'opp', 'moveToDeckTop', [
          index % 2 === 0 ? 'opp' : 'self',
          zone,
          zone === 'deckCover' ? 0 : index,
        ])
      )
    );
    expect(result).toEqual({
      ok: true,
      actions: CARD_SOURCE_ZONES.map((zone, index) => ({
        type: 'moveToDeckTop',
        recordIndex: index + 3,
        player: index % 2 === 0 ? 'self' : 'opp',
        initiator: index % 2 === 0 ? 'opp' : 'self',
        sourceZone: zone,
        sourceIndex: zone === 'deckCover' ? 0 : index,
      })),
    });
  });

  it('decodes shuffle-into-deck target, source coordinate, and recorded order', () => {
    expect(
      decode(
        action('opp', 'shuffleIntoDeck', ['self', 'deck', 2, [2, 0, 1]]),
        action('self', 'shuffleIntoDeck', ['opp', 'discardCover', 4, [0]])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'shuffleIntoDeck',
          recordIndex: 3,
          player: 'opp',
          initiator: 'self',
          sourceZone: 'deck',
          sourceIndex: 2,
          shuffleIndices: [2, 0, 1],
        },
        {
          type: 'shuffleIntoDeck',
          recordIndex: 4,
          player: 'self',
          initiator: 'opp',
          sourceZone: 'discardCover',
          sourceIndex: 4,
          shuffleIndices: [0],
        },
      ],
    });
  });

  it('decodes deck-top switches only from source-authentic non-deck containers', () => {
    const result = decode(
      ...SWITCH_SOURCE_ZONES.map((zone, index) =>
        action(index % 2 === 0 ? 'self' : 'opp', 'switchWithDeckTop', [
          index % 2 === 0 ? 'opp' : 'self',
          zone,
          index,
        ])
      )
    );
    expect(result).toEqual({
      ok: true,
      actions: SWITCH_SOURCE_ZONES.map((zone, index) => ({
        type: 'switchWithDeckTop',
        recordIndex: index + 3,
        player: index % 2 === 0 ? 'self' : 'opp',
        initiator: index % 2 === 0 ? 'opp' : 'self',
        sourceZone: zone,
        sourceIndex: index,
      })),
    });
  });

  it('decodes shuffled-prizes-to-deck-bottom target, initiator, and recorded order', () => {
    expect(
      decode(
        action('self', 'shufflePrizesToDeckBottom', [
          'opp',
          [5, 3, 1, 4, 2, 0],
        ]),
        action('opp', 'shufflePrizesToDeckBottom', ['self', [0]])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'shufflePrizesToDeckBottom',
          recordIndex: 3,
          player: 'self',
          initiator: 'opp',
          shuffleIndices: [5, 3, 1, 4, 2, 0],
        },
        {
          type: 'shufflePrizesToDeckBottom',
          recordIndex: 4,
          player: 'opp',
          initiator: 'self',
          shuffleIndices: [0],
        },
      ],
    });
  });

  it('ignores all other admitted families rather than inferring tuples', () => {
    expect(
      decode(
        action('self', 'moveCardBundle', ['unvalidated']),
        action('opp', 'pass', []),
        action('self', 'setup', [[]])
      )
    ).toEqual({ ok: true, actions: [] });
  });

  it('requires exactly the source-exported draw parameters', () => {
    expect(firstIssue(action('self', 'draw', ['self']))).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(action('self', 'draw', ['self', 1, 'extra']))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
  });

  it('requires exactly four direct shuffle parameters', () => {
    expect(
      firstIssue(action('self', 'shuffleZone', ['self', 'prizes', [0]]))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(
        action('self', 'shuffleZone', ['self', 'prizes', [0], true, 'extra'])
      )
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
  });

  it('requires exactly three move-to-top parameters', () => {
    expect(
      firstIssue(action('self', 'moveToDeckTop', ['self', 'hand']))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(action('self', 'moveToDeckTop', ['self', 'hand', 0, 'extra']))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
  });

  it('requires exactly four shuffle-into-deck parameters', () => {
    expect(
      firstIssue(action('self', 'shuffleIntoDeck', ['self', 'hand', 0]))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(
        action('self', 'shuffleIntoDeck', ['self', 'hand', 0, [0], 'extra'])
      )
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
  });

  it('requires exactly three switch-with-deck-top parameters', () => {
    expect(
      firstIssue(action('self', 'switchWithDeckTop', ['self', 'hand']))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(
        action('self', 'switchWithDeckTop', ['self', 'hand', 0, 'extra'])
      )
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
  });

  it('requires exactly two shuffled-prizes-to-deck-bottom parameters', () => {
    expect(
      firstIssue(action('self', 'shufflePrizesToDeckBottom', ['self']))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(
        action('self', 'shufflePrizesToDeckBottom', ['self', [0], 'extra'])
      )
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
  });

  it('requires a perspective initiator and the direct prizes/message shape', () => {
    expect(
      firstIssue(action('self', 'shuffleZone', [7, 'prizes', [], true]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[0]',
    });
    expect(
      firstIssue(action('self', 'shuffleZone', ['self', 'deck', [], true]))
    ).toMatchObject({
      code: 'invalid_shuffle_zone',
      path: '$[3].parameters[1]',
    });
    expect(
      firstIssue(action('self', 'shuffleZone', ['self', 'prizes', [], false]))
    ).toMatchObject({
      code: 'invalid_shuffle_message',
      path: '$[3].parameters[3]',
    });
    expect(
      firstIssue(action('self', 'shuffleZone', ['self', 'prizes', [], 'true']))
    ).toMatchObject({
      code: 'invalid_shuffle_message',
      path: '$[3].parameters[3]',
    });
  });

  it.each([null, [0, 0], [0, 2], [1], [-1], [0.5], ['0']])(
    'rejects an invalid prize shuffle permutation: %j',
    (indices) => {
      expect(
        firstIssue(
          action('self', 'shuffleZone', ['self', 'prizes', indices, true])
        )
      ).toMatchObject({
        code: 'invalid_shuffle_permutation',
        recordIndex: 3,
        path: '$[3].parameters[2]',
      });
    }
  );

  it('requires a perspective initiator for shuffled prizes to deck bottom', () => {
    expect(
      firstIssue(action('self', 'shufflePrizesToDeckBottom', [false, [0]]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      recordIndex: 3,
      path: '$[3].parameters[0]',
    });
  });

  it.each([null, [], [0, 0], [0, 2], [1], [-1], [0.5], ['0']])(
    'rejects an invalid shuffled-prizes-to-deck-bottom permutation: %j',
    (indices) => {
      expect(
        firstIssue(
          action('self', 'shufflePrizesToDeckBottom', ['self', indices])
        )
      ).toMatchObject({
        code: 'invalid_shuffle_permutation',
        recordIndex: 3,
        path: '$[3].parameters[1]',
      });
    }
  );

  it('bounds a syntactically complete prize shuffle permutation', () => {
    const oversized = Array.from(
      { length: MAX_DECK_CARDS + 1 },
      (_, index) => index
    );
    expect(
      firstIssue(
        action('self', 'shuffleZone', ['self', 'prizes', oversized, true])
      )
    ).toMatchObject({
      code: 'invalid_shuffle_permutation',
      recordIndex: 3,
      path: '$[3].parameters[2]',
    });
  });

  it('requires a perspective initiator and a source card container', () => {
    expect(
      firstIssue(action('self', 'moveToDeckTop', [false, 'hand', 0]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[0]',
    });
    expect(
      firstIssue(action('self', 'moveToDeckTop', ['self', null, 0]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[1]',
    });
    expect(
      firstIssue(action('self', 'moveToDeckTop', ['self', 'deckcover', 0]))
    ).toMatchObject({
      code: 'invalid_source_zone',
      path: '$[3].parameters[1]',
    });
    expect(
      firstIssue(action('self', 'moveToDeckTop', ['self', 'not-a-zone', 0]))
    ).toMatchObject({
      code: 'invalid_source_zone',
      path: '$[3].parameters[1]',
    });
  });

  it.each([null, true, '0', [], {}])(
    'rejects non-number move-to-top index %j',
    (index) => {
      expect(
        firstIssue(action('self', 'moveToDeckTop', ['self', 'hand', index]))
      ).toMatchObject({
        code: 'invalid_parameter_type',
        recordIndex: 3,
        path: '$[3].parameters[2]',
      });
    }
  );

  it.each([-1, 0.5, MAX_DECK_CARDS, 9_007_199_254_740_992])(
    'rejects unsafe or out-of-range move-to-top index %j',
    (index) => {
      expect(
        firstIssue(action('self', 'moveToDeckTop', ['self', 'hand', index]))
      ).toMatchObject({
        code: 'invalid_card_index',
        recordIndex: 3,
        path: '$[3].parameters[2]',
      });
    }
  );

  it('requires the deck cover to select the source top', () => {
    expect(
      firstIssue(action('self', 'moveToDeckTop', ['self', 'deckCover', 1]))
    ).toEqual({
      code: 'invalid_card_index',
      recordIndex: 3,
      path: '$[3].parameters[2]',
      message: `moveToDeckTop source index must be an integer from 0 to ${MAX_DECK_CARDS - 1}, and deckCover always selects index 0`,
    });
  });

  it('applies shared source validation to shuffle-into-deck tuples', () => {
    expect(
      firstIssue(action('self', 'shuffleIntoDeck', [false, 'hand', 0, [0]]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[0]',
    });
    expect(
      firstIssue(
        action('self', 'shuffleIntoDeck', ['self', 'not-a-zone', 0, [0]])
      )
    ).toMatchObject({
      code: 'invalid_source_zone',
      path: '$[3].parameters[1]',
    });
    expect(
      firstIssue(
        action('self', 'shuffleIntoDeck', ['self', 'deckCover', 1, [0]])
      )
    ).toMatchObject({
      code: 'invalid_card_index',
      path: '$[3].parameters[2]',
    });
  });

  it('applies shared source validation and excludes deck sources for switches', () => {
    expect(
      firstIssue(action('self', 'switchWithDeckTop', [false, 'hand', 0]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[0]',
    });
    expect(
      firstIssue(action('self', 'switchWithDeckTop', ['self', 'not-a-zone', 0]))
    ).toMatchObject({
      code: 'invalid_source_zone',
      path: '$[3].parameters[1]',
    });
    expect(
      firstIssue(action('self', 'switchWithDeckTop', ['self', 'hand', '0']))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[2]',
    });
    expect(
      firstIssue(action('self', 'switchWithDeckTop', ['self', 'hand', -1]))
    ).toMatchObject({
      code: 'invalid_card_index',
      path: '$[3].parameters[2]',
    });
    for (const zone of ['deck', 'deckCover']) {
      expect(
        firstIssue(action('self', 'switchWithDeckTop', ['self', zone, 0]))
      ).toEqual({
        code: 'invalid_source_zone',
        recordIndex: 3,
        path: '$[3].parameters[1]',
        message:
          'switchWithDeckTop is exported only for a source outside the deck',
      });
    }
  });

  it.each([null, [0, 0], [0, 2], [1], [-1], [0.5], ['0']])(
    'rejects an invalid shuffle-into-deck permutation: %j',
    (indices) => {
      expect(
        firstIssue(
          action('self', 'shuffleIntoDeck', ['self', 'hand', 0, indices])
        )
      ).toMatchObject({
        code: 'invalid_shuffle_permutation',
        recordIndex: 3,
        path: '$[3].parameters[3]',
      });
    }
  );

  it.each([null, true, 0, 'player'])('rejects initiator %j', (initiator) => {
    expect(firstIssue(action('self', 'draw', [initiator, 1]))).toMatchObject({
      code: 'invalid_parameter_type',
      recordIndex: 3,
      path: '$[3].parameters[0]',
    });
  });

  it.each([null, true, '1', [], {}])(
    'rejects non-number draw count %j',
    (count) => {
      expect(firstIssue(action('self', 'draw', ['self', count]))).toMatchObject(
        {
          code: 'invalid_parameter_type',
          recordIndex: 3,
          path: '$[3].parameters[1]',
        }
      );
    }
  );

  it.each([0, -1, 0.5, 1.5, MAX_DECK_CARDS + 1, 9_007_199_254_740_992])(
    'rejects unsafe or out-of-range draw count %j',
    (count) => {
      expect(firstIssue(action('self', 'draw', ['self', count]))).toEqual({
        code: 'invalid_draw_count',
        recordIndex: 3,
        path: '$[3].parameters[1]',
        message: `draw count must be an integer from 1 to ${MAX_DECK_CARDS}`,
      });
    }
  );
});
