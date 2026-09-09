import { exports } from 'cloudflare:workers';
import { PROTOCOL_VERSION } from '@ptcgsim/protocol';
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DurableRoomSnapshotStore,
  ROOM_LIFECYCLE_STORAGE_KEY,
} from '../src/durable-storage.js';
import {
  RUNTIME_ORIGIN as ORIGIN,
  type StoredLifecycle,
  connect as connectWithoutTracking,
  createRoom,
  flipCommandFrame,
  helloFrame,
  issuePlayerTicket,
  nextServerFrames,
  nextServerMessage,
  nextServerMessages,
  roomStub,
  runtimeCommandPerformanceEvidence,
  runtimeEvidence,
} from './runtime-harness.js';

const openSockets = new Set<WebSocket>();
const connect = async (
  created: Parameters<typeof connectWithoutTracking>[0]
): Promise<WebSocket> => {
  const socket = await connectWithoutTracking(created);
  openSockets.add(socket);
  return socket;
};

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const socket of openSockets) socket.close(1000, 'Test complete');
  openSockets.clear();
});

describe('Cloudflare Worker runtime', () => {
  it('serves health metadata through the deployed entrypoint', async () => {
    const response = await exports.default.fetch(
      new Request('https://play.example/v2/health')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({
      status: 'ok',
      buildId: 'local-development',
      protocolVersion: 2,
      authoritySchemaVersion: 7,
      matchStateSchemaVersion: 3,
    });
  });

  it('creates a room through edge bindings and initializes its Durable Object', async () => {
    const created = await createRoom();
    const room = roomStub(created);
    const evidence = await runtimeEvidence(created);

    expect(room.id.toString()).toHaveLength(64);
    expect(created.credentials.playerOneSeatCapability).not.toBe(
      created.credentials.playerTwoSeatCapability
    );
    expect(evidence.snapshot?.state.matchId).toBe(created.roomCode);
    expect(
      Object.values(evidence.snapshot?.state.players ?? {}).map(
        (player) => player.cardBackUrl
      )
    ).toEqual(['/v2/assets/cardback.png', '/v2/assets/cardback.png']);
    expect(evidence.authorityStorage).toEqual({
      envelope: {
        format: 'ptcgsim-room-authority-v6',
        generation: expect.stringMatching(/^[0-9a-f]{32}$/u),
        authorityVersion: evidence.snapshot?.authorityVersion,
        stateRevision: evidence.snapshot?.state.revision,
      },
      frontier: {
        format: 'ptcgsim-authority-frontier-v1',
        envelopeFormat: 'ptcgsim-room-authority-v6',
        generation: expect.stringMatching(/^[0-9a-f]{32}$/u),
        authorityVersion: evidence.snapshot?.authorityVersion,
        stateRevision: evidence.snapshot?.state.revision,
      },
    });
    expect(evidence.authorityStorage.frontier?.generation).toBe(
      evidence.authorityStorage.envelope?.generation
    );
    expect(evidence.lifecycle).toMatchObject({
      format: 'ptcgsim-room-lifecycle-v1',
      state: 'unclaimed',
    });
    expect(evidence.alarm).not.toBeNull();
    expect(evidence.alarm).toBeGreaterThan(Date.now());
  });

  it('creates a real solo room without releasing a second-player bearer', async () => {
    const created = await createRoom('solo');
    const beforeAdmission = await runtimeEvidence(created);

    expect(created).toMatchObject({ mode: 'solo' });
    expect(created.credentials).not.toHaveProperty('playerTwoSeatCapability');
    expect(beforeAdmission.snapshot).toMatchObject({
      mode: 'solo',
      admission: { playerSeatLimit: 1 },
    });
    await expect(issuePlayerTicket(created, 'two')).rejects.toThrow(
      'no second-player bearer'
    );

    const ticket = await issuePlayerTicket(
      created,
      'one',
      'Solo Runtime Player'
    );
    const socket = await connect(created);
    const welcomePromise = nextServerMessage(socket);
    socket.send(helloFrame(created, ticket, 'Solo Runtime Player'));
    const welcome = await welcomePromise;

    if (welcome.type !== 'Welcome') {
      throw new Error(`Expected solo Welcome: ${JSON.stringify(welcome)}`);
    }
    expect(welcome).toMatchObject({ type: 'Welcome', role: 'player' });
    const afterAdmission = await runtimeEvidence(created);
    expect(afterAdmission.snapshot?.mode).toBe('solo');
    expect(afterAdmission.snapshot?.admission?.playerSeatLimit).toBe(1);
    expect(Object.values(afterAdmission.snapshot?.sessions ?? {})).toHaveLength(
      1
    );
  });

  it('reschedules an early alarm and deletes an expired unclaimed room', async () => {
    const created = await createRoom();
    const room = roomStub(created);
    const initial = await runtimeEvidence(created);

    expect(await runDurableObjectAlarm(room)).toBe(true);
    const rescheduled = await runtimeEvidence(created);
    expect(rescheduled.alarm).toBe(initial.alarm);

    await runInDurableObject(room, async (_instance, state) => {
      const now = Date.now();
      await state.storage.put(ROOM_LIFECYCLE_STORAGE_KEY, {
        format: 'ptcgsim-room-lifecycle-v1',
        state: 'unclaimed',
        createdAt: now - 60_000,
        unclaimedExpiresAt: now - 1,
      } satisfies StoredLifecycle);
      // Keep automatic local delivery from racing the explicit test helper.
      await state.storage.setAlarm(now + 60_000);
    });

    expect(await runDurableObjectAlarm(room)).toBe(true);
    const deleted = await runInDurableObject(
      room,
      async (_instance, state) => ({
        alarm: await state.storage.getAlarm(),
        entries: [...(await state.storage.list()).entries()],
      })
    );
    expect(deleted).toEqual({ alarm: null, entries: [] });

    const expiredConnect = await exports.default.fetch(
      new Request(`${ORIGIN}/v2/rooms/${created.roomCode}/connect`, {
        headers: { Origin: ORIGIN, Upgrade: 'websocket' },
      })
    );
    expect(expiredConnect.status).toBe(404);
  });

  it('claims atomically and resumes an admitted socket after real eviction', async () => {
    const created = await createRoom();
    const ticket = await issuePlayerTicket(created);
    const socket = await connect(created);
    const welcomePromise = nextServerMessage(socket);

    socket.send(helloFrame(created, ticket));
    const welcome = await welcomePromise;
    expect(welcome.type).toBe('Welcome');
    if (welcome.type !== 'Welcome') throw new Error('Expected Welcome');

    const beforeEviction = await runtimeEvidence(created);
    if (!beforeEviction.snapshot) throw new Error('Snapshot was not persisted');
    expect(beforeEviction.alarm).toBeNull();
    expect(beforeEviction.lifecycle).toMatchObject({
      format: 'ptcgsim-room-lifecycle-v1',
      state: 'claimed',
      claimedAtAuthorityVersion: beforeEviction.snapshot.authorityVersion,
    });
    expect(beforeEviction.socketCount).toBe(1);
    expect(beforeEviction.attachment).toMatchObject({
      sessionId: welcome.sessionId,
      authorityVersion: beforeEviction.snapshot.authorityVersion,
    });
    expect(beforeEviction.snapshot.sessions[welcome.sessionId]).toMatchObject({
      displayName: 'Runtime Player',
    });

    await evictDurableObject(roomStub(created));

    const pongPromise = nextServerFrames(socket, 1);
    socket.send(
      JSON.stringify({
        type: 'Ping',
        protocolVersion: PROTOCOL_VERSION,
        id: 17,
      })
    );
    await expect(pongPromise).resolves.toEqual([
      expect.objectContaining({
        message: expect.objectContaining({ type: 'Pong', id: 17 }),
      }),
    ]);

    const privateChat = 'post-hibernation chat';
    const chatPromise = nextServerMessage(socket);
    socket.send(
      JSON.stringify({
        type: 'SendChat',
        protocolVersion: PROTOCOL_VERSION,
        message: `  ${privateChat}  `,
        playerId: 'forged-player',
        displayName: 'Forged Name',
      })
    );
    await expect(chatPromise).resolves.toMatchObject({
      type: 'ChatMessage',
      playerId: expect.any(String),
      displayName: 'Runtime Player',
      message: privateChat,
      createdAtMs: expect.any(Number),
    });
    const storedChatLeak = await runInDurableObject(
      roomStub(created),
      async (_instance, state) =>
        JSON.stringify([...(await state.storage.list()).values()]).includes(
          privateChat
        )
    );
    expect(storedChatLeak).toBe(false);

    const afterEviction = await runtimeEvidence(created);
    expect(afterEviction.snapshot).toEqual(beforeEviction.snapshot);
    expect(afterEviction.lifecycle).toEqual(beforeEviction.lifecycle);
    expect(afterEviction.alarm).toBeNull();
    expect(afterEviction.socketCount).toBe(1);
    expect(afterEviction.attachment).toEqual(beforeEviction.attachment);
    expect(afterEviction.authorityStorage).toEqual(
      beforeEviction.authorityStorage
    );

    const commandMessagesPromise = nextServerMessages(socket, 2);
    socket.send(flipCommandFrame(welcome, 'runtime-post-hibernation-flip'));
    const commandMessages = await commandMessagesPromise;
    expect(commandMessages.map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(commandMessages[1]).toMatchObject({
      type: 'CommandResult',
      commandId: 'runtime-post-hibernation-flip',
      accepted: true,
      revision: welcome.snapshot.revision + 1,
    });

    const afterCommand = await runtimeEvidence(created);
    expect(afterCommand.snapshot?.state.revision).toBe(
      welcome.snapshot.revision + 1
    );
    expect(afterCommand.authorityStorage.frontier?.generation).toBe(
      afterCommand.authorityStorage.envelope?.generation
    );
    expect(afterCommand.authorityStorage.envelope).toMatchObject({
      authorityVersion: afterCommand.snapshot?.authorityVersion,
      stateRevision: afterCommand.snapshot?.state.revision,
    });
    expect(afterCommand.authorityStorage.frontier).toMatchObject({
      authorityVersion: afterCommand.snapshot?.authorityVersion,
      stateRevision: afterCommand.snapshot?.state.revision,
    });
    expect(afterCommand.authorityStorage.envelope?.generation).not.toBe(
      beforeEviction.authorityStorage.envelope?.generation
    );
    expect(afterCommand.snapshot?.sessions[welcome.sessionId]).toMatchObject({
      active: true,
      nextClientSequence: welcome.nextClientSequence + 1,
      recentOutcomes: [
        {
          commandId: 'runtime-post-hibernation-flip',
          accepted: true,
        },
      ],
    });
    expect(
      (await runtimeCommandPerformanceEvidence(created)).at(-1)?.breakdown
        .frontierFastPathHit
    ).toBe(1);
  });

  it('publishes real presence and durably revokes an explicit player leave', async () => {
    const created = await createRoom();
    const firstTicket = await issuePlayerTicket(created, 'one', 'Runtime Blue');
    const firstSocket = await connect(created);
    const firstAdmission = nextServerFrames(firstSocket, 2);
    firstSocket.send(helloFrame(created, firstTicket, 'Runtime Blue'));
    const [firstWelcomeFrame, firstJoinedFrame] = await firstAdmission;
    expect(firstWelcomeFrame?.message).toMatchObject({
      type: 'Welcome',
      role: 'player',
    });
    expect(firstJoinedFrame?.message).toMatchObject({
      type: 'Presence',
      displayName: 'Runtime Blue',
      status: 'joined',
    });

    const secondTicket = await issuePlayerTicket(created, 'two', 'Runtime Red');
    const secondSocket = await connect(created);
    const firstSeesJoin = nextServerFrames(firstSocket, 1);
    const secondAdmission = nextServerFrames(secondSocket, 2);
    secondSocket.send(helloFrame(created, secondTicket, 'Runtime Red'));
    const [secondWelcomeFrame, secondJoinedFrame] = await secondAdmission;
    const secondWelcome = secondWelcomeFrame?.message;
    if (secondWelcome?.type !== 'Welcome') {
      throw new Error('Expected second player Welcome');
    }
    expect(secondJoinedFrame?.message).toMatchObject({
      type: 'Presence',
      displayName: 'Runtime Red',
      status: 'joined',
    });
    await expect(firstSeesJoin).resolves.toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          type: 'Presence',
          displayName: 'Runtime Red',
          status: 'joined',
        }),
      }),
    ]);

    const beforeDisconnect = await runtimeEvidence(created);
    const firstSeesDisconnect = nextServerFrames(firstSocket, 1);
    secondSocket.close(1011, 'Injected transport loss');
    await expect(firstSeesDisconnect).resolves.toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          type: 'Presence',
          displayName: 'Runtime Red',
          status: 'disconnected',
        }),
      }),
    ]);
    const disconnected = await runtimeEvidence(created);
    expect(disconnected.snapshot).toEqual(beforeDisconnect.snapshot);
    expect(
      disconnected.snapshot?.sessions[secondWelcome.sessionId]
    ).toMatchObject({ active: true });
    expect(
      disconnected.snapshot?.admission?.seats[secondWelcome.playerId!]
        ?.claimedSessionId
    ).toBe(secondWelcome.sessionId);

    const firstSeesReconnect = nextServerFrames(firstSocket, 1);
    await evictDurableObject(roomStub(created));
    const resumedSocket = await connect(created);
    const resumedAdmission = nextServerFrames(resumedSocket, 2);
    resumedSocket.send(
      JSON.stringify({
        type: 'Hello',
        protocolVersion: PROTOCOL_VERSION,
        buildId: 'local-development',
        roomCode: created.roomCode,
        displayName: 'Forged Runtime Red',
        requestedRole: 'player',
        resumeToken: secondWelcome.resumeToken,
      })
    );
    const [resumedWelcomeFrame, reconnectedFrame] = await resumedAdmission;
    const resumedWelcome = resumedWelcomeFrame?.message;
    if (resumedWelcome?.type !== 'Welcome') {
      throw new Error('Expected resumed player Welcome');
    }
    expect(resumedWelcome.sessionId).toBe(secondWelcome.sessionId);
    // Reconnect reuses the durable resume bearer so a Welcome lost after an
    // ambiguous commit remains retryable; explicit Leave revokes it below.
    expect(resumedWelcome.resumeToken).toBe(secondWelcome.resumeToken);
    expect(reconnectedFrame?.message).toMatchObject({
      type: 'Presence',
      displayName: 'Runtime Red',
      status: 'reconnected',
    });
    await expect(firstSeesReconnect).resolves.toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          type: 'Presence',
          displayName: 'Runtime Red',
          status: 'reconnected',
        }),
      }),
    ]);

    const firstSeesLeave = nextServerFrames(firstSocket, 1);
    resumedSocket.send(
      JSON.stringify({ type: 'Leave', protocolVersion: PROTOCOL_VERSION })
    );
    await expect(firstSeesLeave).resolves.toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          type: 'Presence',
          displayName: 'Runtime Red',
          status: 'left',
        }),
      }),
    ]);
    const left = await runtimeEvidence(created);
    expect(left.snapshot?.sessions[secondWelcome.sessionId]).toMatchObject({
      active: false,
      displayName: 'Runtime Red',
    });
    expect(left.snapshot?.sessions[secondWelcome.sessionId]).not.toHaveProperty(
      'resumeCapabilityDigest'
    );
    expect(
      left.snapshot?.admission?.seats[secondWelcome.playerId!]?.claimedSessionId
    ).toBeNull();

    await expect(
      issuePlayerTicket(created, 'two', 'Replacement Runtime Red')
    ).resolves.toMatchObject({ admissionTicket: expect.any(String) });
  });

  it('keeps an admission ticket retryable when its durable claim fails', async () => {
    const created = await createRoom();
    const ticket = await issuePlayerTicket(created);
    const socket = await connect(created);
    const commitAdmission = vi
      .spyOn(DurableRoomSnapshotStore.prototype, 'commitAdmission')
      .mockRejectedValueOnce(new Error('injected durable admission failure'));

    const failedAdmissionPromise = nextServerMessage(socket);
    socket.send(helloFrame(created, ticket));
    await expect(failedAdmissionPromise).resolves.toMatchObject({
      type: 'ServerNotice',
      code: 'internal_retryable',
      retryable: true,
    });

    const afterFailure = await runtimeEvidence(created);
    expect(afterFailure.lifecycle).toMatchObject({ state: 'unclaimed' });
    expect(afterFailure.alarm).toBeGreaterThan(Date.now());
    expect(afterFailure.snapshot?.sessions).toEqual({});
    expect(
      Object.keys(afterFailure.snapshot?.admission?.tickets ?? {})
    ).toHaveLength(1);
    expect(afterFailure.attachment?.sessionId).toBeUndefined();

    const retriedAdmissionPromise = nextServerMessage(socket);
    socket.send(helloFrame(created, ticket));
    const retriedAdmission = await retriedAdmissionPromise;
    expect(retriedAdmission.type).toBe('Welcome');
    if (retriedAdmission.type !== 'Welcome') {
      throw new Error('Expected Welcome after retry');
    }

    const afterRetry = await runtimeEvidence(created);
    expect(afterRetry.lifecycle).toMatchObject({ state: 'claimed' });
    expect(afterRetry.alarm).toBeNull();
    expect(Object.keys(afterRetry.snapshot?.sessions ?? {})).toEqual([
      retriedAdmission.sessionId,
    ]);
    expect(afterRetry.snapshot?.admission?.tickets).toEqual({});
    expect(afterRetry.attachment?.sessionId).toBe(retriedAdmission.sessionId);
    expect(commitAdmission).toHaveBeenCalledTimes(2);
  });

  it('recovers an admission whose durable commit reports failure after writing', async () => {
    const created = await createRoom();
    const ticket = await issuePlayerTicket(created);
    const socket = await connect(created);
    const originalCommit = DurableRoomSnapshotStore.prototype.commitAdmission;
    const commitAdmission = vi
      .spyOn(DurableRoomSnapshotStore.prototype, 'commitAdmission')
      .mockImplementationOnce(async function (
        this: DurableRoomSnapshotStore,
        transaction
      ) {
        await originalCommit.call(this, transaction);
        throw new Error('injected post-commit admission failure');
      });

    const ambiguousPromise = nextServerMessage(socket);
    socket.send(helloFrame(created, ticket));
    await expect(ambiguousPromise).resolves.toMatchObject({
      type: 'ServerNotice',
      code: 'internal_retryable',
      retryable: true,
    });

    const ambiguous = await runtimeEvidence(created);
    const committedSessionId = Object.keys(
      ambiguous.snapshot?.sessions ?? {}
    )[0];
    expect(committedSessionId).toBeDefined();
    expect(ambiguous.snapshot?.admission?.tickets).toEqual({});
    expect(ambiguous.attachment?.sessionId).toBeUndefined();
    expect(ambiguous.lifecycle).toMatchObject({ state: 'claimed' });

    const recoveredPromise = nextServerMessage(socket);
    socket.send(helloFrame(created, ticket));
    await expect(recoveredPromise).resolves.toMatchObject({
      type: 'Welcome',
      sessionId: committedSessionId,
      resumeToken: ticket.resumeToken,
    });

    const recovered = await runtimeEvidence(created);
    expect(recovered.snapshot?.authorityVersion).toBe(3);
    expect(Object.keys(recovered.snapshot?.sessions ?? {})).toEqual([
      committedSessionId,
    ]);
    expect(recovered.attachment?.sessionId).toBe(committedSessionId);
    expect(commitAdmission).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent admission around a failed command without phantom acknowledgement', async () => {
    const created = await createRoom();
    const firstTicket = await issuePlayerTicket(created);
    const firstSocket = await connect(created);
    const firstWelcomePromise = nextServerMessage(firstSocket);
    firstSocket.send(helloFrame(created, firstTicket));
    const firstWelcome = await firstWelcomePromise;
    expect(firstWelcome.type).toBe('Welcome');
    if (firstWelcome.type !== 'Welcome') throw new Error('Expected Welcome');

    const secondTicket = await issuePlayerTicket(
      created,
      'two',
      'Runtime Opponent'
    );
    const secondSocket = await connect(created);
    const commit = vi
      .spyOn(DurableRoomSnapshotStore.prototype, 'commit')
      .mockRejectedValueOnce(new Error('injected durable command failure'));
    const commandFrame = flipCommandFrame(
      firstWelcome,
      'runtime-concurrent-fault-flip'
    );
    const secondWelcomePromise = nextServerMessage(secondSocket);
    const failedCommandPromise = nextServerMessage(firstSocket);

    secondSocket.send(helloFrame(created, secondTicket, 'Runtime Opponent'));
    firstSocket.send(commandFrame);

    const [secondWelcome, failedCommand] = await Promise.all([
      secondWelcomePromise,
      failedCommandPromise,
    ]);
    expect(secondWelcome.type).toBe('Welcome');
    expect(failedCommand).toMatchObject({
      type: 'ServerNotice',
      code: 'internal_retryable',
      retryable: true,
    });

    const afterFailure = await runtimeEvidence(created);
    expect(afterFailure.snapshot?.state.revision).toBe(
      firstWelcome.snapshot.revision
    );
    expect(Object.keys(afterFailure.snapshot?.sessions ?? {})).toHaveLength(2);
    expect(
      afterFailure.snapshot?.sessions[firstWelcome.sessionId]
    ).toMatchObject({
      nextClientSequence: firstWelcome.nextClientSequence,
      recentOutcomes: [],
    });

    const retriedCommandPromise = nextServerMessages(firstSocket, 2);
    firstSocket.send(commandFrame);
    const retriedCommand = await retriedCommandPromise;
    expect(retriedCommand.map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(retriedCommand[1]).toMatchObject({
      type: 'CommandResult',
      commandId: 'runtime-concurrent-fault-flip',
      accepted: true,
      revision: firstWelcome.snapshot.revision + 1,
    });

    const committed = await runtimeEvidence(created);
    expect(committed.snapshot?.state.revision).toBe(
      firstWelcome.snapshot.revision + 1
    );
    expect(committed.snapshot?.sessions[firstWelcome.sessionId]).toMatchObject({
      nextClientSequence: firstWelcome.nextClientSequence + 1,
      recentOutcomes: [
        {
          commandId: 'runtime-concurrent-fault-flip',
          accepted: true,
          revision: firstWelcome.snapshot.revision + 1,
        },
      ],
    });
    expect(commit).toHaveBeenCalledTimes(2);

    await evictDurableObject(roomStub(created));
    const pongPromise = nextServerMessage(firstSocket);
    firstSocket.send(
      JSON.stringify({
        type: 'Ping',
        protocolVersion: PROTOCOL_VERSION,
        id: 29,
      })
    );
    await expect(pongPromise).resolves.toMatchObject({
      type: 'Pong',
      id: 29,
    });
    expect((await runtimeEvidence(created)).snapshot).toEqual(
      committed.snapshot
    );

    const duplicatePromise = nextServerMessages(firstSocket, 2);
    firstSocket.send(commandFrame);
    const duplicate = await duplicatePromise;
    expect(duplicate.map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(duplicate[1]).toMatchObject({
      type: 'CommandResult',
      commandId: 'runtime-concurrent-fault-flip',
      accepted: true,
      revision: firstWelcome.snapshot.revision + 1,
    });
    expect((await runtimeEvidence(created)).snapshot).toEqual(
      committed.snapshot
    );
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('deduplicates an ambiguously committed command before and after eviction', async () => {
    const created = await createRoom();
    const ticket = await issuePlayerTicket(created);
    const socket = await connect(created);
    const welcomePromise = nextServerMessage(socket);
    socket.send(helloFrame(created, ticket));
    const welcome = await welcomePromise;
    expect(welcome.type).toBe('Welcome');
    if (welcome.type !== 'Welcome') throw new Error('Expected Welcome');

    const originalCommit = DurableRoomSnapshotStore.prototype.commit;
    const commit = vi
      .spyOn(DurableRoomSnapshotStore.prototype, 'commit')
      .mockImplementationOnce(async function (
        this: DurableRoomSnapshotStore,
        transaction
      ) {
        await originalCommit.call(this, transaction);
        throw new Error('injected failure after durable commit');
      });
    const commandFrame = flipCommandFrame(
      welcome,
      'runtime-ambiguous-commit-flip'
    );
    const ambiguousResultPromise = nextServerMessage(socket);
    socket.send(commandFrame);
    await expect(ambiguousResultPromise).resolves.toMatchObject({
      type: 'ServerNotice',
      code: 'internal_retryable',
      retryable: true,
    });

    const committedWithoutAck = await runtimeEvidence(created);
    expect(committedWithoutAck.snapshot?.state.revision).toBe(
      welcome.snapshot.revision + 1
    );
    expect(
      committedWithoutAck.snapshot?.sessions[welcome.sessionId]
    ).toMatchObject({
      nextClientSequence: welcome.nextClientSequence + 1,
      recentOutcomes: [
        {
          commandId: 'runtime-ambiguous-commit-flip',
          accepted: true,
          revision: welcome.snapshot.revision + 1,
        },
      ],
    });
    expect(commit).toHaveBeenCalledTimes(1);

    const retryPromise = nextServerMessages(socket, 2);
    socket.send(commandFrame);
    const retry = await retryPromise;
    expect(retry.map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(retry[1]).toMatchObject({
      type: 'CommandResult',
      commandId: 'runtime-ambiguous-commit-flip',
      accepted: true,
      revision: welcome.snapshot.revision + 1,
    });
    expect((await runtimeEvidence(created)).snapshot).toEqual(
      committedWithoutAck.snapshot
    );
    expect(commit).toHaveBeenCalledTimes(1);

    await evictDurableObject(roomStub(created));
    const postEvictionRetryPromise = nextServerMessages(socket, 2);
    socket.send(commandFrame);
    const postEvictionRetry = await postEvictionRetryPromise;
    expect(postEvictionRetry.map((message) => message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
    expect(postEvictionRetry[1]).toMatchObject({
      type: 'CommandResult',
      commandId: 'runtime-ambiguous-commit-flip',
      accepted: true,
      revision: welcome.snapshot.revision + 1,
    });
    expect((await runtimeEvidence(created)).snapshot).toEqual(
      committedWithoutAck.snapshot
    );
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
