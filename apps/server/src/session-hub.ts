import {
  assertAdmissionTransactionTransition,
  buildProjectedReplay,
  disconnectRoomSession,
  expireDisconnectedRoomSessions,
  issueRoomAdmissionTicket,
  issueRoomInvitation,
  leaveRoomSession,
  RoomAuthorityCoordinator,
  type AdmissionTicketIssueRequest,
  type AuthorityCommandTimingBreakdown,
  type AuthoritySession,
  type AuthoritySnapshotStore,
  type RoomInvitationDependencies,
  type RoomInvitationIssueRequest,
} from '@ptcgsim/room-authority';
import {
  PROTOCOL_VERSION,
  SESSION_RECONNECT_GRACE_MS,
  parseClientFrame,
  serializeMatchViewState,
  type ClientMessage,
  type ServerMessage,
} from '@ptcgsim/protocol';

import { establishSession } from './session-handshake.js';
import { RoomChatService } from './room-chat.js';
import { sessionPresentationIdentity } from './session-presentation-identity.js';
import type {
  BoundedAdmissionTicketIssueResult,
  BoundedRoomInvitationIssueResult,
  RoomRateLimitDecision,
  RoomRateLimitPort,
} from './room-rate-limit.js';
import type {
  RoomCommandPhaseDurations,
  ServerTelemetryPort,
} from './server-telemetry.js';

const MAX_RECENT_ACCEPTED_COMMAND_PERFORMANCE = 32;

export interface AcceptedCommandPerformanceObservation {
  readonly endRevision: number;
  readonly totalMs: number;
  readonly phases: RoomCommandPhaseDurations;
  readonly breakdown: AuthorityCommandTimingBreakdown;
}

export interface RuntimeConnection {
  readonly id: string;
  readonly send: (frame: string) => void;
  readonly close: (code: number, reason: string) => void;
}

export interface SessionHubDependencies {
  readonly admission: RoomInvitationDependencies & {
    readonly now: () => number;
  };
  readonly rateLimits: RoomRateLimitPort;
  readonly store: AuthoritySnapshotStore;
  readonly telemetry: ServerTelemetryPort;
  readonly monotonicNow: () => number;
}

const notice = (
  code: string,
  message: string,
  retryable = false
): ServerMessage => ({
  type: 'ServerNotice',
  protocolVersion: PROTOCOL_VERSION,
  code,
  message,
  retryable,
});

const encodedBytes = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

const serializedMessageBytes = (message: ServerMessage): number => {
  try {
    return encodedBytes(JSON.stringify(message));
  } catch {
    return 0;
  }
};

const boundedObservedDuration = (value: number): number =>
  Number.isFinite(value) && value >= 0 ? Math.min(value, 86_400_000) : 0;

const boundedCommandPhases = (
  phases: RoomCommandPhaseDurations
): RoomCommandPhaseDurations => ({
  authorityProcessingMs: boundedObservedDuration(phases.authorityProcessingMs),
  projectionMs: boundedObservedDuration(phases.projectionMs),
  persistenceMs: boundedObservedDuration(phases.persistenceMs),
  publicationSerializationMs: boundedObservedDuration(
    phases.publicationSerializationMs
  ),
  socketSendMs: boundedObservedDuration(phases.socketSendMs),
});

const boundedCommandBreakdown = (
  breakdown: AuthorityCommandTimingBreakdown
): AuthorityCommandTimingBreakdown => ({
  inputValidationMs: boundedObservedDuration(breakdown.inputValidationMs),
  resolutionAndExecutionMs: boundedObservedDuration(
    breakdown.resolutionAndExecutionMs
  ),
  historyAndCandidateMs: boundedObservedDuration(
    breakdown.historyAndCandidateMs
  ),
  candidateValidationMs: boundedObservedDuration(
    breakdown.candidateValidationMs
  ),
  snapshotValidationMs: boundedObservedDuration(breakdown.snapshotValidationMs),
  predecessorValidationMs: boundedObservedDuration(
    breakdown.predecessorValidationMs
  ),
  frontierFastPathHit: breakdown.frontierFastPathHit === 1 ? 1 : 0,
  transactionMs: boundedObservedDuration(breakdown.transactionMs),
});

export class RoomSessionHub {
  private tail: Promise<void> = Promise.resolve();
  private readonly connections = new Map<string, RuntimeConnection>();
  private readonly connectionSessions = new Map<string, string>();
  private readonly sessionConnections = new Map<string, string>();
  private readonly pendingDisconnects = new Map<string, boolean>();
  private readonly chat: RoomChatService;
  private readonly acceptedCommandPerformance: AcceptedCommandPerformanceObservation[] =
    [];
  private nextReplayId = 1;

