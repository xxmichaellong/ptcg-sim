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

  it('ignores other allowlisted action families', () => {
    expect(
      decode(
        action('self', 'attack', []),
        action('opp', 'changeCardBack', ['/back.png'])
      )
    ).toEqual({ ok: true, actions: [] });
  });
});
