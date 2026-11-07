import { describe, expect, it } from 'vitest';

import lifecycleFixture from '../../../tests/legacy-fixtures/saves/action-export-v1.5.1.json' with { type: 'json' };
import { decodeLegacyV1LifecycleActions } from './decode-lifecycle.js';
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
  return decodeLegacyV1LifecycleActions(parsed.value);
};

const firstIssue = (...actions: unknown[]) => {
  const result = decode(...actions);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected lifecycle decode rejection');
  return result.issues[0]!;
};

describe('legacy v1 lifecycle positional decoder', () => {
  it('decodes both bootstraps and source-shaped lifecycle records without applying them', () => {
    const parsed = parseLegacyExportJson(JSON.stringify(lifecycleFixture));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Expected fixture admission');

    expect(decodeLegacyV1LifecycleActions(parsed.value)).toEqual({
      ok: true,
      actions: [
        {
          type: 'loadDeckData',
          recordIndex: 1,
          player: 'self',
          deck: [
            ['2', 'Pikachu', 'Pokémon', 'https://cards.example/pikachu.png'],
            [
              '3',
              'Lightning Energy',
              'Energy',
              'https://cards.example/energy.png',
            ],
          ],
        },
        {
          type: 'loadDeckData',
          recordIndex: 2,
          player: 'opp',
          deck: '',
        },
        {
          type: 'setup',
          recordIndex: 3,
          player: 'self',
          shuffleIndices: [4, 3, 2, 1, 0],
        },
        {
          type: 'takeTurn',
          recordIndex: 5,
          player: 'self',
          initiator: 'self',
        },
        {
          type: 'reset',
          recordIndex: 6,
          player: 'opp',
          clean: false,
          build: true,
          invalidMessage: true,
        },
      ],
    });
  });

  it('ignores other admitted families instead of guessing their parameters', () => {
    expect(
      decode(
        action('self', 'pass', ['unvalidated']),
        action('opp', 'changeCardBack', ['https://cards.example/back.png'])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'loadDeckData',
          recordIndex: 1,
          player: 'self',
          deck: '',
        },
        {
          type: 'loadDeckData',
          recordIndex: 2,
          player: 'opp',
          deck: '',
        },
      ],
    });
  });

  it('requires the exact three reset booleans', () => {
    expect(firstIssue(action('self', 'reset', [false, true]))).toMatchObject({
      code: 'invalid_parameter_count',
      recordIndex: 3,
      path: '$[3].parameters',
    });
    expect(
      firstIssue(action('self', 'reset', [false, 'true', true]))
    ).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters',
    });
  });

  it.each([null, [0, 0], [0, 2], [1], [-1], [0.5], ['0']])(
    'rejects a non-permutation setup payload: %j',
    (indices) => {
      expect(firstIssue(action('self', 'setup', [indices]))).toMatchObject({
        code: 'invalid_shuffle_permutation',
        recordIndex: 3,
        path: '$[3].parameters[0]',
      });
    }
  );

  it('accepts the empty shuffle and rejects extra setup parameters', () => {
    const empty = decode(action('self', 'setup', [[]]));
    expect(empty.ok && empty.actions.at(-1)).toEqual({
      type: 'setup',
      recordIndex: 3,
      player: 'self',
      shuffleIndices: [],
    });
    expect(firstIssue(action('self', 'setup', [[], 'extra']))).toMatchObject({
      code: 'invalid_parameter_count',
      path: '$[3].parameters',
    });
  });

  it('requires takeTurn export perspective to match the record owner', () => {
    expect(firstIssue(action('self', 'takeTurn', []))).toMatchObject({
      code: 'invalid_parameter_count',
      path: '$[3].parameters',
    });
    expect(firstIssue(action('self', 'takeTurn', [7]))).toMatchObject({
      code: 'invalid_parameter_type',
      path: '$[3].parameters[0]',
    });
    expect(firstIssue(action('self', 'takeTurn', ['opp']))).toMatchObject({
      code: 'invalid_export_perspective',
      path: '$[3].parameters[0]',
    });
  });

  it('rejects a loadDeckData record outside the two parser-verified bootstraps', () => {
    expect(firstIssue(action('self', 'loadDeckData', ['']))).toMatchObject({
      code: 'unexpected_deck_bootstrap',
      recordIndex: 3,
      path: '$[3].action',
    });
  });
});
