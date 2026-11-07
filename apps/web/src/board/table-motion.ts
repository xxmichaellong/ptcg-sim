/**
 * Whether the table is moving on its own, as its renderer reports it
 * (`BoardRendererAdapters.reportMotion`); never part of game state. A
 * renderer that does not report reads as still.
 */
export class TableMotionStore {
  private moving = false;
  private readonly listeners = new Set<() => void>();

  readonly set = (moving: boolean): void => {
    if (moving === this.moving) return;
    this.moving = moving;
    for (const listener of this.listeners) listener();
  };

  readonly isMoving = (): boolean => this.moving;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
