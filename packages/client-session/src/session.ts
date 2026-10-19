import {
  asPlayerId,
  asViewCardId,
  asViewDefinitionId,
  stableSerialize,
  type MatchViewState,
} from '@ptcgsim/game-core';
import {
  hydrateMatchViewState,
  MAX_CHAT_CODE_UNITS,
  MAX_CLIENT_FRAME_CODE_UNITS,
  PROTOCOL_VERSION,
  SESSION_RECONNECT_GRACE_MS,
  parseServerFrame,
  type ClientMessage,
  type ServerMessage,
  type WireGameCommand,
} from '@ptcgsim/protocol';

import {
  DEFAULT_CLIENT_SESSION_POLICY,
  type ClientSessionFailure,
  type ClientSessionPolicy,
  type ClientSessionState,
  type CompletedCommandSummary,
  type ConnectSessionOptions,
  type PendingCommandSummary,
  type ProjectedReplayArtifact,
} from './model.js';
import type {
  SessionSocket,
  SessionSocketCloseEvent,
  SessionSocketFactory,
} from './transport.js';

type CommandEnvelope = Extract<ClientMessage, { type: 'Command' }>;
type CommandResult = Extract<ServerMessage, { type: 'CommandResult' }>;

interface PendingCommand {
  /** Fixed once first sent: a retry must be byte-identical. */
  envelope: CommandEnvelope;
  /** Whether `lastSeenRevision` has been settled before the first send. */
  revisionSettled?: boolean;
  /** Whether its references have been rebound before the first send. */
  rebound?: boolean;
  status: PendingCommandSummary['state'];
  retries: number;
  publicationRevision?: number;
  result?: CommandResult;
}

interface ReplayTransfer {
  readonly replayId: string;
  readonly viewer: Extract<ServerMessage, { type: 'ReplayStarted' }>['viewer'];
  readonly startRevision: number;
  readonly endRevision: number;
  readonly truncated: boolean;
  readonly frameCount: number;
  readonly localDisclosureDefinitions?: ProjectedReplayArtifact['localDisclosureDefinitions'];
  readonly frames: ProjectedReplayArtifact['frames'][number][];
}

export interface ClientSessionScheduler {
  readonly schedule: (callback: () => void, delayMs: number) => unknown;
  readonly cancel: (handle: unknown) => void;
}

export interface ClientSessionDependencies {
  readonly socketFactory: SessionSocketFactory;
  readonly createCommandId?: () => string;
  readonly scheduler?: ClientSessionScheduler;
  readonly random?: () => number;
  readonly now?: () => number;
  /**
   * Whether the device has a network at all (a browser's `navigator.onLine`,
   * which is false only when it surely hasn't). Defaults to that.
   */
  readonly isOnline?: () => boolean;
  readonly policy?: Partial<ClientSessionPolicy>;
  /**
   * Rewrites what a queued command refers to just before it is first sent,
   * against the room's latest view. A command built on a prediction can
   * name something the client made up while the command that creates it
   * was still on its way (a Pokémon just played, a window just opened);
   * by the time it is sent, the room has created it under its own ID.
   */
  readonly rebindCommand?: ((
    command: WireGameCommand,
    view: MatchViewState
  ) => WireGameCommand) & {
    /**
     * Told of a command the room refused, before the next is sent: what
     * it was predicted to make never was, and nothing queued after it may
     * be bound to something else in its place.
     */
    readonly refused?: (command: WireGameCommand) => void;
  };
}

export type SubmitCommandResult =
  | {
      readonly queued: true;
      readonly commandId: string;
      readonly clientSequence: number;
    }
  | {
      readonly queued: false;
      readonly reason:
        | 'not_ready'
        | 'spectator'
        | 'queue_full'
        | 'command_pending'
        | 'too_large';
    };

const initialState = (): ClientSessionState => ({
  phase: 'idle',
  nextClientSequence: 1,
  pendingCommands: [],
  completedCommands: [],
  presentationEvents: [],
  chatMessages: [],
  presence: [],
  notices: [],
  replayLoading: false,
  reconnectAttempt: 0,
});

const defaultScheduler: ClientSessionScheduler = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => globalThis.clearTimeout(handle as number),
};

const defaultCommandId = (): string => globalThis.crypto.randomUUID();

/** How often a session offline looks for the network again. */
const OFFLINE_RECHECK_MS = 1_000;

const appendBounded = <Value>(
  values: readonly Value[],
  value: Value,
  maximum: number
): readonly Value[] =>
  maximum === 0 ? [] : [...values, value].slice(-maximum);

const appendManyBounded = <Value>(
  values: readonly Value[],
  additions: readonly Value[],
  maximum: number
): readonly Value[] =>
  maximum === 0 ? [] : [...values, ...additions].slice(-maximum);

const isDisplayNameOnlyRefresh = (
  current: MatchViewState,
  candidate: MatchViewState
): boolean => {
  const currentPlayerIds = Object.keys(current.players);
  const candidatePlayerIds = Object.keys(candidate.players);
  if (
    currentPlayerIds.length !== candidatePlayerIds.length ||
    candidatePlayerIds.some((playerId) => !current.players[playerId])
  ) {
    return false;
  }
  const normalizedPlayers = Object.fromEntries(
    candidatePlayerIds.map((playerId) => [
      playerId,
      {
        ...candidate.players[playerId]!,
        displayName: current.players[playerId]!.displayName,
      },
    ])
  );
  return (
    stableSerialize({ ...candidate, players: normalizedPlayers }) ===
    stableSerialize(current)
  );
};

