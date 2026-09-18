import { MAX_DECK_CARDS } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { decodeLegacyV1RandomActions } from './decode-random-actions.js';
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
  return decodeLegacyV1RandomActions(parsed.value);
};

describe('legacy v1 resolved-random positional decoder', () => {
  it('decodes both target owners and independently exported initiators', () => {
    expect(
      decode(
        action('self', 'playRandomCardFaceDown', ['self', 3]),
        action('self', 'draw', ['opp', 1]),
        action('opp', 'playRandomCardFaceDown', ['self', 0]),
        action('opp', 'playRandomCardFaceDown', ['opp', 7])
      )
    ).toEqual({
      ok: true,
      actions: [
        {
          type: 'playRandomCardFaceDown',
          recordIndex: 3,
          player: 'self',
          initiator: 'self',
          randomIndex: 3,
        },
        {
          type: 'playRandomCardFaceDown',
          recordIndex: 5,
          player: 'opp',
          initiator: 'self',
          randomIndex: 0,
        },
        {
          type: 'playRandomCardFaceDown',
          recordIndex: 6,
          player: 'opp',
          initiator: 'opp',
          randomIndex: 7,
        },
      ],
    });
  });

  it.each([
    { parameters: [] },
    { parameters: ['self'] },
    { parameters: ['self', 0, 'extra'] },
  ])(
    'requires the exact resolved-random tuple $parameters',
    ({ parameters }) => {
      expect(
        decode(action('self', 'playRandomCardFaceDown', parameters))
      ).toEqual({
        ok: false,
        issues: [
          {
            code: 'invalid_parameter_count',
            recordIndex: 3,
            path: '$[3].parameters',
            message: 'playRandomCardFaceDown requires [initiator, randomIndex]',
          },
        ],
      });
    }
  );

  it.each([null, true, 1, 'player', [], {}])(
    'rejects a non-perspective random-play initiator %j',
    (initiator) => {
      expect(
        decode(action('self', 'playRandomCardFaceDown', [initiator, 0]))
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

  it.each([null, '0', true, [], {}])(
    'rejects a non-number random hand index %j',
    (randomIndex) => {
      expect(
        decode(action('self', 'playRandomCardFaceDown', ['self', randomIndex]))
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
    'rejects an out-of-bound random hand index %j',
    (randomIndex) => {
      expect(
        decode(action('self', 'playRandomCardFaceDown', ['opp', randomIndex]))
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'invalid_random_index',
            recordIndex: 3,
            path: '$[3].parameters[1]',
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
