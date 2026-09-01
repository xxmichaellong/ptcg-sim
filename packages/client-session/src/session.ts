import { stableSerialize } from '@ptcgsim/game-core';
import {
  hydrateMatchViewState,
  PROTOCOL_VERSION,
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
} from './model.js';
import type {
  SessionSocket,
  SessionSocketCloseEvent,
  SessionSocketFactory,
} from './transport.js';

type CommandEnvelope = Extract<ClientMessage, { type: 'Command' }>;
type CommandResult = Extract<ServerMessage, { type: 'CommandResult' }>;

interface PendingCommand {
  readonly envelope: CommandEnvelope;
  status: PendingCommandSummary['state'];
  retries: number;
  publicationRevision?: number;
  result?: CommandResult;
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
  readonly policy?: Partial<ClientSessionPolicy>;
}

export type SubmitCommandResult =
  | {
      readonly queued: true;
      readonly commandId: string;
      readonly clientSequence: number;
    }
  | {
      readonly queued: false;
      readonly reason: 'not_ready' | 'spectator' | 'queue_full';
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
  reconnectAttempt: 0,
});

const defaultScheduler: ClientSessionScheduler = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => globalThis.clearTimeout(handle as number),
};

const defaultCommandId = (): string => globalThis.crypto.randomUUID();

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
  private readonly policy: ClientSessionPolicy;
  private readonly listeners = new Set<() => void>();
  private readonly pending: PendingCommand[] = [];
  private readonly pingTimes = new Map<number, number>();
  private state: ClientSessionState = initialState();
  private options?: Omit<ConnectSessionOptions, 'admissionTicket'>;
  private admissionTicket?: string;
  private resumeToken?: string;
  private sessionId?: string;
  private socket?: SessionSocket;
  private socketGeneration = 0;
  private reconnectTimer?: unknown;
  private reconnectAttempts = 0;
  private manualClose = false;
  private nextPingId = 0;

  constructor(dependencies: ClientSessionDependencies) {
    this.socketFactory = dependencies.socketFactory;
    this.createCommandId = dependencies.createCommandId ?? defaultCommandId;
    this.scheduler = dependencies.scheduler ?? defaultScheduler;
    this.random = dependencies.random ?? Math.random;
    this.now = dependencies.now ?? Date.now;
    this.policy = validPolicy({
      ...DEFAULT_CLIENT_SESSION_POLICY,
      ...dependencies.policy,
    });
  }

  getSnapshot = (): ClientSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  connect(options: ConnectSessionOptions): void {
    this.cancelReconnect();
    this.closeSocket(1000, 'Session replaced');
    this.socketGeneration += 1;
    this.pending.length = 0;
    this.pingTimes.clear();
    this.options = {
      url: options.url,
      buildId: options.buildId,
      roomCode: options.roomCode,
      displayName: options.displayName,
      requestedRole: options.requestedRole,
    };
    this.admissionTicket = options.admissionTicket;
    this.resumeToken = undefined;
    this.sessionId = undefined;
    this.reconnectAttempts = 0;
    this.manualClose = false;
    this.state = { ...initialState(), phase: 'connecting' };
    this.emit();
    this.openSocket();
  }

  submit(command: WireGameCommand): SubmitCommandResult {
    if (this.state.phase !== 'ready' || !this.sessionId) {
      return { queued: false, reason: 'not_ready' };
    }
    if (this.state.role !== 'player') {
      return { queued: false, reason: 'spectator' };
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
    this.pending.push({ envelope, status: 'queued', retries: 0 });
    this.updateState({ nextClientSequence: clientSequence + 1 });
    this.publishPending();
    this.sendHead();
    return { queued: true, commandId, clientSequence };
  }

  sendChat(message: string): boolean {
    if (this.state.phase !== 'ready') return false;
    return this.send({
      type: 'SendChat',
      protocolVersion: PROTOCOL_VERSION,
      message,
    });
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

  disconnect(): void {
    if (this.state.phase === 'closed') return;
    this.manualClose = true;
    this.cancelReconnect();
    if (this.state.phase === 'ready') {
      this.send({ type: 'Leave', protocolVersion: PROTOCOL_VERSION });
    }
    this.closeSocket(1000, 'Client left room');
    this.socketGeneration += 1;
    this.clearCapabilities();
    this.updateState({ phase: 'closed', reconnectAttempt: 0 });
  }

  private openSocket(): void {
    const options = this.options;
    if (!options) return;
    const generation = ++this.socketGeneration;
    try {
      const socket = this.socketFactory.open(options.url, {
        open: () => {
          if (!this.isCurrent(generation)) return;
          this.updateState({ phase: 'handshaking' });
          const capability = this.resumeToken ?? this.admissionTicket;
          if (!capability) {
            this.fail({
              code: 'sequence_divergence',
              message: 'No admission capability is available',
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
            ...(this.resumeToken
              ? { resumeToken: capability }
              : { admissionTicket: capability }),
          });
          if (!sent) {
            this.reconnectTransport('Admission handshake write failed');
          }
        },
        message: (frame) => {
          if (this.isCurrent(generation)) this.handleFrame(frame);
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
      case 'CommandResult':
        this.handleCommandResult(message);
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
      case 'Presence':
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
      case 'ServerNotice':
        this.updateState({
          notices: appendBounded(
            this.state.notices,
            message,
            this.policy.maximumNotices
          ),
        });
        if (message.retryable && this.state.phase === 'ready') {
          this.retryHead();
        } else if (message.retryable && this.state.phase === 'handshaking') {
          this.reconnectTransport('Admission retry requested');
        } else if (!message.retryable && this.state.phase === 'handshaking') {
          this.fail({
            code: 'admission_rejected',
            message: `Room admission was rejected: ${message.code}`,
          });
        }
        return;
      case 'SessionSuperseded':
        this.manualClose = true;
        this.cancelReconnect();
        this.closeSocket(4409, 'Session superseded');
        this.socketGeneration += 1;
        this.clearCapabilities();
        this.updateState({ phase: 'superseded', reconnectAttempt: 0 });
        return;
    }
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
    if (!this.installView(hydrateMatchViewState(message.snapshot), true))
      return;
    this.sessionId = message.sessionId;
    this.resumeToken = message.resumeToken ?? this.resumeToken;
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
    });
    this.publishPending();
    this.sendHead();
  }

  private handlePublication(
    message: Extract<ServerMessage, { type: 'StatePublication' }>
  ): void {
    if (this.state.phase !== 'ready') return;
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
    const previousRevision = this.state.view?.revision ?? -1;
    if (!this.installView(hydrateMatchViewState(message.snapshot))) return;
    if (
      message.snapshot.revision > previousRevision &&
      message.presentationEvents
    ) {
      this.updateState({
        presentationEvents: appendManyBounded(
          this.state.presentationEvents,
          message.presentationEvents,
          this.policy.maximumPresentationEvents
        ),
      });
    }
    if (message.coveringCommandId) {
      const pending = this.pending.find(
        (item) => item.envelope.commandId === message.coveringCommandId
      );
      if (pending) pending.publicationRevision = message.snapshot.revision;
    }
    this.finishHeadIfComplete();
    this.publishPending();
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
      pendingCommands: this.pending.map((item) => ({
        commandId: item.envelope.commandId,
        clientSequence: item.envelope.clientSequence,
        commandType: item.envelope.command.type,
        state: item.status,
      })),
    });
    this.sendHead();
  }

  private installView(
    candidate: NonNullable<ClientSessionState['view']>,
    authoritativeReplacement = false
  ): boolean {
    const current = this.state.view;
    if (current && candidate.revision < current.revision) return true;
    if (
      current &&
      candidate.revision === current.revision &&
      stableSerialize(candidate) !== stableSerialize(current)
    ) {
      if (authoritativeReplacement) {
        this.updateState({ view: candidate });
        return true;
      }
      this.fail({
        code: 'inconsistent_publication',
        message: 'Equal state revisions contained different projections',
      });
      return false;
    }
    if (!current || candidate.revision > current.revision) {
      this.updateState({ view: candidate });
    }
    return true;
  }

  private sendHead(): void {
    if (this.state.phase !== 'ready') return;
    const head = this.pending[0];
    if (!head || head.status !== 'queued') return;
    head.status = 'in_flight';
    this.publishPending();
    if (!this.sendEnvelope(head.envelope)) {
      this.reconnectTransport('Command write failed');
    }
  }

  private retryHead(): void {
    const head = this.pending[0];
    if (!head) return;
    if (head.retries >= this.policy.maximumCommandRetries) {
      this.fail({
        code: 'command_retry_exhausted',
        message: 'The in-flight command exceeded its bounded retry budget',
      });
      return;
    }
    head.retries += 1;
    if (!this.sendEnvelope(head.envelope)) {
      this.reconnectTransport('Command retry write failed');
    }
  }

  private send(message: ClientMessage): boolean {
    return this.sendEnvelope(message);
  }

  private sendEnvelope(message: ClientMessage): boolean {
    try {
      if (!this.socket) return false;
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private handleClose(event: SessionSocketCloseEvent): void {
    this.socket = undefined;
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
      this.updateState({ phase: 'closed', reconnectAttempt: 0 });
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.policy.maximumReconnectAttempts) {
      this.fail({
        code: 'reconnect_exhausted',
        message: 'The session exceeded its bounded reconnect budget',
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
    this.updateState({
      phase: 'reconnecting',
      reconnectAttempt: this.reconnectAttempts,
    });
    this.reconnectTimer = this.scheduler.schedule(() => {
      this.reconnectTimer = undefined;
      if (this.state.phase !== 'reconnecting') return;
      this.updateState({ phase: 'connecting' });
      this.openSocket();
    }, delay);
  }

  private reconnectTransport(reason: string): void {
    this.closeSocket(1012, reason);
    this.socketGeneration += 1;
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
    this.closeSocket(4400, failure.code);
    this.socketGeneration += 1;
    this.clearCapabilities();
    this.updateState({ phase: 'failed', failure });
  }

  private clearCapabilities(): void {
    this.admissionTicket = undefined;
    this.resumeToken = undefined;
    this.sessionId = undefined;
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
    this.updateState({
      pendingCommands: this.pending.map((item) => ({
        commandId: item.envelope.commandId,
        clientSequence: item.envelope.clientSequence,
        commandType: item.envelope.command.type,
        state: item.status,
      })),
    });
  }

  private updateState(patch: Partial<ClientSessionState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
