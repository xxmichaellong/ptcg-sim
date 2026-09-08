import { describe, expect, it } from 'vitest';

import { LEGACY_SYNCHRONIZED_ACTIONS } from '../../../tests/characterization/legacy-surface.js';
import version150Fixture from '../../../tests/legacy-fixtures/saves/action-export-v1.5.json' with { type: 'json' };
import version151Fixture from '../../../tests/legacy-fixtures/saves/action-export-v1.5.1.json' with { type: 'json' };
import {
  LEGACY_EXPORT_FORMAT,
  LEGACY_SYNCHRONIZED_ACTION_NAMES,
  MAX_LEGACY_ACTION_PARAMETERS,
  MAX_LEGACY_EXPORT_ACTIONS,
  MAX_LEGACY_EXPORT_CODE_UNITS,
  MAX_LEGACY_JSON_COLLECTION_ITEMS,
  MAX_LEGACY_JSON_DEPTH,
  MAX_LEGACY_JSON_STRING_CODE_UNITS,
  parseLegacyExportJson,
} from './parse-export.js';

const deck = [
  ['2', 'Pikachu', 'Pokémon', 'https://cards.example/pikachu.png'],
  ['3', 'Lightning Energy', 'Energy', 'https://cards.example/energy.png'],
];

const action = (
  user: 'self' | 'opp',
  name: string,
  parameters: unknown[] = []
) => ({ user, emit: true, action: name, parameters });

const exportPayload = (
  version = '1.5.1',
  additionalActions: unknown[] = []
) => [
  { version },
  action('self', 'loadDeckData', [deck]),
  action('opp', 'loadDeckData', ['']),
  ...additionalActions,
];

