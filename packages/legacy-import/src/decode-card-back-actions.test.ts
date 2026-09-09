import { describe, expect, it } from 'vitest';

import { decodeLegacyV1CardBackActions } from './decode-card-back-actions.js';
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
  return decodeLegacyV1CardBackActions(parsed.value);
};

describe('legacy v1 card-back positional decoder', () => {
  it('decodes either player without retaining the arbitrary source URL', () => {
    const result = decode(
      action('self', 'changeCardBack', [
        'https://private.example/self-secret.png',
      ]),
      action('opp', 'changeCardBack', ['data:image/png;base64,c2VjcmV0'])
    );

    expect(result).toEqual({
      ok: true,
      actions: [
        { type: 'changeCardBack', recordIndex: 3, player: 'self' },
        { type: 'changeCardBack', recordIndex: 4, player: 'opp' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('private.example');
    expect(JSON.stringify(result)).not.toContain('c2VjcmV0');
  });

  it.each([{ parameters: [] }, { parameters: ['/one.png', '/two.png'] }])(
    'requires the exact one-entry tuple $parameters',
    ({ parameters }) => {
      expect(decode(action('self', 'changeCardBack', parameters))).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_count',
            recordIndex: 3,
            path: '$[3].parameters',
            message: 'changeCardBack requires one source URL',
          },
        ],
      });
    }
  );

  it.each([null, false, 0, [], {}])(
    'rejects a non-string source URL %j',
    (sourceUrl) => {
      expect(decode(action('opp', 'changeCardBack', [sourceUrl]))).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_type',
            recordIndex: 3,
            path: '$[3].parameters[0]',
            message: 'changeCardBack source URL must be a string',
          },
        ],
      });
    }
  );

  it('rejects an empty source URL', () => {
    expect(decode(action('self', 'changeCardBack', ['']))).toEqual({
      ok: false,
      issues: [
        {
          code: 'invalid_card_back_url',
          recordIndex: 3,
          path: '$[3].parameters[0]',
          message: 'changeCardBack source URL cannot be empty',
        },
      ],
    });
  });

  it('ignores every other allowlisted action family', () => {
    expect(
      decode(action('self', 'draw', ['self', 1]), action('opp', 'attack', []))
    ).toEqual({ ok: true, actions: [] });
  });
});
