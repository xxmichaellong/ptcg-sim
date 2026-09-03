import {
  buildProjectedReplay,
  issueRoomAdmissionTicket,
  issueRoomInvitation,
  RoomAuthorityCoordinator,
  type AdmissionTicketIssueRequest,
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

export class RoomSessionHub {
  private tail: Promise<void> = Promise.resolve();
  private readonly connections = new Map<string, RuntimeConnection>();
  private readonly connectionSessions = new Map<string, string>();
  private readonly sessionConnections = new Map<string, string>();
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
    const run = this.tail.then(async () => {
      try {
        const now = this.dependencies.admission.now();
        const rateLimit = await this.dependencies.rateLimits.attempt(
          'admission_ticket',
          now
        );
        if (!rateLimit.allowed) {
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
        return result;
      } catch (error) {
        const durable = await this.dependencies.store.load();
        if (durable) this.coordinator.installCommittedSnapshot(durable);
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
    const run = this.tail.then(async () => {
      try {
        const now = this.dependencies.admission.now();
        const rateLimit = await this.dependencies.rateLimits.attempt(
          'invitation',
          now
        );
        if (!rateLimit.allowed) {
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
        return result;
      } catch (error) {
        const durable = await this.dependencies.store.load();
        if (durable) this.coordinator.installCommittedSnapshot(durable);
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
    const run = this.tail.then(() =>
      this.dependencies.rateLimits.attempt(
        'socket_upgrade',
        this.dependencies.admission.now()
      )
    );
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

  private send(connection: RuntimeConnection, message: ServerMessage): void {
    try {
      connection.send(JSON.stringify(message));
    } catch {
      this.disconnect(connection.id);
    }
  }

  private async processFrame(
    connection: RuntimeConnection,
    frame: string
  ): Promise<void> {
    const parsed = parseClientFrame(frame);
    if (!parsed.ok) {
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
      this.send(
        connection,
        notice('hello_required', 'Send Hello before messages')
      );
      return;
    }

    switch (message.type) {
      case 'Command': {
        if (message.sessionId !== boundSessionId) {
          this.send(
            connection,
            notice(
              'invalid_session',
              'Command session does not match connection'
            )
          );
          return;
        }
        try {
          const result = await this.coordinator.submit(message);
          for (const delivery of result.deliveries) {
            const targetConnectionId = this.sessionConnections.get(
              delivery.sessionId
            );
            const target = targetConnectionId
              ? this.connections.get(targetConnectionId)
              : undefined;
            if (target) this.send(target, delivery.message);
          }
        } catch {
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
    try {
      const rateLimit = await this.dependencies.rateLimits.attempt(
        'session_hello',
        this.dependencies.admission.now()
      );
      if (!rateLimit.allowed) {
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
      this.send(connection, result.message);
    } catch {
      const durable = await this.dependencies.store.load();
      if (durable) this.coordinator.installCommittedSnapshot(durable);
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
