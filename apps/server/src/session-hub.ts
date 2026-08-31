import {
  RoomAuthorityCoordinator,
  type AdmissionDependencies,
  type AuthoritySnapshotStore,
} from '@ptcgsim/room-authority';
import {
  PROTOCOL_VERSION,
  parseClientFrame,
  type ClientMessage,
  type ServerMessage,
} from '@ptcgsim/protocol';

import { establishSession } from './session-handshake.js';

export interface RuntimeConnection {
  readonly id: string;
  readonly send: (frame: string) => void;
  readonly close: (code: number, reason: string) => void;
}

export interface SessionHubDependencies {
  readonly admission: AdmissionDependencies;
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
