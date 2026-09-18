export interface ImmutableLogSource<Snapshot> {
  readonly getSnapshot: () => Snapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * Identity-cursor dispatcher for an immutable bounded object log. It advances
 * the cursor before application callbacks and serializes reentrant snapshots.
 */
export class ImmutableLogDispatcher<Snapshot, Entry extends object> {
  private readonly consumed = new WeakSet<Entry>();
  private readonly queue: Entry[][] = [];
  private unsubscribe: () => void = () => undefined;
  private delivering = false;
  private disposed = false;

  constructor(
    private readonly source: ImmutableLogSource<Snapshot>,
    private readonly selectEntries: (snapshot: Snapshot) => readonly Entry[],
    private readonly sink: (entry: Entry) => void,
    private readonly reportFailure: (error: unknown, entry: Entry) => void
  ) {
    this.consumeWithoutDelivery(selectEntries(source.getSnapshot()));
    const unsubscribe = source.subscribe(this.handleSourceChange);
    if (this.disposed) unsubscribe();
    else this.unsubscribe = unsubscribe;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.queue.length = 0;
  }

  private readonly handleSourceChange = (): void => {
    if (this.disposed) return;
    const entered = this.selectEntries(this.source.getSnapshot()).filter(
      (entry) => !this.consumed.has(entry)
    );
    this.consumeWithoutDelivery(entered);
    if (entered.length === 0) return;
    this.queue.push(entered);
    this.deliverQueuedEntries();
  };

  private consumeWithoutDelivery(entries: readonly Entry[]): void {
    for (const entry of entries) this.consumed.add(entry);
  }

  private deliverQueuedEntries(): void {
    if (this.delivering) return;
    this.delivering = true;
    try {
      while (!this.disposed) {
        const entries = this.queue.shift();
        if (!entries) return;
        for (const entry of entries) {
          if (this.disposed) return;
          try {
            this.sink(entry);
          } catch (error) {
            try {
              this.reportFailure(error, entry);
            } catch {
              // Diagnostics must not suppress later immutable-log entries.
            }
          }
        }
      }
    } finally {
      this.delivering = false;
    }
  }
}
