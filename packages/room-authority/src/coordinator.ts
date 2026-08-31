import type { ClientMessage } from '@ptcgsim/protocol';

import { assertAuthoritySnapshotInvariants } from './invariants.js';
import type {
  AuthorityDependencies,
  AuthorityProcessResult,
  AuthoritySnapshotStore,
  RoomAuthoritySnapshot,
} from './model.js';
import { processAuthorityCommand } from './process-command.js';

type CommandEnvelope = Extract<ClientMessage, { type: 'Command' }>;

/**
 * Serializes every command that can mutate one room. Durable Object event
 * delivery can interleave at `await` boundaries, so runtime locality alone is
 * not a command queue.
 */
export class RoomAuthorityCoordinator {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private snapshot: RoomAuthoritySnapshot,
    private readonly store: AuthoritySnapshotStore,
    private readonly dependencies: Omit<AuthorityDependencies, 'persistence'>
  ) {}

  static async restore(
    store: AuthoritySnapshotStore,
    dependencies: Omit<AuthorityDependencies, 'persistence'>
  ): Promise<RoomAuthorityCoordinator | undefined> {
    const snapshot = await store.load();
    return snapshot
      ? new RoomAuthorityCoordinator(snapshot, store, dependencies)
      : undefined;
  }

  currentSnapshot(): RoomAuthoritySnapshot {
    return this.snapshot;
  }

  installCommittedSnapshot(snapshot: RoomAuthoritySnapshot): void {
    assertAuthoritySnapshotInvariants(snapshot);
    if (snapshot.authorityVersion < this.snapshot.authorityVersion) {
      throw new Error('Cannot install an older authority snapshot');
    }
    this.snapshot = snapshot;
  }

  submit(envelope: CommandEnvelope): Promise<AuthorityProcessResult> {
    const run = this.tail.then(() => this.process(envelope));
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async process(
    envelope: CommandEnvelope
  ): Promise<AuthorityProcessResult> {
    try {
      const result = await processAuthorityCommand(this.snapshot, envelope, {
        ...this.dependencies,
        persistence: this.store,
      });
      this.snapshot = result.snapshot;
      return result;
    } catch (error) {
      // A storage call can fail before commit or after the durable write became
      // visible. Reloading makes the next retry safe in both cases.
      const durable = await this.store.load();
      if (durable) this.snapshot = durable;
      throw error;
    }
  }
}
