import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/game-core';
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
  it('decodes either player while retaining each arbitrary source URL exactly', () => {
    const result = decode(
      action('self', 'changeCardBack', [
        'https://private.example/self-secret.png',
      ]),
      action('opp', 'changeCardBack', ['data:image/png;base64,c2VjcmV0'])
    );

    expect(result).toEqual({
      ok: true,
      actions: [
        {
          type: 'changeCardBack',
          recordIndex: 3,
          player: 'self',
          sourceUrl: 'https://private.example/self-secret.png',
        },
        {
          type: 'changeCardBack',
          recordIndex: 4,
          player: 'opp',
          sourceUrl: 'data:image/png;base64,c2VjcmV0',
        },
      ],
    });
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

  it.each(['', 'x'.repeat(MAX_IMAGE_URL_CODE_UNITS + 1)])(
    'rejects an empty or oversized source URL',
    (sourceUrl) => {
      expect(decode(action('self', 'changeCardBack', [sourceUrl]))).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_card_back_url',
            recordIndex: 3,
            path: '$[3].parameters[0]',
            message: `changeCardBack source URL must contain 1 to ${MAX_IMAGE_URL_CODE_UNITS} code units`,
          },
        ],
      });
    }
  );

  it('ignores every other allowlisted action family', () => {
    expect(
      decode(action('self', 'draw', ['self', 1]), action('opp', 'attack', []))
    ).toEqual({ ok: true, actions: [] });
  });
});