const validPolicy = (policy: ClientSessionPolicy): ClientSessionPolicy => {
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid client session policy: ${key}`);
    }
  }
  if (
    policy.maximumPendingCommands < 1 ||
    policy.maximumReconnectAttempts < 1 ||
    policy.reconnectJitterRatio > 1
  ) {
    throw new Error('Invalid client session policy bounds');
  }
  return policy;
};

/**
 * Owns one authoritative remote session. No capability is ever copied into the
 * public state returned by getSnapshot().
 */
export class RemoteGameSession {
  private readonly socketFactory: SessionSocketFactory;
  private readonly createCommandId: () => string;
  private readonly scheduler: ClientSessionScheduler;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly isOnline: () => boolean;
  private readonly rebindCommand: ClientSessionDependencies['rebindCommand'];
  private readonly policy: ClientSessionPolicy;
  private readonly listeners = new Set<() => void>();
  private readonly pending: PendingCommand[] = [];
  /** Recent revisions this client's own accepted commands produced. */
  private readonly ownRevisions = new Set<number>();
  /**
   * The newest revision whose presentation events this session has shown.
   * A view installed without them (a reconnect's Welcome, a catch-up
   * refresh) leaves it behind, so a retried command's events (a coin's
   * face) still show when they come; a repeat of shown ones does not.
   */
  private presentedRevision = -1;
  /**
   * Announcements for a revision this session doesn't have yet (the room
   * committed a command whose publication it never sent): shown once the
   * view reaches it.
   */
  private deferredAnnouncements: Extract<
    ServerMessage,
    { type: 'MulliganAnnouncement' | 'DeckViewAnnouncement' }
  >['event'][] = [];
  private readonly pingTimes = new Map<number, number>();
  private state: ClientSessionState = initialState();
  private options?: Omit<
    ConnectSessionOptions,
    'admissionTicket' | 'resumeToken'
  >;
  private admissionTicket?: string;
  private resumeToken?: string;
  private sessionId?: string;
  private socket?: SessionSocket;
  private socketGeneration = 0;
  private reconnectTimer?: unknown;
  /** The deadline of the connection attempt in flight. */
  private attemptTimer?: unknown;
  /** The deadline for the room to answer the command in flight. */
  private answerTimer?: unknown;
  /** When an admitted session lost its transport: the grace runs from here. */
  private reconnectingSince?: number;
  private reconnectAttempts = 0;
  private manualClose = false;
  private nextPingId = 0;
  private replayTransfer?: ReplayTransfer;

  constructor(dependencies: ClientSessionDependencies) {
    this.socketFactory = dependencies.socketFactory;
    this.createCommandId = dependencies.createCommandId ?? defaultCommandId;
    this.scheduler = dependencies.scheduler ?? defaultScheduler;
    this.random = dependencies.random ?? Math.random;
    this.now = dependencies.now ?? Date.now;
    this.isOnline =
      dependencies.isOnline ??
      (() =>
        (globalThis as { navigator?: { onLine?: boolean } }).navigator
          ?.onLine !== false);
    this.rebindCommand = dependencies.rebindCommand;
    this.policy = validPolicy({
      ...DEFAULT_CLIENT_SESSION_POLICY,
      ...dependencies.policy,
    });
  }

  getSnapshot = (): ClientSessionState => this.state;

  /** Accidental serialization is restricted to the credential-free snapshot. */
  toJSON(): ClientSessionState {
    return this.state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  connect(options: ConnectSessionOptions): void {
    this.cancelReconnect();
    this.socketGeneration += 1;
    this.closeSocket(1000, 'Session replaced');
    this.cancelAttemptDeadline();
    this.cancelAnswerDeadline();
    this.reconnectingSince = undefined;
    this.pending.length = 0;
    this.ownRevisions.clear();
    this.presentedRevision = -1;
    this.deferredAnnouncements = [];
    this.pingTimes.clear();
    this.replayTransfer = undefined;
    this.options = {
      url: options.url,
      buildId: options.buildId,
      roomCode: options.roomCode,
      displayName: options.displayName,
      requestedRole: options.requestedRole,
    };
    this.admissionTicket = options.admissionTicket;
    this.resumeToken = options.resumeToken;
    this.sessionId = undefined;
    this.reconnectAttempts = 0;
    this.manualClose = false;
    this.state = { ...initialState(), phase: 'connecting' };
    const generation = this.socketGeneration;
    this.emit();
    if (
      !this.isCurrent(generation) ||
      this.manualClose ||
      this.state.phase !== 'connecting'
    ) {
      return;
    }
    this.openSocket();
  }

  submit(command: WireGameCommand): SubmitCommandResult {
    if (this.state.phase !== 'ready' || !this.sessionId) {
      return { queued: false, reason: 'not_ready' };
    }
    if (this.state.role !== 'player') {
      return { queued: false, reason: 'spectator' };
    }
    // Undo pops whole-match authority history. Match v1's in-progress guard so
    // key repeat cannot turn one intended undo into multiple queued pops.
    if (
      command.type === 'ApplySoloUndo' &&
      this.pending.some(
        (pending) => pending.envelope.command.type === 'ApplySoloUndo'
      )
    ) {
      return { queued: false, reason: 'command_pending' };
    }
    if (this.pending.length >= this.policy.maximumPendingCommands) {
      return { queued: false, reason: 'queue_full' };
    }
    const commandId = this.createCommandId();
    const clientSequence = this.state.nextClientSequence;
    const envelope: CommandEnvelope = {
      type: 'Command',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      clientSequence,
      commandId,
      lastSeenRevision: this.state.view?.revision ?? 0,
      command,
    };
    // The room drops a frame over its limit without answering it, and a
    // command never answered holds up every one queued behind it. Measured
    // at the largest revision a resend could carry.
    if (
      JSON.stringify({
        ...envelope,
        lastSeenRevision: Number.MAX_SAFE_INTEGER,
      }).length > MAX_CLIENT_FRAME_CODE_UNITS
    ) {
      return { queued: false, reason: 'too_large' };
    }
    this.pending.push({ envelope, status: 'queued', retries: 0 });
    this.updateState({
      nextClientSequence: clientSequence + 1,
      pendingCommands: this.pendingSummaries(),
    });
    this.sendHead();
    return { queued: true, commandId, clientSequence };
  }

  /**
   * `actingPlayerId` names the seat the sender is acting for -- v1's
   * `systemState.initiator`, which a flipped board moves to the other seat.
   * The room authenticates it and falls back to the sender's own seat, so it
   * asks for attribution rather than asserting it.
   */
  sendChat(message: string, actingPlayerId?: string): boolean {
    if (this.state.phase !== 'ready') return false;
    const normalized = message.trim();
    if (normalized.length === 0 || normalized.length > MAX_CHAT_CODE_UNITS) {
      return false;
    }
    return this.send({
      type: 'SendChat',
      protocolVersion: PROTOCOL_VERSION,
      message: normalized,
      ...(actingPlayerId === undefined
        ? {}
        : { targetPlayerId: actingPlayerId }),
    });
  }

  declareMulligan(actingPlayerId?: string): boolean {
    if (this.state.phase !== 'ready' || this.state.role !== 'player') {
      return false;
    }
    return this.send({
      type: 'DeclareMulligan',
      protocolVersion: PROTOCOL_VERSION,
      ...(actingPlayerId === undefined
        ? {}
        : { targetPlayerId: actingPlayerId }),
    });
  }

  declareDeckView(actingPlayerId?: string): boolean {
    if (this.state.phase !== 'ready' || this.state.role !== 'player') {
      return false;
    }
    return this.send({
      type: 'DeclareDeckView',
      protocolVersion: PROTOCOL_VERSION,
      ...(actingPlayerId === undefined
        ? {}
        : { targetPlayerId: actingPlayerId }),
    });
  }

  requestReplay(): boolean {
    if (
      this.state.phase !== 'ready' ||
      this.state.replayLoading ||
      this.replayTransfer
    ) {
      return false;
    }
    const sent = this.send({
      type: 'RequestReplay',
      protocolVersion: PROTOCOL_VERSION,
    });
    if (sent) {
      this.updateState({ replayLoading: true });
      this.armAnswerDeadline();
    }
    return sent;
  }

  ping(): number | undefined {
    if (this.state.phase !== 'ready') return undefined;
    const id = this.nextPingId++;
    this.pingTimes.set(id, this.now());
    if (this.pingTimes.size > 32) {
      const oldest = this.pingTimes.keys().next().value;
      if (oldest !== undefined) this.pingTimes.delete(oldest);
    }
    if (!this.send({ type: 'Ping', protocolVersion: PROTOCOL_VERSION, id })) {
      this.pingTimes.delete(id);
      return undefined;
    }
    return id;
  }

  /**
   * Asks the room for this seat again after the connection failed (its
   * reconnects or a command's retries ran out): the room takes it back
   * unless it has given the seat up meanwhile. Whether it is trying.
   */
  retry(): boolean {
    if (
      this.state.phase !== 'failed' ||
      !this.state.failure?.retryable ||
      !this.resumeToken ||
      !this.options
    ) {
      return false;
    }
    this.manualClose = false;
    this.reconnectAttempts = 0;
    this.reconnectingSince = undefined;
    const generation = this.socketGeneration;
    this.updateState({
      phase: 'connecting',
      failure: undefined,
      reconnectAttempt: 0,
    });
    if (
      !this.isCurrent(generation) ||
      this.getSnapshot().phase !== 'connecting'
    ) {
      return false;
    }
    this.openSocket();
    return true;
  }

  disconnect(): void {
    if (this.state.phase === 'closed') return;
    this.manualClose = true;
    this.cancelReconnect();
    if (this.state.phase === 'ready') {
      this.send({ type: 'Leave', protocolVersion: PROTOCOL_VERSION });
    }
    this.socketGeneration += 1;
    this.cancelAttemptDeadline();
    this.cancelAnswerDeadline();
    this.closeSocket(1000, 'Client left room');
    this.clearCapabilities();
    this.updateState({
      phase: 'closed',
      reconnectAttempt: 0,
      replayLoading: false,
    });
  }

  private openSocket(): void {
    const options = this.options;
    if (!options) return;
    const generation = ++this.socketGeneration;
    this.armAttemptDeadline(generation);
    try {
      const socket = this.socketFactory.open(options.url, {
        open: () => {
          if (!this.isCurrent(generation)) return;
          this.updateState({ phase: 'handshaking' });
          if (
            !this.isCurrent(generation) ||
            this.state.phase !== 'handshaking'
          ) {
            return;
          }
          if (!this.resumeToken) {
            this.fail({
              code: 'sequence_divergence',
              message: 'No resume capability is available',
            });
            return;
          }
          const sent = this.send({
            type: 'Hello',
            protocolVersion: PROTOCOL_VERSION,
            buildId: options.buildId,
            roomCode: options.roomCode,
            displayName: options.displayName,
            requestedRole: options.requestedRole,
            resumeToken: this.resumeToken,
            ...(this.admissionTicket
              ? { admissionTicket: this.admissionTicket }
              : {}),
          });
          if (
            !sent &&
            this.isCurrent(generation) &&
            this.state.phase === 'handshaking'
          ) {
            this.reconnectTransport('Admission handshake write failed');
          }
        },
        message: (frame) => {
          if (!this.isCurrent(generation)) return;
          this.handleFrame(frame);
          // Anything from the room shows the connection is alive.
          if (this.answerTimer !== undefined && this.isCurrent(generation)) {
            this.armAnswerDeadline();
          }
        },
        close: (event) => {
          if (this.isCurrent(generation)) this.handleClose(event);
        },
        error: () => {
          // Browser WebSocket error events carry no actionable detail. The
          // close event owns reconnect policy and avoids scheduling twice.
        },
      });
      if (!this.isCurrent(generation)) socket.close(1000, 'Stale socket');
      else this.socket = socket;
    } catch {
      if (this.isCurrent(generation)) {
        this.socket = undefined;
        this.scheduleReconnect();
      }
    }
  }

  private handleFrame(frame: string): void {
    const parsed = parseServerFrame(frame);
    if (!parsed.ok) {
      this.fail({
        code: 'invalid_server_frame',
        message: `Server frame rejected: ${parsed.reason}`,
      });
      return;
    }
    const message = parsed.value;
    switch (message.type) {
      case 'Welcome':
        this.handleWelcome(message);
        return;
      case 'StatePublication':
        this.handlePublication(message);
        return;
      case 'ProjectionRefresh':
        this.handleProjectionRefresh(message);
        return;
      case 'CommandResult':
        this.handleCommandResult(message);
        return;
      case 'ReplayStarted':
        this.handleReplayStarted(message);
        return;
      case 'ReplayFrame':
        this.handleReplayFrame(message);
        return;
      case 'ReplayCompleted':
        this.handleReplayCompleted(message);
        return;
      case 'ChatMessage':
        this.updateState({
          chatMessages: appendBounded(
            this.state.chatMessages,
            message,
            this.policy.maximumChatMessages
          ),
        });
        return;
      case 'MulliganAnnouncement':
      case 'DeckViewAnnouncement': {
        const current = this.state.view;
        if (this.state.phase === 'ready' && current) {
          // Ahead of the view: held until it gets there. Behind it: stale.
          if (message.event.revision > current.revision) {
            this.deferredAnnouncements = [
              ...this.deferredAnnouncements,
              message.event,
            ].slice(-16);
            return;
          }
          if (message.event.revision < current.revision) return;
        }
        if (
          this.state.phase !== 'ready' ||
          !current ||
          message.event.revision !== current.revision ||
          !current.players[message.event.playerId]
        ) {
          this.fail({
            code: 'inconsistent_publication',
            message: 'Player announcement does not match the current room',
          });
          return;
        }
        this.updateState({
          presentationEvents: appendBounded(
            this.state.presentationEvents,
            message.event,
            this.policy.maximumPresentationEvents
          ),
        });
        return;
      }
      case 'Presence':
        if (this.state.phase !== 'ready' || !this.state.view) {
          this.fail({
            code: 'sequence_divergence',
            message: 'Presence received outside an admitted room session',
          });
          return;
        }
        if (
          message.playerId !== undefined &&
          !this.state.view.players[message.playerId]
        ) {
          this.fail({
            code: 'inconsistent_publication',
            message: 'Presence references a player outside the current room',
          });
          return;
        }
        this.updateState({
          presence: appendBounded(
            this.state.presence,
            message,
            this.policy.maximumPresenceEvents
          ),
        });
        return;
      case 'Pong': {
        const started = this.pingTimes.get(message.id);
        if (started === undefined) return;
        this.pingTimes.delete(message.id);
        this.updateState({ latencyMs: Math.max(0, this.now() - started) });
        return;
      }
      case 'ServerNotice': {
        const noticeGeneration = this.socketGeneration;
        const noticePhase = this.state.phase;
        const commandAtReceipt =
          noticePhase === 'ready' ? this.pending[0] : undefined;
        if (message.code === 'replay_unavailable') {
          this.replayTransfer = undefined;
        }
        this.updateState({
          notices: appendBounded(
            this.state.notices,
            message,
            this.policy.maximumNotices
          ),
          ...(message.code === 'replay_unavailable'
            ? { replayLoading: false }
            : {}),
        });
        if (!this.isCurrent(noticeGeneration)) return;
        if (
          message.retryable &&
          noticePhase === 'ready' &&
          this.state.phase === 'ready' &&
          commandAtReceipt !== undefined &&
          this.pending[0] === commandAtReceipt
        ) {
          this.retryHead();
        } else if (
          message.retryable &&
          noticePhase === 'handshaking' &&
          this.state.phase === 'handshaking'
        ) {
          this.reconnectTransport('Admission retry requested');
        } else if (
          !message.retryable &&
          noticePhase === 'handshaking' &&
          this.state.phase === 'handshaking'
        ) {
          this.fail({
            code: 'admission_rejected',
            message: `Room admission was rejected: ${message.code}`,
          });
        }
        return;
      }
      case 'SessionSuperseded':
        this.manualClose = true;
        this.cancelReconnect();
        this.cancelAnswerDeadline();
        this.socketGeneration += 1;
        this.closeSocket(4409, 'Session superseded');
        this.clearCapabilities();
        this.updateState({
          phase: 'superseded',
          reconnectAttempt: 0,
          replayLoading: false,
        });
        return;
    }
  }

  private handleReplayStarted(
    message: Extract<ServerMessage, { type: 'ReplayStarted' }>
  ): void {
    if (
      this.state.phase !== 'ready' ||
      !this.state.replayLoading ||
      this.replayTransfer ||
      message.endRevision < message.startRevision ||
      message.frameCount !== message.endRevision - message.startRevision + 1 ||
      message.truncated !== message.startRevision > 0 ||
      message.viewer.kind !== this.state.role ||
      (message.viewer.kind === 'player' &&
        message.viewer.playerId !== this.state.playerId)
    ) {
      this.failReplay('Replay start metadata is inconsistent with the session');
      return;
    }
    this.replayTransfer = {
      replayId: message.replayId,
      viewer: message.viewer,
      startRevision: message.startRevision,
      endRevision: message.endRevision,
      truncated: message.truncated,
      frameCount: message.frameCount,
      ...(message.localDisclosureDefinitions
        ? {
            localDisclosureDefinitions: message.localDisclosureDefinitions.map(
              (definition) => ({
                ...definition,
                id: asViewDefinitionId(definition.id),
              })
            ),
          }
        : {}),
      frames: [],
    };
  }

  private handleReplayFrame(
    message: Extract<ServerMessage, { type: 'ReplayFrame' }>
  ): void {
    const transfer = this.replayTransfer;
    const expectedRevision = transfer
      ? transfer.startRevision + transfer.frames.length
      : -1;
    if (
      !transfer ||
      message.replayId !== transfer.replayId ||
      message.index !== transfer.frames.length ||
      message.index >= transfer.frameCount ||
      message.snapshot.revision !== expectedRevision ||
      message.snapshot.matchId !== this.state.view?.matchId ||
      message.snapshot.viewer.kind !== transfer.viewer.kind ||
      (message.snapshot.viewer.kind === 'player' &&
        (transfer.viewer.kind !== 'player' ||
          message.snapshot.viewer.playerId !== transfer.viewer.playerId)) ||
      message.presentationEvents?.some(
        (event) => event.revision !== message.snapshot.revision
      ) ||
      (message.index === 0 && (message.presentationEvents?.length ?? 0) > 0)
    ) {
      this.failReplay('Replay frame sequence or perspective is inconsistent');
      return;
    }
    transfer.frames.push({
      snapshot: hydrateMatchViewState(message.snapshot),
      ...(message.localDisclosure
        ? {
            localDisclosure: {
              zoneIds: [...message.localDisclosure.zoneIds],
              cards: message.localDisclosure.cards.map((card) => ({
                ...card,
                id: asViewCardId(card.id),
                definitionId: asViewDefinitionId(card.definitionId),
                ownerId: asPlayerId(card.ownerId),
              })),
            },
          }
        : {}),
      presentationEvents: message.presentationEvents ?? [],
    });
  }

  private handleReplayCompleted(
    message: Extract<ServerMessage, { type: 'ReplayCompleted' }>
  ): void {
    const transfer = this.replayTransfer;
    if (
      !transfer ||
      message.replayId !== transfer.replayId ||
      message.frameCount !== transfer.frameCount ||
      transfer.frames.length !== transfer.frameCount ||
      transfer.frames.at(-1)?.snapshot.revision !== transfer.endRevision
    ) {
      this.failReplay('Replay completion metadata is inconsistent');
      return;
    }
    const replayArtifact: ProjectedReplayArtifact = {
      replayId: transfer.replayId,
      viewer: transfer.frames[0]!.snapshot.viewer,
      startRevision: transfer.startRevision,
      endRevision: transfer.endRevision,
      truncated: transfer.truncated,
      ...(transfer.localDisclosureDefinitions
        ? {
            localDisclosureDefinitions: [
              ...transfer.localDisclosureDefinitions,
            ],
          }
        : {}),
      frames: transfer.frames,
    };
    this.replayTransfer = undefined;
    this.updateState({ replayLoading: false, replayArtifact });
  }

  private failReplay(message: string): void {
    this.replayTransfer = undefined;
    this.fail({ code: 'inconsistent_replay', message });
  }

  private handleWelcome(
    message: Extract<ServerMessage, { type: 'Welcome' }>
  ): void {
    if (this.state.phase !== 'handshaking') {
      this.fail({
        code: 'sequence_divergence',
        message: 'Welcome received outside the handshake',
      });
      return;
    }
    if (this.sessionId && this.sessionId !== message.sessionId) {
      this.fail({
        code: 'sequence_divergence',
        message: 'The resumed session identity changed',
      });
      return;
    }
    if (message.resumeToken !== this.resumeToken) {
      this.fail({
        code: 'sequence_divergence',
        message: 'The server changed the bound resume capability',
      });
      return;
    }
    const sequenceFloor =
      this.pending[0]?.envelope.clientSequence ?? this.state.nextClientSequence;
    if (
      this.sessionId !== undefined &&
      message.nextClientSequence < sequenceFloor
    ) {
      this.fail({
        code: 'sequence_divergence',
        message: 'The server sequence moved behind the pending command queue',
      });
      return;
    }
    const candidate = hydrateMatchViewState(message.snapshot);
    const current = this.state.view;
    const nextView =
      current &&
      (candidate.revision < current.revision ||
        (candidate.revision === current.revision &&
          stableSerialize(candidate) === stableSerialize(current)))
        ? current
        : candidate;
    // A first admission shows nothing from before it; a resumed one may yet
    // be owed what it missed.
    if (!current) this.presentedRevision = candidate.revision;
    this.cancelAttemptDeadline();
    this.reconnectingSince = undefined;
    this.sessionId = message.sessionId;
    this.admissionTicket = undefined;
    this.reconnectAttempts = 0;
    for (const command of this.pending) {
      command.status = 'queued';
      command.retries = 0;
      if (command.envelope.clientSequence < message.nextClientSequence) {
        command.publicationRevision = message.snapshot.revision;
      }
    }
    const locallyAllocated = this.state.nextClientSequence;
    this.updateState({
      phase: 'ready',
      role: message.role,
      ...(message.playerId ? { playerId: message.playerId } : {}),
      nextClientSequence: Math.max(
        locallyAllocated,
        message.nextClientSequence
      ),
      reconnectAttempt: 0,
      failure: undefined,
      view: nextView,
      presentationEvents: this.releaseAnnouncements(
        nextView,
        this.state.presentationEvents
      ),
      pendingCommands: this.pendingSummaries(),
    });
    if (
      this.getSnapshot().phase !== 'ready' ||
      this.sessionId !== message.sessionId
    ) {
      return;
    }
    this.sendHead();
  }

  /** The announcements held for a view that has now reached them. */
  private releaseAnnouncements(
    view: MatchViewState,
    events: ClientSessionState['presentationEvents']
  ): ClientSessionState['presentationEvents'] {
    const due = this.deferredAnnouncements.filter(
      (event) => event.revision <= view.revision
    );
    if (due.length === 0) return events;
    this.deferredAnnouncements = this.deferredAnnouncements.filter(
      (event) => event.revision > view.revision
    );
    return appendManyBounded(
      events,
      due.filter((event) => view.players[event.playerId] !== undefined),
      this.policy.maximumPresentationEvents
    );
  }

  private handlePublication(
    message: Extract<ServerMessage, { type: 'StatePublication' }>
  ): void {
    if (this.state.phase !== 'ready') return;
    const generation = this.socketGeneration;
    if (
      message.presentationEvents?.some(
        (event) => event.revision !== message.snapshot.revision
      )
    ) {
      this.fail({
        code: 'inconsistent_publication',
        message: 'Presentation event revision does not match its snapshot',
      });
      return;
    }
    const candidate = hydrateMatchViewState(message.snapshot);
    const current = this.state.view;
    const previousRevision = current?.revision ?? -1;
    if (
      current &&
      candidate.revision === current.revision &&
      stableSerialize(candidate) !== stableSerialize(current)
    ) {
      this.fail({
        code: 'inconsistent_publication',
        message: 'Equal state revisions contained different projections',
      });
      return;
    }
    const advancesView = !current || candidate.revision > current.revision;
    // Mark the covered command before anyone sees the new view, so no
    // observer folds its outcome over a view that already contains it.
    if (message.coveringCommandId) {
      const pending = this.pending.find(
        (item) => item.envelope.commandId === message.coveringCommandId
      );
      if (pending) pending.publicationRevision = message.snapshot.revision;
    }
    const presentationEvents =
      candidate.revision > this.presentedRevision &&
      candidate.revision >= previousRevision &&
      message.presentationEvents
        ? appendManyBounded(
            this.state.presentationEvents,
            message.presentationEvents,
            this.policy.maximumPresentationEvents
          )
        : this.state.presentationEvents;
    if (candidate.revision >= previousRevision) {
      this.presentedRevision = Math.max(
        this.presentedRevision,
        candidate.revision
      );
    }
    if (advancesView || presentationEvents !== this.state.presentationEvents) {
      this.updateState({
        ...(advancesView ? { view: candidate } : {}),
        presentationEvents: advancesView
          ? this.releaseAnnouncements(candidate, presentationEvents)
          : presentationEvents,
        pendingCommands: this.pendingSummaries(),
      });
      if (!this.isCurrent(generation) || this.state.phase !== 'ready') return;
    }
    this.finishHeadIfComplete();
    this.publishPending();
  }

  private handleProjectionRefresh(
    message: Extract<ServerMessage, { type: 'ProjectionRefresh' }>
  ): void {
    const current = this.state.view;
    if (this.state.phase !== 'ready' || !current) {
      this.fail({
        code: 'sequence_divergence',
        message: 'Projection refresh received outside an admitted room',
      });
      return;
    }
    const candidate = hydrateMatchViewState(message.snapshot);
    const sameProjection =
      candidate.revision === current.revision &&
      stableSerialize(candidate) === stableSerialize(current);
    if (sameProjection) return;
    // Ahead of this view: a command committed whose publication never
    // reached this session (the room failed after committing it), and the
    // refresh carries it past. Its events, if any, may come with a retry.
    if (candidate.revision > current.revision) {
      this.updateState({
        view: candidate,
        presentationEvents: this.releaseAnnouncements(
          candidate,
          this.state.presentationEvents
        ),
      });
      return;
    }
    if (
      candidate.revision !== current.revision ||
      !isDisplayNameOnlyRefresh(current, candidate)
    ) {
      this.fail({
        code: 'inconsistent_publication',
        message: 'Projection refresh changed non-refreshable authority state',
      });
      return;
    }
    this.updateState({ view: candidate });
  }

  private handleCommandResult(message: CommandResult): void {
    if (this.state.phase !== 'ready') return;
    const head = this.pending[0];
    if (
      !head ||
      head.envelope.commandId !== message.commandId ||
      head.envelope.clientSequence !== message.clientSequence
    ) {
      this.fail({
        code: 'sequence_divergence',
        message: 'Command result does not match the in-flight command',
      });
      return;
    }
    head.result = message;
    if (message.accepted) {
      this.ownRevisions.add(message.revision);
      // Only revisions newer than the oldest queued command matter.
      if (this.ownRevisions.size > 256) {
        const oldest = Math.min(...this.ownRevisions);
        this.ownRevisions.delete(oldest);
      }
    }
    if (
      message.accepted &&
      (head.publicationRevision ?? -1) < message.revision
    ) {
      head.status = 'awaiting_publication';
      this.publishPending();
      return;
    }
    this.finishHeadIfComplete();
    this.publishPending();
  }

  private finishHeadIfComplete(): void {
    const head = this.pending[0];
    if (!head?.result) return;
    if (
      head.result.accepted &&
      (head.publicationRevision ?? -1) < head.result.revision
    ) {
      return;
    }
    this.pending.shift();
    if (!head.result.accepted)
      this.rebindCommand?.refused?.(head.envelope.command);
    const completed: CompletedCommandSummary = {
      commandId: head.result.commandId,
      clientSequence: head.result.clientSequence,
      accepted: head.result.accepted,
      revision: head.result.revision,
      ...(head.result.code ? { code: head.result.code } : {}),
    };
    this.updateState({
      completedCommands: appendBounded(
        this.state.completedCommands,
        completed,
        this.policy.maximumCompletedCommands
      ),
      pendingCommands: this.pendingSummaries(),
    });
    this.sendHead();
  }

  private sendHead(): void {
    if (this.state.phase !== 'ready') return;
    const head = this.pending[0];
    if (!head || head.status !== 'queued') return;
    this.settleLastSeenRevision(head);
    this.rebindReferences(head);
    const generation = this.socketGeneration;
    const sessionId = this.sessionId;
    head.status = 'in_flight';
    this.publishPending();
    if (
      !this.isCurrent(generation) ||
      this.state.phase !== 'ready' ||
      this.sessionId !== sessionId ||
      this.pending[0] !== head ||
      head.status !== 'in_flight'
    ) {
      return;
    }
    if (this.sendEnvelope(head.envelope)) {
      this.armAnswerDeadline();
    } else if (
      this.isCurrent(generation) &&
      this.state.phase === 'ready' &&
      this.sessionId === sessionId &&
      this.pending[0] === head &&
      head.status === 'in_flight'
    ) {
      this.reconnectTransport('Command write failed');
    }
  }

  /**
   * A command records the revision its sender saw. One queued behind this
   * client's own commands was built on their predicted outcome, so once they
   * have landed it is brought up to the revision they produced -- otherwise
   * a turn, attack or undo pressed right after a move would be refused as
   * stale. Only revisions this client produced count: if anyone else changed
   * the match meanwhile the command keeps what its sender actually saw, and
   * the room rejects it as it should.
   */
  private settleLastSeenRevision(head: PendingCommand): void {
    if (head.revisionSettled) return;
    head.revisionSettled = true;
    const seen = head.envelope.lastSeenRevision;
    const current = this.state.view?.revision ?? seen;
    if (current <= seen) return;
    for (let revision = seen + 1; revision <= current; revision += 1) {
      if (!this.ownRevisions.has(revision)) return;
    }
    head.envelope = { ...head.envelope, lastSeenRevision: current };
  }

  private rebindReferences(head: PendingCommand): void {
    if (head.rebound) return;
    head.rebound = true;
    const view = this.state.view;
    if (!this.rebindCommand || !view) return;
    const command = this.rebindCommand(head.envelope.command, view);
    if (command !== head.envelope.command) {
      head.envelope = { ...head.envelope, command };
    }
  }

  private retryHead(): void {
    const head = this.pending[0];
    if (!head) return;
    if (head.retries >= this.policy.maximumCommandRetries) {
      this.fail({
        code: 'command_retry_exhausted',
        message: 'The in-flight command exceeded its bounded retry budget',
        retryable: true,
      });
      return;
    }
    const generation = this.socketGeneration;
    const sessionId = this.sessionId;
    head.retries += 1;
    if (this.sendEnvelope(head.envelope)) {
      this.armAnswerDeadline();
    } else if (
      this.isCurrent(generation) &&
      this.state.phase === 'ready' &&
      this.sessionId === sessionId &&
      this.pending[0] === head
    ) {
      this.reconnectTransport('Command retry write failed');
    }
  }

  private send(message: ClientMessage): boolean {
    return this.sendEnvelope(message);
  }

  private sendEnvelope(message: ClientMessage): boolean {
    const socket = this.socket;
    const generation = this.socketGeneration;
    try {
      if (!socket) return false;
      socket.send(JSON.stringify(message));
      return this.isCurrent(generation) && this.socket === socket;
    } catch {
      return false;
    }
  }

  private handleClose(event: SessionSocketCloseEvent): void {
    this.cancelAttemptDeadline();
    this.cancelAnswerDeadline();
    this.socket = undefined;
    this.replayTransfer = undefined;
    this.socketGeneration += 1;
    if (
      this.manualClose ||
      this.state.phase === 'closed' ||
      this.state.phase === 'failed' ||
      this.state.phase === 'superseded'
    ) {
      return;
    }
    if (event.code === 1000 && event.wasClean) {
      this.clearCapabilities();
      this.updateState({
        phase: 'closed',
        reconnectAttempt: 0,
        replayLoading: false,
      });
      return;
    }
    this.scheduleReconnect();
  }

  /**
   * An attempt that neither closes nor gets to Welcome (a stalled upgrade,
   * a Hello never answered) is dropped for another, before it can use up
   * the room's reconnect grace on its own.
   */
  private armAttemptDeadline(generation: number): void {
    this.cancelAttemptDeadline();
    let timeout = this.policy.connectionAttemptTimeoutMs;
    if (this.reconnectingSince !== undefined) {
      const left =
        SESSION_RECONNECT_GRACE_MS - (this.now() - this.reconnectingSince);
      // Past the grace by this clock (an outage waited out), the room may
      // never have seen the drop: the attempt gets its whole time.
      if (left > 0) timeout = Math.min(timeout, left);
    }
    this.attemptTimer = this.scheduler.schedule(() => {
      this.attemptTimer = undefined;
      if (!this.isCurrent(generation)) return;
      if (
        this.state.phase !== 'connecting' &&
        this.state.phase !== 'handshaking'
      ) {
        return;
      }
      this.reconnectTransport('Connection attempt timed out');
    }, timeout);
  }

  private cancelAttemptDeadline(): void {
    if (this.attemptTimer === undefined) return;
    this.scheduler.cancel(this.attemptTimer);
    this.attemptTimer = undefined;
  }

  /**
   * A command sent and not yet settled, or a replay asked for, with nothing
   * coming back for a while: the connection went quiet without closing (a
   * dropped route), so it is resumed on another, which sends the command
   * again (a replay is given up, to be asked for again).
   */
  private armAnswerDeadline(): void {
    this.cancelAnswerDeadline();
    if (!this.awaitingRoom()) return;
    const generation = this.socketGeneration;
    this.answerTimer = this.scheduler.schedule(() => {
      this.answerTimer = undefined;
      if (!this.isCurrent(generation) || !this.awaitingRoom()) return;
      // Offline, no other connection could open either, and this one may
      // well carry on when the network is back (it did across a 45 s
      // outage): it is given until then, and the deadline after.
      if (!this.isOnline()) {
        this.armAnswerDeadline();
        return;
      }
      this.reconnectTransport('The room stopped answering');
    }, this.policy.commandAnswerTimeoutMs);
  }

  /** The room owes an answer: the head command's, or a replay's. */
  private awaitingRoom(): boolean {
    const status = this.pending[0]?.status;
    return (
      this.state.phase === 'ready' &&
      (status === 'in_flight' ||
        status === 'awaiting_publication' ||
        this.state.replayLoading)
    );
  }

  private cancelAnswerDeadline(): void {
    if (this.answerTimer === undefined) return;
    this.scheduler.cancel(this.answerTimer);
    this.answerTimer = undefined;
  }

  private scheduleReconnect(): void {
    this.cancelAttemptDeadline();
    this.cancelAnswerDeadline();
    if (this.sessionId !== undefined && this.reconnectingSince === undefined) {
      this.reconnectingSince = this.now();
    }
    // Offline, no attempt could open: the network is waited for, and the
    // budget is kept for when it is back.
    if (!this.isOnline()) {
      this.awaitNetwork();
      return;
    }
    if (this.reconnectAttempts >= this.policy.maximumReconnectAttempts) {
      this.fail({
        code: 'reconnect_exhausted',
        message: 'The session exceeded its bounded reconnect budget',
        retryable: true,
      });
      return;
    }
    this.cancelReconnect();
    this.reconnectAttempts += 1;
    const exponential = Math.min(
      this.policy.reconnectMaximumDelayMs,
      this.policy.reconnectBaseDelayMs * 2 ** (this.reconnectAttempts - 1)
    );
    const jitter =
      exponential * this.policy.reconnectJitterRatio * (this.random() * 2 - 1);
    const delay = Math.max(0, Math.round(exponential + jitter));
    const generation = this.socketGeneration;
    const reconnectAttempt = this.reconnectAttempts;
    this.updateState({
      phase: 'reconnecting',
      reconnectAttempt,
      replayLoading: false,
    });
    if (
      !this.isCurrent(generation) ||
      this.state.phase !== 'reconnecting' ||
      this.reconnectAttempts !== reconnectAttempt
    ) {
      return;
    }
    this.reconnectTimer = this.scheduler.schedule(() => {
      this.reconnectTimer = undefined;
      if (this.state.phase !== 'reconnecting') return;
      const timerGeneration = this.socketGeneration;
      this.updateState({ phase: 'connecting' });
      if (
        !this.isCurrent(timerGeneration) ||
        this.getSnapshot().phase !== 'connecting'
      ) {
        return;
      }
      this.openSocket();
    }, delay);
  }

  private awaitNetwork(): void {
    this.cancelReconnect();
    const generation = this.socketGeneration;
    if (this.state.phase !== 'reconnecting') {
      this.updateState({ phase: 'reconnecting', replayLoading: false });
      if (
        !this.isCurrent(generation) ||
        this.getSnapshot().phase !== 'reconnecting'
      ) {
        return;
      }
    }
    this.reconnectTimer = this.scheduler.schedule(() => {
      this.reconnectTimer = undefined;
      if (!this.isCurrent(generation) || this.state.phase !== 'reconnecting') {
        return;
      }
      this.scheduleReconnect();
    }, OFFLINE_RECHECK_MS);
  }

  private reconnectTransport(reason: string): void {
    this.socketGeneration += 1;
    // 1012 (service restart) in the range a browser lets a page close with:
    // it refuses anything but 1000 and 3000-4999, and the old socket would
    // stay open beside the new one.
    this.closeSocket(4012, reason);
    // The old socket's close no longer comes here: a replay it was part way
    // through is dropped now, as that close would have.
    this.replayTransfer = undefined;
    this.scheduleReconnect();
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer === undefined) return;
    this.scheduler.cancel(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private fail(failure: ClientSessionFailure): void {
    this.manualClose = true;
    this.cancelReconnect();
    this.cancelAttemptDeadline();
    this.cancelAnswerDeadline();
    this.socketGeneration += 1;
    this.closeSocket(4400, failure.code);
    if (failure.retryable) {
      // What retry() needs is kept: the seat's resume, and the admission
      // ticket of a session the room hasn't yet admitted (a Welcome clears
      // it), which a resume alone can't stand in for.
      this.replayTransfer = undefined;
    } else {
      this.clearCapabilities();
    }
    this.updateState({ phase: 'failed', replayLoading: false, failure });
  }

  private clearCapabilities(): void {
    this.admissionTicket = undefined;
    this.resumeToken = undefined;
    this.sessionId = undefined;
    this.replayTransfer = undefined;
  }

  private closeSocket(code: number, reason: string): void {
    const socket = this.socket;
    this.socket = undefined;
    try {
      socket?.close(code, reason);
    } catch {
      // Closing is best effort; generation invalidation rejects late events.
    }
  }

  private isCurrent(generation: number): boolean {
    return generation === this.socketGeneration;
  }

  private publishPending(): void {
    const pendingCommands = this.pendingSummaries();
    if (
      pendingCommands.length === this.state.pendingCommands.length &&
      pendingCommands.every((pending, index) => {
        const current = this.state.pendingCommands[index];
        return (
          current?.commandId === pending.commandId &&
          current.clientSequence === pending.clientSequence &&
          current.commandType === pending.commandType &&
          current.state === pending.state
        );
      })
    ) {
      return;
    }
    this.updateState({ pendingCommands });
  }

  private pendingSummaries(): PendingCommandSummary[] {
    return this.pending.map((item) => ({
      commandId: item.envelope.commandId,
      clientSequence: item.envelope.clientSequence,
      commandType: item.envelope.command.type,
      command: item.envelope.command,
      state: item.status,
      ...(item.publicationRevision !== undefined
        ? { published: true as const }
        : {}),
    }));
  }

  private updateState(patch: Partial<ClientSessionState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
