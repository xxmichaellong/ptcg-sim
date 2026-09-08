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

  it('pins move-to-deck-top ingress, source coordinates, and index-zero ordering', () => {
    const deckActions = readRepositoryFile(
      'client/src/actions/zones/deck-actions.js'
    );
    const generalButtons = readRepositoryFile(
      'client/src/initialization/document-event-listeners/card-context-menu/general-buttons.js'
    );
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );
    const drag = readRepositoryFile('client/src/setup/image-logic/drag.js');
    const clicks = readRepositoryFile(
      'client/src/setup/image-logic/click-events.js'
    );
    const moveCard = readRepositoryFile(
      'client/src/actions/move-card-bundle/move-card.js'
    );
    const getZone = readRepositoryFile('client/src/setup/zones/get-zone.js');

    expect(generalButtons).toContain(
      'moveToDeckTop(\n      mouseClick.cardUser,\n      systemState.initiator,\n      mouseClick.zoneId,\n      mouseClick.cardIndex\n    )'
    );
    expect(keybinds).toContain(
      'moveToDeckTop(\n          mouseClick.cardUser,\n          systemState.initiator,\n          mouseClick.zoneId,\n          mouseClick.cardIndex\n        )'
    );
    expect(drag).toContain("if (dZoneId === 'deckCover')");
    expect(drag).toContain(
      'moveToDeckTop(\n          mouseClick.cardUser,\n          systemState.initiator,\n          mouseClick.zoneId,\n          mouseClick.cardIndex\n        )'
    );
    expect(deckActions).toContain(
      "moveCardBundle(user, initiator, oZoneId, 'deck', index, false, 'top', false)"
    );
    expect(deckActions).toContain(
      "const selectedDeckCount = getZone(user, 'deck').getCount();"
    );
    expect(deckActions).toContain(
      "moveCard(user, initiator, 'deck', 'deck', 0)"
    );
    expect(deckActions).toContain(
      "processAction(user, emit, 'moveToDeckTop', [oInitiator, oZoneId, index])"
    );
    expect(
      deckActions.indexOf(
        "moveCardBundle(user, initiator, oZoneId, 'deck', index, false, 'top', false)"
      )
    ).toBeLessThan(
      deckActions.lastIndexOf(
        "processAction(user, emit, 'moveToDeckTop', [oInitiator, oZoneId, index])"
      )
    );

    expect(clicks).toContain("if (mouseClick.zoneId === 'deckCover')");
    expect(clicks).toContain('mouseClick.cardIndex = 0;');
    expect(clicks).toContain(
      "['lostZoneCover', 'discardCover'].includes(mouseClick.zoneId)"
    );
    expect(clicks).toContain(
      'getZone(mouseClick.cardUser, mouseClick.zoneId).getCount() - 1'
    );
    expect(moveCard).toContain("oZoneId = oZoneId.replace('Cover', '');");
    for (const zone of [
      'deck',
      'lostZone',
      'discard',
      'prizes',
      'active',
      'bench',
      'hand',
      'attachedCards',
      'viewCards',
      'board',
    ]) {
      expect(getZone).toContain(`${zone}: [],`);
    }
    expect(getZone).toContain(
      'const neutralZoneArrays = {\n  stadium: [],\n};'
    );
  });

  it('pins shuffle-into-deck ingress, tail move, and post-move permutation', () => {
    const deckActions = readRepositoryFile(
      'client/src/actions/zones/deck-actions.js'
    );
    const generalButtons = readRepositoryFile(
      'client/src/initialization/document-event-listeners/card-context-menu/general-buttons.js'
    );
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );

    const contextCall =
      'shuffleIntoDeck(\n      mouseClick.cardUser,\n      systemState.initiator,\n      mouseClick.zoneId,\n      mouseClick.cardIndex\n    )';
    const keyCall =
      'shuffleIntoDeck(\n          mouseClick.cardUser,\n          systemState.initiator,\n          mouseClick.zoneId,\n          mouseClick.cardIndex\n        )';
    const tailMove =
      "moveCardBundle(\n    user,\n    initiator,\n    zoneId,\n    'deck',\n    index,\n    false,\n    'shuffle',\n    false\n  )";
    const generatedOrder =
      'indices = indices ? indices : shuffleIndices(deck.getCount())';
    const appliedOrder =
      "shuffleZone(user, initiator, 'deck', indices, false, false)";
    const exportedTuple =
      "processAction(user, emit, 'shuffleIntoDeck', [\n    oInitiator,\n    zoneId,\n    index,\n    indices,\n  ])";

    expect(generalButtons).toContain(contextCall);
    expect(keybinds).toContain(keyCall);
    expect(deckActions).toContain(tailMove);
    expect(deckActions).toContain(generatedOrder);
    expect(deckActions).toContain(appliedOrder);
    expect(deckActions).toContain(exportedTuple);
    expect(deckActions.indexOf(tailMove)).toBeLessThan(
      deckActions.indexOf(generatedOrder)
    );
    expect(deckActions.indexOf(generatedOrder)).toBeLessThan(
      deckActions.indexOf(appliedOrder)
    );
    expect(deckActions.indexOf(appliedOrder)).toBeLessThan(
      deckActions.lastIndexOf(exportedTuple)
    );
  });

  it('pins switch-with-deck-top ingress, source tail return, and empty-deck branch', () => {
    const deckActions = readRepositoryFile(
      'client/src/actions/zones/deck-actions.js'
    );
    const generalButtons = readRepositoryFile(
      'client/src/initialization/document-event-listeners/card-context-menu/general-buttons.js'
    );
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );

    expect(generalButtons).toContain(
      'switchWithDeckTop(\n      mouseClick.cardUser,\n      systemState.initiator,\n      mouseClick.zoneId,\n      mouseClick.cardIndex\n    )'
    );
    expect(keybinds).toContain(
      "} else if (event.key === 'ArrowRight' || event.code === 'ArrowRight') {"
    );
    expect(keybinds).toContain(
      'switchWithDeckTop(\n          mouseClick.cardUser,\n          systemState.initiator,\n          mouseClick.zoneId,\n          mouseClick.cardIndex\n        )'
    );

    const implementation = deckActions.slice(
      deckActions.indexOf('export const switchWithDeckTop =')
    );
    const sourceGuard = "if (oZoneId !== 'deck' && oZoneId !== 'deckCover') {";
    const tailMove =
      "moveCardBundle(\n      user,\n      initiator,\n      oZoneId,\n      'deck',\n      index,\n      false,\n      'switch',\n      false\n    )";
    const deckCount =
      "const initialDeckCount = getZone(user, 'deck').getCount();";
    const rotateTop = "moveCard(user, initiator, 'deck', 'deck', 0);";
    const returnGuard = 'if (selectedDeckCount > 1) {';
    const returnToSourceTail = "moveCard(user, initiator, 'deck', oZoneId, 1);";
    const exportedTuple =
      "processAction(user, emit, 'switchWithDeckTop', [\n      oInitiator,\n      oZoneId,\n      index,\n    ])";

    for (const fragment of [
      sourceGuard,
      tailMove,
      deckCount,
      rotateTop,
      returnGuard,
      returnToSourceTail,
      exportedTuple,
    ]) {
      expect(implementation).toContain(fragment);
    }
    expect(implementation.indexOf(sourceGuard)).toBeLessThan(
      implementation.indexOf(tailMove)
    );
    expect(implementation.indexOf(tailMove)).toBeLessThan(
      implementation.indexOf(deckCount)
    );
    expect(implementation.indexOf(deckCount)).toBeLessThan(
      implementation.indexOf(rotateTop)
    );
    expect(implementation.indexOf(rotateTop)).toBeLessThan(
      implementation.indexOf(returnGuard)
    );
    expect(implementation.indexOf(returnGuard)).toBeLessThan(
      implementation.indexOf(returnToSourceTail)
    );
    expect(implementation.indexOf(returnToSourceTail)).toBeLessThan(
      implementation.lastIndexOf(exportedTuple)
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

  it('pins shuffled-prizes-to-deck-bottom ingress, permutation, and empty guard', () => {
    const prizesActions = readRepositoryFile(
      'client/src/actions/zones/prizes-actions.js'
    );
    const prizesButtons = readRepositoryFile(
      'client/src/initialization/document-event-listeners/card-context-menu/prizes-buttons.js'
    );

    expect(prizesButtons).toContain(
      'shufflePrizesToDeckBottom(mouseClick.cardUser, systemState.initiator)'
    );

    const implementation = prizesActions.slice(
      prizesActions.indexOf('export const shufflePrizesToDeckBottom =')
    );
    const remoteRelay =
      "if (user === 'opp' && emit && systemState.isTwoPlayer) {";
    const relayTuple =
      "processAction(user, emit, 'shufflePrizesToDeckBottom', [\n      oInitiator,\n      indices,\n    ])";
    const prizeCount = "const prizeCount = getZone(user, 'prizes').getCount();";
    const emptyGuard = 'if (prizeCount === 0) return;';
    const generatedOrder =
      'indices = indices ? indices : shuffleIndices(prizeCount);';
    const appliedOrder =
      "shuffleZone(user, initiator, 'prizes', indices, false, false);";
    const appendLoop =
      "for (let i = 0; i < prizeCount; i++) {\n    moveCard(user, initiator, 'prizes', 'deck', 0);\n  }";
    const exportedTuple =
      "processAction(user, emit, 'shufflePrizesToDeckBottom', [oInitiator, indices]);";

    for (const fragment of [
      remoteRelay,
      relayTuple,
      prizeCount,
      emptyGuard,
      generatedOrder,
      appliedOrder,
      appendLoop,
      exportedTuple,
    ]) {
      expect(implementation).toContain(fragment);
    }
    expect(implementation.indexOf(remoteRelay)).toBeLessThan(
      implementation.indexOf(relayTuple)
    );
    expect(implementation.indexOf(relayTuple)).toBeLessThan(
      implementation.indexOf(prizeCount)
    );
    expect(implementation.indexOf(prizeCount)).toBeLessThan(
      implementation.indexOf(emptyGuard)
    );
    expect(implementation.indexOf(emptyGuard)).toBeLessThan(
      implementation.indexOf(generatedOrder)
    );
    expect(implementation.indexOf(generatedOrder)).toBeLessThan(
      implementation.indexOf(appliedOrder)
    );
    expect(implementation.indexOf(appliedOrder)).toBeLessThan(
      implementation.indexOf(appendLoop)
    );
    expect(implementation.indexOf(appendLoop)).toBeLessThan(
      implementation.lastIndexOf(exportedTuple)
    );
  });

  it('pins discard-and-draw ingress, clamped count, ordered moves, and export', () => {
    const handActions = readRepositoryFile(
      'client/src/actions/zones/hand-actions.js'
    );
    const handButtons = readRepositoryFile(
      'client/src/initialization/document-event-listeners/card-context-menu/hand-buttons.js'
    );
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );

    expect(handButtons).toContain(
      'discardAndDraw(mouseClick.cardUser, systemState.initiator)'
    );
    expect(keybinds).toContain(
      "(event.key === 'd' || event.code === 'KeyD') &&\n      isAltKeyPressed(event)"
    );
    expect(keybinds).toContain(
      'discardAndDraw(systemState.initiator, systemState.initiator)'
    );

    const implementation = handActions.slice(
      handActions.indexOf('export const discardAndDraw ='),
      handActions.indexOf('export const shuffleAndDraw =')
    );
    const promptedCount =
      "parseInt(window.prompt('Draw how many cards?', '0'))";
    const sourceDeckCount =
      "const selectedDeckCount = getZone(user, 'deck').getCount();";
    const sourceHandCount =
      "const discardAmount = getZone(user, 'hand').getCount();";
    const clampedCount =
      'drawAmount = Math.min(drawAmount, selectedDeckCount);';
    const remoteRelay =
      "if (user === 'opp' && emit && systemState.isTwoPlayer) {";
    const relayTuple =
      "processAction(user, emit, 'discardAndDraw', [oInitiator, drawAmount]);";
    const validGuard = 'if (!isNaN(drawAmount) && drawAmount >= 0) {';
    const discardLoop =
      "for (let i = 0; i < discardAmount; i++) {\n      moveCard(user, initiator, 'hand', 'discard', 0);\n    }";
    const drawLoop =
      "for (let i = 0; i < drawAmount; i++) {\n      moveCard(user, initiator, 'deck', 'hand', 0);\n    }";
    const positiveMessage = 'if (drawAmount > 0) {';
    const zeroMessage =
      "message = determineUsername(initiator) + ' discarded hand';";
    const invalidExportGuard = 'emit = false;';

    for (const fragment of [
      promptedCount,
      sourceDeckCount,
      sourceHandCount,
      clampedCount,
      remoteRelay,
      relayTuple,
      validGuard,
      discardLoop,
      drawLoop,
      positiveMessage,
      zeroMessage,
      invalidExportGuard,
    ]) {
      expect(implementation).toContain(fragment);
    }
    expect(implementation.indexOf(promptedCount)).toBeLessThan(
      implementation.indexOf(sourceDeckCount)
    );
    expect(implementation.indexOf(sourceDeckCount)).toBeLessThan(
      implementation.indexOf(sourceHandCount)
    );
    expect(implementation.indexOf(sourceHandCount)).toBeLessThan(
      implementation.indexOf(clampedCount)
    );
    expect(implementation.indexOf(clampedCount)).toBeLessThan(
      implementation.indexOf(remoteRelay)
    );
    expect(implementation.indexOf(remoteRelay)).toBeLessThan(
      implementation.indexOf(relayTuple)
    );
    expect(implementation.indexOf(relayTuple)).toBeLessThan(
      implementation.indexOf(validGuard)
    );
    expect(implementation.indexOf(validGuard)).toBeLessThan(
      implementation.indexOf(discardLoop)
    );
    expect(implementation.indexOf(discardLoop)).toBeLessThan(
      implementation.indexOf(drawLoop)
    );
    expect(implementation.indexOf(drawLoop)).toBeLessThan(
      implementation.lastIndexOf(relayTuple)
    );
  });

  it('pins shuffle-and-draw ingress, combined basis, resolved order, and export', () => {
    const handActions = readRepositoryFile(
      'client/src/actions/zones/hand-actions.js'
    );
    const handButtons = readRepositoryFile(
      'client/src/initialization/document-event-listeners/card-context-menu/hand-buttons.js'
    );
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );

    expect(handButtons).toContain(
      'shuffleAndDraw(mouseClick.cardUser, systemState.initiator)'
    );
    expect(keybinds).toContain(
      "(event.key === 's' || event.code === 'KeyS') &&\n      isAltKeyPressed(event)"
    );
    expect(keybinds).toContain(
      'shuffleAndDraw(systemState.initiator, systemState.initiator)'
    );

    const implementation = handActions.slice(
      handActions.indexOf('export const shuffleAndDraw ='),
      handActions.indexOf('export const shuffleBottomAndDraw =')
    );
    const promptedCount =
      "parseInt(window.prompt('Draw how many cards?', '0'))";
    const sourceDeckCount =
      "const selectedDeckCount = getZone(user, 'deck').getCount();";
    const sourceHandCount =
      "const shuffleAmount = getZone(user, 'hand').getCount();";
    const combinedClamp =
      'drawAmount = Math.min(drawAmount, selectedDeckCount + shuffleAmount);';
    const remoteRelay =
      "if (user === 'opp' && emit && systemState.isTwoPlayer) {";
    const relayTuple =
      "processAction(user, emit, 'shuffleAndDraw', [\n      oInitiator,\n      drawAmount,\n      indices,\n    ])";
    const exportedTuple =
      "processAction(user, emit, 'shuffleAndDraw', [\n    oInitiator,\n    drawAmount,\n    indices,\n  ])";
    const validGuard = 'if (!isNaN(drawAmount) && drawAmount >= 0) {';
    const handToDeckLoop =
      "for (let i = 0; i < shuffleAmount; i++) {\n      moveCard(user, initiator, 'hand', 'deck', 0);\n    }";
    const combinedCount =
      "const newDeckCount = getZone(user, 'deck').getCount();";
    const resolvedOrder =
      'indices = indices ? indices : shuffleIndices(newDeckCount);';
    const appliedOrder =
      "shuffleZone(user, initiator, 'deck', indices, false, false);";
    const drawLoop =
      "for (let i = 0; i < drawAmount; i++) {\n      moveCard(user, initiator, 'deck', 'hand', 0);\n    }";
    const zeroMessage =
      "message = determineUsername(initiator) + ' shuffled hand into deck';";
    const invalidExportGuard = 'emit = false;';

    for (const fragment of [
      promptedCount,
      sourceDeckCount,
      sourceHandCount,
      combinedClamp,
      remoteRelay,
      relayTuple,
      exportedTuple,
      validGuard,
      handToDeckLoop,
      combinedCount,
      resolvedOrder,
      appliedOrder,
      drawLoop,
      zeroMessage,
      invalidExportGuard,
    ]) {
      expect(implementation).toContain(fragment);
    }
    expect(implementation.indexOf(sourceDeckCount)).toBeLessThan(
      implementation.indexOf(sourceHandCount)
    );
    expect(implementation.indexOf(sourceHandCount)).toBeLessThan(
      implementation.indexOf(combinedClamp)
    );
    expect(implementation.indexOf(combinedClamp)).toBeLessThan(
      implementation.indexOf(remoteRelay)
    );
    expect(implementation.indexOf(remoteRelay)).toBeLessThan(
      implementation.indexOf(relayTuple)
    );
    expect(implementation.indexOf(relayTuple)).toBeLessThan(
      implementation.indexOf(validGuard)
    );
    expect(implementation.indexOf(validGuard)).toBeLessThan(
      implementation.indexOf(handToDeckLoop)
    );
    expect(implementation.indexOf(handToDeckLoop)).toBeLessThan(
      implementation.indexOf(combinedCount)
    );
    expect(implementation.indexOf(combinedCount)).toBeLessThan(
      implementation.indexOf(resolvedOrder)
    );
    expect(implementation.indexOf(resolvedOrder)).toBeLessThan(
      implementation.indexOf(appliedOrder)
    );
    expect(implementation.indexOf(appliedOrder)).toBeLessThan(
      implementation.indexOf(drawLoop)
    );
    expect(implementation.indexOf(drawLoop)).toBeLessThan(
      implementation.indexOf(exportedTuple)
    );
  });

  it('pins shuffle-bottom-and-draw ingress, hand-only basis, append order, and export', () => {
    const handActions = readRepositoryFile(
      'client/src/actions/zones/hand-actions.js'
    );
    const handButtons = readRepositoryFile(
      'client/src/initialization/document-event-listeners/card-context-menu/hand-buttons.js'
    );
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );

    expect(handButtons).toContain(
      'shuffleBottomAndDraw(mouseClick.cardUser, systemState.initiator)'
    );
    expect(keybinds).toContain(
      "(event.key === 'ArrowDown' || event.code === 'ArrowDown') &&\n      isAltKeyPressed(event)"
    );
    expect(keybinds).toContain(
      'shuffleBottomAndDraw(systemState.initiator, systemState.initiator)'
    );

    const implementation = handActions.slice(
      handActions.indexOf('export const shuffleBottomAndDraw =')
    );
    const promptedCount =
      "parseInt(window.prompt('Draw how many cards?', '0'))";
    const sourceDeckCount =
      "const selectedDeckCount = getZone(user, 'deck').getCount();";
    const sourceHandCount =
      "const shuffleAmount = getZone(user, 'hand').getCount();";
    const combinedClamp =
      'drawAmount = Math.min(drawAmount, selectedDeckCount + shuffleAmount);';
    const remoteRelay =
      "if (user === 'opp' && emit && systemState.isTwoPlayer) {";
    const relayTuple =
      "processAction(user, emit, 'shuffleBottomAndDraw', [\n      oInitiator,\n      drawAmount,\n      indices,\n    ])";
    const exportedTuple =
      "processAction(user, emit, 'shuffleBottomAndDraw', [\n    oInitiator,\n    drawAmount,\n    indices,\n  ])";
    const validGuard = 'if (!isNaN(drawAmount) && drawAmount >= 0) {';
    const resolvedHandOrder =
      'indices = indices ? indices : shuffleIndices(shuffleAmount);';
    const appliedHandOrder =
      "shuffleZone(user, initiator, 'hand', indices, false, false);";
    const appendHandLoop =
      "for (let i = 0; i < shuffleAmount; i++) {\n      moveCard(user, initiator, 'hand', 'deck', 0);\n    }";
    const drawLoop =
      "for (let i = 0; i < drawAmount; i++) {\n      moveCard(user, initiator, 'deck', 'hand', 0);\n    }";
    const zeroMessage =
      "determineUsername(initiator) + ' shuffled hand to bottom of deck'";
    const invalidExportGuard = 'emit = false;';

    for (const fragment of [
      promptedCount,
      sourceDeckCount,
      sourceHandCount,
      combinedClamp,
      remoteRelay,
      relayTuple,
      exportedTuple,
      validGuard,
      resolvedHandOrder,
      appliedHandOrder,
      appendHandLoop,
      drawLoop,
      zeroMessage,
      invalidExportGuard,
    ]) {
      expect(implementation).toContain(fragment);
    }
    expect(implementation.indexOf(sourceDeckCount)).toBeLessThan(
      implementation.indexOf(sourceHandCount)
    );
    expect(implementation.indexOf(sourceHandCount)).toBeLessThan(
      implementation.indexOf(combinedClamp)
    );
    expect(implementation.indexOf(combinedClamp)).toBeLessThan(
      implementation.indexOf(remoteRelay)
    );
    expect(implementation.indexOf(remoteRelay)).toBeLessThan(
      implementation.indexOf(relayTuple)
    );
    expect(implementation.indexOf(relayTuple)).toBeLessThan(
      implementation.indexOf(validGuard)
    );
    expect(implementation.indexOf(validGuard)).toBeLessThan(
      implementation.indexOf(resolvedHandOrder)
    );
    expect(implementation.indexOf(resolvedHandOrder)).toBeLessThan(
      implementation.indexOf(appliedHandOrder)
    );
    expect(implementation.indexOf(appliedHandOrder)).toBeLessThan(
      implementation.indexOf(appendHandLoop)
    );
    expect(implementation.indexOf(appendHandLoop)).toBeLessThan(
      implementation.indexOf(drawLoop)
    );
    expect(implementation.indexOf(drawLoop)).toBeLessThan(
      implementation.indexOf(exportedTuple)
    );
  });

  it('pins move-to-deck-bottom as the bottom-mode move-card-bundle tuple', () => {
    const deckActions = readRepositoryFile(
      'client/src/actions/zones/deck-actions.js'
    );
    const moveBundle = readRepositoryFile(
      'client/src/actions/move-card-bundle/move-card-bundle.js'
    );
    const generalButtons = readRepositoryFile(
      'client/src/initialization/document-event-listeners/card-context-menu/general-buttons.js'
    );
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );

    expect(generalButtons).toContain(
      'moveToDeckBottom(\n      mouseClick.cardUser,\n      systemState.initiator,\n      mouseClick.zoneId,\n      mouseClick.cardIndex\n    )'
    );
    expect(keybinds).toContain(
      "event.key === 'ArrowDown' || event.code === 'ArrowDown'"
    );
    expect(keybinds).toContain(
      'moveToDeckBottom(\n          mouseClick.cardUser,\n          systemState.initiator,\n          mouseClick.zoneId,\n          mouseClick.cardIndex\n        )'
    );

    const wrapper = deckActions.slice(
      deckActions.indexOf('export const moveToDeckBottom ='),
      deckActions.indexOf('export const moveToBoard =')
    );
    expect(wrapper).toContain(
      "moveCardBundle(user, initiator, oZoneId, 'deck', index, false, 'bottom')"
    );
    expect(wrapper).not.toContain(
      "processAction(user, emit, 'moveToDeckBottom'"
    );

    const exportedTuple =
      "processAction(user, emit, 'moveCardBundle', [\n    oInitiator,\n    oZoneId,\n    dZoneId,\n    index,\n    targetIndex,\n    action,\n  ])";
    expect(moveBundle).toContain(exportedTuple);
    expect(moveBundle).toContain(
      "processAction(user, emit, 'moveCardBundle', [\n      oInitiator,\n      oZoneId,\n      dZoneId,\n      index,\n      targetIndex,\n      action,\n    ])"
    );
  });

  it('pins target-free loose-zone move bundles, cover normalization, and append order', () => {
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );
    const deckActions = readRepositoryFile(
      'client/src/actions/zones/deck-actions.js'
    );
    const drag = readRepositoryFile('client/src/setup/image-logic/drag.js');
    const moveCard = readRepositoryFile(
      'client/src/actions/move-card-bundle/move-card.js'
    );
    const exporter = readRepositoryFile(
      'client/src/initialization/document-event-listeners/sidebox/p1/bottom-buttons.js'
    );

    for (const binding of [
      "h: 'hand'",
      "d: 'discard'",
      "l: 'lostZone'",
      "p: 'prizes'",
      "' ': 'board'",
    ]) {
      expect(keybinds).toContain(binding);
    }
    expect(keybinds).toContain(
      "moveCardBundle(\n          mouseClick.cardUser,\n          systemState.initiator,\n          mouseClick.zoneId,\n          dZoneId,\n          mouseClick.cardIndex,\n          false,\n          'move'\n        )"
    );
    expect(deckActions).toContain(
      "moveCardBundle(user, initiator, oZoneId, 'board', index, false, 'move')"
    );

    expect(drag).toContain('let targetIndex;');
    expect(drag).toContain(
      "['active', 'bench'].includes(event.target.parentElement.parentElement.id)"
    );
    expect(drag).toContain(
      "moveCardBundle(\n          mouseClick.cardUser,\n          systemState.initiator,\n          mouseClick.zoneId,\n          dZoneId,\n          mouseClick.cardIndex,\n          targetIndex,\n          'move'\n        )"
    );
    expect(exporter).toContain(
      'const jsonData = JSON.stringify(exportData, null, 2);'
    );
    expect(JSON.parse(JSON.stringify([undefined]))).toEqual([null]);

    const originNormalization = "oZoneId = oZoneId.replace('Cover', '');";
    const destinationNormalization = "dZoneId = dZoneId.replace('Cover', '');";
    const appendMove = 'dZone.array.push(...oZone.array.splice(index, 1));';
    expect(moveCard).toContain(originNormalization);
    expect(moveCard).toContain(destinationNormalization);
    expect(moveCard).toContain(appendMove);
    expect(moveCard.indexOf(originNormalization)).toBeLessThan(
      moveCard.indexOf(appendMove)
    );
    expect(moveCard.indexOf(destinationNormalization)).toBeLessThan(
      moveCard.indexOf(appendMove)
    );
    expect(moveCard).toContain("['prizes'].includes(dZoneId)");
    expect(moveCard).toContain("['hand'].includes(dZoneId)");
    expect(moveCard).toContain('if (dZoneId !== oZoneId) {');
    expect(moveCard).toContain('movingCard.image.public = false;');
    expect(moveCard).toContain(
      "if (['deck', 'lostZone', 'discard', 'hand'].includes(dZoneId))"
    );
  });

  it('pins stadium bundle ingress, incumbent-owner displacement, and outer export order', () => {
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );
    const moveBundle = readRepositoryFile(
      'client/src/actions/move-card-bundle/move-card-bundle.js'
    );
    const moveCard = readRepositoryFile(
      'client/src/actions/move-card-bundle/move-card.js'
    );
    const updateStadium = readRepositoryFile(
      'client/src/actions/move-card-bundle/update-stadium-card.js'
    );

    expect(keybinds).toContain("g: 'stadium'");
    expect(keybinds).toContain("KeyG: 'stadium'");
    expect(keybinds).toContain(
      "moveCardBundle(\n          mouseClick.cardUser,\n          systemState.initiator,\n          mouseClick.zoneId,\n          dZoneId,\n          mouseClick.cardIndex,\n          false,\n          'move'\n        )"
    );

    expect(moveCard).toContain(
      'updateStadiumCard(user, initiator, dZoneId, dZone);'
    );
    expect(updateStadium).toContain(
      "if (['stadium'].includes(dZoneId) && dZone.array[1])"
    );
    expect(updateStadium).toContain(
      "if (dZone.array[0].image.user === 'self')"
    );
    expect(updateStadium).toContain(
      "moveCard('self', initiator, 'stadium', 'discard', 0)"
    );
    expect(updateStadium).toContain(
      "moveCard('opp', initiator, 'stadium', 'discard', 0)"
    );

    const localMove =
      'moveCard(user, initiator, oZoneId, dZoneId, index, targetIndex);';
    const refresh = 'refreshBoard();';
    const exportedTuple =
      "processAction(user, emit, 'moveCardBundle', [\n    oInitiator,\n    oZoneId,\n    dZoneId,\n    index,\n    targetIndex,\n    action,\n  ])";
    expect(moveBundle.indexOf(localMove)).toBeLessThan(
      moveBundle.indexOf(refresh)
    );
    expect(moveBundle.indexOf(refresh)).toBeLessThan(
      moveBundle.indexOf(exportedTuple)
    );
  });

  it('pins target-free play placement and no-target whole-stack movement', () => {
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );
    const moveCard = readRepositoryFile(
      'client/src/actions/move-card-bundle/move-card.js'
    );
    const initializePlayCard = readRepositoryFile(
      'client/src/actions/move-card-bundle/initialize-active-bench-card.js'
    );
    const autoMove = readRepositoryFile(
      'client/src/actions/move-card-bundle/auto-move-active-bench-card.js'
    );
    const relocate = readRepositoryFile(
      'client/src/actions/move-card-bundle/relocate-attached-cards.js'
    );

    for (const binding of [
      "b: 'bench'",
      "KeyB: 'bench'",
      "a: 'active'",
      "KeyA: 'active'",
    ]) {
      expect(keybinds).toContain(binding);
    }
    expect(keybinds).toContain(
      "moveCardBundle(\n          mouseClick.cardUser,\n          systemState.initiator,\n          mouseClick.zoneId,\n          dZoneId,\n          mouseClick.cardIndex,\n          false,\n          'move'\n        )"
    );

    const appendMove = 'dZone.array.push(...oZone.array.splice(index, 1));';
    const initialize =
      'initializeActiveBenchCard(user, movingCard, dZoneId, dZone);';
    const autoMoveCall =
      'autoMoveActiveBenchCard(\n      user,\n      initiator,\n      movingCard,\n      targetCard,\n      oZoneId,\n      oZone,\n      dZoneId,\n      dZone,\n      targetIndex\n    );';
    expect(moveCard).toContain(initialize);
    expect(moveCard).toContain(autoMoveCall);
    expect(moveCard.indexOf(appendMove)).toBeLessThan(
      moveCard.indexOf(initialize)
    );
    expect(moveCard.indexOf(initialize)).toBeLessThan(
      moveCard.indexOf(autoMoveCall)
    );

    expect(initializePlayCard).toContain("movingCard.type = 'Pokémon'");
    expect(initializePlayCard).toContain(
      "container.className = 'play-container'"
    );
    expect(autoMove).toContain(
      "['active'].includes(dZoneId) &&\n    dZone.array[1]"
    );
    const activeDemotionMessage =
      "moveCardMessage(user, initiator, 'active', 'bench', 0, false, 'move')";
    const activeDemotion =
      "moveCard(user, initiator, 'active', 'bench', 0, false)";
    expect(autoMove).toContain(activeDemotionMessage);
    expect(autoMove).toContain(activeDemotion);
    expect(autoMove.indexOf(activeDemotionMessage)).toBeLessThan(
      autoMove.indexOf(activeDemotion)
    );
    expect(autoMove).toContain(
      "['bench'].includes(dZoneId) &&\n    ['active'].includes(oZoneId) &&\n    dZone.array.filter((card) => !card.image.attached).length === 2"
    );
    expect(autoMove).toContain(
      "moveCard(user, initiator, 'bench', 'active', 0, false)"
    );
    expect(moveCard).toContain(
      'zonesWithAttachedCards.includes(oZoneId) && !movingCard.image.attached'
    );
    expect(relocate).toContain('if (image.relative === movingCard.image)');
    expect(relocate).toContain("if (['active', 'bench'].includes(dZoneId))");
    expect(relocate).toContain(
      'moveCard(user, initiator, oZoneId, dZoneId, i, targetIndex)'
    );
  });

  it('pins numeric play targets, top-only eligibility, and refreshed flat ordering', () => {
    const keybinds = readRepositoryFile(
      'client/src/actions/keybinds/keybinds.js'
    );
    const clicks = readRepositoryFile(
      'client/src/setup/image-logic/click-events.js'
    );
    const drag = readRepositoryFile('client/src/setup/image-logic/drag.js');
    const moveCard = readRepositoryFile(
      'client/src/actions/move-card-bundle/move-card.js'
    );
    const autoMove = readRepositoryFile(
      'client/src/actions/move-card-bundle/auto-move-active-bench-card.js'
    );
    const attach = readRepositoryFile(
      'client/src/actions/move-card-bundle/attach-card.js'
    );
    const evolve = readRepositoryFile(
      'client/src/actions/move-card-bundle/evolve-card.js'
    );
    const refresh = readRepositoryFile(
      'client/src/setup/sizing/refresh-board.js'
    );

    expect(keybinds).toContain(
      "(!['active', 'bench'].includes(mouseClick.zoneId) ||\n        mouseClick.card.image.attached)"
    );
    expect(keybinds).toContain(
      'getZone(mouseClick.cardUser, zoneId).array.forEach((card) => {\n          if (!card.image.attached)'
    );
    expect(clicks).toContain(
      'const targetIndex = getZone(event.target.user, dZoneId).array.findIndex('
    );
    expect(clicks).toContain(
      "mouseClick.cardIndex,\n      targetIndex,\n      'move'"
    );
    expect(drag).toContain(
      '(mouseClick.zoneId !== dZoneId || draggedImage.attached)'
    );

    expect(moveCard).toContain(
      "if (typeof targetIndex === 'number') {\n    targetCard = dZone.array[targetIndex];"
    );
    expect(moveCard).toContain(
      'targetCard &&\n    activeOrBenchZone.includes(dZoneId) &&\n    !targetCard.image.attached'
    );
    expect(moveCard).toContain(
      '!activeOrBenchZone.includes(oZoneId) || movingCard.image.attached'
    );
    expect(moveCard).toContain(
      "movingCard.type === 'Pokémon' && !activeOrBenchZone.includes(oZoneId)"
    );
    expect(autoMove).toContain('//case 3: yes target, switch spots');
    expect(autoMove).toContain(
      '!movingCard.image.attached && //we are not attaching a card\n    !dZone.array[targetIndex].image.attached'
    );
    expect(autoMove).toContain(
      'moveCard(user, initiator, dZoneId, oZoneId, targetIndex, false);'
    );
    expect(evolve).toContain('targetCard.image.after(movingCard.image);');
    expect(evolve).toContain('targetCard.image.relative = movingCard.image;');
    expect(attach).toContain('targetCard.image.after(movingCard.image);');

    expect(refresh).toContain(
      "const playContainers = zone.element.querySelectorAll('DIV');"
    );
    expect(refresh).toContain(
      "const images = playContainer.querySelectorAll('img');"
    );
    expect(refresh).toContain('if (!image.attached) {');
    expect(refresh).toContain('moveCard(user, user, zoneId, zoneId, index);');
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
