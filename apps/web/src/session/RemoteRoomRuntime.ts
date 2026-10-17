import {
  serializeContinuationHandoffText,
  type ContinuationCreationResponse,
} from '@ptcgsim/protocol';
import {
  createBrowserWebSocketFactory,
  RemoteGameSession,
  type ClientSessionDependencies,
  type ConnectSessionOptions,
  type SessionSocketFactory,
} from '@ptcgsim/client-session';

import { motionSettings } from '../motion/motion-settings.js';
import { LegacyGamePresentationRuntime } from '../presentation/LegacyGamePresentationRuntime.js';
import {
  ReplaySessionCoordinator,
  type ReplayArtifactRequestResult,
} from '../replay/ReplaySessionCoordinator.js';
import {
  createBrowserContinuationPort,
  RemoteContinuationCustody,
  RemoteContinuationCustodyError,
  type RemoteContinuationPort,
  type RemoteContinuationSourceInput,
} from './RemoteContinuationCustody.js';
import { createProvisionalRebinder } from '../board/rebindProvisionalReferences.js';

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

export type RemoteContinuationHandoffWriter = (
  filename: string,
  contents: string
) => boolean | Promise<boolean>;

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
      rebindCommand = createProvisionalRebinder(),
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
      rebindCommand,
      ...remainingSessionDependencies,
    });

    let replay: ReplaySessionCoordinator | undefined;
    let presentation: LegacyGamePresentationRuntime | undefined;
    try {
      replay = new ReplaySessionCoordinator(this.session);
      presentation = new LegacyGamePresentationRuntime({
        // Coins follow the page's motion settings, like the board does.
        reducedMotion: motionSettings().reducedMotion,
        animationDurationScale: () =>
          motionSettings().getSnapshot().durationScale,
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
    return custody;
  }

  /**
   * Creates and downloads one opaque online save. Successful delivery rotates
   * custody so the next user action captures a fresh authoritative head.
   */
  async saveOnlineGame(
    write: RemoteContinuationHandoffWriter,
    signal?: AbortSignal
  ): Promise<void> {
    // The save is of the room as it stands: moves still on their way to it
    // go in first, or the file would miss the last of them.
    await this.commandsSettled(signal);
    const custody = this.getContinuationCustody();
    await custody.handoffCreated(
      async (receipt: ContinuationCreationResponse) => {
        const contents = serializeContinuationHandoffText({
          format: 'ptcgsim-continuation-handoff-v1',
          saveId: receipt.saveId,
          capability: receipt.capability,
          expiresAt: receipt.expiresAt,
        });
        if (!(await write('ptcgsim-online-save.ptcgsave', contents))) {
          throw new Error('Continuation handoff was not delivered');
        }
      },
      signal
    );
    if (this.disposed) {
      throw new RemoteContinuationCustodyError('disposed');
    }
    if (this.continuationCustody === custody) {
      custody.dispose();
      this.continuationCustody = undefined;
    }
  }

  /**
   * This player's replay of the game, once every move sent has been
   * answered: the request would otherwise overtake the moves queued behind
   * the one in flight, and the file would miss them.
   */
  async exportReplay(
    signal?: AbortSignal
  ): Promise<ReplayArtifactRequestResult> {
    try {
      await this.commandsSettled(signal);
    } catch {
      return {
        ok: false,
        failure: {
          code: 'unavailable',
          message: 'The live session is not ready to export a replay',
        },
      };
    }
    return await this.replay.requestReplayArtifact();
  }

  /** Resolves once every move sent has been answered by the room. */
  private commandsSettled(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let unsubscribe = (): void => undefined;
      let settled = false;
      const settle = (error?: Error): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        unsubscribe();
        if (error) reject(error);
        else resolve();
      };
      const onAbort = (): void =>
        settle(new RemoteContinuationCustodyError('cancelled'));
      const inspect = (): void => {
        if (this.disposed) {
          settle(new RemoteContinuationCustodyError('disposed'));
          return;
        }
        const state = this.session.getSnapshot();
        if (state.phase !== 'ready') {
          settle(new RemoteContinuationCustodyError('invalid_state'));
        } else if (state.pendingCommands.length === 0) {
          settle();
        }
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      unsubscribe = this.session.subscribe(inspect);
      inspect();
    });
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
