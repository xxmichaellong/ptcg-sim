import type { MatchViewState } from '@ptcgsim/game-core';
import {
  createBoardScene,
  DEFAULT_BOARD_PRESENTATION,
  type BoardIntent,
  type BoardPresentation,
  type BoardPresentationUpdate,
  type BoardRenderer,
  type BoardRendererAdapters,
  type BoardRendererStatus,
} from '@ptcgsim/renderer-contract';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { useEffect, useRef, useState } from 'react';
import { submitBoardDrop } from './board/resolveBoardDrop.js';

export type RendererKind = 'dom' | 'pixi';
type BoardRendererFactory = (adapters: BoardRendererAdapters) => BoardRenderer;

const sceneForHost = (host: HTMLElement, view: MatchViewState) => {
  const viewport = {
    width: Math.max(1, host.clientWidth || 1208),
    height: Math.max(1, host.clientHeight || 900),
    devicePixelRatio: Math.max(1, window.devicePixelRatio),
  };
  const bottomPlayerId =
    view.viewer.kind === 'player' ? view.viewer.playerId : view.playerOrder[0];
  if (!bottomPlayerId) throw new Error('Projected match has no board player');
  return {
    viewport,
    scene: createBoardScene(view, {
      viewport,
      bottomPlayerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    }),
  };
};

declare global {
  interface Window {
    __PTCG_RENDERER_SPIKE__?: {
      readonly rendererKind: RendererKind;
      readonly renderer: BoardRenderer;
      readonly scene: ReturnType<typeof createBoardScene>;
      /** Development-only browser-test seam for lifecycle gates. */
      readonly createRenderer?: BoardRendererFactory;
    };
  }
}

export const RendererSpikeBoard = ({
  view,
  rendererKind,
  onIntent,
  submitCommand,
  allowRevisionRegression = false,
}: {
  readonly view: MatchViewState;
  readonly rendererKind: RendererKind;
  readonly onIntent: (intent: BoardIntent) => void;
  readonly submitCommand: (command: WireGameCommand) => unknown;
  /** Replay-only escape hatch; live callers retain monotonic stale protection. */
  readonly allowRevisionRegression?: boolean;
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const rendererFactoryRef = useRef<BoardRendererFactory | null>(null);
  const viewRef = useRef(view);
  const onIntentRef = useRef(onIntent);
  const submitCommandRef = useRef(submitCommand);
  const allowRevisionRegressionRef = useRef(allowRevisionRegression);
  const presentationRef = useRef(DEFAULT_BOARD_PRESENTATION);
  const installedRef = useRef<{
    readonly view: MatchViewState;
    readonly scene: ReturnType<typeof createBoardScene>;
  } | null>(null);
  viewRef.current = view;
  onIntentRef.current = onIntent;
  submitCommandRef.current = submitCommand;
  allowRevisionRegressionRef.current = allowRevisionRegression;
  const [status, setStatus] = useState<BoardRendererStatus>({
    kind: 'mounting',
  });
  const [presentation, setPresentation] = useState<BoardPresentation>(
    DEFAULT_BOARD_PRESENTATION
  );
  presentationRef.current = presentation;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let renderer: BoardRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame: number | null = null;
    setStatus({ kind: 'mounting' });
    const mount = async () => {
      const initial = sceneForHost(host, viewRef.current);
      installedRef.current = { view: viewRef.current, scene: initial.scene };
      const adapters = {
        emitIntent: (intent: BoardIntent) => {
          onIntentRef.current(intent);
          if (intent.kind === 'CardDropRequested') {
            const installed = installedRef.current;
            if (installed) {
              submitBoardDrop(
                installed.view,
                installed.scene,
                intent,
                submitCommandRef.current
              );
            }
          }
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
      rendererFactoryRef.current = createRenderer;
      renderer = createRenderer(adapters);
      try {
        await renderer.mount(host, initial.scene, presentationRef.current);
        if (disposed) return;
        rendererRef.current = renderer;
        const installSize = () => {
          if (!renderer || disposed) return;
          const latestView = viewRef.current;
          const next = sceneForHost(host, latestView);
          const installed = installedRef.current;
          const mode =
            allowRevisionRegressionRef.current &&
            installed &&
            next.scene.revision < installed.scene.revision
              ? 'replace'
              : 'advance';
          renderer.resize(next.viewport);
          renderer.installScene(next.scene, [], mode);
          installedRef.current = { view: latestView, scene: next.scene };
          window.__PTCG_RENDERER_SPIKE__ = {
            rendererKind,
            renderer,
            scene: next.scene,
            ...(import.meta.env.DEV ? { createRenderer } : {}),
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
      rendererFactoryRef.current = null;
      installedRef.current = null;
    };
  }, [rendererKind]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const createRenderer = rendererFactoryRef.current;
    const host = hostRef.current;
    if (!renderer || !createRenderer || !host) return;
    const next = sceneForHost(host, view);
    const installed = installedRef.current;
    const mode =
      allowRevisionRegression &&
      installed &&
      next.scene.revision < installed.scene.revision
        ? 'replace'
        : 'advance';
    renderer.installScene(next.scene, [], mode);
    installedRef.current = { view, scene: next.scene };
    window.__PTCG_RENDERER_SPIKE__ = {
      rendererKind,
      renderer,
      scene: next.scene,
      ...(import.meta.env.DEV ? { createRenderer } : {}),
    };
  }, [allowRevisionRegression, rendererKind, view]);

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
