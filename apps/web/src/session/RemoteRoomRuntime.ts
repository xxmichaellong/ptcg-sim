import {
  createBrowserWebSocketFactory,
  RemoteGameSession,
  type ClientSessionDependencies,
  type ConnectSessionOptions,
  type SessionSocketFactory,
} from '@ptcgsim/client-session';

import { LegacyGamePresentationRuntime } from '../presentation/LegacyGamePresentationRuntime.js';
import { ReplaySessionCoordinator } from '../replay/ReplaySessionCoordinator.js';
import {
  createBrowserContinuationPort,
  RemoteContinuationCustody,
  RemoteContinuationCustodyError,
  type RemoteContinuationPort,
  type RemoteContinuationSourceInput,
} from './RemoteContinuationCustody.js';

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
  readonly continuation?: {
    readonly port?: RemoteContinuationPort;
    readonly createOperationId?: () => string;
  };
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
  private readonly continuationOptions:
    RemoteRoomRuntimeOptions['continuation'] | undefined;
  private continuationSource: RemoteContinuationSourceInput | undefined;
  private continuationCustody: RemoteContinuationCustody | undefined;
  private disposed = false;

  constructor({
    connection,
    session: sessionDependencies = {},
    presentation: presentationOptions = {},
    continuation,
  }: RemoteRoomRuntimeOptions) {
    const {
      socketFactory = createBrowserWebSocketFactory(),
      ...remainingSessionDependencies
    } = sessionDependencies;
    this.roomCode = connection.roomCode;
    this.requestedRole = connection.requestedRole;
    this.continuationOptions = continuation;
    this.continuationSource =
      connection.requestedRole === 'player'
        ? {
            roomCode: connection.roomCode,
            resumeToken: connection.resumeToken,
          }
        : undefined;
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

  /** Lazily creates private save custody; no continuation code runs on mount. */
  getContinuationCustody(): RemoteContinuationCustody {
    if (this.disposed) {
      throw new RemoteContinuationCustodyError('disposed');
    }
    if (this.continuationCustody) return this.continuationCustody;
    const sessionState = this.session.getSnapshot();
    if (sessionState.phase !== 'ready' || sessionState.role !== 'player') {
      throw new RemoteContinuationCustodyError('invalid_state');
    }
    const source = this.continuationSource;
    if (!source) {
      throw new RemoteContinuationCustodyError('invalid_state');
    }
    const custody = new RemoteContinuationCustody({
      port: this.continuationOptions?.port ?? createBrowserContinuationPort(),
      source,
      canCreate: () => {
        const state = this.session.getSnapshot();
        return state.phase === 'ready' && state.role === 'player';
      },
      ...(this.continuationOptions?.createOperationId
        ? {
            createOperationId: this.continuationOptions.createOperationId,
          }
        : {}),
    });
    this.continuationCustody = custody;
    this.continuationSource = undefined;
    return custody;
  }

  /** Prevents route/controller graphs from becoming credential-bearing JSON. */
  toJSON(): { readonly roomCode: string; readonly requestedRole: string } {
    return Object.freeze({
      roomCode: this.roomCode,
      requestedRole: this.requestedRole,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.continuationSource = undefined;
    try {
      this.continuationCustody?.dispose();
    } finally {
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
}
