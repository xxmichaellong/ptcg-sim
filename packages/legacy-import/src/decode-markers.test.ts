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

  it('ignores other allowlisted action families', () => {
    expect(
      decode(
        action('self', 'attack', []),
        action('opp', 'changeCardBack', ['/back.png'])
      )
    ).toEqual({ ok: true, actions: [] });
  });
});
