import { MAX_DECK_CARDS } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { decodeLegacyV1CardAnnotationActions } from './decode-card-annotations.js';
import { parseLegacyExportJson } from './parse-export.js';

const action = (user: 'self' | 'opp', name: string, parameters: unknown[]) => ({
  user,
  emit: true,
  action: name,
  parameters,
});

const decode = (...actions: unknown[]) => {
  const parsed = parseLegacyExportJson(
    JSON.stringify([
      { version: '1.5.1' },
      action('self', 'loadDeckData', ['']),
      action('opp', 'loadDeckData', ['']),
      ...actions,
    ])
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('Expected envelope admission');
  return decodeLegacyV1CardAnnotationActions(parsed.value);
};

describe('legacy v1 card-annotation positional decoder', () => {
  it('decodes all source-selectable category targets and exported initiators', () => {
    const zones = [
      'deck',
      'hand',
      'prizes',
      'discard',
      'lostZone',
      'board',
      'active',
      'bench',
      'attachedCards',
      'viewCards',
      'stadium',
    ] as const;
    const categories = ['Energy', 'Trainer', 'Pokémon'] as const;
    const result = decode(
      ...zones.map((zone, index) =>
        action(index % 2 === 0 ? 'self' : 'opp', 'changeType', [
          index % 2 === 0 ? 'opp' : 'self',
          zone,
          index,
          categories[index % categories.length],
        ])
      )
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);
    expect(result.actions).toEqual(
      zones.map((zone, index) => ({
        type: 'changeType',
        recordIndex: index + 3,
        player: index % 2 === 0 ? 'self' : 'opp',
        initiator: index % 2 === 0 ? 'opp' : 'self',
        zone,
        sourceIndex: index,
        category: categories[index % categories.length],
      }))
    );
  });

  it('decodes play group, play single, and stadium rotation in source order', () => {
    expect(
      decode(
        action('self', 'rotateCard', ['active', 0, false]),
        action('opp', 'draw', ['self', 1]),
        action('opp', 'rotateCard', ['bench', 7, true]),
        action('self', 'rotateCard', ['stadium', 0, false])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'rotateCard',
          recordIndex: 3,
          player: 'self',
          zone: 'active',
          sourceIndex: 0,
          single: false,
        },
        {
          type: 'rotateCard',
          recordIndex: 5,
          player: 'opp',
          zone: 'bench',
          sourceIndex: 7,
          single: true,
        },
        {
          type: 'rotateCard',
          recordIndex: 6,
          player: 'self',
          zone: 'stadium',
          sourceIndex: 0,
          single: false,
        },
      ],
    });
  });

  it.each([
    { parameters: [] },
    { parameters: ['active', 0] },
    { parameters: ['active', 0, false, 'extra'] },
  ])('requires the exact three-parameter tuple %j', ({ parameters }) => {
    expect(decode(action('self', 'rotateCard', parameters))).toEqual({
      ok: false,
      issues: [
        {
          code: 'invalid_parameter_count',
          recordIndex: 3,
          path: '$[3].parameters',
          message: 'rotateCard requires [zone, index, single]',
        },
      ],
    });
  });

  it.each([null, true, 1, [], {}])('rejects a non-string zone %j', (zone) => {
    expect(
      decode(action('self', 'rotateCard', [zone, 0, false]))
    ).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'invalid_parameter_type',
          recordIndex: 3,
          path: '$[3].parameters[0]',
        },
      ],
    });
  });

  it.each(['deck', 'hand', 'prizes', 'discard', 'lostZone', 'board'])(
    'rejects a source-inaccessible rotation zone %s',
    (zone) => {
      expect(decode(action('self', 'rotateCard', [zone, 0, false]))).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_rotation_zone',
            recordIndex: 3,
            path: '$[3].parameters[0]',
            message: 'rotateCard must target active, bench, or stadium',
          },
        ],
      });
    }
  );

  it.each([null, '0', true, [], {}])(
    'rejects a non-number card index %j',
    (sourceIndex) => {
      expect(
        decode(action('self', 'rotateCard', ['active', sourceIndex, false]))
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_type',
            recordIndex: 3,
            path: '$[3].parameters[1]',
          },
        ],
      });
    }
  );

  it.each([-1, 0.5, MAX_DECK_CARDS, Number.MAX_SAFE_INTEGER])(
    'rejects an out-of-bound card index %j',
    (sourceIndex) => {
      expect(
        decode(action('self', 'rotateCard', ['bench', sourceIndex, false]))
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'invalid_card_index',
            recordIndex: 3,
            path: '$[3].parameters[1]',
          },
        ],
      });
    }
  );

  it.each([null, 0, 'false', [], {}])(
    'rejects a non-boolean single mode %j',
    (single) => {
      expect(
        decode(action('self', 'rotateCard', ['active', 0, single]))
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_type',
            recordIndex: 3,
            path: '$[3].parameters[2]',
          },
        ],
      });
    }
  );

  it('rejects the source-inaccessible stadium single-card mode', () => {
    expect(decode(action('self', 'rotateCard', ['stadium', 0, true]))).toEqual({
      ok: false,
      issues: [
        {
          code: 'invalid_rotation_mode',
          recordIndex: 3,
          path: '$[3].parameters[2]',
          message:
            'rotateCard single mode is only source-accessible in active or bench',
        },
      ],
    });
  });

  it.each([
    { parameters: [] },
    { parameters: ['opp', 'active', 0] },
    { parameters: ['opp', 'active', 0, 'Energy', 'extra'] },
  ])('requires the exact changeType tuple %j', ({ parameters }) => {
    expect(decode(action('self', 'changeType', parameters))).toEqual({
      ok: false,
      issues: [
        {
          code: 'invalid_parameter_count',
          recordIndex: 3,
          path: '$[3].parameters',
          message: 'changeType requires [initiator, zone, index, category]',
        },
      ],
    });
  });

  it.each([null, true, 1, 'player', [], {}])(
    'rejects a non-perspective category initiator %j',
    (initiator) => {
      expect(
        decode(action('self', 'changeType', [initiator, 'active', 0, 'Energy']))
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_type',
            recordIndex: 3,
            path: '$[3].parameters[0]',
          },
        ],
      });
    }
  );

  it.each([null, true, 1, [], {}])(
    'rejects a non-string category zone %j',
    (zone) => {
      expect(
        decode(action('self', 'changeType', ['opp', zone, 0, 'Energy']))
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_type',
            recordIndex: 3,
            path: '$[3].parameters[1]',
          },
        ],
      });
    }
  );

  it.each(['deckCover', 'discardCover', 'lostZoneCover', 'unknown'])(
    'rejects a source-inaccessible category zone %s',
    (zone) => {
      expect(
        decode(action('self', 'changeType', ['opp', zone, 0, 'Energy']))
      ).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_annotation_zone',
            recordIndex: 3,
            path: '$[3].parameters[1]',
            message:
              'changeType must target a source-selectable card container',
          },
        ],
      });
    }
  );

  it.each([null, '0', true, [], {}])(
    'rejects a non-number category card index %j',
    (sourceIndex) => {
      expect(
        decode(
          action('self', 'changeType', ['opp', 'active', sourceIndex, 'Energy'])
        )
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_type',
            recordIndex: 3,
            path: '$[3].parameters[2]',
          },
        ],
      });
    }
  );

  it.each([-1, 0.5, MAX_DECK_CARDS, Number.MAX_SAFE_INTEGER])(
    'rejects an out-of-bound category card index %j',
    (sourceIndex) => {
      expect(
        decode(
          action('self', 'changeType', ['opp', 'active', sourceIndex, 'Energy'])
        )
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'invalid_card_index',
            recordIndex: 3,
            path: '$[3].parameters[2]',
          },
        ],
      });
    }
  );

  it.each([null, true, 1, [], {}])(
    'rejects a non-string category %j',
    (category) => {
      expect(
        decode(action('self', 'changeType', ['opp', 'active', 0, category]))
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_type',
            recordIndex: 3,
            path: '$[3].parameters[3]',
          },
        ],
      });
    }
  );

  it.each(['Pokemon', 'Tool', 'Supporter', 'Unknown', '', 'energy'])(
    'rejects an unsupported category %j',
    (category) => {
      expect(
        decode(action('self', 'changeType', ['opp', 'active', 0, category]))
      ).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_card_category',
            recordIndex: 3,
            path: '$[3].parameters[3]',
            message: 'changeType category must be Pokémon, Trainer, or Energy',
          },
        ],
      });
    }
  );
});
