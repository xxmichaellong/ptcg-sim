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

  it('ignores all other admitted families rather than inferring tuples', () => {
    expect(
      decode(
        action('self', 'moveCardBundle', ['unvalidated']),
        action('opp', 'shuffleIntoDeck', []),
        action('self', 'setup', [[]])
      )
    ).toEqual({ ok: true, actions: [] });
  });

  it('requires exactly the source-exported two parameters', () => {
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
