import {
  buildProjectedReplay,
  issueRoomAdmissionTicket,
  issueRoomInvitation,
  RoomAuthorityCoordinator,
  type AdmissionTicketIssueRequest,
  type AuthorityCommandTimingBreakdown,
  type AuthoritySnapshotStore,
  type RoomInvitationDependencies,
  type RoomInvitationIssueRequest,
} from '@ptcgsim/room-authority';
import {
  PROTOCOL_VERSION,
  parseClientFrame,
  serializeMatchViewState,
  type ClientMessage,
  type ServerMessage,
} from '@ptcgsim/protocol';

import { establishSession } from './session-handshake.js';
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
  private readonly acceptedCommandPerformance: AcceptedCommandPerformanceObservation[] =
    [];
  private nextReplayId = 1;

  constructor(
    private readonly coordinator: RoomAuthorityCoordinator,
    private readonly buildId: string,
    private readonly dependencies: SessionHubDependencies
  ) {}

  handleFrame(connection: RuntimeConnection, frame: string): Promise<void> {
    this.connections.set(connection.id, connection);
    const run = this.tail.then(() => this.processFrame(connection, frame));
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

  disconnect(connectionId: string): void {
    this.connections.delete(connectionId);
    const sessionId = this.connectionSessions.get(connectionId);
    this.connectionSessions.delete(connectionId);
    if (sessionId && this.sessionConnections.get(sessionId) === connectionId) {
      this.sessionConnections.delete(sessionId);
    }
  }

  restoreBinding(connection: RuntimeConnection, sessionId?: string): void {
    this.connections.set(connection.id, connection);
    if (!sessionId) return;
    const session = this.coordinator.currentSnapshot().sessions[sessionId];
    if (!session?.active) return;
    const previousConnectionId = this.sessionConnections.get(sessionId);
    if (previousConnectionId && previousConnectionId !== connection.id) {
      const previous = this.connections.get(previousConnectionId);
      if (previous) {
        this.send(previous, {
          type: 'SessionSuperseded',
          protocolVersion: PROTOCOL_VERSION,
        });
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

  private send(connection: RuntimeConnection, message: ServerMessage): void {
    try {
      connection.send(JSON.stringify(message));
    } catch {
      this.disconnect(connection.id);
      this.dependencies.telemetry.failure({
        subsystem: 'socket_send',
        retryable: true,
      });
      this.dependencies.telemetry.roomSocket({
        outcome: 'error',
        activeSockets: this.connections.size,
      });
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
      case 'SendChat':
        this.send(
          connection,
          notice('not_implemented', 'Chat migration is not implemented yet')
        );
        return;
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
            this.dependencies.admission.opaqueIds
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
          });
          replay.frames.forEach((frame, index) => {
            this.send(connection, {
              type: 'ReplayFrame',
              protocolVersion: PROTOCOL_VERSION,
              replayId,
              index,
              snapshot: serializeMatchViewState(frame.snapshot),
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
        this.disconnect(connection.id);
        connection.close(1000, 'Client left room');
        return;
    }
  }

  private async handleHello(
    connection: RuntimeConnection,
    hello: Extract<ClientMessage, { type: 'Hello' }>
  ): Promise<void> {
    const startedAt = this.dependencies.monotonicNow();
    const operation = hello.resumeToken ? 'hello_resume' : 'hello_ticket';
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
          this.send(previous, {
            type: 'SessionSuperseded',
            protocolVersion: PROTOCOL_VERSION,
          });
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
      this.send(connection, result.message);
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
}
