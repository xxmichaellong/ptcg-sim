import type {
  SessionSocket,
  SessionSocketHandlers,
} from '@ptcgsim/client-session';
import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  type CommandContext,
  type GameCommand,
  type MatchViewState,
} from '@ptcgsim/game-core';
import {
  PROTOCOL_VERSION,
  serializeMatchViewState,
  type ClientMessage,
  type ServerMessage,
  type WireGameCommand,
} from '@ptcgsim/protocol';
import {
  DEFAULT_AUTHORITY_POLICY,
  emptyProjectionIdentityState,
  projectRecipient,
  resolveWireCommand,
} from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import { predictWireCommand } from '../board/predictWireCommand.js';
import { createProvisionalRebinder } from '../board/rebindProvisionalReferences.js';
import { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

const blue = asPlayerId('restore-blue');
const red = asPlayerId('restore-red');

const nativeFixture = (energyCount = 2, keepSpareEnergy = true) => {
  let next = 0;
  const context: CommandContext = {
    nextCardId: () => asCardInstanceId(`card-${++next}`),
    nextStackId: () => asStackId(`stack-${++next}`),
    nextInspectionId: () => asInspectionId(`inspection-${++next}`),
    nextWorkAreaId: () => asWorkAreaId(`area-${++next}`),
    shuffle: (cards) => [...cards],
    randomInt: () => 0,
  };
  let state = createEmptyMatch(asMatchId('restored-stack-native'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const run = (command: GameCommand) => {
    const result = executeCommand(state, command, context);
    if (!result.accepted) throw new Error(`${result.code}: ${result.message}`);
    state = result.state;
    return result;
  };
  run({
    type: 'LoadDeck',
    playerId: red,
    entries: [
      ['pokemon', 'Pokémon', 3],
      ['tool', 'Trainer', 1],
      ['energy', 'Energy', energyCount],
    ].map(([id, category, count]) => ({
      definition: {
        id: asCardDefinitionId(String(id)),
        name: String(id),
        category: category as 'Pokémon' | 'Trainer' | 'Energy',
        imageUrl: `/${id}.png`,
      },
      count: Number(count),
    })),
  });
  const ids = [...state.zones[playerZoneId(red, 'deck')]!.cardIds];
  run({ type: 'DrawCards', playerId: red, count: ids.length });
  run({
    type: 'MoveCardToPlay',
    cardId: ids[0]!,
    expectedSourceZoneId: playerZoneId(red, 'hand'),
    boardPlayerId: red,
    slot: 'active',
  });
  const stackId = state.boards[red]!.activeStackId!;
  for (const cardId of [ids[1]!, ids[2]!, ids[3]!]) {
    run({
      type: 'MoveCardToPlay',
      cardId,
      expectedSourceZoneId: playerZoneId(red, 'hand'),
      boardPlayerId: red,
      slot: 'active',
      targetStackId: stackId,
    });
  }
  run({
    type: 'MoveCardFromStack',
    cardId: ids[2]!,
    expectedStackId: stackId,
    destinationZoneId: playerZoneId(red, 'hand'),
  });
  for (const cardId of ids.slice(4, keepSpareEnergy ? -1 : undefined)) {
    run({
      type: 'MoveCardToWorkArea',
      cardId,
      expectedWorkAreaId: state.workAreas[red]!.attachmentResolution!.id,
    });
  }
  let identities = emptyProjectionIdentityState();
  const project = () => {
    const result = projectRecipient(
      state,
      { kind: 'player', playerId: blue },
      identities,
      { nextOpaqueId: () => `opaque-restore-alias-${++next}` },
      'solo'
    );
    identities = result.identities;
    return result.snapshot;
  };
  const seat = {
    id: 'native-solo-seat',
    viewer: { kind: 'player' as const, playerId: blue },
    active: true,
    nextClientSequence: 1,
    recentOutcomes: [],
  };
  const resolve = (command: WireGameCommand) =>
    resolveWireCommand(
      state,
      identities,
      seat,
      command,
      DEFAULT_AUTHORITY_POLICY,
      state.revision,
      { mode: 'solo' }
    );
  const execute = (command: WireGameCommand) => {
    const resolved = resolve(command);
    if (!resolved.accepted)
      throw new Error(`Native resolution: ${resolved.code}`);
    return run(resolved.command);
  };
  const before = project();
  const area = before.workAreas[red]!.attachmentResolution!;
  const restore: WireGameCommand = {
    type: 'RestoreStagedStack',
    targetPlayerId: red,
    expectedWorkAreaId: area.id,
    expectedActiveStackId: null,
    expectedBenchStackIds: [],
    destinationSlot: 'active',
  };
  return {
    before,
    area,
    restore,
    run,
    project,
    execute,
    resolve,
    state: () => state,
    ids,
  };
};

const connectedRuntime = (view: MatchViewState) => {
  let handlers: SessionSocketHandlers | undefined;
  const sent: ClientMessage[] = [];
  let nextCommand = 0;
  const runtime = new RemoteRoomRuntime({
    connection: {
      url: 'wss://example.test/connect',
      buildId: 'native-test',
      roomCode: 'ABCDEFGH2345',
      displayName: 'Blue',
      requestedRole: 'player',
      admissionTicket: 'native-private-admission-ticket-0001',
      resumeToken: 'native-private-resume-capability-0001',
    },
    session: {
      socketFactory: {
        open: (_url, callbacks): SessionSocket => {
          handlers = callbacks;
          return {
            send: (frame) => sent.push(JSON.parse(frame) as ClientMessage),
            close: () => {},
          };
        },
      },
      scheduler: { schedule: () => 1, cancel: () => {} },
      createCommandId: () => `native-restore-${++nextCommand}`,
      policy: { idleHeartbeatMs: 0 },
    },
  });
  const receive = (message: ServerMessage) =>
    handlers!.message(JSON.stringify(message));
  handlers!.open();
  receive({
    type: 'Welcome',
    protocolVersion: PROTOCOL_VERSION,
    buildId: 'native-test',
    role: 'player',
    playerId: blue,
    sessionId: 'native-solo-session',
    resumeToken: 'native-private-resume-capability-0001',
    nextClientSequence: 1,
    snapshot: serializeMatchViewState(view),
  });
  return {
    runtime,
    sent,
    receive,
    complete: (
      command: Extract<ClientMessage, { type: 'Command' }>,
      snapshot: MatchViewState
    ) => {
      receive({
        type: 'StatePublication',
        protocolVersion: PROTOCOL_VERSION,
        coveringCommandId: command.commandId,
        executedClientSequence: command.clientSequence,
        snapshot: serializeMatchViewState(snapshot),
      });
      receive({
        type: 'CommandResult',
        protocolVersion: PROTOCOL_VERSION,
        commandId: command.commandId,
        clientSequence: command.clientSequence,
        accepted: true,
        revision: snapshot.revision,
      });
    },
  };
};

describe('native restored-stack provisional identities', () => {
  it('binds both old queued and rebased in-flight Play keys to its exact accepted stack', () => {
    const fixture = nativeFixture();
    fixture.execute(fixture.restore);
    const before = fixture.project();
    const stack = before.stacks[before.boards[red]!.activeStackId!]!;
    const oldAlias = stack.evolutionCards[0]!.id;
    const hand: WireGameCommand = {
      type: 'MovePlayStackToZone',
      stackId: stack.id,
      expectedEvolutionCardIds: stack.evolutionCards.map((card) => card.id),
      expectedAttachmentCardIds: stack.attachmentCards.map((card) => card.id),
      destinationZoneId: playerZoneId(red, 'hand'),
    };
    const play: WireGameCommand = {
      type: 'MoveCardToPlay',
      cardId: oldAlias,
      expectedSourceZoneId: playerZoneId(red, 'hand'),
      boardPlayerId: red,
      slot: 'active',
    };
    const { runtime, sent, complete } = connectedRuntime(before);
    try {
      expect(runtime.session.submit(hand).queued).toBe(true);
      expect(runtime.session.submit(play).queued).toBe(true);
      const first = sent[1]!;
      if (first.type !== 'Command') throw new Error('Hand command required');
      fixture.execute(first.command);
      const inHand = fixture.project();
      complete(first, inHand);
      const second = sent[2]!;
      if (second.type !== 'Command' || second.command.type !== 'MoveCardToPlay')
        throw new Error('Play command required');
      expect(second.command.cardId).not.toBe(oldAlias);
      const currentPrediction = predictWireCommand(inHand, second.command)!;
      const currentKey = currentPrediction.boards[red]!.activeStackId!;
      expect(currentKey).toBe(`predicted-stack:${second.command.cardId}`);
      expect(
        runtime.session.submit({
          type: 'SetDamage',
          stackId: currentKey,
          damage: 30,
        }).queued
      ).toBe(true);
      expect(
        runtime.session.submit({
          type: 'SetDamage',
          stackId: `predicted-stack:${oldAlias}`,
          damage: 60,
        }).queued
      ).toBe(true);
      fixture.execute(second.command);
      complete(second, fixture.project());
      const actualStack = fixture.state().boards[red]!.activeStackId!;
      for (let index = 3; index <= 4; index += 1) {
        const envelope = sent[index]!;
        if (envelope.type !== 'Command')
          throw new Error('Damage command required');
        expect(envelope.command).toMatchObject({
          type: 'SetDamage',
          stackId: actualStack,
        });
        fixture.execute(envelope.command);
        complete(envelope, fixture.project());
      }
      expect(fixture.state().stacks[actualStack]!.evolutionCardIds).toEqual([
        fixture.ids[0],
      ]);
      expect(fixture.state().stacks[actualStack]!.damage).toBe(60);
      expect(
        runtime.session
          .getSnapshot()
          .completedCommands.map((command) => command.accepted)
      ).toEqual([true, true, true, true]);
      expect(runtime.session.getSnapshot().pendingCommands).toHaveLength(0);
    } finally {
      runtime.dispose();
    }
  });

  it('refreshes a deliberate new play that reuses a previously completed public card key', () => {
    const fixture = nativeFixture();
    fixture.execute(fixture.restore);
    let view = fixture.project();
    let stack = view.stacks[view.boards[red]!.activeStackId!]!;
    fixture.execute({
      type: 'MovePlayStackToZone',
      stackId: stack.id,
      expectedEvolutionCardIds: stack.evolutionCards.map((card) => card.id),
      expectedAttachmentCardIds: stack.attachmentCards.map((card) => card.id),
      destinationZoneId: playerZoneId(red, 'discard'),
    });
    view = fixture.project();
    const baseAlias = stack.evolutionCards[0]!.id;
    const rebind = createProvisionalRebinder();
    for (let play = 0; play < 2; play += 1) {
      const command = rebind(
        {
          type: 'MoveCardToPlay',
          cardId: baseAlias,
          expectedSourceZoneId: playerZoneId(red, 'discard'),
          boardPlayerId: red,
          slot: 'active',
        },
        view
      );
      fixture.execute(command);
      view = fixture.project();
      stack = view.stacks[view.boards[red]!.activeStackId!]!;
      rebind.accepted(command, view.revision, view);
      const damage = rebind(
        {
          type: 'SetDamage',
          stackId: `predicted-stack:${baseAlias}`,
          damage: 30,
        },
        view
      );
      expect(damage).toMatchObject({ stackId: stack.id });
      fixture.execute(damage);
      if (play === 0) {
        fixture.execute({
          type: 'MovePlayStackToZone',
          stackId: stack.id,
          expectedEvolutionCardIds: [baseAlias],
          expectedAttachmentCardIds: [],
          destinationZoneId: playerZoneId(red, 'discard'),
        });
        view = fixture.project();
        expect(
          view.zones[playerZoneId(red, 'discard')]!.cards.some(
            (card) => card.id === baseAlias
          )
        ).toBe(true);
      }
    }
    expect(fixture.state().stacks[stack.id as never]!.damage).toBe(30);
  });

  it.each([2, 196])(
    'keeps old role aliases through a fully queued Stage/Restore/Hand chain (%s Energy)',
    (energyCount) => {
      const fixture = nativeFixture(energyCount, false);
      fixture.execute(fixture.restore);
      const before = fixture.project();
      const original = before.stacks[before.boards[red]!.activeStackId!]!;
      const stage: WireGameCommand = {
        type: 'MoveCardFromStack',
        cardId: original.evolutionCards.at(-1)!.id,
        expectedStackId: original.id,
        destinationZoneId: playerZoneId(red, 'hand'),
      };
      const predictedStage = predictWireCommand(before, stage, {
        readsEveryHand: true,
      })!;
      const area = predictedStage.workAreas[red]!.attachmentResolution!;
      const restore: WireGameCommand = {
        type: 'RestoreStagedStack',
        targetPlayerId: red,
        expectedWorkAreaId: area.id,
        expectedActiveStackId: null,
        expectedBenchStackIds: [],
        destinationSlot: 'active',
      };
      const predictedRestore = predictWireCommand(predictedStage, restore, {
        readsEveryHand: true,
      })!;
      const stack =
        predictedRestore.stacks[predictedRestore.boards[red]!.activeStackId!]!;
      const hand: WireGameCommand = {
        type: 'MovePlayStackToZone',
        stackId: stack.id,
        expectedEvolutionCardIds: stack.evolutionCards.map((card) => card.id),
        expectedAttachmentCardIds: stack.attachmentCards.map((card) => card.id),
        destinationZoneId: playerZoneId(red, 'hand'),
      };
      const last: WireGameCommand = {
        type: 'MoveCard',
        cardId: original.evolutionCards[0]!.id,
        expectedSourceZoneId: playerZoneId(red, 'hand'),
        destinationZoneId: playerZoneId(red, 'discard'),
      };
      const { runtime, sent, complete } = connectedRuntime(before);
      try {
        for (const command of [stage, restore, hand, last])
          expect(runtime.session.submit(command).queued).toBe(true);
        expect(sent).toHaveLength(2);
        for (let index = 1; index <= 4; index += 1) {
          const envelope = sent[index]!;
          if (envelope.type !== 'Command')
            throw new Error('Queued Command required');
          expect(envelope.clientSequence).toBe(index);
          fixture.execute(envelope.command);
          complete(envelope, fixture.project());
        }
        expect(runtime.session.getSnapshot().pendingCommands).toHaveLength(0);
        expect(
          runtime.session
            .getSnapshot()
            .completedCommands.map((command) => command.accepted)
        ).toEqual([true, true, true, true]);
        expect(
          fixture.state().zones[playerZoneId(red, 'discard')]!.cardIds
        ).toEqual([fixture.ids[0]]);
      } finally {
        runtime.dispose();
      }
    }
  );

  it('retains every alias of a restored stack larger than the command-memory bound', () => {
    const fixture = nativeFixture(66);
    const rebind = createProvisionalRebinder();
    const sent = rebind(fixture.restore, fixture.before);
    const predicted = predictWireCommand(fixture.before, sent)!;
    const stack = predicted.stacks[predicted.boards[red]!.activeStackId!]!;
    expect(stack.evolutionCards.length + stack.attachmentCards.length).toBe(68);
    fixture.execute(sent);
    const after = fixture.project();
    rebind.accepted(sent, after.revision, after);
    const move = rebind(
      {
        type: 'MovePlayStackToZone',
        stackId: stack.id,
        expectedEvolutionCardIds: stack.evolutionCards.map((card) => card.id),
        expectedAttachmentCardIds: stack.attachmentCards.map((card) => card.id),
        destinationZoneId: playerZoneId(red, 'discard'),
      },
      after
    );
    fixture.execute(move);
    expect(
      fixture.state().zones[playerZoneId(red, 'discard')]!.cardIds
    ).toHaveLength(68);
  });

  it('declines same-ID staged copy replacement before the accepted restore', () => {
    const fixture = nativeFixture();
    const rebind = createProvisionalRebinder();
    const sent = rebind(fixture.restore, fixture.before);
    const areaId = fixture.state().workAreas[red]!.attachmentResolution!.id;
    fixture.run({
      type: 'MoveStagedCard',
      cardId: fixture.ids[0]!,
      expectedWorkAreaId: areaId,
      destinationZoneId: playerZoneId(red, 'deck'),
    });
    fixture.run({
      type: 'MoveCardToWorkArea',
      cardId: fixture.ids[2]!,
      expectedWorkAreaId: areaId,
    });
    expect(fixture.state().workAreas[red]!.attachmentResolution!.id).toBe(
      areaId
    );
    fixture.execute(sent);
    const after = fixture.project();
    expect(after.revision).toBe(fixture.before.revision + 3);
    rebind.accepted(sent, after.revision, after);
    const predicted = `predicted-stack:${fixture.area.evolutionCards[0]!.id}`;
    const damage = rebind(
      { type: 'SetDamage', stackId: predicted, damage: 30 },
      after
    );
    expect(damage).toMatchObject({ stackId: predicted });
    expect(fixture.resolve(damage)).toEqual({
      accepted: false,
      code: 'stale_reference',
    });
    expect(
      fixture.state().stacks[fixture.state().boards[red]!.activeStackId!]!
        .damage
    ).toBeNull();
  });

  it.each(['bench', 'cross-active', 'cross-bench'] as const)(
    'binds the predictor destination after %s restoration',
    (destination) => {
      const fixture = nativeFixture();
      // Keep an Active so a same-board Bench restore stays on the Bench.
      fixture.run({
        type: 'MoveCardToPlay',
        cardId: fixture.ids[2]!,
        expectedSourceZoneId: playerZoneId(red, 'hand'),
        boardPlayerId: red,
        slot: 'active',
      });
      const before = fixture.project();
      const playerId = destination === 'bench' ? red : blue;
      const board = before.boards[playerId]!;
      const restore: WireGameCommand = {
        ...(fixture.restore as Extract<
          WireGameCommand,
          { type: 'RestoreStagedStack' }
        >),
        expectedActiveStackId: board.activeStackId,
        expectedBenchStackIds: [...board.benchStackIds],
        destinationBoardPlayerId: playerId,
        destinationSlot: destination === 'cross-active' ? 'active' : 'bench',
        benchIndex: 99,
      };
      const rebind = createProvisionalRebinder();
      const sent = rebind(restore, before);
      const predicted = predictWireCommand(before, sent)!;
      const stack = Object.values(predicted.stacks).find((candidate) =>
        candidate.id.startsWith('predicted-stack:')
      )!;
      fixture.execute(sent);
      const after = fixture.project();
      rebind.accepted(sent, after.revision, after);
      const move = rebind(
        {
          type: 'MovePlayStackToZone',
          stackId: stack.id,
          expectedEvolutionCardIds: stack.evolutionCards.map((card) => card.id),
          expectedAttachmentCardIds: stack.attachmentCards.map(
            (card) => card.id
          ),
          destinationZoneId: playerZoneId(red, 'discard'),
        },
        after
      );
      expect(move).toMatchObject({
        stackId: Object.values(after.stacks).find(
          (candidate) => candidate.id !== before.boards[red]!.activeStackId
        )!.id,
      });
      fixture.execute(move);
      expect(
        fixture.state().zones[playerZoneId(red, 'discard')]!.cardIds
      ).toContain(fixture.ids[0]);
    }
  );

  it('predicts native Energy/Trainer restoration order, preserving unsupported order', () => {
    const fixture = nativeFixture();
    const predicted = predictWireCommand(fixture.before, fixture.restore)!;
    const stack = predicted.stacks[predicted.boards[red]!.activeStackId!]!;
    expect(
      stack.attachmentCards.map(
        (card) => card.kind === 'known' && card.category
      )
    ).toEqual(['Energy', 'Trainer']);
    const unknown = {
      id: fixture.area.attachmentCards[1]!.id,
      ownerId: red,
      kind: 'concealed' as const,
      cardBackUrl: '/red.png',
      publiclyRevealed: false as const,
    };
    const unsupported = {
      ...fixture.before,
      workAreas: {
        ...fixture.before.workAreas,
        [red]: {
          ...fixture.before.workAreas[red]!,
          attachmentResolution: {
            ...fixture.area,
            attachmentCards: [fixture.area.attachmentCards[0]!, unknown],
          },
        },
      },
    };
    const uncertain = predictWireCommand(unsupported, fixture.restore)!;
    expect(
      uncertain.stacks[
        uncertain.boards[red]!.activeStackId!
      ]!.attachmentCards.map((card) => card.id)
    ).toEqual([fixture.area.attachmentCards[0]!.id, unknown.id]);
  });

  it.each(['damage', 'top', 'attachment', 'attach', 'whole'] as const)(
    'sends queued %s on the correct native restored stack and every card role',
    (action) => {
      const fixture = nativeFixture();
      const { runtime, sent, receive } = connectedRuntime(fixture.before);
      try {
        const restoring = runtime.session.submit(fixture.restore);
        if (!restoring.queued) throw new Error('Restore must queue');
        const predicted = predictWireCommand(fixture.before, fixture.restore)!;
        const stack = predicted.stacks[predicted.boards[red]!.activeStackId!]!;
        const spare = fixture.before.zones[
          playerZoneId(red, 'hand')
        ]!.cards.find(
          (card) => card.kind === 'known' && card.category === 'Energy'
        )!;
        const command: WireGameCommand =
          action === 'damage'
            ? { type: 'SetDamage', stackId: stack.id, damage: 30 }
            : action === 'attach'
              ? {
                  type: 'PlaceCardOnPlayStack',
                  cardId: spare.id,
                  expectedSourceId: playerZoneId(red, 'hand'),
                  targetStackId: stack.id,
                  expectedTargetTopCardId: stack.evolutionCards.at(-1)!.id,
                  mode: 'attachment',
                }
              : action === 'whole'
                ? {
                    type: 'MovePlayStackToZone',
                    stackId: stack.id,
                    expectedEvolutionCardIds: stack.evolutionCards.map(
                      (card) => card.id
                    ),
                    expectedAttachmentCardIds: stack.attachmentCards.map(
                      (card) => card.id
                    ),
                    destinationZoneId: playerZoneId(red, 'discard'),
                  }
                : {
                    type: 'MoveCardFromStack',
                    expectedStackId: stack.id,
                    cardId: (action === 'top'
                      ? stack.evolutionCards.at(-1)!
                      : stack.attachmentCards[0]!
                    ).id,
                    destinationZoneId: playerZoneId(red, 'discard'),
                  };
        const following = runtime.session.submit(command);
        if (!following.queued) throw new Error('Follow-up must queue');
        expect(sent).toHaveLength(2);
        const first = sent[1]!;
        if (first.type !== 'Command') throw new Error('Command required');
        fixture.execute(first.command);
        const restored = fixture.project();
        const actual = restored.stacks[restored.boards[red]!.activeStackId!]!;
        expect(actual.evolutionCards).toHaveLength(2);
        expect(actual.evolutionCards[0]!.id).not.toBe(
          fixture.area.evolutionCards[0]!.id
        );
        receive({
          type: 'StatePublication',
          protocolVersion: PROTOCOL_VERSION,
          coveringCommandId: first.commandId,
          executedClientSequence: 1,
          snapshot: serializeMatchViewState(restored),
        });
        receive({
          type: 'CommandResult',
          protocolVersion: PROTOCOL_VERSION,
          commandId: first.commandId,
          clientSequence: 1,
          accepted: true,
          revision: restored.revision,
        });
        const second = sent[2]!;
        if (second.type !== 'Command')
          throw new Error('Queued Command required');
        expect(second.clientSequence).toBe(2);
        expect(second.command).toMatchObject(
          action === 'damage' || action === 'whole'
            ? { stackId: actual.id }
            : action === 'attach'
              ? {
                  targetStackId: actual.id,
                  expectedTargetTopCardId: actual.evolutionCards.at(-1)!.id,
                }
              : {
                  expectedStackId: actual.id,
                  cardId: (action === 'top'
                    ? actual.evolutionCards.at(-1)!
                    : actual.attachmentCards[0]!
                  ).id,
                }
        );
        fixture.execute(second.command);
        const after = fixture.project();
        receive({
          type: 'StatePublication',
          protocolVersion: PROTOCOL_VERSION,
          coveringCommandId: second.commandId,
          executedClientSequence: 2,
          snapshot: serializeMatchViewState(after),
        });
        receive({
          type: 'CommandResult',
          protocolVersion: PROTOCOL_VERSION,
          commandId: second.commandId,
          clientSequence: 2,
          accepted: true,
          revision: after.revision,
        });
        expect(runtime.session.getSnapshot().phase).toBe('ready');
        expect(runtime.session.getSnapshot().pendingCommands).toHaveLength(0);
        if (action === 'damage')
          expect(fixture.state().stacks[actual.id as never]?.damage).toBe(30);
        else if (action === 'attach')
          expect(
            fixture.state().stacks[actual.id as never]!.attachmentCardIds
          ).toContain(fixture.ids[5]);
        else
          expect(
            fixture.state().zones[playerZoneId(red, 'discard')]!.cardIds
          ).toContain(
            action === 'top'
              ? fixture.ids[1]
              : action === 'attachment'
                ? fixture.ids[4]
                : fixture.ids[0]
          );
      } finally {
        runtime.dispose();
      }
    }
  );

  it.each(['newer', 'idle', 'refused', 'intervening'] as const)(
    'never acquires an identical replacement after %s completion',
    (frontier) => {
      const fixture = nativeFixture();
      const rebind = createProvisionalRebinder();
      const sent = rebind(fixture.restore, fixture.before);
      if (frontier === 'intervening')
        fixture.run({
          type: 'SetCardFace',
          cardId: fixture.ids[2]!,
          face: 'down',
        });
      fixture.execute(sent);
      const completed = fixture.project();
      const stack = completed.stacks[completed.boards[red]!.activeStackId!]!;
      const predicted = `predicted-stack:${fixture.area.evolutionCards[0]!.id}`;
      if (frontier === 'idle')
        rebind.accepted(sent, completed.revision, completed);
      if (frontier === 'refused') rebind.refused(sent);
      fixture.execute({
        type: 'MovePlayStackToZone',
        stackId: stack.id,
        expectedEvolutionCardIds: stack.evolutionCards.map((card) => card.id),
        expectedAttachmentCardIds: stack.attachmentCards.map((card) => card.id),
        destinationZoneId: playerZoneId(red, 'discard'),
      });
      let latest = fixture.project();
      const replacement = latest.zones[playerZoneId(red, 'hand')]!.cards.find(
        (card) => card.kind === 'known' && card.category === 'Pokémon'
      )!;
      fixture.execute({
        type: 'MoveCardToPlay',
        cardId: replacement.id,
        expectedSourceZoneId: playerZoneId(red, 'hand'),
        boardPlayerId: red,
        slot: 'active',
      });
      latest = fixture.project();
      if (frontier === 'newer')
        rebind.accepted(sent, completed.revision, latest);
      if (frontier === 'intervening')
        rebind.accepted(sent, completed.revision, completed);
      const damage = rebind(
        { type: 'SetDamage', stackId: predicted, damage: 30 },
        latest
      );
      expect(damage).toMatchObject({
        stackId: frontier === 'idle' ? stack.id : predicted,
      });
      expect(fixture.resolve(damage)).toEqual({
        accepted: false,
        code: 'stale_reference',
      });
      expect(
        fixture.state().stacks[fixture.state().boards[red]!.activeStackId!]!
          .damage
      ).toBeNull();
    }
  );
});
