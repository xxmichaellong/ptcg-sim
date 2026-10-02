import type {
  BoardLayoutSnapshot,
  BoardResizeHandleId,
} from '@ptcgsim/renderer-contract';

interface ActiveResizePointer {
  readonly pointerId: number;
  readonly handleId: BoardResizeHandleId;
  readonly playAreaWidth: number;
  readonly playAreaHeight: number;
}

/** v1's `#selfResizer` / `#oppResizer` pills, painted by the board chrome. */
const RESIZER_PILL_SELECTOR = '.legacy-board-resizer';

const containsPoint = (
  bounds: BoardLayoutSnapshot['resizeHandles'][number]['bounds'],
  x: number,
  y: number
): boolean =>
  x >= bounds.x &&
  x <= bounds.x + bounds.width &&
  y >= bounds.y &&
  y <= bounds.y + bounds.height;

/**
 * DOM-only input bridge for the source-shaped resize handles. The renderer
 * keeps its geometry sentinels pointer-transparent; capture-phase hit testing
 * preserves v1's overlap priority without turning resize into a game command.
 */
export class ReactDomBoardResizeInteraction {
  private readonly view: Window;
  private active: ActiveResizePointer | null = null;
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly getLayout: () => BoardLayoutSnapshot,
    private readonly resize: (
      handleId: BoardResizeHandleId,
      clientY: number
    ) => void
  ) {
    const view = host.ownerDocument.defaultView;
    if (!view) throw new Error('Board resize host has no owning window');
    this.view = view;
    // The press is watched on the window, not the host: v1's resizer pills
    // are ordinary elements that show the row-resize cursor, so they sit
    // above the board and would otherwise swallow the press before the
    // host's capture listener could see it. The hit test is unchanged --
    // only a point inside a handle's rectangle starts a resize -- and only a
    // press that lands on the board or a pill counts, so popups and modals
    // drawn over a handle keep their own clicks.
    view.addEventListener('pointerdown', this.handlePointerDown, true);
    view.addEventListener('pointermove', this.handlePointerMove, true);
    view.addEventListener('pointerup', this.handlePointerEnd, true);
    view.addEventListener('pointercancel', this.handlePointerEnd, true);
    view.addEventListener('blur', this.handleWindowBlur);
    view.addEventListener('resize', this.handleWindowBlur);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = null;
    this.view.removeEventListener('pointerdown', this.handlePointerDown, true);
    this.view.removeEventListener('pointermove', this.handlePointerMove, true);
    this.view.removeEventListener('pointerup', this.handlePointerEnd, true);
    this.view.removeEventListener('pointercancel', this.handlePointerEnd, true);
    this.view.removeEventListener('blur', this.handleWindowBlur);
    this.view.removeEventListener('resize', this.handleWindowBlur);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disposed || this.active) return;
    if (!this.startsOnBoard(event.target)) return;
    const layout = this.getLayout();
    const point = this.toBoardPoint(
      event,
      layout.playAreaBounds.width,
      layout.playAreaBounds.height
    );
    if (!point) return;
    // V1 appends the upper/opp handle after the lower/self handle, so the
    // upper handle wins when expanded hit rectangles overlap.
    const handle = [...layout.resizeHandles]
      .reverse()
      .find((candidate) => containsPoint(candidate.bounds, point.x, point.y));
    if (!handle) return;
    this.active = {
      pointerId: event.pointerId,
      handleId: handle.id,
      playAreaWidth: layout.playAreaBounds.width,
      playAreaHeight: layout.playAreaBounds.height,
    };
    this.consume(event);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const active = this.active;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = this.toBoardPoint(
      event,
      active.playAreaWidth,
      active.playAreaHeight
    );
    if (point) this.resize(active.handleId, point.y);
    this.consume(event);
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (!this.active || this.active.pointerId !== event.pointerId) return;
    this.active = null;
    this.consume(event);
  };

  private readonly handleWindowBlur = (): void => {
    this.active = null;
  };

  private startsOnBoard(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    if (this.host.contains(target)) return true;
    const element =
      target instanceof Element ? target : target.parentElement;
    return element?.closest(RESIZER_PILL_SELECTOR) != null;
  }

  private toBoardPoint(
    event: Pick<PointerEvent, 'clientX' | 'clientY'>,
    playAreaWidth: number,
    playAreaHeight: number
  ): { readonly x: number; readonly y: number } | null {
    const surface = this.host.querySelector<HTMLElement>(
      '.ptcgsim-board-surface'
    );
    const bounds = surface?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x: ((event.clientX - bounds.left) * playAreaWidth) / bounds.width,
      y: ((event.clientY - bounds.top) * playAreaHeight) / bounds.height,
    };
  }

  private consume(event: PointerEvent): void {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }
}
