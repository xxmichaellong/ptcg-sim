import type {
  BoardLayoutSnapshot,
  BoardRenderer,
  BoardRendererAdapters,
  BoardResizeHandleId,
} from '@ptcgsim/renderer-contract';
import { createReactDomBoardRenderer } from '@ptcgsim/renderer-dom';

import {
  BoardSessionRuntime,
  type BoardSessionRuntimeOptions,
} from './BoardSessionRuntime.js';

export interface ReactDomBoardSessionRuntimeOptions extends Omit<
  BoardSessionRuntimeOptions,
  'createRenderer'
> {
  readonly createRenderer?: (adapters: BoardRendererAdapters) => BoardRenderer;
  /**
   * Candidate-only native pointer ownership for the source-shaped resize
   * handles. Disabled unless the composing route explicitly opts in.
   */
  readonly enableLegacyResizeInteraction?: boolean;
}

interface ActiveResizePointer {
  readonly pointerId: number;
  readonly handleId: BoardResizeHandleId;
  readonly playAreaWidth: number;
  readonly playAreaHeight: number;
}

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
 * Route-owned input bridge. The renderer keeps its handle nodes non-painting
 * and pointer-transparent; capture-phase hit testing gives the later DOM
 * handle the same overlap priority as v1 without adding renderer commands.
 */
class ReactDomBoardResizeInteraction {
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
    host.addEventListener('pointerdown', this.handlePointerDown, true);
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
    this.host.removeEventListener('pointerdown', this.handlePointerDown, true);
    this.view.removeEventListener('pointermove', this.handlePointerMove, true);
    this.view.removeEventListener('pointerup', this.handlePointerEnd, true);
    this.view.removeEventListener('pointercancel', this.handlePointerEnd, true);
    this.view.removeEventListener('blur', this.handleWindowBlur);
    this.view.removeEventListener('resize', this.handleWindowBlur);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disposed || this.active) return;
    const layout = this.getLayout();
    const point = this.toBoardPoint(
      event,
      layout.playAreaBounds.width,
      layout.playAreaBounds.height
    );
    if (!point) return;
    // v1 appends the upper/opp handle after the lower/self handle, so the
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

/**
 * Opt-in normalized-DOM composition. Upstream live/replay/presentation owners
 * are borrowed; this wrapper only selects the DOM renderer implementation.
 */
export class ReactDomBoardSessionRuntime extends BoardSessionRuntime {
  private readonly enableLegacyResizeInteraction: boolean;
  private readonly reportResizeError: (error: unknown) => void;
  private resizeInteraction: ReactDomBoardResizeInteraction | null = null;

  constructor(options: ReactDomBoardSessionRuntimeOptions) {
    super({
      ...options,
      createRenderer: options.createRenderer ?? createReactDomBoardRenderer,
    });
    this.enableLegacyResizeInteraction =
      options.enableLegacyResizeInteraction === true;
    this.reportResizeError = options.reportError ?? (() => undefined);
  }

  override async mount(host: HTMLElement): Promise<void> {
    await super.mount(host);
    if (!this.enableLegacyResizeInteraction) return;
    try {
      this.resizeInteraction = new ReactDomBoardResizeInteraction(
        host,
        () => this.getCharacterizedLayoutSnapshot(),
        (handleId, clientY) => this.resizeBoard(handleId, clientY)
      );
    } catch (error) {
      super.dispose();
      try {
        this.reportResizeError(error);
      } catch {
        // Diagnostics cannot interrupt the mount failure boundary.
      }
      throw error;
    }
  }

  override dispose(): void {
    this.resizeInteraction?.dispose();
    this.resizeInteraction = null;
    super.dispose();
  }
}
