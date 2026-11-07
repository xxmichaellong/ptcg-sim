import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from './constants.js';
import { parseClientFrame } from './ingress.js';

/** A Pokémon's print and text, and the moves picked from it (ADR-043). */

const parseCommand = (command: unknown) =>
  parseClientFrame(
    JSON.stringify({
      type: 'Command',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 'session',
      clientSequence: 1,
      commandId: 'command',
      lastSeenRevision: 0,
      command,
    })
  );

const loadDeck = (definition: Record<string, unknown>) =>
  parseCommand({
    type: 'LoadDeck',
    entries: [
      {
        definition: {
          id: 'definition',
          name: 'Charizard ex',
          category: 'Pokémon',
          imageUrl: 'https://example.test/charizard.png',
          ...definition,
        },
        count: 1,
      },
    ],
  });

describe('card text on the wire (ADR-043)', () => {
  it('carries a definition’s print and its own text, in bounds', () => {
    expect(loadDeck({ print: 'OBF 125' }).ok).toBe(true);
    expect(
      loadDeck({
        text: {
          hp: 330,
          attacks: [
            {
              name: 'Burning Darkness',
              cost: ['Fire', 'Fire'],
              damage: '180+',
            },
          ],
        },
      }).ok
    ).toBe(true);
    expect(loadDeck({ print: 'OBF125' }).ok).toBe(false);
    expect(loadDeck({ text: { hp: -1 } }).ok).toBe(false);
    expect(loadDeck({ text: { hp: 330, script: 'run()' } }).ok).toBe(false);
    expect(loadDeck({ text: {} }).ok).toBe(false);
  });

  it('names an Ability or attack on one bounded line', () => {
    expect(
      parseCommand({
        type: 'SetAbilityUsed',
        stackId: 'stack',
        used: true,
        ability: 'Infernal Reign',
      }).ok
    ).toBe(true);
    expect(
      parseCommand({
        type: 'DeclareAttack',
        targetPlayerId: 'player',
        attack: { stackId: 'stack', name: 'Burning Darkness' },
      }).ok
    ).toBe(true);
    for (const name of ['', '  ', 'Two\nlines', 'x'.repeat(65)]) {
      expect(
        parseCommand({
          type: 'SetAbilityUsed',
          stackId: 'stack',
          used: true,
          ability: name,
        }).ok
      ).toBe(false);
      expect(
        parseCommand({
          type: 'DeclareAttack',
          targetPlayerId: 'player',
          attack: { stackId: 'stack', name },
        }).ok
      ).toBe(false);
    }
  });
});
