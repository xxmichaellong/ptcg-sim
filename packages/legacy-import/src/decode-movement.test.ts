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

const LOOSE_DESTINATION_ZONES = [
  'deck',
  'hand',
  'prizes',
  'discard',
  'discardCover',
  'lostZone',
  'lostZoneCover',
  'board',
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

  it('decodes discard-and-draw target, independent initiator, and clamped count', () => {
    expect(
      decode(
        action('self', 'discardAndDraw', ['opp', 0]),
        action('opp', 'discardAndDraw', ['self', MAX_DECK_CARDS])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'discardAndDraw',
          recordIndex: 3,
          player: 'self',
          initiator: 'opp',
          count: 0,
        },
        {
          type: 'discardAndDraw',
          recordIndex: 4,
          player: 'opp',
          initiator: 'self',
          count: MAX_DECK_CARDS,
        },
      ],
    });
  });

  it('decodes shuffle-and-draw target, independent initiator, count, and order', () => {
    const maximumOrder = Array.from(
      { length: MAX_DECK_CARDS },
      (_, index) => MAX_DECK_CARDS - index - 1
    );
    expect(
      decode(
        action('self', 'shuffleAndDraw', ['opp', 0, []]),
        action('opp', 'shuffleAndDraw', ['self', MAX_DECK_CARDS, maximumOrder])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'shuffleAndDraw',
          recordIndex: 3,
          player: 'self',
          initiator: 'opp',
          count: 0,
          shuffleIndices: [],
        },
        {
          type: 'shuffleAndDraw',
          recordIndex: 4,
          player: 'opp',
          initiator: 'self',
          count: MAX_DECK_CARDS,
          shuffleIndices: maximumOrder,
        },
      ],
    });
  });

  it('decodes shuffle-bottom-and-draw with a hand-only order and independent combined count', () => {
    const maximumOrder = Array.from(
      { length: MAX_DECK_CARDS },
      (_, index) => MAX_DECK_CARDS - index - 1
    );
    expect(
      decode(
        action('self', 'shuffleBottomAndDraw', ['opp', 0, []]),
        action('opp', 'shuffleBottomAndDraw', [
          'self',
          MAX_DECK_CARDS,
          maximumOrder,
        ]),
        action('self', 'shuffleBottomAndDraw', ['self', 2, [0]])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'shuffleBottomAndDraw',
          recordIndex: 3,
          player: 'self',
          initiator: 'opp',
          count: 0,
          shuffleIndices: [],
        },
        {
          type: 'shuffleBottomAndDraw',
          recordIndex: 4,
          player: 'opp',
          initiator: 'self',
          count: MAX_DECK_CARDS,
          shuffleIndices: maximumOrder,
        },
        {
          type: 'shuffleBottomAndDraw',
          recordIndex: 5,
          player: 'self',
          initiator: 'self',
          count: 2,
          shuffleIndices: [0],
        },
      ],
    });
  });

  it('decodes exact top, bottom, cross-owner, and zero-card deck inspections', () => {
    expect(
      decode(
        action('self', 'viewDeck', ['self', 2, true, 4, false]),
        action('opp', 'viewDeck', ['self', 3, false, 5, true]),
        action('opp', 'viewDeck', ['opp', 0, true, 0, false])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'viewDeck',
          recordIndex: 3,
          player: 'self',
          initiator: 'self',
          count: 2,
          edge: 'top',
          expectedDeckCount: 4,
          targetIsOpponent: false,
        },
        {
          type: 'viewDeck',
          recordIndex: 4,
          player: 'opp',
          initiator: 'self',
          count: 3,
          edge: 'bottom',
          expectedDeckCount: 5,
          targetIsOpponent: true,
        },
        {
          type: 'viewDeck',
          recordIndex: 5,
          player: 'opp',
          initiator: 'opp',
          count: 0,
          edge: 'top',
          expectedDeckCount: 0,
          targetIsOpponent: false,
        },
      ],
    });
  });

  it('rejects malformed or source-inconsistent deck inspections', () => {
    expect(
      firstIssue(action('self', 'viewDeck', ['self', 1, true, 1]))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      path: '$[3].parameters',
    });
    expect(
      firstIssue(action('self', 'viewDeck', [false, 1, true, 1, false]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[0]',
    });
    expect(
      firstIssue(action('self', 'viewDeck', ['self', '1', true, 1, false]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[1]',
    });
    for (const count of [-1, 0.5, MAX_DECK_CARDS + 1]) {
      expect(
        firstIssue(
          action('self', 'viewDeck', [
            'self',
            count,
            true,
            MAX_DECK_CARDS,
            false,
          ])
        )
      ).toMatchObject({
        code: 'invalid_view_count',
        path: '$[3].parameters[1]',
      });
    }
    expect(
      firstIssue(action('self', 'viewDeck', ['self', 1, 1, 1, false]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[2]',
    });
    expect(
      firstIssue(action('self', 'viewDeck', ['self', 1, true, '1', false]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[3]',
    });
    for (const deckCount of [-1, 0.5, MAX_DECK_CARDS + 1]) {
      expect(
        firstIssue(
          action('self', 'viewDeck', ['self', 0, true, deckCount, false])
        )
      ).toMatchObject({
        code: 'invalid_recorded_deck_count',
        path: '$[3].parameters[3]',
      });
    }
    expect(
      firstIssue(action('self', 'viewDeck', ['self', 2, true, 1, false]))
    ).toMatchObject({
      code: 'invalid_view_count',
      path: '$[3].parameters[1]',
    });
    expect(
      firstIssue(action('self', 'viewDeck', ['self', 1, true, 1, 'false']))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[4]',
    });
    expect(
      firstIssue(action('opp', 'viewDeck', ['self', 1, true, 1, false]))
    ).toMatchObject({
      code: 'invalid_view_target',
      recordIndex: 3,
      path: '$[3].parameters[4]',
    });
  });

  it('decodes the source-authentic bottom-mode bundle from every card container', () => {
    const result = decode(
      ...CARD_SOURCE_ZONES.map((zone, index) =>
        action(index % 2 === 0 ? 'self' : 'opp', 'moveCardBundle', [
          index % 2 === 0 ? 'opp' : 'self',
          zone,
          'deck',
          zone === 'deckCover' ? 0 : index,
          false,
          'bottom',
        ])
      )
    );
    expect(result).toEqual({
      ok: true,
      actions: CARD_SOURCE_ZONES.map((zone, index) => ({
        type: 'moveCardBundle',
        recordIndex: index + 3,
        player: index % 2 === 0 ? 'self' : 'opp',
        initiator: index % 2 === 0 ? 'opp' : 'self',
        sourceZone: zone,
        sourceIndex: zone === 'deckCover' ? 0 : index,
        destinationZone: 'deck',
        targetIndex: false,
        mode: 'bottom',
      })),
    });
  });

  it('decodes target-free loose-zone bundles, including serialized drag nulls and cover aliases', () => {
    const result = decode(
      ...LOOSE_DESTINATION_ZONES.map((destinationZone, index) =>
        action(index % 2 === 0 ? 'self' : 'opp', 'moveCardBundle', [
          index % 2 === 0 ? 'opp' : 'self',
          CARD_SOURCE_ZONES[index]!,
          destinationZone,
          CARD_SOURCE_ZONES[index] === 'deckCover' ? 0 : index,
          index % 2 === 0 ? false : null,
          'move',
        ])
      )
    );
    expect(result).toEqual({
      ok: true,
      actions: LOOSE_DESTINATION_ZONES.map((destinationZone, index) => ({
        type: 'moveCardBundle',
        recordIndex: index + 3,
        player: index % 2 === 0 ? 'self' : 'opp',
        initiator: index % 2 === 0 ? 'opp' : 'self',
        sourceZone: CARD_SOURCE_ZONES[index]!,
        sourceIndex: CARD_SOURCE_ZONES[index] === 'deckCover' ? 0 : index,
        destinationZone,
        targetIndex: index % 2 === 0 ? false : null,
        mode: 'move',
      })),
    });
  });

  it('decodes target-free stadium bundles from keyboard and serialized drag records', () => {
    expect(
      decode(
        action('self', 'moveCardBundle', [
          'opp',
          'hand',
          'stadium',
          3,
          false,
          'move',
        ]),
        action('opp', 'moveCardBundle', [
          'self',
          'deckCover',
          'stadium',
          0,
          null,
          'move',
        ])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'moveCardBundle',
          recordIndex: 3,
          player: 'self',
          initiator: 'opp',
          sourceZone: 'hand',
          sourceIndex: 3,
          destinationZone: 'stadium',
          targetIndex: false,
          mode: 'move',
        },
        {
          type: 'moveCardBundle',
          recordIndex: 4,
          player: 'opp',
          initiator: 'self',
          sourceZone: 'deckCover',
          sourceIndex: 0,
          destinationZone: 'stadium',
          targetIndex: null,
          mode: 'move',
        },
      ],
    });
  });

  it('decodes target-free active and bench bundles as new play stacks', () => {
    expect(
      decode(
        action('self', 'moveCardBundle', [
          'opp',
          'hand',
          'active',
          3,
          false,
          'move',
        ]),
        action('opp', 'moveCardBundle', [
          'self',
          'deckCover',
          'bench',
          0,
          null,
          'move',
        ])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'moveCardBundle',
          recordIndex: 3,
          player: 'self',
          initiator: 'opp',
          sourceZone: 'hand',
          sourceIndex: 3,
          destinationZone: 'active',
          targetIndex: false,
          mode: 'move',
        },
        {
          type: 'moveCardBundle',
          recordIndex: 4,
          player: 'opp',
          initiator: 'self',
          sourceZone: 'deckCover',
          sourceIndex: 0,
          destinationZone: 'bench',
          targetIndex: null,
          mode: 'move',
        },
      ],
    });
  });

  it('decodes bounded numeric active and bench targets from every card container', () => {
    expect(
      decode(
        action('self', 'moveCardBundle', [
          'opp',
          'hand',
          'active',
          3,
          0,
          'move',
        ]),
        action('opp', 'moveCardBundle', [
          'self',
          'attachedCards',
          'bench',
          7,
          MAX_DECK_CARDS - 1,
          'move',
        ])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'moveCardBundle',
          recordIndex: 3,
          player: 'self',
          initiator: 'opp',
          sourceZone: 'hand',
          sourceIndex: 3,
          destinationZone: 'active',
          targetIndex: 0,
          mode: 'move',
        },
        {
          type: 'moveCardBundle',
          recordIndex: 4,
          player: 'opp',
          initiator: 'self',
          sourceZone: 'attachedCards',
          sourceIndex: 7,
          destinationZone: 'bench',
          targetIndex: MAX_DECK_CARDS - 1,
          mode: 'move',
        },
      ],
    });
  });

  it('decodes target-free active and bench source coordinates for whole-stack movement', () => {
    const inputs = [
      ['active', 'bench', 0, false],
      ['bench', 'active', 1, null],
      ['bench', 'bench', 2, false],
      ['active', 'active', 0, null],
    ] as const;
    expect(
      decode(
        ...inputs.map(
          ([sourceZone, destinationZone, sourceIndex, targetIndex]) =>
            action('self', 'moveCardBundle', [
              'opp',
              sourceZone,
              destinationZone,
              sourceIndex,
              targetIndex,
              'move',
            ])
        )
      )
    ).toEqual({
      ok: true,
      actions: inputs.map(
        ([sourceZone, destinationZone, sourceIndex, targetIndex], index) => ({
          type: 'moveCardBundle',
          recordIndex: index + 3,
          player: 'self',
          initiator: 'opp',
          sourceZone,
          sourceIndex,
          destinationZone,
          targetIndex,
          mode: 'move',
        })
      ),
    });
  });

  it('decodes exact staged-stack leave-all destinations for both perspectives', () => {
    expect(
      decode(
        action('self', 'leaveAll', ['opp', 'attachedCards', 'active']),
        action('opp', 'leaveAll', ['self', 'attachedCards', 'bench'])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'leaveAll',
          recordIndex: 3,
          player: 'self',
          initiator: 'opp',
          sourceZone: 'attachedCards',
          destinationSlot: 'active',
        },
        {
          type: 'leaveAll',
          recordIndex: 4,
          player: 'opp',
          initiator: 'self',
          sourceZone: 'attachedCards',
          destinationSlot: 'bench',
        },
      ],
    });
  });

  it('rejects malformed or broadened leave-all tuples', () => {
    expect(
      firstIssue(action('self', 'leaveAll', ['self', 'attachedCards']))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(action('self', 'leaveAll', [false, 'attachedCards', 'active']))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      recordIndex: 3,
      path: '$[3].parameters[0]',
    });
    expect(
      firstIssue(action('self', 'leaveAll', ['self', 'bench', 'active']))
    ).toMatchObject({
      code: 'invalid_source_zone',
      recordIndex: 3,
      path: '$[3].parameters[1]',
    });
    expect(
      firstIssue(
        action('self', 'leaveAll', ['self', 'attachedCards', 'discard'])
      )
    ).toMatchObject({
      code: 'invalid_destination_zone',
      recordIndex: 3,
      path: '$[3].parameters[2]',
    });
  });

  it('decodes exact staged discard, lost-zone, and hand bulk tuples', () => {
    expect(
      decode(
        action('self', 'discardAll', ['opp', 'attachedCards']),
        action('opp', 'lostZoneAll', ['self', 'attachedCards']),
        action('self', 'handAll', ['self', 'attachedCards'])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'discardAll',
          recordIndex: 3,
          player: 'self',
          initiator: 'opp',
          sourceZone: 'attachedCards',
        },
        {
          type: 'lostZoneAll',
          recordIndex: 4,
          player: 'opp',
          initiator: 'self',
          sourceZone: 'attachedCards',
        },
        {
          type: 'handAll',
          recordIndex: 5,
          player: 'self',
          initiator: 'self',
          sourceZone: 'attachedCards',
        },
      ],
    });
  });

  it.each(['discardAll', 'lostZoneAll', 'handAll'])(
    'rejects malformed or non-staged %s tuples',
    (actionName) => {
      expect(firstIssue(action('self', actionName, ['self']))).toMatchObject({
        code: 'invalid_parameter_count',
        recordIndex: 3,
        path: '$[3].parameters',
      });
      expect(
        firstIssue(action('self', actionName, [false, 'attachedCards']))
      ).toMatchObject({
        code: 'invalid_parameter_type',
        recordIndex: 3,
        path: '$[3].parameters[0]',
      });
      expect(
        firstIssue(action('self', actionName, ['self', 'viewCards']))
      ).toMatchObject({
        code: 'invalid_source_zone',
        recordIndex: 3,
        path: '$[3].parameters[1]',
      });
    }
  );

  it('decodes exact staged full-deck and deck-bottom shuffle tuples', () => {
    expect(
      decode(
        action('self', 'shuffleAll', ['opp', 'attachedCards', [3, 0, 2, 1]]),
        action('opp', 'shuffleBottom', ['self', 'attachedCards', [1, 0]])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'shuffleAll',
          recordIndex: 3,
          player: 'self',
          initiator: 'opp',
          sourceZone: 'attachedCards',
          shuffleIndices: [3, 0, 2, 1],
        },
        {
          type: 'shuffleBottom',
          recordIndex: 4,
          player: 'opp',
          initiator: 'self',
          sourceZone: 'attachedCards',
          shuffleIndices: [1, 0],
        },
      ],
    });
  });

  it.each(['shuffleAll', 'shuffleBottom'])(
    'rejects malformed, non-staged, or invalid-permutation %s tuples',
    (actionName) => {
      expect(
        firstIssue(action('self', actionName, ['self', 'attachedCards']))
      ).toMatchObject({
        code: 'invalid_parameter_count',
        recordIndex: 3,
        path: '$[3].parameters',
      });
      expect(
        firstIssue(action('self', actionName, [false, 'attachedCards', [0]]))
      ).toMatchObject({
        code: 'invalid_parameter_type',
        recordIndex: 3,
        path: '$[3].parameters[0]',
      });
      expect(
        firstIssue(action('self', actionName, ['self', 'viewCards', [0]]))
      ).toMatchObject({
        code: 'invalid_source_zone',
        recordIndex: 3,
        path: '$[3].parameters[1]',
      });
      expect(
        firstIssue(
          action('self', actionName, ['self', 'attachedCards', [0, 0]])
        )
      ).toMatchObject({
        code: 'invalid_shuffle_permutation',
        recordIndex: 3,
        path: '$[3].parameters[2]',
      });
    }
  );

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
        action('self', 'changeCardBack', ['/cardback.png']),
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

  it('requires exactly the source-exported discard-and-draw parameters', () => {
    expect(
      firstIssue(action('self', 'discardAndDraw', ['self']))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(action('self', 'discardAndDraw', ['self', 0, 'extra']))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
  });

  it('requires exactly the source-exported shuffle-and-draw parameters', () => {
    expect(
      firstIssue(action('self', 'shuffleAndDraw', ['self', 0]))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(action('self', 'shuffleAndDraw', ['self', 0, [], 'extra']))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
  });

  it('requires exactly the source-exported shuffle-bottom-and-draw parameters', () => {
    expect(
      firstIssue(action('self', 'shuffleBottomAndDraw', ['self', 0]))
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(
        action('self', 'shuffleBottomAndDraw', ['self', 0, [], 'extra'])
      )
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
  });

  it('requires exactly the six source-exported move-card-bundle parameters', () => {
    expect(
      firstIssue(
        action('self', 'moveCardBundle', ['self', 'hand', 'deck', 0, false])
      )
    ).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(
        action('self', 'moveCardBundle', [
          'self',
          'hand',
          'deck',
          0,
          false,
          'bottom',
          'extra',
        ])
      )
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

  it('requires a perspective initiator for discard-and-draw', () => {
    expect(
      firstIssue(action('self', 'discardAndDraw', [false, 0]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      recordIndex: 3,
      path: '$[3].parameters[0]',
    });
  });

  it.each([null, true, '0', [], {}])(
    'rejects non-number discard-and-draw count %j',
    (count) => {
      expect(
        firstIssue(action('self', 'discardAndDraw', ['self', count]))
      ).toMatchObject({
        code: 'invalid_parameter_type',
        recordIndex: 3,
        path: '$[3].parameters[1]',
      });
    }
  );

  it.each([-1, 0.5, 1.5, MAX_DECK_CARDS + 1, 9_007_199_254_740_992])(
    'rejects unsafe or out-of-range discard-and-draw count %j',
    (count) => {
      expect(
        firstIssue(action('self', 'discardAndDraw', ['self', count]))
      ).toEqual({
        code: 'invalid_discard_draw_count',
        recordIndex: 3,
        path: '$[3].parameters[1]',
        message: `discardAndDraw count must be an integer from 0 to ${MAX_DECK_CARDS}`,
      });
    }
  );

  it('requires a perspective initiator for shuffle-and-draw', () => {
    expect(
      firstIssue(action('self', 'shuffleAndDraw', [false, 0, []]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      recordIndex: 3,
      path: '$[3].parameters[0]',
    });
  });

  it.each([null, true, '0', [], {}])(
    'rejects non-number shuffle-and-draw count %j',
    (count) => {
      expect(
        firstIssue(action('self', 'shuffleAndDraw', ['self', count, []]))
      ).toMatchObject({
        code: 'invalid_parameter_type',
        recordIndex: 3,
        path: '$[3].parameters[1]',
      });
    }
  );

  it.each([-1, 0.5, 1.5, MAX_DECK_CARDS + 1, 9_007_199_254_740_992])(
    'rejects unsafe or out-of-range shuffle-and-draw count %j',
    (count) => {
      expect(
        firstIssue(action('self', 'shuffleAndDraw', ['self', count, []]))
      ).toEqual({
        code: 'invalid_shuffle_draw_count',
        recordIndex: 3,
        path: '$[3].parameters[1]',
        message: `shuffleAndDraw count must be an integer from 0 to ${MAX_DECK_CARDS}`,
      });
    }
  );

  it.each([null, [0, 0], [0, 2], [1], [-1], [0.5], ['0']])(
    'rejects an invalid shuffle-and-draw permutation: %j',
    (indices) => {
      expect(
        firstIssue(action('self', 'shuffleAndDraw', ['self', 0, indices]))
      ).toMatchObject({
        code: 'invalid_shuffle_permutation',
        recordIndex: 3,
        path: '$[3].parameters[2]',
      });
    }
  );

  it('rejects a shuffle-and-draw count above its recorded permutation length', () => {
    expect(
      firstIssue(action('self', 'shuffleAndDraw', ['self', 2, [0]]))
    ).toEqual({
      code: 'invalid_shuffle_draw_count',
      recordIndex: 3,
      path: '$[3].parameters[1]',
      message:
        'shuffleAndDraw count cannot exceed its recorded shuffle permutation length',
    });
  });

  it('bounds a syntactically complete shuffle-and-draw permutation', () => {
    const oversized = Array.from(
      { length: MAX_DECK_CARDS + 1 },
      (_, index) => index
    );
    expect(
      firstIssue(action('self', 'shuffleAndDraw', ['self', 0, oversized]))
    ).toMatchObject({
      code: 'invalid_shuffle_permutation',
      recordIndex: 3,
      path: '$[3].parameters[2]',
    });
  });

  it('requires a perspective initiator for shuffle-bottom-and-draw', () => {
    expect(
      firstIssue(action('self', 'shuffleBottomAndDraw', [false, 0, []]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      recordIndex: 3,
      path: '$[3].parameters[0]',
    });
  });

  it.each([null, true, '0', [], {}])(
    'rejects non-number shuffle-bottom-and-draw count %j',
    (count) => {
      expect(
        firstIssue(action('self', 'shuffleBottomAndDraw', ['self', count, []]))
      ).toMatchObject({
        code: 'invalid_parameter_type',
        recordIndex: 3,
        path: '$[3].parameters[1]',
      });
    }
  );

  it.each([-1, 0.5, 1.5, MAX_DECK_CARDS + 1, 9_007_199_254_740_992])(
    'rejects unsafe or out-of-range shuffle-bottom-and-draw count %j',
    (count) => {
      expect(
        firstIssue(action('self', 'shuffleBottomAndDraw', ['self', count, []]))
      ).toEqual({
        code: 'invalid_shuffle_bottom_draw_count',
        recordIndex: 3,
        path: '$[3].parameters[1]',
        message: `shuffleBottomAndDraw count must be an integer from 0 to ${MAX_DECK_CARDS}`,
      });
    }
  );

  it.each([null, [0, 0], [0, 2], [1], [-1], [0.5], ['0']])(
    'rejects an invalid shuffle-bottom-and-draw hand permutation: %j',
    (indices) => {
      expect(
        firstIssue(action('self', 'shuffleBottomAndDraw', ['self', 0, indices]))
      ).toMatchObject({
        code: 'invalid_shuffle_permutation',
        recordIndex: 3,
        path: '$[3].parameters[2]',
      });
    }
  );

  it('bounds a syntactically complete shuffle-bottom-and-draw hand permutation', () => {
    const oversized = Array.from(
      { length: MAX_DECK_CARDS + 1 },
      (_, index) => index
    );
    expect(
      firstIssue(action('self', 'shuffleBottomAndDraw', ['self', 0, oversized]))
    ).toMatchObject({
      code: 'invalid_shuffle_permutation',
      recordIndex: 3,
      path: '$[3].parameters[2]',
    });
  });

  it('requires a typed bottom mode for the incremental move-card-bundle subset', () => {
    expect(
      firstIssue(
        action('self', 'moveCardBundle', [
          'self',
          'hand',
          'deck',
          0,
          false,
          null,
        ])
      )
    ).toMatchObject({
      code: 'invalid_parameter_type',
      recordIndex: 3,
      path: '$[3].parameters[5]',
    });
  });

  it.each(['shuffle', 'top', 'switch', 'attach', 'evolve'])(
    'keeps move-card-bundle mode %s fail-closed',
    (mode) => {
      expect(
        firstIssue(
          action('self', 'moveCardBundle', [
            'self',
            'hand',
            'deck',
            0,
            false,
            mode,
          ])
        )
      ).toEqual({
        code: 'unsupported_move_card_bundle',
        recordIndex: 3,
        path: '$[3].parameters[5]',
        message:
          'Only source-authentic deck-bottom, loose-zone, stadium, new-play-stack, and targeted play-stack bundles are converted',
      });
    }
  );

  it.each(['deckCover', 'attachedCards', 'viewCards', 'not-a-zone'])(
    'rejects special move-bundle destination %s',
    (destinationZone) => {
      expect(
        firstIssue(
          action('self', 'moveCardBundle', [
            'opp',
            'hand',
            destinationZone,
            0,
            false,
            'move',
          ])
        )
      ).toEqual({
        code: 'invalid_destination_zone',
        recordIndex: 3,
        path: '$[3].parameters[2]',
        message: 'A target-free moveCardBundle must target a supported zone',
      });
    }
  );

  it.each([true, 'false', [], {}])(
    'rejects malformed loose-zone target value %j',
    (targetIndex) => {
      expect(
        firstIssue(
          action('self', 'moveCardBundle', [
            'opp',
            'hand',
            'discard',
            0,
            targetIndex,
            'move',
          ])
        )
      ).toEqual({
        code: 'invalid_target_index',
        recordIndex: 3,
        path: '$[3].parameters[4]',
        message:
          'A moveCardBundle target must be false, null, or a numeric active/bench card index',
      });
    }
  );

  it.each(['discard', 'stadium'])(
    'rejects a numeric target whose destination is %s',
    (destinationZone) => {
      expect(
        firstIssue(
          action('self', 'moveCardBundle', [
            'opp',
            'hand',
            destinationZone,
            0,
            0,
            'move',
          ])
        )
      ).toEqual({
        code: 'invalid_destination_zone',
        recordIndex: 3,
        path: '$[3].parameters[2]',
        message: 'A targeted moveCardBundle must target active or bench',
      });
    }
  );

  it.each([-1, 0.5, MAX_DECK_CARDS, Number.MAX_SAFE_INTEGER])(
    'rejects an out-of-bounds numeric play target %j',
    (targetIndex) => {
      expect(
        firstIssue(
          action('self', 'moveCardBundle', [
            'opp',
            'hand',
            'active',
            0,
            targetIndex,
            'move',
          ])
        )
      ).toEqual({
        code: 'invalid_target_index',
        recordIndex: 3,
        path: '$[3].parameters[4]',
        message: `A targeted moveCardBundle index must be an integer from 0 to ${MAX_DECK_CARDS - 1}`,
      });
    }
  );

  it('requires a perspective initiator and card-container source for a bottom bundle', () => {
    expect(
      firstIssue(
        action('self', 'moveCardBundle', [
          false,
          'hand',
          'deck',
          0,
          false,
          'bottom',
        ])
      )
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[0]',
    });
    expect(
      firstIssue(
        action('self', 'moveCardBundle', [
          'self',
          null,
          'deck',
          0,
          false,
          'bottom',
        ])
      )
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[1]',
    });
    expect(
      firstIssue(
        action('self', 'moveCardBundle', [
          'self',
          'not-a-zone',
          'deck',
          0,
          false,
          'bottom',
        ])
      )
    ).toMatchObject({
      code: 'invalid_source_zone',
      path: '$[3].parameters[1]',
    });
  });

  it.each([null, true, '0', [], {}, -1, 0.5, MAX_DECK_CARDS])(
    'rejects invalid bottom-bundle source index %j',
    (index) => {
      expect(
        firstIssue(
          action('self', 'moveCardBundle', [
            'self',
            'hand',
            'deck',
            index,
            false,
            'bottom',
          ])
        )
      ).toMatchObject({
        code:
          typeof index === 'number'
            ? 'invalid_card_index'
            : 'invalid_parameter_type',
        recordIndex: 3,
        path: '$[3].parameters[3]',
      });
    }
  );

  it('enforces the deck-cover index-zero alias for a bottom bundle', () => {
    expect(
      firstIssue(
        action('self', 'moveCardBundle', [
          'self',
          'deckCover',
          'deck',
          1,
          false,
          'bottom',
        ])
      )
    ).toMatchObject({
      code: 'invalid_card_index',
      recordIndex: 3,
      path: '$[3].parameters[3]',
    });
  });

  it('requires an exact deck destination for a bottom bundle', () => {
    expect(
      firstIssue(
        action('self', 'moveCardBundle', [
          'self',
          'hand',
          null,
          0,
          false,
          'bottom',
        ])
      )
    ).toMatchObject({
      code: 'invalid_parameter_type',
      recordIndex: 3,
      path: '$[3].parameters[2]',
    });
    expect(
      firstIssue(
        action('self', 'moveCardBundle', [
          'self',
          'hand',
          'discard',
          0,
          false,
          'bottom',
        ])
      )
    ).toEqual({
      code: 'invalid_destination_zone',
      recordIndex: 3,
      path: '$[3].parameters[2]',
      message: 'A bottom-mode moveCardBundle must target deck',
    });
  });

  it.each([null, true, 0, 'false', []])(
    'rejects bottom-bundle target index %j',
    (targetIndex) => {
      expect(
        firstIssue(
          action('self', 'moveCardBundle', [
            'self',
            'hand',
            'deck',
            0,
            targetIndex,
            'bottom',
          ])
        )
      ).toEqual({
        code: 'invalid_target_index',
        recordIndex: 3,
        path: '$[3].parameters[4]',
        message:
          'A bottom-mode moveCardBundle must not carry a target card index',
      });
    }
  );
});
