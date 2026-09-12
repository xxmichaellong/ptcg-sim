import {
  createBrowserWebSocketFactory,
  RemoteGameSession,
  type ClientSessionDependencies,
  type ConnectSessionOptions,
  type SessionSocketFactory,
} from '@ptcgsim/client-session';

import { LegacyGamePresentationRuntime } from '../presentation/LegacyGamePresentationRuntime.js';
import { ReplaySessionCoordinator } from '../replay/ReplaySessionCoordinator.js';

export interface RemoteRoomSessionDependencies extends Omit<
  ClientSessionDependencies,
  'socketFactory'
> {
  readonly socketFactory?: SessionSocketFactory;
}

export interface RemoteRoomRuntimeOptions {
  /** Trusted handoff from the one-time admission-ticket bootstrap. */
  readonly connection: ConnectSessionOptions;
  readonly session?: RemoteRoomSessionDependencies;
  readonly presentation?: Omit<
    ConstructorParameters<typeof LegacyGamePresentationRuntime>[0],
    'live' | 'replay'
  >;
}

/**
 * Single owner for one remote room route. It constructs every dependent source
 * before connecting and tears them down outside-in before closing transport.
 */
export class RemoteRoomRuntime {
  readonly roomCode: string;
  readonly requestedRole: ConnectSessionOptions['requestedRole'];
  readonly session: RemoteGameSession;
  readonly replay: ReplaySessionCoordinator;
  readonly presentation: LegacyGamePresentationRuntime;
  private disposed = false;

  constructor({
    connection,
    session: sessionDependencies = {},
    presentation: presentationOptions = {},
  }: RemoteRoomRuntimeOptions) {
    const {
      socketFactory = createBrowserWebSocketFactory(),
      ...remainingSessionDependencies
    } = sessionDependencies;
    this.roomCode = connection.roomCode;
    this.requestedRole = connection.requestedRole;
    this.session = new RemoteGameSession({
      socketFactory,
      ...remainingSessionDependencies,
    });

    let replay: ReplaySessionCoordinator | undefined;
    let presentation: LegacyGamePresentationRuntime | undefined;
    try {
      replay = new ReplaySessionCoordinator(this.session);
      presentation = new LegacyGamePresentationRuntime({
        ...presentationOptions,
        live: this.session,
        replay,
      });
      this.session.connect(connection);
    } catch (error) {
      presentation?.dispose();
      replay?.dispose();
      this.session.disconnect();
      throw error;
    }
    this.replay = replay;
    this.presentation = presentation;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.presentation.dispose();
    } finally {
      try {
        this.replay.dispose();
      } finally {
        this.session.disconnect();
      }
    }
  }
}
