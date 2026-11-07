import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  LEGACY_KEYBIND_ACTION_CALLS,
  LEGACY_REPLAY_ALLOWED_ACTIONS,
  LEGACY_REPLAY_ALLOWED_CONTEXT_MENU_IDS,
  LEGACY_REPLAY_ALLOWED_KEY_TOKENS,
  LEGACY_SELECTED_CARD_DESTINATIONS,
  LEGACY_SYNCHRONIZED_ACTIONS,
} from './legacy-surface.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

const readRepositoryFile = (relativePath: string): string =>
  readFileSync(new URL(relativePath, `file://${repositoryRoot}`), 'utf8');

const extractObjectBody = (source: string, declaration: string): string => {
  const start = source.indexOf(declaration);
  expect(start, `missing declaration: ${declaration}`).toBeGreaterThanOrEqual(
    0
  );

  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`unterminated object: ${declaration}`);
};

const extractPropertyKeys = (objectBody: string): string[] =>
  [...objectBody.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):/gm)].map(
    (match) => match[1]!
  );

const extractQuotedValues = (objectBody: string): string[] =>
  [...objectBody.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]!);

describe('legacy synchronized surface', () => {
  it('keeps the complete 50-action dispatcher inventory explicit', () => {
    const source = readRepositoryFile(
      'client/src/setup/general/accept-action.js'
    );
    const actual = extractPropertyKeys(
      extractObjectBody(source, 'const functions =')
    );

    expect(new Set(actual).size).toBe(50);
    expect(actual).toEqual(LEGACY_SYNCHRONIZED_ACTIONS);
  });

  it('locks replay capability exceptions', () => {
    const source = readRepositoryFile(
      'client/src/setup/general/replay-block.js'
    );
    const body = extractObjectBody(source, 'const allowedDuringReplay =');
    const arrays = [
      ...body.matchAll(/(action|keybind|contextMenu):\s*\[([\s\S]*?)\]/g),
    ];
    const byType = Object.fromEntries(
      arrays.map((match) => [match[1], extractQuotedValues(match[2]!)])
    );

    expect(byType.action).toEqual(LEGACY_REPLAY_ALLOWED_ACTIONS);
    expect(byType.keybind).toEqual(LEGACY_REPLAY_ALLOWED_KEY_TOKENS);
    expect(byType.contextMenu).toEqual(LEGACY_REPLAY_ALLOWED_CONTEXT_MENU_IDS);
  });

  it('locks selected-card destination shortcuts', () => {
    const source = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );
    const body = extractObjectBody(source, 'const keyBinds =');
    const entries = [
      ...body.matchAll(/^\s*(['"]?)([^:'"]+)\1:\s*['"]([^'"]+)['"],/gm),
    ];
    const actual = Object.fromEntries(
      entries.map((match) => [
        match[1] ? match[2]! : match[2]!.trim(),
        match[3]!,
      ])
    );

    expect(actual).toEqual(LEGACY_SELECTED_CARD_DESTINATIONS);
  });

  it('keeps every gameplay function reached by the keyboard discoverable', () => {
    const source = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );
    const importedActions = new Set(
      [
        ...source.matchAll(
          /import\s+{([\s\S]*?)}\s+from\s+['"][^'"]+['"];|import\s+([A-Za-z][A-Za-z0-9]*)\s+from\s+['"][^'"]+['"];/g
        ),
      ].flatMap((match) =>
        match[1]
          ? match[1]
              .split(',')
              .map((name) => name.trim().split(/\s+as\s+/)[1] ?? name.trim())
              .filter(Boolean)
          : [match[2]!]
      )
    );
    const calledActions = LEGACY_KEYBIND_ACTION_CALLS.filter((action) =>
      new RegExp(`\\b${action}\\s*\\(`).test(source)
    );

    expect(calledActions).toEqual(LEGACY_KEYBIND_ACTION_CALLS);
    expect([...importedActions]).toEqual(
      expect.arrayContaining(LEGACY_KEYBIND_ACTION_CALLS)
    );
  });
});
