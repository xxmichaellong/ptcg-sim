import {
  createBoardScene,
  createRendererSpikeView,
  DEFAULT_BOARD_PRESENTATION,
  type BoardIntent,
  type BoardPresentation,
  type BoardPresentationUpdate,
  type BoardRenderer,
  type BoardRendererStatus,
} from '@ptcgsim/renderer-contract';
import { useEffect, useRef, useState } from 'react';

export type RendererKind = 'dom' | 'pixi';

const view = createRendererSpikeView();

declare global {
  interface Window {
    __PTCG_RENDERER_SPIKE__?: {
      readonly rendererKind: RendererKind;
      readonly renderer: BoardRenderer;
      readonly scene: ReturnType<typeof createBoardScene>;
    };
  }
}

export const RendererSpikeBoard = ({
  rendererKind,
  onIntent,
}: {
  readonly rendererKind: RendererKind;
  readonly onIntent: (intent: BoardIntent) => void;
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const [status, setStatus] = useState<BoardRendererStatus>({
    kind: 'mounting',
  });
  const [presentation, setPresentation] = useState<BoardPresentation>(
    DEFAULT_BOARD_PRESENTATION
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let renderer: BoardRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame: number | null = null;
    const sceneForHost = () => {
      const viewport = {
        width: Math.max(1, host.clientWidth || 1208),
        height: Math.max(1, host.clientHeight || 900),
        devicePixelRatio: Math.max(1, window.devicePixelRatio),
      };
      return {
        viewport,
        scene: createBoardScene(view, {
          viewport,
          bottomPlayerId: view.playerOrder[0]!,
          splitRatio: 0.5,
          geometryVersion: 1,
        }),
      };
    };
    const mount = async () => {
      const { scene } = sceneForHost();
      const adapters = {
        emitIntent: (intent: BoardIntent) => {
          onIntent(intent);
          if (intent.kind === 'CardSelected') {
            setPresentation((current) => ({
              ...current,
              selectedCardId: intent.cardId,
            }));
          }
        },
        emitPresentationUpdate: (update: BoardPresentationUpdate) => {
          if (update.kind === 'DragChanged') {
            setPresentation((current) => ({
              ...current,
              drag: update.drag,
            }));
          }
        },
        reportError: (error: unknown) =>
          console.error('[renderer-spike]', error),
        reportStatus: (next: BoardRendererStatus) => {
          if (!disposed) setStatus(next);
        },
      };
      const createRenderer =
        rendererKind === 'pixi'
          ? (await import('@ptcgsim/renderer-pixi')).createPixiBoardRenderer
          : (await import('@ptcgsim/renderer-dom')).createReactDomBoardRenderer;
      if (disposed) return;
      renderer = createRenderer(adapters);
      rendererRef.current = renderer;
      try {
        await renderer.mount(host, scene, DEFAULT_BOARD_PRESENTATION);
        if (disposed) return;
        window.__PTCG_RENDERER_SPIKE__ = {
          rendererKind,
          renderer,
          scene,
        };
        const installSize = () => {
          if (!renderer || disposed) return;
          const next = sceneForHost();
          renderer.resize(next.viewport);
          renderer.installScene(next.scene, []);
          window.__PTCG_RENDERER_SPIKE__ = {
            rendererKind,
            renderer,
            scene: next.scene,
          };
        };
        installSize();
        resizeObserver = new ResizeObserver(() => {
          if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            installSize();
          });
        });
        resizeObserver.observe(host);
      } catch (error) {
        if (!disposed) console.error('[renderer-spike] mount failed', error);
      }
    };
    void mount();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      renderer?.destroy();
      if (window.__PTCG_RENDERER_SPIKE__?.renderer === renderer) {
        delete window.__PTCG_RENDERER_SPIKE__;
      }
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, [onIntent, rendererKind]);

  useEffect(() => {
    rendererRef.current?.installPresentation(presentation);
  }, [presentation]);

  return (
    <div className="board-spike-host">
      <div className="renderer-surface-host" ref={hostRef} />
      <span
        className="renderer-status"
        role="status"
        data-renderer-status={status.kind}
        data-renderer-generation={
          status.kind === 'ready' ? status.generation : undefined
        }
      >
        {status.kind}
      </span>
    </div>
  );
};
