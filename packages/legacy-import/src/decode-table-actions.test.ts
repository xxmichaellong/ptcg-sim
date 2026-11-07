import { describe, expect, it } from 'vitest';

import { decodeLegacyV1TableActions } from './decode-table-actions.js';
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
  return decodeLegacyV1TableActions(parsed.value);
};

describe('legacy v1 table-action positional decoder', () => {
  it('decodes attack and pass in source-record order for either player', () => {
    expect(
      decode(
        action('self', 'attack', []),
        action('self', 'draw', ['self', 1]),
        action('opp', 'pass', [])
      )
    ).toEqual({
      ok: true,
      actions: [
        { type: 'attack', recordIndex: 3, player: 'self' },
        { type: 'pass', recordIndex: 5, player: 'opp' },
      ],
    });
  });

  it.each(['attack', 'pass'] as const)(
    'requires an exact empty parameter list for %s',
    (actionName) => {
      const result = decode(action('self', actionName, [null]));
      expect(result).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_count',
            recordIndex: 3,
            path: '$[3].parameters',
            message: `${actionName} requires an empty parameter list`,
          },
        ],
      });
    }
  );

  it('ignores other allowlisted action families', () => {
    expect(
      decode(
        action('self', 'takeTurn', ['self']),
        action('opp', 'changeCardBack', ['/back.png'])
      )
    ).toEqual({ ok: true, actions: [] });
  });
});
