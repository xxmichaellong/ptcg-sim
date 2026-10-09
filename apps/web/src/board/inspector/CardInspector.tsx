import type { MatchViewState } from '@ptcgsim/game-core';
import type { BoardCardHover, BoardScene } from '@ptcgsim/renderer-contract';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { inspectCard, type CardInspection } from './card-inspection.js';
import './CardInspector.css';

/**
 * The hovered card, published by the renderer at most once per frame. Which
 * card is hovered changes rarely and drives React; where the pointer is
 * changes every frame and is applied straight to the inspector's styles.
 */
export class CardHoverStore {
  private hover: BoardCardHover | null = null;
  private readonly cardListeners = new Set<() => void>();
  private readonly pointerListeners = new Set<() => void>();

  readonly set = (hover: BoardCardHover | null): void => {
    const changedCard =
      (hover?.cardId ?? null) !== (this.hover?.cardId ?? null);
    this.hover = hover;
    if (changedCard) for (const listener of this.cardListeners) listener();
    for (const listener of this.pointerListeners) listener();
  };

  readonly getCardId = (): string | null =>
    this.hover ? String(this.hover.cardId) : null;

  readonly getPointer = (): BoardCardHover | null => this.hover;

  readonly subscribeCard = (listener: () => void): (() => void) => {
    this.cardListeners.add(listener);
    return () => this.cardListeners.delete(listener);
  };

  readonly subscribePointer = (listener: () => void): (() => void) => {
    this.pointerListeners.add(listener);
    return () => this.pointerListeners.delete(listener);
  };
}

/** Rest on a card this long before the inspector opens for it. */
const OPEN_DELAY_MS = 140;
/** Keep it open this long after the pointer leaves the cards. */
const CLOSE_DELAY_MS = 160;
const MAXIMUM_TILT_DEGREES = 11;

const sideFor = (
  scene: BoardScene | undefined,
  cardId: string
): 'left' | 'right' => {
  const card = scene?.cards.find(
    (candidate) => String(candidate.id) === cardId
  );
  if (!scene || !card) return 'right';
  const centre = card.bounds.x + card.bounds.width / 2;
  // Dock on the far side from the card so it never covers what you point at.
  return centre > scene.viewport.width / 2 ? 'left' : 'right';
};

export interface CardInspectorProps {
  readonly store: CardHoverStore;
  readonly view: MatchViewState | undefined;
  readonly scene: BoardScene | undefined;
  readonly reducedMotion: boolean;
  /**
   * A zone browser or card preview is open: it shows its cards large
   * itself, so the inspector closes at once and stays closed.
   */
  readonly suppressed?: boolean;
}

/**
 * A large, readable view of the card under the pointer, docked beside the
 * board. It never takes input, never covers the hovered card, and tilts and
 * catches the light as the pointer moves over the small card.
 */
export const CardInspector = ({
  store,
  view,
  scene,
  reducedMotion,
  suppressed = false,
}: CardInspectorProps) => {
  const hoveredId = useSyncExternalStore(
    store.subscribeCard,
    store.getCardId,
    store.getCardId
  );
  const [shown, setShown] = useState<{
    readonly inspection: CardInspection;
    readonly side: 'left' | 'right';
  } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const viewRef = useRef(view);
  viewRef.current = view;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useEffect(() => {
    const inspection = hoveredId
      ? inspectCard(viewRef.current, hoveredId)
      : null;
    if (!inspection) {
      const timer = setTimeout(() => setShown(null), CLOSE_DELAY_MS);
      return () => clearTimeout(timer);
    }
    const next = {
      inspection,
      side:
        shownRef.current?.side ?? sideFor(sceneRef.current, inspection.cardId),
    };
    // Already open: follow the pointer from card to card at once.
    if (shownRef.current) {
      setShown({ ...next, side: sideFor(sceneRef.current, inspection.cardId) });
      return undefined;
    }
    const timer = setTimeout(() => setShown(next), OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hoveredId]);

  // The card leans with the pointer over the small card on the board.
  useEffect(() => {
    if (reducedMotion) return undefined;
    const apply = () => {
      const card = cardRef.current;
      const pointer = store.getPointer();
      if (!card) return;
      if (!pointer) {
        card.style.setProperty('--inspector-tilt-x', '0deg');
        card.style.setProperty('--inspector-tilt-y', '0deg');
        card.style.setProperty('--inspector-light', '0');
        return;
      }
      card.style.setProperty(
        '--inspector-tilt-x',
        `${(-pointer.y * 2 * MAXIMUM_TILT_DEGREES).toFixed(2)}deg`
      );
      card.style.setProperty(
        '--inspector-tilt-y',
        `${(pointer.x * 2 * MAXIMUM_TILT_DEGREES).toFixed(2)}deg`
      );
      card.style.setProperty(
        '--inspector-pointer-x',
        `${((pointer.x + 0.5) * 100).toFixed(1)}%`
      );
      card.style.setProperty(
        '--inspector-pointer-y',
        `${((pointer.y + 0.5) * 100).toFixed(1)}%`
      );
      card.style.setProperty(
        '--inspector-from-centre',
        Math.min(1, Math.hypot(pointer.x, pointer.y) * 2).toFixed(3)
      );
      card.style.setProperty('--inspector-light', '1');
    };
    apply();
    return store.subscribePointer(apply);
  }, [store, reducedMotion, shown?.inspection.cardId]);

  const inspection = shown?.inspection;
  // Suppression fades the open card out rather than dropping it.
  const open = inspection !== undefined && !suppressed;
  return (
    <aside
      className="card-inspector"
      data-card-inspector=""
      data-open={open ? 'true' : 'false'}
      data-side={shown?.side ?? 'right'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      aria-hidden="true"
    >
      {inspection ? (
        <div
          ref={cardRef}
          key={inspection.cardId}
          className="card-inspector__card"
          data-finish={inspection.finish}
        >
          <img
            className="card-inspector__image"
            src={inspection.imageUrl}
            alt=""
            draggable={false}
          />
          <span className="card-inspector__shine" />
          <span className="card-inspector__glare" />
        </div>
      ) : null}
    </aside>
  );
};
