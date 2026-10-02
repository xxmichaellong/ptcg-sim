import { MAX_DECK_CARDS } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { decodeLegacyV1MarkerActions } from './decode-markers.js';
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
  return decodeLegacyV1MarkerActions(parsed.value);
};

describe('legacy v1 marker-action positional decoder', () => {
  it('decodes independent GX and VSTAR toggles for either player in source order', () => {
    expect(
      decode(
        action('self', 'VSTARGXFunction', ['VSTAR']),
        action('opp', 'draw', ['self', 1]),
        action('opp', 'VSTARGXFunction', ['GX'])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'VSTARGXFunction',
          recordIndex: 3,
          player: 'self',
          marker: 'vstar',
        },
        {
          type: 'VSTARGXFunction',
          recordIndex: 5,
          player: 'opp',
          marker: 'gx',
        },
      ],
    });
  });

  it('requires exactly one marker parameter', () => {
    for (const parameters of [[], ['GX', 'extra']]) {
      expect(decode(action('self', 'VSTARGXFunction', parameters))).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_count',
            recordIndex: 3,
            path: '$[3].parameters',
            message: 'VSTARGXFunction requires [marker]',
          },
        ],
      });
    }
  });

  it.each([null, true, 1, [], {}])(
    'rejects a non-string marker %j',
    (marker) => {
      expect(decode(action('self', 'VSTARGXFunction', [marker]))).toMatchObject(
        {
          ok: false,
          issues: [
            {
              code: 'invalid_parameter_type',
              recordIndex: 3,
              path: '$[3].parameters[0]',
            },
          ],
        }
      );
    }
  );

  it.each(['gx', 'Vstar', 'V-STAR', '', 'OTHER'])(
    'rejects a source-inaccessible marker %j',
    (marker) => {
      expect(decode(action('self', 'VSTARGXFunction', [marker]))).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_once_per_game_marker',
            recordIndex: 3,
            path: '$[3].parameters[0]',
            message: 'VSTARGXFunction marker must be GX or VSTAR',
          },
        ],
      });
    }
  );

  it('decodes source-accessible ability marker coordinates and initiator perspective', () => {
    expect(
      decode(
        action('self', 'useAbility', ['opp', 'active', 0]),
        action('opp', 'removeAbilityCounter', ['bench', 4]),
        action('self', 'useAbility', ['self', 'discard', 2]),
        action('opp', 'removeAbilityCounter', ['stadium', 0])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'useAbility',
          recordIndex: 3,
          player: 'self',
          initiator: 'opp',
          zone: 'active',
          sourceIndex: 0,
        },
        {
          type: 'removeAbilityCounter',
          recordIndex: 4,
          player: 'opp',
          zone: 'bench',
          sourceIndex: 4,
        },
        {
          type: 'useAbility',
          recordIndex: 5,
          player: 'self',
          initiator: 'self',
          zone: 'discard',
          sourceIndex: 2,
        },
        {
          type: 'removeAbilityCounter',
          recordIndex: 6,
          player: 'opp',
          zone: 'stadium',
          sourceIndex: 0,
        },
      ],
    });
  });

  it.each([
    { actionName: 'useAbility', parameters: ['self', 'active'] },
    { actionName: 'removeAbilityCounter', parameters: ['active'] },
  ])('rejects a malformed $actionName tuple', ({ actionName, parameters }) => {
    expect(decode(action('self', actionName, parameters))).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'invalid_parameter_count',
          recordIndex: 3,
          path: '$[3].parameters',
        },
      ],
    });
  });

  it('requires an exported initiator for ability use', () => {
    expect(
      decode(action('self', 'useAbility', [false, 'active', 0]))
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

  it.each(['useAbility', 'removeAbilityCounter'] as const)(
    'rejects invalid %s zones and indices',
    (actionName) => {
      const parameters = (zone: unknown, index: unknown): unknown[] =>
        actionName === 'useAbility' ? ['self', zone, index] : [zone, index];
      const zoneParameter = actionName === 'useAbility' ? 1 : 0;
      const indexParameter = zoneParameter + 1;
      expect(
        decode(action('self', actionName, parameters(null, 0)))
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_type',
            path: `$[3].parameters[${zoneParameter}]`,
          },
        ],
      });
      expect(
        decode(action('self', actionName, parameters('hand', 0)))
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'invalid_marker_zone',
            path: `$[3].parameters[${zoneParameter}]`,
          },
        ],
      });
      for (const index of [null, '0', true]) {
        expect(
          decode(action('self', actionName, parameters('active', index)))
        ).toMatchObject({
          ok: false,
          issues: [
            {
              code: 'invalid_parameter_type',
              path: `$[3].parameters[${indexParameter}]`,
            },
          ],
        });
      }
      for (const index of [-1, 0.5, MAX_DECK_CARDS, Number.MAX_SAFE_INTEGER]) {
        expect(
          decode(action('self', actionName, parameters('active', index)))
        ).toMatchObject({
          ok: false,
          issues: [
            {
              code: 'invalid_card_index',
              path: `$[3].parameters[${indexParameter}]`,
            },
          ],
        });
      }
    }
  );

  it('decodes bounded damage marker targets and the serialized add default', () => {
    expect(
      decode(
        action('self', 'addDamageCounter', ['active', 0, null]),
        action('self', 'addDamageCounter', ['bench', 1, '30']),
        action('opp', 'updateDamageCounter', ['active', 2, ' 70 ']),
        action('opp', 'updateDamageCounter', ['bench', 3, '0']),
        action('self', 'updateDamageCounter', ['active', 4, '-20']),
        action('self', 'updateDamageCounter', ['bench', 5, '']),
        action('opp', 'removeDamageCounter', ['active', 6])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'addDamageCounter',
          recordIndex: 3,
          player: 'self',
          zone: 'active',
          sourceIndex: 0,
          damage: 10,
        },
        {
          type: 'addDamageCounter',
          recordIndex: 4,
          player: 'self',
          zone: 'bench',
          sourceIndex: 1,
          damage: 30,
        },
        {
          type: 'updateDamageCounter',
          recordIndex: 5,
          player: 'opp',
          zone: 'active',
          sourceIndex: 2,
          damage: 70,
        },
        {
          type: 'updateDamageCounter',
          recordIndex: 6,
          player: 'opp',
          zone: 'bench',
          sourceIndex: 3,
          damage: null,
        },
        {
          type: 'updateDamageCounter',
          recordIndex: 7,
          player: 'self',
          zone: 'active',
          sourceIndex: 4,
          damage: null,
        },
        {
          type: 'updateDamageCounter',
          recordIndex: 8,
          player: 'self',
          zone: 'bench',
          sourceIndex: 5,
          damage: null,
        },
        {
          type: 'removeDamageCounter',
          recordIndex: 9,
          player: 'opp',
          zone: 'active',
          sourceIndex: 6,
        },
      ],
    });
  });

  it.each([
    { actionName: 'addDamageCounter', parameters: ['active', 0] },
    { actionName: 'updateDamageCounter', parameters: ['active', 0] },
    { actionName: 'removeDamageCounter', parameters: ['active'] },
  ])('rejects a malformed $actionName tuple', ({ actionName, parameters }) => {
    expect(decode(action('self', actionName, parameters))).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'invalid_parameter_count',
          recordIndex: 3,
          path: '$[3].parameters',
        },
      ],
    });
  });

  it.each([
    'addDamageCounter',
    'updateDamageCounter',
    'removeDamageCounter',
  ] as const)('rejects invalid %s zones and indices', (actionName) => {
    const parameters = (zone: unknown, index: unknown): unknown[] =>
      actionName === 'removeDamageCounter'
        ? [zone, index]
        : [zone, index, '10'];
    expect(
      decode(action('self', actionName, parameters(null, 0)))
    ).toMatchObject({
      ok: false,
      issues: [{ code: 'invalid_parameter_type', path: '$[3].parameters[0]' }],
    });
    expect(
      decode(action('self', actionName, parameters('discard', 0)))
    ).toMatchObject({
      ok: false,
      issues: [{ code: 'invalid_marker_zone', path: '$[3].parameters[0]' }],
    });
    for (const index of [null, '0', true]) {
      expect(
        decode(action('self', actionName, parameters('active', index)))
      ).toMatchObject({
        ok: false,
        issues: [
          { code: 'invalid_parameter_type', path: '$[3].parameters[1]' },
        ],
      });
    }
    for (const index of [-1, 0.5, MAX_DECK_CARDS]) {
      expect(
        decode(action('self', actionName, parameters('active', index)))
      ).toMatchObject({
        ok: false,
        issues: [{ code: 'invalid_card_index', path: '$[3].parameters[1]' }],
      });
    }
  });

  it.each(['addDamageCounter', 'updateDamageCounter'] as const)(
    'requires string damage for %s outside the serialized add default',
    (actionName) => {
      for (const damage of [true, 10, [], {}, null]) {
        if (actionName === 'addDamageCounter' && damage === null) continue;
        expect(
          decode(action('self', actionName, ['active', 0, damage]))
        ).toMatchObject({
          ok: false,
          issues: [
            { code: 'invalid_parameter_type', path: '$[3].parameters[2]' },
          ],
        });
      }
    }
  );

  it.each(['', '0', '-10', '1.5', 'damage', '9991'])(
    'rejects an unrepresentable add-damage value %j',
    (damage) => {
      expect(
        decode(action('self', 'addDamageCounter', ['active', 0, damage]))
      ).toMatchObject({
        ok: false,
        issues: [{ code: 'invalid_damage_value', path: '$[3].parameters[2]' }],
      });
    }
  );

  it.each(['1.5', 'damage', '9991', '9999999999999999'])(
    'rejects an unrepresentable update-damage value %j',
    (damage) => {
      expect(
        decode(action('self', 'updateDamageCounter', ['active', 0, damage]))
      ).toMatchObject({
        ok: false,
        issues: [{ code: 'invalid_damage_value', path: '$[3].parameters[2]' }],
      });
    }
  );

  it('decodes active special-condition defaults, bounded edits, and removals', () => {
    expect(
      decode(
        action('self', 'addSpecialCondition', ['active', 0]),
        action('opp', 'updateSpecialCondition', ['active', 1, ' Pa ']),
        action('self', 'updateSpecialCondition', ['active', 2, '0']),
        action('opp', 'updateSpecialCondition', ['active', 3, '   ']),
        action('self', 'updateSpecialCondition', [
          'active',
          4,
          '1234567890123456',
        ]),
        action('opp', 'removeSpecialCondition', ['active', 5])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'addSpecialCondition',
          recordIndex: 3,
          player: 'self',
          zone: 'active',
          sourceIndex: 0,
          condition: 'P',
        },
        {
          type: 'updateSpecialCondition',
          recordIndex: 4,
          player: 'opp',
          zone: 'active',
          sourceIndex: 1,
          condition: 'Pa',
        },
        {
          type: 'updateSpecialCondition',
          recordIndex: 5,
          player: 'self',
          zone: 'active',
          sourceIndex: 2,
          condition: null,
        },
        {
          type: 'updateSpecialCondition',
          recordIndex: 6,
          player: 'opp',
          zone: 'active',
          sourceIndex: 3,
          condition: null,
        },
        {
          type: 'updateSpecialCondition',
          recordIndex: 7,
          player: 'self',
          zone: 'active',
          sourceIndex: 4,
          condition: '1234567890123456',
        },
        {
          type: 'removeSpecialCondition',
          recordIndex: 8,
          player: 'opp',
          zone: 'active',
          sourceIndex: 5,
        },
      ],
    });
  });

  it.each([
    { actionName: 'addSpecialCondition', parameters: ['active'] },
    {
      actionName: 'addSpecialCondition',
      parameters: ['active', 0, 'extra'],
    },
    { actionName: 'updateSpecialCondition', parameters: ['active', 0] },
    {
      actionName: 'updateSpecialCondition',
      parameters: ['active', 0, 'P', 'extra'],
    },
    { actionName: 'removeSpecialCondition', parameters: ['active'] },
    {
      actionName: 'removeSpecialCondition',
      parameters: ['active', 0, 'extra'],
    },
  ])('rejects a malformed $actionName tuple', ({ actionName, parameters }) => {
    expect(decode(action('self', actionName, parameters))).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'invalid_parameter_count',
          recordIndex: 3,
          path: '$[3].parameters',
        },
      ],
    });
  });

  it.each([
    'addSpecialCondition',
    'updateSpecialCondition',
    'removeSpecialCondition',
  ] as const)('rejects invalid %s zones and indices', (actionName) => {
    const parameters = (zone: unknown, index: unknown): unknown[] =>
      actionName === 'updateSpecialCondition'
        ? [zone, index, 'P']
        : [zone, index];
    expect(
      decode(action('self', actionName, parameters(null, 0)))
    ).toMatchObject({
      ok: false,
      issues: [{ code: 'invalid_parameter_type', path: '$[3].parameters[0]' }],
    });
    for (const zone of ['bench', 'discard', 'stadium']) {
      expect(
        decode(action('self', actionName, parameters(zone, 0)))
      ).toMatchObject({
        ok: false,
        issues: [{ code: 'invalid_marker_zone', path: '$[3].parameters[0]' }],
      });
    }
    for (const index of [null, '0', true]) {
      expect(
        decode(action('self', actionName, parameters('active', index)))
      ).toMatchObject({
        ok: false,
        issues: [
          { code: 'invalid_parameter_type', path: '$[3].parameters[1]' },
        ],
      });
    }
    for (const index of [-1, 0.5, MAX_DECK_CARDS]) {
      expect(
        decode(action('self', actionName, parameters('active', index)))
      ).toMatchObject({
        ok: false,
        issues: [{ code: 'invalid_card_index', path: '$[3].parameters[1]' }],
      });
    }
  });

  it.each([null, true, 1, [], {}])(
    'rejects a non-string special-condition edit %j',
    (condition) => {
      expect(
        decode(
          action('self', 'updateSpecialCondition', ['active', 0, condition])
        )
      ).toMatchObject({
        ok: false,
        issues: [
          { code: 'invalid_parameter_type', path: '$[3].parameters[2]' },
        ],
      });
    }
  );

  it('rejects a special-condition edit over the approved bound', () => {
    expect(
      decode(
        action('self', 'updateSpecialCondition', [
          'active',
          0,
          '12345678901234567',
        ])
      )
    ).toMatchObject({
      ok: false,
      issues: [{ code: 'invalid_condition_value', path: '$[3].parameters[2]' }],
    });
  });

  it('ignores other allowlisted action families', () => {
    expect(
      decode(
        action('self', 'attack', []),
        action('opp', 'changeCardBack', ['/back.png'])
      )
    ).toEqual({ ok: true, actions: [] });
  });
});