const firstIssue = (source: unknown) => {
  const result = parseLegacyExportJson(
    typeof source === 'string' ? source : JSON.stringify(source)
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected parser rejection');
  return result.issues[0]!;
};

describe('legacy v1 export envelope', () => {
  it('accepts the frozen source-shaped 1.5 and 1.5.1 fixtures', () => {
    const version150 = parseLegacyExportJson(JSON.stringify(version150Fixture));
    const version151 = parseLegacyExportJson(JSON.stringify(version151Fixture));

    expect(version150.ok && version150.value.version).toBe('1.5');
    expect(version151.ok && version151.value.version).toBe('1.5.1');
    expect(version151.ok && version151.value.selfDeck).toEqual(deck);
    expect(version151.ok && version151.value.actions.slice(2)).toEqual([
      action('self', 'setup'),
      action('opp', 'changeCardBack', ['https://cards.example/back.png']),
    ]);
  });

  it('parses the exact 1.5.1 export shape without executing an action', () => {
    let invoked = false;
    Object.defineProperty(globalThis, '__legacyImportProbe', {
      configurable: true,
      value: () => {
        invoked = true;
      },
    });
    const result = parseLegacyExportJson(
      JSON.stringify(
        exportPayload('1.5.1', [
          action('self', 'setup'),
          action('opp', 'moveCardBundle', [
            'self',
            'hand',
            0,
            { nested: ['data'] },
          ]),
        ])
      )
    );
    delete (globalThis as { __legacyImportProbe?: unknown })
      .__legacyImportProbe;

    expect(invoked).toBe(false);
    expect(result).toEqual({
      ok: true,
      value: {
        format: LEGACY_EXPORT_FORMAT,
        version: '1.5.1',
        selfDeck: deck,
        opponentDeck: '',
        actions: exportPayload('1.5.1', [
          action('self', 'setup'),
          action('opp', 'moveCardBundle', [
            'self',
            'hand',
            0,
            { nested: ['data'] },
          ]),
        ]).slice(1),
      },
    });
  });

  it('admits both source-observed versions and locks all 50 dispatcher names', () => {
    expect(LEGACY_SYNCHRONIZED_ACTION_NAMES).toEqual(
      LEGACY_SYNCHRONIZED_ACTIONS
    );
    expect(LEGACY_SYNCHRONIZED_ACTION_NAMES).toHaveLength(50);

    for (const version of ['1.5', '1.5.1']) {
      const result = parseLegacyExportJson(
        JSON.stringify(
          exportPayload(
            version,
            LEGACY_SYNCHRONIZED_ACTION_NAMES.map((name, index) =>
              action(index % 2 === 0 ? 'self' : 'opp', name)
            )
          )
        )
      );
      expect(result.ok).toBe(true);
    }
  });

  it('requires one explicit supported version record in the first position', () => {
    expect(firstIssue([]).code).toBe('invalid_root');
    expect(
      firstIssue([
        action('self', 'loadDeckData', [deck]),
        action('opp', 'loadDeckData', ['']),
        { version: '1.5.1' },
      ])
    ).toMatchObject({ code: 'invalid_version_record', path: '$[0]' });
    expect(
      firstIssue([{ version: '1.4' }, ...exportPayload().slice(1)])
    ).toMatchObject({ code: 'unsupported_version', path: '$[0].version' });
    expect(
      firstIssue([
        { version: '1.5.1', inferred: true },
        ...exportPayload().slice(1),
      ])
    ).toMatchObject({ code: 'invalid_version_record', path: '$[0]' });
  });

  it('requires exact action records and rejects unknown dynamic names', () => {
    expect(
      firstIssue(
        exportPayload('1.5.1', [{ ...action('self', 'setup'), counter: 1 }])
      )
    ).toMatchObject({ code: 'invalid_action_record', path: '$[3]' });
    expect(
      firstIssue(
        exportPayload('1.5.1', [action('self', '__legacyImportProbe')])
      )
    ).toMatchObject({ code: 'unknown_action', path: '$[3].action' });
    expect(
      firstIssue(exportPayload('1.5.1', [action('self', 'private-card-name')]))
        .message
    ).not.toContain('private-card-name');
    expect(
      firstIssue([
        { version: '1.5.1' },
        action('player-one' as 'self', 'loadDeckData', [deck]),
        action('opp', 'loadDeckData', ['']),
      ])
    ).toMatchObject({ code: 'invalid_action_record', path: '$[1]' });
  });

  it('requires the source exporter self/opponent loadDeckData bootstrap', () => {
    expect(
      firstIssue([
        { version: '1.5.1' },
        action('opp', 'loadDeckData', [deck]),
        action('self', 'loadDeckData', ['']),
      ])
    ).toMatchObject({ code: 'invalid_bootstrap', path: '$[1..2]' });
    expect(
      firstIssue([
        { version: '1.5.1' },
        { ...action('self', 'loadDeckData', [deck]), emit: false },
        action('opp', 'loadDeckData', ['']),
      ])
    ).toMatchObject({ code: 'invalid_bootstrap', path: '$[1..2]' });
  });

  it('validates both deck bootstraps structurally before interpretation', () => {
    expect(
      firstIssue([
        { version: '1.5.1' },
        action('self', 'loadDeckData', [[['1', 'Pikachu', 'Pokémon']]]),
        action('opp', 'loadDeckData', ['']),
      ])
    ).toMatchObject({ code: 'invalid_deck', path: '$[1].parameters[0][0]' });
    expect(
      firstIssue([
        { version: '1.5.1' },
        action('self', 'loadDeckData', [null]),
        action('opp', 'loadDeckData', ['']),
      ])
    ).toMatchObject({ code: 'invalid_deck', path: '$[1].parameters[0]' });
  });

  it('rejects empty, malformed, and oversized source text before conversion', () => {
    expect(firstIssue('').code).toBe('empty_input');
    expect(firstIssue('{').code).toBe('invalid_json');
    expect(firstIssue(' '.repeat(MAX_LEGACY_EXPORT_CODE_UNITS + 1)).code).toBe(
      'payload_too_large'
    );
  });

  it('bounds action count and top-level parameter count', () => {
    const tooManyActions = exportPayload(
      '1.5.1',
      Array.from({ length: MAX_LEGACY_EXPORT_ACTIONS - 1 }, () =>
        action('self', 'setup')
      )
    );
    expect(firstIssue(tooManyActions).code).toBe('too_many_actions');

    expect(
      firstIssue(
        exportPayload('1.5.1', [
          action(
            'self',
            'setup',
            Array.from({ length: MAX_LEGACY_ACTION_PARAMETERS + 1 }, () => 0)
          ),
        ])
      )
    ).toMatchObject({ code: 'invalid_parameters', path: '$[3].parameters' });
  });

  it('bounds nested structures and strings independently of raw payload size', () => {
    let nested: unknown = 'leaf';
    for (let depth = 0; depth < MAX_LEGACY_JSON_DEPTH + 1; depth += 1) {
      nested = [nested];
    }
    expect(
      firstIssue(exportPayload('1.5.1', [action('self', 'setup', [nested])]))
        .code
    ).toBe('structure_too_deep');
    expect(
      firstIssue(
        exportPayload('1.5.1', [
          action('self', 'setup', [
            'x'.repeat(MAX_LEGACY_JSON_STRING_CODE_UNITS + 1),
          ]),
        ])
      )
    ).toMatchObject({
      code: 'string_too_large',
      path: '$[3].parameters[0]',
    });

    expect(
      firstIssue(
        exportPayload('1.5.1', [
          action('self', 'setup', [
            Array.from(
              { length: MAX_LEGACY_JSON_COLLECTION_ITEMS + 1 },
              () => 0
            ),
          ]),
        ])
      )
    ).toMatchObject({
      code: 'collection_too_large',
      path: '$[3].parameters[0]',
    });
  });

  it('rejects numbers that JSON decodes outside the finite range', () => {
    const finiteSource = JSON.stringify(
      exportPayload('1.5.1', [action('self', 'setup', [0])])
    );
    const overflowSource = finiteSource.replace(
      '"parameters":[0]',
      '"parameters":[1e400]'
    );
    expect(overflowSource).not.toBe(finiteSource);
    expect(firstIssue(overflowSource)).toMatchObject({
      code: 'invalid_number',
      path: '$[3].parameters[0]',
    });
  });
});
