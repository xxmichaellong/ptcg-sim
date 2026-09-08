import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  throw new Error(`unterminated object: ${declaration}`);
};

const propertyKeys = (body: string): string[] =>
  [...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1]!);

describe('legacy action-export source envelope', () => {
  it('pins the current declared version and exact exported record fields', () => {
    const globals = readRepositoryFile(
      'client/src/initialization/global-variables/global-variables.js'
    );
    const exporter = readRepositoryFile(
      'client/src/initialization/document-event-listeners/sidebox/p1/bottom-buttons.js'
    );

    expect(globals).toContain("export const version = '1.5.1';");
    expect(
      propertyKeys(extractObjectBody(exporter, 'const selfData ='))
    ).toEqual(['user', 'emit', 'action', 'parameters']);
    expect(
      propertyKeys(extractObjectBody(exporter, 'const oppData ='))
    ).toEqual(['user', 'emit', 'action', 'parameters']);
    expect(exporter).toContain("user: 'self'");
    expect(exporter).toContain("user: 'opp'");
    expect(exporter.match(/action: 'loadDeckData'/g)).toHaveLength(2);
    expect(exporter).toContain('const versionData = { version: version };');
    expect(exporter).toMatch(
      /const exportData = \[\s*versionData,\s*selfData,\s*oppData,\s*\.\.\.systemState\.exportActionData,\s*\];/
    );
  });

  it('pins the deck tuple and documents the current unsafe import ordering', () => {
    const exporter = readRepositoryFile(
      'client/src/initialization/document-event-listeners/sidebox/p1/bottom-buttons.js'
    );
    const deckConstructor = readRepositoryFile(
      'client/src/setup/deck-constructor/import.js'
    );
    const urlLoader = readRepositoryFile(
      'client/src/initialization/load-import-data/load-import-data.js'
    );

    expect(deckConstructor).toContain(
      'let cardData = [quantity, name, type, url];'
    );
    expect(exporter).toContain("socket.emit('initiateImport'");
    expect(exporter.indexOf("socket.emit('initiateImport'")).toBeLessThan(
      exporter.indexOf('const jsonData = JSON.parse(e.target.result);')
    );
    expect(exporter).toContain(
      "jsonData.filter((data) => !('version' in data))"
    );
    expect(urlLoader).toContain(
      "importData.filter((obj) => !('version' in obj))"
    );
    expect(urlLoader).toContain(
      'acceptAction(data.user, data.action, data.parameters, true)'
    );
  });

  it('pins the first lifecycle positional family and export perspective rewrite', () => {
    const reset = readRepositoryFile('client/src/actions/general/reset.js');
    const setup = readRepositoryFile('client/src/actions/general/setup.js');
    const takeTurn = readRepositoryFile(
      'client/src/actions/general/take-turn.js'
    );
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );
    const boardButtons = readRepositoryFile(
      'client/src/initialization/document-event-listeners/table/board-buttons.js'
    );
    const processAction = readRepositoryFile(
      'client/src/setup/general/process-action.js'
    );

    expect(reset).toContain(
      "processAction(user, emit, 'reset', [clean, build, invalidMessage])"
    );
    expect(reset).toContain('systemState.turn = 0;');
    expect(reset).toContain('if (build) {');
    expect(reset).toContain('buildDeck(user);');
    expect(setup).toContain('reset(user, true, true, true, false);');
    expect(setup).toContain("processAction(user, emit, 'setup', [indices])");
    expect(takeTurn).toContain("discardBoard(initiator, 'self', false, false)");
    expect(takeTurn).toContain("discardBoard(initiator, 'opp', false, false)");
    expect(takeTurn).toContain('resetAbilityCounters();');
    expect(takeTurn).toContain('systemState.turn++;');
    expect(takeTurn).toContain("moveCard(user, initiator, 'deck', 'hand', 0)");
    expect(takeTurn).toContain(
      "const oInitiator = initiator === 'self' ? 'opp' : 'self';"
    );
    expect(takeTurn).toContain(
      "processAction(user, emit, 'takeTurn', [oInitiator])"
    );
    expect(keybinds).toContain(
      'takeTurn(systemState.initiator, systemState.initiator)'
    );
    expect(boardButtons).toContain(
      'takeTurn(systemState.initiator, systemState.initiator)'
    );
    expect(processAction).toContain('const exportParameters = [...parameters]');
    expect(processAction).toContain("if (exportParameters[0] === 'self')");
    expect(processAction).toContain("exportParameters[0] = 'opp'");
    expect(processAction).toContain("exportParameters[0] = 'self'");
  });

  it('pins the first movement tuple, clamp, and independent target ownership', () => {
    const deckActions = readRepositoryFile(
      'client/src/actions/zones/deck-actions.js'
    );
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );
    const deckButtons = readRepositoryFile(
      'client/src/initialization/document-event-listeners/card-context-menu/deck-buttons.js'
    );
    const acceptAction = readRepositoryFile(
      'client/src/setup/general/accept-action.js'
    );

    expect(deckActions).toContain(
      'drawAmount = Math.min(drawAmount, selectedDeckCount);'
    );
    expect(deckActions).toContain('if (!isNaN(drawAmount) && drawAmount > 0)');
    expect(deckActions).toContain('emit = false;');
    expect(deckActions).toContain(
      "moveCard(user, initiator, 'deck', 'hand', 0)"
    );
    expect(deckActions).toContain(
      "processAction(user, emit, 'draw', [oInitiator, drawAmount])"
    );
    expect(keybinds).toContain(
      'draw(\n        systemState.initiator,\n        systemState.initiator,'
    );
    expect(deckButtons).toContain(
      'draw(mouseClick.cardUser, systemState.initiator)'
    );
    expect(acceptAction).toContain(
      'actionToFunction(action)(user, ...parameters, emit)'
    );
    expect(
      deckActions.indexOf(
        'drawAmount = Math.min(drawAmount, selectedDeckCount);'
      )
    ).toBeLessThan(
      deckActions.indexOf('if (!isNaN(drawAmount) && drawAmount > 0)')
    );
    expect(
      deckActions.indexOf('if (!isNaN(drawAmount) && drawAmount > 0)')
    ).toBeLessThan(
      deckActions.lastIndexOf(
        "processAction(user, emit, 'draw', [oInitiator, drawAmount])"
      )
    );
  });

  it('pins direct prize shuffle and excludes internal helper shuffles', () => {
    const shuffleZone = readRepositoryFile(
      'client/src/actions/zones/shuffle-zone.js'
    );
    const prizesButtons = readRepositoryFile(
      'client/src/initialization/document-event-listeners/card-context-menu/prizes-buttons.js'
    );
    const setup = readRepositoryFile('client/src/actions/general/setup.js');
    const deckActions = readRepositoryFile(
      'client/src/actions/zones/deck-actions.js'
    );
    const handActions = readRepositoryFile(
      'client/src/actions/zones/hand-actions.js'
    );
    const prizesActions = readRepositoryFile(
      'client/src/actions/zones/prizes-actions.js'
    );
    const boardActions = readRepositoryFile(
      'client/src/actions/general/board-actions.js'
    );
    const generalZoneActions = readRepositoryFile(
      'client/src/actions/zones/general.js'
    );

    expect(shuffleZone).toContain(
      'indices = indices ? indices : shuffleIndices(zone.getCount())'
    );
    expect(shuffleZone).toContain('rearrangeArray(zone.array, indices)');
    expect(shuffleZone).toContain(
      "processAction(user, emit, 'shuffleZone', [\n    oInitiator,\n    zoneId,\n    indices,\n    message,\n  ])"
    );
    expect(prizesButtons).toContain(
      "shuffleZone(mouseClick.cardUser, systemState.initiator, 'prizes')"
    );
    expect(setup).toContain(
      "shuffleZone(user, user, 'deck', indices, false, false)"
    );
    expect(deckActions).toContain(
      "shuffleZone(user, initiator, 'deck', indices, false, false)"
    );
    expect(handActions).toContain(
      "shuffleZone(user, initiator, 'deck', indices, false, false)"
    );
    expect(handActions).toContain(
      "shuffleZone(user, initiator, 'hand', indices, false, false)"
    );
    expect(prizesActions).toContain(
      "shuffleZone(user, initiator, 'prizes', indices, false, false)"
    );
    expect(boardActions).toContain(
      "shuffleZone(user, initiator, 'deck', indices, false, false)"
    );
    expect(generalZoneActions).toContain(
      "shuffleZone(user, initiator, 'deck', indices, false, false)"
    );
    expect(generalZoneActions).toContain(
      'shuffleZone(user, initiator, zoneId, indices, false, false)'
    );
  });

  it('pins deck tuple materialization, selectable categories, and the unknown error marker', () => {
    const buildDeck = readRepositoryFile(
      'client/src/setup/deck-constructor/build-deck.js'
    );
    const importDeck = readRepositoryFile(
      'client/src/setup/deck-constructor/import.js'
    );

    expect(buildDeck).toContain(
      'for (const [quantity, name, type, imageURL] of deckData)'
    );
    expect(buildDeck).toContain('for (let i = 0; i < quantity; i++)');
    expect(buildDeck).toContain('new Card(user, name, type, imageURL)');
    for (const category of ['Pokémon', 'Trainer', 'Energy']) {
      expect(importDeck).toContain(
        `<option value="${category}">${category}</option>`
      );
    }
    expect(importDeck).toContain("type === 'Unknown'");
  });

  it('pins exported permutations and random indices as resolved outcomes', () => {
    const shuffle = readRepositoryFile('client/src/setup/general/shuffle.js');
    const setup = readRepositoryFile('client/src/actions/general/setup.js');
    const shuffleZone = readRepositoryFile(
      'client/src/actions/zones/shuffle-zone.js'
    );
    const revealAndHide = readRepositoryFile(
      'client/src/actions/general/reveal-and-hide.js'
    );

    expect(shuffle).toContain(
      'const rearrangedArray = indices.map((newIndex) => array[newIndex])'
    );
    expect(setup).toContain(
      'indices = indices ? indices : shuffleIndices(deck.getCount())'
    );
    expect(setup).toContain("processAction(user, emit, 'setup', [indices])");
    expect(shuffleZone).toContain("processAction(user, emit, 'shuffleZone', [");
    expect(shuffleZone).toContain('oInitiator,\n    zoneId,\n    indices,');
    expect(revealAndHide).toContain(
      "processAction(user, emit, 'playRandomCardFaceDown', ["
    );
    expect(revealAndHide).toContain('oInitiator,\n    randomIndex,');
  });
});