  constructor(
    private readonly coordinator: RoomAuthorityCoordinator,
    private readonly buildId: string,
    private readonly dependencies: SessionHubDependencies
  ) {
    this.chat = new RoomChatService({
      rateLimits: dependencies.rateLimits,
      telemetry: dependencies.telemetry,
      now: dependencies.admission.now,
      nextMessageIdCandidate: () =>
        dependencies.admission.crypto.nextSessionId(),
    });
  }

  handleFrame(connection: RuntimeConnection, frame: string): Promise<void> {
    this.connections.set(connection.id, connection);
    const run = this.tail.then(async () => {
      try {
        await this.processFrame(connection, frame);
      } finally {
        await this.flushPendingDisconnects();
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  issueAdmissionTicket(
    request: AdmissionTicketIssueRequest
  ): Promise<BoundedAdmissionTicketIssueResult> {
    const startedAt = this.dependencies.monotonicNow();
    const run = this.tail.then(async () => {
      try {
        const now = this.dependencies.admission.now();
        const rateLimit = await this.dependencies.rateLimits.attempt(
          'admission_ticket',
          now
        );
        this.dependencies.telemetry.roomRateLimit({
          operation: 'admission_ticket',
          allowed: rateLimit.allowed,
          ...(!rateLimit.allowed
            ? { retryAfterSeconds: rateLimit.retryAfterSeconds }
            : {}),
        });
        if (!rateLimit.allowed) {
          this.dependencies.telemetry.roomAdmission({
            operation: 'ticket_issue',
            requestedRole: request.requestedRole,
            outcome: 'rate_limited',
            reason: 'rate_limited',
            authorityVersion:
              this.coordinator.currentSnapshot().authorityVersion,
            durationMs: this.dependencies.monotonicNow() - startedAt,
          });
          return {
            accepted: false,
            code: 'rate_limited',
            retryAfterSeconds: rateLimit.retryAfterSeconds,
            snapshot: this.coordinator.currentSnapshot(),
          } as const;
        }
        const result = await issueRoomAdmissionTicket(
          this.coordinator.currentSnapshot(),
          request,
          now,
          this.dependencies.admission
        );
        if (result.accepted) {
          this.coordinator.installCommittedSnapshot(result.snapshot);
        }
        this.dependencies.telemetry.roomAdmission({
          operation: 'ticket_issue',
          requestedRole: request.requestedRole,
          outcome: result.accepted ? 'accepted' : 'rejected',
          ...(!result.accepted ? { reason: result.code } : {}),
          authorityVersion: result.snapshot.authorityVersion,
          durationMs: this.dependencies.monotonicNow() - startedAt,
        });
        return result;
      } catch (error) {
        const durable = await this.dependencies.store.load();
        if (durable) this.coordinator.installCommittedSnapshot(durable);
        this.dependencies.telemetry.roomAdmission({
          operation: 'ticket_issue',
          requestedRole: request.requestedRole,
          outcome: 'failed',
          reason: 'internal_retryable',
          authorityVersion: this.coordinator.currentSnapshot().authorityVersion,
          durationMs: this.dependencies.monotonicNow() - startedAt,
        });
        this.dependencies.telemetry.failure({
          subsystem: 'ticket_issue',
          retryable: true,
        });
        throw error;
      }
    });
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  issueInvitation(
    request: RoomInvitationIssueRequest
  ): Promise<BoundedRoomInvitationIssueResult> {
    const startedAt = this.dependencies.monotonicNow();
    const run = this.tail.then(async () => {
      try {
        const now = this.dependencies.admission.now();
        const rateLimit = await this.dependencies.rateLimits.attempt(
          'invitation',
          now
        );
        this.dependencies.telemetry.roomRateLimit({
          operation: 'invitation',
          allowed: rateLimit.allowed,
          ...(!rateLimit.allowed
            ? { retryAfterSeconds: rateLimit.retryAfterSeconds }
            : {}),
        });
        if (!rateLimit.allowed) {
          this.dependencies.telemetry.roomAdmission({
            operation: 'invitation_issue',
            requestedRole: request.requestedRole,
            outcome: 'rate_limited',
            reason: 'rate_limited',
            authorityVersion:
              this.coordinator.currentSnapshot().authorityVersion,
            durationMs: this.dependencies.monotonicNow() - startedAt,
          });
          return {
            accepted: false,
            code: 'rate_limited',
            retryAfterSeconds: rateLimit.retryAfterSeconds,
            snapshot: this.coordinator.currentSnapshot(),
          } as const;
        }
        const result = await issueRoomInvitation(
          this.coordinator.currentSnapshot(),
          request,
          now,
          this.dependencies.admission
        );
        if (result.accepted) {
          this.coordinator.installCommittedSnapshot(result.snapshot);
        }
        this.dependencies.telemetry.roomAdmission({
          operation: 'invitation_issue',
          requestedRole: request.requestedRole,
          outcome: result.accepted ? 'accepted' : 'rejected',
          ...(!result.accepted ? { reason: result.code } : {}),
          authorityVersion: result.snapshot.authorityVersion,
          durationMs: this.dependencies.monotonicNow() - startedAt,
        });
        return result;
      } catch (error) {
        const durable = await this.dependencies.store.load();
        if (durable) this.coordinator.installCommittedSnapshot(durable);
        this.dependencies.telemetry.roomAdmission({
          operation: 'invitation_issue',
          requestedRole: request.requestedRole,
          outcome: 'failed',
          reason: 'internal_retryable',
          authorityVersion: this.coordinator.currentSnapshot().authorityVersion,
          durationMs: this.dependencies.monotonicNow() - startedAt,
        });
        this.dependencies.telemetry.failure({
          subsystem: 'invitation_issue',
          retryable: true,
        });
        throw error;
      }
    });
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  reserveSocketUpgrade(): Promise<RoomRateLimitDecision> {
    const run = this.tail.then(async () => {
      const decision = await this.dependencies.rateLimits.attempt(
        'socket_upgrade',
        this.dependencies.admission.now()
      );
      this.dependencies.telemetry.roomRateLimit({
        operation: 'socket_upgrade',
        allowed: decision.allowed,
        ...(!decision.allowed
          ? { retryAfterSeconds: decision.retryAfterSeconds }
          : {}),
      });
      return decision;
    });
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  disconnect(connectionId: string): Promise<void> {
    const run = this.tail.then(async () => {
      const sessionId = this.disconnectNow(connectionId);
      if (sessionId) this.queueSessionDisconnect(sessionId, true);
      await this.flushPendingDisconnects();
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private disconnectNow(connectionId: string): string | undefined {
    this.connections.delete(connectionId);
    this.chat.releaseConnection(connectionId);
    const sessionId = this.connectionSessions.get(connectionId);
    this.connectionSessions.delete(connectionId);
    if (sessionId && this.sessionConnections.get(sessionId) === connectionId) {
      this.sessionConnections.delete(sessionId);
      return sessionId;
    }
    return undefined;
  }

  private queueSessionDisconnect(
    sessionId: string,
    publishPresence: boolean
  ): void {
    this.pendingDisconnects.set(
      sessionId,
      Boolean(this.pendingDisconnects.get(sessionId)) || publishPresence
    );
  }

  private async flushPendingDisconnects(): Promise<void> {
    while (this.pendingDisconnects.size > 0) {
      const pending = [...this.pendingDisconnects];
      this.pendingDisconnects.clear();
      for (const [sessionId, publishPresence] of pending) {
        if (this.sessionConnections.has(sessionId)) continue;
        try {
          await this.persistSessionDisconnect(sessionId, publishPresence);
        } catch (error) {
          this.queueSessionDisconnect(sessionId, publishPresence);
          throw error;
        }
      }
    }
  }

  private async persistSessionDisconnect(
    sessionId: string,
    publishPresence: boolean
  ): Promise<void> {
    const before = this.coordinator.currentSnapshot();
    const existing = before.sessions[sessionId];
    if (!existing?.active) return;
    const now = this.dependencies.admission.now();
    try {
      const result = await disconnectRoomSession(
        before,
        sessionId,
        now,
        this.dependencies.admission.persistence
      );
      if (!result.accepted) return;
      this.coordinator.installCommittedSnapshot(result.snapshot);
      if (publishPresence && result.committed) {
        this.broadcastPresence(result.snapshot, sessionId, 'disconnected');
      }
    } catch (error) {
      let durable:
        ReturnType<RoomAuthorityCoordinator['currentSnapshot']> | undefined;
      try {
        durable = await this.dependencies.store.load();
      } catch {
        // The original disconnect failure remains authoritative.
      }
      if (
        durable &&
        this.isCommittedDisconnect(before, durable, sessionId, now)
      ) {
        this.coordinator.installCommittedSnapshot(durable);
        if (publishPresence) {
          this.broadcastPresence(durable, sessionId, 'disconnected');
        }
        return;
      }
      if (durable) this.coordinator.installCommittedSnapshot(durable);
      this.dependencies.telemetry.failure({
        subsystem: 'session_disconnect',
        retryable: true,
      });
      throw error;
    }
  }

  private isCommittedDisconnect(
    before: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    durable: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    sessionId: string,
    disconnectedAt: number
  ): boolean {
    try {
      assertAdmissionTransactionTransition(before, {
        expectedAuthorityVersion: before.authorityVersion,
        snapshot: durable,
        sessionId,
        kind: 'session_disconnected',
        disconnectedAt,
        reconnectExpiresAt: disconnectedAt + SESSION_RECONNECT_GRACE_MS,
      });
      return true;
    } catch {
      return false;
    }
  }

  restoreBinding(connection: RuntimeConnection, sessionId?: string): void {
    this.connections.set(connection.id, connection);
    if (!sessionId) return;
    const session = this.coordinator.currentSnapshot().sessions[sessionId];
    if (!session?.active || session.reconnectExpiresAt !== undefined) return;
    const previousConnectionId = this.sessionConnections.get(sessionId);
    if (previousConnectionId && previousConnectionId !== connection.id) {
      const previous = this.connections.get(previousConnectionId);
      if (previous) {
        this.send(
          previous,
          {
            type: 'SessionSuperseded',
            protocolVersion: PROTOCOL_VERSION,
          },
          false
        );
        previous.close(4409, 'Session superseded');
      }
      this.connectionSessions.delete(previousConnectionId);
    }
    this.connectionSessions.set(connection.id, sessionId);
    this.sessionConnections.set(sessionId, connection.id);
  }

  bindingForConnection(connectionId: string): {
    readonly sessionId?: string;
    readonly authorityVersion: number;
  } {
    const sessionId = this.connectionSessions.get(connectionId);
    return {
      ...(sessionId ? { sessionId } : {}),
      authorityVersion: this.coordinator.currentSnapshot().authorityVersion,
    };
  }

  recentAcceptedCommandPerformance(): readonly AcceptedCommandPerformanceObservation[] {
    return this.acceptedCommandPerformance.map((observation) => ({
      ...observation,
      phases: { ...observation.phases },
      breakdown: { ...observation.breakdown },
    }));
  }

  private send(
    connection: RuntimeConnection,
    message: ServerMessage,
    publishDisconnect = true
  ): boolean {
    try {
      connection.send(JSON.stringify(message));
      return true;
    } catch {
      const sessionId = this.disconnectNow(connection.id);
      if (sessionId) {
        this.queueSessionDisconnect(sessionId, publishDisconnect);
      }
      this.dependencies.telemetry.failure({
        subsystem: 'socket_send',
        retryable: true,
      });
      this.dependencies.telemetry.roomSocket({
        outcome: 'error',
        activeSockets: this.connections.size,
      });
      return false;
    }
  }

  /** Broadcasts only to the currently bound sockets for active room sessions. */
  private broadcastToActiveSessions(
    snapshot: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    message: ServerMessage
  ): void {
    for (const [sessionId, connectionId] of this.sessionConnections) {
      if (!snapshot.sessions[sessionId]?.active) continue;
      const target = this.connections.get(connectionId);
      if (target) this.send(target, message);
    }
  }

  private broadcastPresence(
    snapshot: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    sessionId: string,
    status: Extract<ServerMessage, { type: 'Presence' }>['status']
  ): void {
    const session = snapshot.sessions[sessionId];
    const identity = sessionPresentationIdentity(snapshot, sessionId);
    if (!session?.active || !identity) return;
    this.broadcastToActiveSessions(snapshot, {
      type: 'Presence',
      protocolVersion: PROTOCOL_VERSION,
      ...identity,
      status,
    });
  }

  nextReconnectExpiry(): number | undefined {
    return Object.values(this.coordinator.currentSnapshot().sessions).reduce<
      number | undefined
    >(
      (next, session) =>
        session.reconnectExpiresAt === undefined
          ? next
          : next === undefined
            ? session.reconnectExpiresAt
            : Math.min(next, session.reconnectExpiresAt),
      undefined
    );
  }

  reconcileDisconnectedBindings(): Promise<number | undefined> {
    const run = this.tail.then(async () => {
      for (const session of Object.values(
        this.coordinator.currentSnapshot().sessions
      )) {
        if (
          session.active &&
          session.reconnectExpiresAt === undefined &&
          !this.sessionConnections.has(session.id)
        ) {
          this.queueSessionDisconnect(session.id, true);
        }
      }
      await this.flushPendingDisconnects();
      return this.nextReconnectExpiry();
    });
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  expireDisconnectedSessions(now: number): Promise<number | undefined> {
    const run = this.tail.then(async () => {
      await this.flushPendingDisconnects();
      const before = this.coordinator.currentSnapshot();
      const expiredSessions = Object.values(before.sessions)
        .filter(
          (session) =>
            session.reconnectExpiresAt !== undefined &&
            session.reconnectExpiresAt <= now
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      try {
        const result = await expireDisconnectedRoomSessions(
          before,
          now,
          this.dependencies.admission.persistence
        );
        if (result.committed) {
          this.finishExpiredSessions(
            before,
            result.snapshot,
            result.expiredSessions
          );
        }
      } catch (error) {
        let durable:
          ReturnType<RoomAuthorityCoordinator['currentSnapshot']> | undefined;
        try {
          durable = await this.dependencies.store.load();
        } catch {
          // The original expiry failure remains authoritative.
        }
        if (
          durable &&
          this.isCommittedExpiry(before, durable, expiredSessions, now)
        ) {
          this.finishExpiredSessions(before, durable, expiredSessions);
        } else {
          if (durable) this.coordinator.installCommittedSnapshot(durable);
          this.dependencies.telemetry.failure({
            subsystem: 'session_expiry',
            retryable: true,
          });
          throw error;
        }
      } finally {
        await this.flushPendingDisconnects();
      }
      return this.nextReconnectExpiry();
    });
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private finishExpiredSessions(
    before: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    committed: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    expiredSessions: readonly AuthoritySession[]
  ): void {
    const identities = expiredSessions.flatMap((session) => {
      const identity = sessionPresentationIdentity(before, session.id);
      return identity ? [identity] : [];
    });
    this.coordinator.installCommittedSnapshot(committed);
    for (const identity of identities) {
      this.broadcastToActiveSessions(committed, {
        type: 'Presence',
        protocolVersion: PROTOCOL_VERSION,
        ...identity,
        status: 'left',
      });
    }
  }

  private isCommittedExpiry(
    before: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    durable: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    expiredSessions: readonly AuthoritySession[],
    expiredAt: number
  ): boolean {
    if (expiredSessions.length === 0) return false;
    try {
      assertAdmissionTransactionTransition(before, {
        expectedAuthorityVersion: before.authorityVersion,
        snapshot: durable,
        kind: 'sessions_expired',
        sessionIds: expiredSessions.map((session) => session.id),
        expiredAt,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async processFrame(
    connection: RuntimeConnection,
    frame: string
  ): Promise<void> {
    const parsed = parseClientFrame(frame);
    if (!parsed.ok) {
      const revision = this.coordinator.currentSnapshot().state.revision;
      this.dependencies.telemetry.roomCommand({
        commandType: 'Unknown',
        outcome: 'rejected',
        reason: 'invalid_message',
        startRevision: revision,
        endRevision: revision,
        requestBytes: encodedBytes(frame),
        publicationBytes: 0,
        deliveryCount: 0,
        durationMs: 0,
      });
      this.send(
        connection,
        notice('invalid_message', `Message rejected: ${parsed.reason}`)
      );
      return;
    }
    const message = parsed.value;
    const boundSessionId = this.connectionSessions.get(connection.id);

    if (message.type === 'Hello') {
      if (boundSessionId) {
        this.dependencies.telemetry.roomAdmission({
          operation: message.resumeToken ? 'hello_resume' : 'hello_ticket',
          requestedRole: message.requestedRole,
          outcome: 'rejected',
          reason: 'invalid_admission',
          authorityVersion: this.coordinator.currentSnapshot().authorityVersion,
          durationMs: 0,
        });
        this.send(
          connection,
          notice('already_admitted', 'This connection is already admitted')
        );
        return;
      }
      await this.handleHello(connection, message);
      return;
    }
    if (!boundSessionId) {
      if (message.type === 'Command') {
        const revision = this.coordinator.currentSnapshot().state.revision;
        this.dependencies.telemetry.roomCommand({
          commandType: message.command.type,
          outcome: 'rejected',
          reason: 'admission_required',
          startRevision: revision,
          endRevision: revision,
          requestBytes: encodedBytes(frame),
          publicationBytes: 0,
          deliveryCount: 0,
          durationMs: 0,
        });
      }
      this.send(
        connection,
        notice('hello_required', 'Send Hello before messages')
      );
      return;
    }

    switch (message.type) {
      case 'Command': {
        if (message.sessionId !== boundSessionId) {
          const revision = this.coordinator.currentSnapshot().state.revision;
          this.dependencies.telemetry.roomCommand({
            commandType: message.command.type,
            outcome: 'rejected',
            reason: 'unauthorized',
            startRevision: revision,
            endRevision: revision,
            requestBytes: encodedBytes(frame),
            publicationBytes: 0,
            deliveryCount: 0,
            durationMs: 0,
          });
          this.send(
            connection,
            notice(
              'invalid_session',
              'Command session does not match connection'
            )
          );
          return;
        }
        const startedAt = this.dependencies.monotonicNow();
        const before = this.coordinator.currentSnapshot();
        const duplicate = before.sessions[boundSessionId]?.recentOutcomes.some(
          (outcome) => outcome.commandId === message.commandId
        );
        try {
          const result = await this.coordinator.submit(message);
          const commandResult = result.deliveries
            .map((delivery) => delivery.message)
            .find(
              (
                candidate
              ): candidate is Extract<
                ServerMessage,
                { type: 'CommandResult' }
              > =>
                candidate.type === 'CommandResult' &&
                candidate.commandId === message.commandId
            );
          const publicationSerializationStartedAt =
            this.dependencies.monotonicNow();
          const publicationBytes = result.deliveries.reduce(
            (total, delivery) =>
              delivery.message.type === 'StatePublication'
                ? total + serializedMessageBytes(delivery.message)
                : total,
            0
          );
          const publicationSerializationFinishedAt =
            this.dependencies.monotonicNow();
          const socketSendStartedAt = this.dependencies.monotonicNow();
          for (const delivery of result.deliveries) {
            const targetConnectionId = this.sessionConnections.get(
              delivery.sessionId
            );
            const target = targetConnectionId
              ? this.connections.get(targetConnectionId)
              : undefined;
            if (target) this.send(target, delivery.message);
          }
          const socketSendFinishedAt = this.dependencies.monotonicNow();
          const commandOutcome = duplicate
            ? ('duplicate' as const)
            : commandResult?.accepted
              ? ('accepted' as const)
              : ('rejected' as const);
          const phases: RoomCommandPhaseDurations = {
            authorityProcessingMs: result.timing.authorityProcessingMs,
            projectionMs: result.timing.projectionMs,
            persistenceMs: result.timing.persistenceMs,
            publicationSerializationMs:
              publicationSerializationFinishedAt -
              publicationSerializationStartedAt,
            socketSendMs: socketSendFinishedAt - socketSendStartedAt,
          };
          const durationMs = socketSendFinishedAt - startedAt;
          if (commandOutcome === 'accepted') {
            this.acceptedCommandPerformance.push({
              endRevision: result.snapshot.state.revision,
              totalMs: boundedObservedDuration(durationMs),
              phases: boundedCommandPhases(phases),
              breakdown: boundedCommandBreakdown(result.timing.breakdown),
            });
            this.acceptedCommandPerformance.splice(
              0,
              Math.max(
                0,
                this.acceptedCommandPerformance.length -
                  MAX_RECENT_ACCEPTED_COMMAND_PERFORMANCE
              )
            );
          }
          this.dependencies.telemetry.roomCommand({
            commandType: message.command.type,
            outcome: commandOutcome,
            ...(commandResult && !commandResult.accepted
              ? { reason: commandResult.code }
              : {}),
            startRevision: before.state.revision,
            endRevision: result.snapshot.state.revision,
            requestBytes: encodedBytes(frame),
            publicationBytes,
            deliveryCount: result.deliveries.length,
            phases,
            durationMs,
          });
        } catch {
          this.dependencies.telemetry.roomCommand({
            commandType: message.command.type,
            outcome: 'failed',
            reason: 'internal_retryable',
            startRevision: before.state.revision,
            endRevision: this.coordinator.currentSnapshot().state.revision,
            requestBytes: encodedBytes(frame),
            publicationBytes: 0,
            deliveryCount: 0,
            durationMs: this.dependencies.monotonicNow() - startedAt,
          });
          this.dependencies.telemetry.failure({
            subsystem: 'command_processing',
            retryable: true,
          });
          this.send(
            connection,
            notice(
              'internal_retryable',
              'The command could not be durably committed; retry it',
              true
            )
          );
        }
        return;
      }
      case 'Ping':
        this.send(connection, {
          type: 'Pong',
          protocolVersion: PROTOCOL_VERSION,
          id: message.id,
        });
        return;
      case 'SendChat': {
        const snapshot = this.coordinator.currentSnapshot();
        const prepared = await this.chat.prepareDelivery({
          snapshot,
          sessionId: boundSessionId,
          connectionId: connection.id,
          message: message.message,
        });
        if (prepared.accepted) {
          this.broadcastToActiveSessions(snapshot, prepared.message);
        } else {
          this.send(connection, prepared.notice);
        }
        return;
      }
      case 'DeclareMulligan': {
        const snapshot = this.coordinator.currentSnapshot();
        const session = snapshot.sessions[boundSessionId];
        if (!session?.active) {
          this.send(
            connection,
            notice('session_superseded', 'Session is no longer active')
          );
          return;
        }
        if (session.viewer.kind !== 'player') {
          this.send(
            connection,
            notice('unauthorized', 'Only a player can declare a mulligan')
          );
          return;
        }
        this.broadcastToActiveSessions(snapshot, {
          type: 'MulliganAnnouncement',
          protocolVersion: PROTOCOL_VERSION,
          event: {
            type: 'MulliganDeclared',
            revision: snapshot.state.revision,
            playerId: session.viewer.playerId,
          },
        });
        return;
      }
      case 'DeclareDeckView': {
        const snapshot = this.coordinator.currentSnapshot();
        const session = snapshot.sessions[boundSessionId];
        if (!session?.active) {
          this.send(
            connection,
            notice('session_superseded', 'Session is no longer active')
          );
          return;
        }
        if (session.viewer.kind !== 'player') {
          this.send(
            connection,
            notice('unauthorized', 'Only a player can declare a deck view')
          );
          return;
        }
        this.broadcastToActiveSessions(snapshot, {
          type: 'DeckViewAnnouncement',
          protocolVersion: PROTOCOL_VERSION,
          event: {
            type: 'DeckViewDeclared',
            revision: snapshot.state.revision,
            playerId: session.viewer.playerId,
          },
        });
        return;
      }
      case 'RequestReplay': {
        const snapshot = this.coordinator.currentSnapshot();
        const session = snapshot.sessions[boundSessionId];
        if (!session?.active) {
          this.send(
            connection,
            notice('session_superseded', 'Replay session is no longer active')
          );
          return;
        }
        try {
          const replay = buildProjectedReplay(
            snapshot.replayHistory,
            session.viewer,
            this.dependencies.admission.opaqueIds,
            snapshot.mode
          );
          const replayId = `replay-${this.nextReplayId++}`;
          this.send(connection, {
            type: 'ReplayStarted',
            protocolVersion: PROTOCOL_VERSION,
            replayId,
            viewer: replay.viewer,
            startRevision: replay.startRevision,
            endRevision: replay.endRevision,
            truncated: replay.truncated,
            frameCount: replay.frames.length,
            ...(replay.localDisclosureDefinitions
              ? {
                  localDisclosureDefinitions: [
                    ...replay.localDisclosureDefinitions,
                  ],
                }
              : {}),
          });
          replay.frames.forEach((frame, index) => {
            this.send(connection, {
              type: 'ReplayFrame',
              protocolVersion: PROTOCOL_VERSION,
              replayId,
              index,
              snapshot: serializeMatchViewState(frame.snapshot),
              ...(frame.localDisclosure
                ? {
                    localDisclosure: {
                      zoneIds: [...frame.localDisclosure.zoneIds],
                      cards: [...frame.localDisclosure.cards],
                    },
                  }
                : {}),
              ...(frame.presentationEvents.length > 0
                ? { presentationEvents: [...frame.presentationEvents] }
                : {}),
            });
          });
          this.send(connection, {
            type: 'ReplayCompleted',
            protocolVersion: PROTOCOL_VERSION,
            replayId,
            frameCount: replay.frames.length,
          });
        } catch {
          this.dependencies.telemetry.failure({
            subsystem: 'replay_projection',
            retryable: false,
          });
          this.send(
            connection,
            notice(
              'replay_unavailable',
              'The retained replay could not be projected'
            )
          );
        }
        return;
      }
      case 'Leave':
        await this.handleLeave(connection, boundSessionId);
        return;
    }
  }

  private async handleHello(
    connection: RuntimeConnection,
    hello: Extract<ClientMessage, { type: 'Hello' }>
  ): Promise<void> {
    const startedAt = this.dependencies.monotonicNow();
    const operation = hello.admissionTicket ? 'hello_ticket' : 'hello_resume';
    try {
      const rateLimit = await this.dependencies.rateLimits.attempt(
        'session_hello',
        this.dependencies.admission.now()
      );
      this.dependencies.telemetry.roomRateLimit({
        operation: 'session_hello',
        allowed: rateLimit.allowed,
        ...(!rateLimit.allowed
          ? { retryAfterSeconds: rateLimit.retryAfterSeconds }
          : {}),
      });
      if (!rateLimit.allowed) {
        this.dependencies.telemetry.roomAdmission({
          operation,
          requestedRole: hello.requestedRole,
          outcome: 'rate_limited',
          reason: 'rate_limited',
          authorityVersion: this.coordinator.currentSnapshot().authorityVersion,
          durationMs: this.dependencies.monotonicNow() - startedAt,
        });
        this.send(
          connection,
          notice(
            'rate_limited',
            `Too many admission attempts; retry in ${rateLimit.retryAfterSeconds} seconds`,
            true
          )
        );
        return;
      }
      const result = await establishSession(
        this.coordinator.currentSnapshot(),
        hello,
        this.buildId,
        this.dependencies.admission
      );
      if (!result.accepted) {
        this.dependencies.telemetry.roomAdmission({
          operation,
          requestedRole: hello.requestedRole,
          outcome: 'rejected',
          reason: result.message.code,
          authorityVersion: result.snapshot.authorityVersion,
          durationMs: this.dependencies.monotonicNow() - startedAt,
        });
        this.send(connection, result.message);
        return;
      }
      this.coordinator.installCommittedSnapshot(result.snapshot);
      const previousConnectionId = this.sessionConnections.get(
        result.sessionId
      );
      if (previousConnectionId && previousConnectionId !== connection.id) {
        const previous = this.connections.get(previousConnectionId);
        if (previous) {
          this.send(
            previous,
            {
              type: 'SessionSuperseded',
              protocolVersion: PROTOCOL_VERSION,
            },
            false
          );
          previous.close(4409, 'Session superseded');
        }
        this.connectionSessions.delete(previousConnectionId);
      }
      this.connectionSessions.set(connection.id, result.sessionId);
      this.sessionConnections.set(result.sessionId, connection.id);
      this.dependencies.telemetry.roomAdmission({
        operation,
        requestedRole: hello.requestedRole,
        outcome: 'accepted',
        authorityVersion: result.snapshot.authorityVersion,
        durationMs: this.dependencies.monotonicNow() - startedAt,
      });
      if (!this.send(connection, result.message, false)) return;
      for (const refresh of result.refreshes) {
        const targetConnectionId = this.sessionConnections.get(
          refresh.sessionId
        );
        const target = targetConnectionId
          ? this.connections.get(targetConnectionId)
          : undefined;
        if (target) this.send(target, refresh.message);
      }
      this.broadcastPresence(
        result.snapshot,
        result.sessionId,
        result.presenceStatus
      );
    } catch {
      const durable = await this.dependencies.store.load();
      if (durable) this.coordinator.installCommittedSnapshot(durable);
      this.dependencies.telemetry.roomAdmission({
        operation,
        requestedRole: hello.requestedRole,
        outcome: 'failed',
        reason: 'internal_retryable',
        authorityVersion: this.coordinator.currentSnapshot().authorityVersion,
        durationMs: this.dependencies.monotonicNow() - startedAt,
      });
      this.dependencies.telemetry.failure({
        subsystem: 'session_admission',
        retryable: true,
      });
      this.send(
        connection,
        notice(
          'internal_retryable',
          'Room admission could not be confirmed; retry the same capability',
          true
        )
      );
    }
  }

  private async handleLeave(
    connection: RuntimeConnection,
    sessionId: string
  ): Promise<void> {
    const startedAt = this.dependencies.monotonicNow();
    const before = this.coordinator.currentSnapshot();
    const session = before.sessions[sessionId];
    const requestedRole = session?.viewer.kind ?? 'spectator';
    try {
      const result = await leaveRoomSession(
        before,
        sessionId,
        this.dependencies.admission.persistence
      );
      if (!result.accepted) {
        this.dependencies.telemetry.roomAdmission({
          operation: 'session_leave',
          requestedRole,
          outcome: 'rejected',
          reason: 'invalid_admission',
          authorityVersion: result.snapshot.authorityVersion,
          durationMs: this.dependencies.monotonicNow() - startedAt,
        });
        this.disconnectNow(connection.id);
        connection.close(4409, 'Session is no longer active');
        return;
      }
      this.finishCommittedLeave(connection, before, result.snapshot, sessionId);
      this.dependencies.telemetry.roomAdmission({
        operation: 'session_leave',
        requestedRole,
        outcome: 'accepted',
        reason: 'none',
        authorityVersion: result.snapshot.authorityVersion,
        durationMs: this.dependencies.monotonicNow() - startedAt,
      });
    } catch {
      let durable:
        ReturnType<RoomAuthorityCoordinator['currentSnapshot']> | undefined;
      try {
        durable = await this.dependencies.store.load();
      } catch {
        // The original failure remains authoritative when reconciliation fails.
      }
      if (durable && this.isCommittedLeave(before, durable, sessionId)) {
        this.finishCommittedLeave(connection, before, durable, sessionId);
        this.dependencies.telemetry.roomAdmission({
          operation: 'session_leave',
          requestedRole,
          outcome: 'accepted',
          reason: 'none',
          authorityVersion: durable.authorityVersion,
          durationMs: this.dependencies.monotonicNow() - startedAt,
        });
        return;
      }
      if (durable) this.coordinator.installCommittedSnapshot(durable);
      this.dependencies.telemetry.roomAdmission({
        operation: 'session_leave',
        requestedRole,
        outcome: 'failed',
        reason: 'internal_retryable',
        authorityVersion: this.coordinator.currentSnapshot().authorityVersion,
        durationMs: this.dependencies.monotonicNow() - startedAt,
      });
      this.dependencies.telemetry.failure({
        subsystem: 'session_leave',
        retryable: true,
      });
      this.send(
        connection,
        notice(
          'internal_retryable',
          'Leaving the room could not be durably confirmed; retry Leave',
          true
        )
      );
    }
  }

  private finishCommittedLeave(
    connection: RuntimeConnection,
    before: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    committed: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    sessionId: string
  ): void {
    const identity = sessionPresentationIdentity(before, sessionId);
    this.coordinator.installCommittedSnapshot(committed);
    this.disconnectNow(connection.id);
    if (identity) {
      this.broadcastToActiveSessions(committed, {
        type: 'Presence',
        protocolVersion: PROTOCOL_VERSION,
        ...identity,
        status: 'left',
      });
    }
    connection.close(1000, 'Client left room');
  }

  private isCommittedLeave(
    before: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    durable: ReturnType<RoomAuthorityCoordinator['currentSnapshot']>,
    sessionId: string
  ): boolean {
    const priorSession = before.sessions[sessionId];
    const durableSession = durable.sessions[sessionId];
    if (
      !priorSession?.active ||
      durable.authorityVersion !== before.authorityVersion + 1 ||
      durableSession
    ) {
      return false;
    }
    return (
      priorSession.viewer.kind !== 'player' ||
      durable.admission?.seats[priorSession.viewer.playerId]
        ?.claimedSessionId === null
    );
  }
}
