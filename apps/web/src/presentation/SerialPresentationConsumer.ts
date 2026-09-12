import type { PresentationStateSource } from './PresentationRuntime.js';

interface IdentifiedPresentationWork {
  readonly id: number;
}

type PresentationWorkResult = void | PromiseLike<void>;

interface SerialPresentationConsumerOptions<
  Snapshot,
  Entry extends IdentifiedPresentationWork,
> {
  readonly source: PresentationStateSource<Snapshot>;
  readonly selectEntries: (snapshot: Snapshot) => readonly Entry[];
  readonly consume: (
    entry: Entry,
    signal: AbortSignal
  ) => PresentationWorkResult;
  readonly acknowledge: (entryId: number) => boolean;
  readonly reportFailure: (error: unknown, entry: Entry) => void;
}

interface ActiveConsumption<Entry> {
  readonly entry: Entry;
  readonly controller: AbortController;
}

type ConsumptionOutcome =
  | { readonly status: 'completed' }
  | { readonly status: 'failed'; readonly error: unknown };

/**
 * Identity-safe serial consumption for bounded transient queues. The source
 * remains authoritative: replacing or removing its head aborts in-flight work.
 */
export class SerialPresentationConsumer<
  Snapshot,
  Entry extends IdentifiedPresentationWork,
> {
  private readonly source: PresentationStateSource<Snapshot>;
  private readonly selectEntries: (snapshot: Snapshot) => readonly Entry[];
  private readonly consume: (
    entry: Entry,
    signal: AbortSignal
  ) => PresentationWorkResult;
  private readonly acknowledge: (entryId: number) => boolean;
  private readonly reportFailure: (error: unknown, entry: Entry) => void;
  private unsubscribe: () => void = () => undefined;
  private active?: ActiveConsumption<Entry>;
  private blockedEntryId?: number;
  private reconcileRequested = false;
  private reconciling = false;
  private started = false;
  private disposed = false;

  constructor({
    source,
    selectEntries,
    consume,
    acknowledge,
    reportFailure,
  }: SerialPresentationConsumerOptions<Snapshot, Entry>) {
    this.source = source;
    this.selectEntries = selectEntries;
    this.consume = consume;
    this.acknowledge = acknowledge;
    this.reportFailure = reportFailure;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const unsubscribe = this.source.subscribe(this.requestReconcile);
    if (this.disposed) unsubscribe();
    else this.unsubscribe = unsubscribe;
    this.requestReconcile();
  }

  /** Re-evaluates the same FIFO head after a consumer preference changes. */
  restartActive(): void {
    if (this.disposed) return;
    this.cancelActive();
    this.requestReconcile();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.unsubscribe();
    } finally {
      this.cancelActive();
    }
  }

  private readonly requestReconcile = (): void => {
    if (this.disposed) return;
    this.reconcileRequested = true;
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      while (this.reconcileRequested && !this.disposed) {
        this.reconcileRequested = false;
        this.reconcileOnce();
      }
    } finally {
      this.reconciling = false;
    }
  };

  private reconcileOnce(): void {
    const head = this.selectEntries(this.source.getSnapshot())[0];
    if (this.active) {
      if (head?.id === this.active.entry.id) return;
      this.cancelActive();
    }
    if (!head) {
      this.blockedEntryId = undefined;
      return;
    }
    if (head.id === this.blockedEntryId) return;
    this.blockedEntryId = undefined;

    const execution: ActiveConsumption<Entry> = {
      entry: head,
      controller: new AbortController(),
    };
    this.active = execution;
    let result: PresentationWorkResult;
    try {
      result = this.consume(head, execution.controller.signal);
    } catch (error) {
      this.finish(execution, { status: 'failed', error });
      return;
    }
    void Promise.resolve(result).then(
      () => this.finish(execution, { status: 'completed' }),
      (error: unknown) => this.finish(execution, { status: 'failed', error })
    );
  }

  private finish(
    execution: ActiveConsumption<Entry>,
    outcome: ConsumptionOutcome
  ): void {
    if (
      this.disposed ||
      this.active !== execution ||
      execution.controller.signal.aborted
    )
      return;

    if (outcome.status === 'failed')
      this.reportFailureSafely(outcome.error, execution.entry);
    if (
      this.disposed ||
      this.active !== execution ||
      execution.controller.signal.aborted
    )
      return;

    let acknowledged = false;
    try {
      acknowledged = this.acknowledge(execution.entry.id);
    } catch (error) {
      this.reportFailureSafely(error, execution.entry);
    }
    if (this.active !== execution) return;
    this.active = undefined;

    const currentHead = this.selectEntries(this.source.getSnapshot())[0];
    if (!acknowledged && currentHead?.id === execution.entry.id) {
      // A miswired/failed acknowledgement must not create a synchronous retry
      // loop. A later head change still resumes consumption normally.
      this.blockedEntryId = execution.entry.id;
    }
    this.requestReconcile();
  }

  private cancelActive(): void {
    const active = this.active;
    this.active = undefined;
    active?.controller.abort();
  }

  private reportFailureSafely(error: unknown, entry: Entry): void {
    try {
      this.reportFailure(error, entry);
    } catch {
      // Diagnostics must not wedge or duplicate the queue.
    }
  }
}
