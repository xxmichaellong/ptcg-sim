import { describe, expect, it } from 'vitest';

import { decodeLegacyV1HistoryActions } from './decode-history-actions.js';
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
  return decodeLegacyV1HistoryActions(parsed.value);
};

describe('legacy v1 history-action positional decoder', () => {
  it('decodes the native JSON undo placeholder for either player', () => {
    expect(
      decode(
        action('self', 'undo', [null]),
        action('self', 'draw', ['self', 1]),
        action('opp', 'undo', [null])
      )
    ).toEqual({
      ok: true,
      actions: [
        { type: 'undo', recordIndex: 3, player: 'self' },
        { type: 'undo', recordIndex: 5, player: 'opp' },
      ],
    });
  });

  it.each([{ parameters: [] }, { parameters: [null, null] }])(
    'requires the exact one-entry undo tuple $parameters',
    ({ parameters }) => {
      expect(decode(action('self', 'undo', parameters))).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_count',
            recordIndex: 3,
            path: '$[3].parameters',
            message: 'undo requires one serialized history placeholder',
          },
        ],
      });
    }
  );

  it.each([false, true, 0, 'null', [], {}])(
    'rejects a non-null undo history placeholder %j',
    (placeholder) => {
      expect(decode(action('opp', 'undo', [placeholder]))).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_type',
            recordIndex: 3,
            path: '$[3].parameters[0]',
            message: 'undo history placeholder must be null',
          },
        ],
      });
    }
  );

  it('ignores every other allowlisted action family', () => {
    expect(
      decode(
        action('self', 'draw', ['self', 1]),
        action('opp', 'changeCardBack', ['/back.png']),
        action('self', 'attack', [])
      )
    ).toEqual({ ok: true, actions: [] });
  });
});
