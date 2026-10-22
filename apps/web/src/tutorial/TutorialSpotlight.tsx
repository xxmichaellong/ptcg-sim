import { HandPointingIcon } from '@phosphor-icons/react/dist/csr/HandPointing';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { TutorialTarget } from './tutorial-lessons.js';

/**
 * What a step points at (ADR-038): a soft ring round each thing to touch,
 * and for a drag a hand that carries a card from where it lies to where it
 * goes, a few times and then still. Neither takes a press: the table under
 * them plays as ever. Under reduced motion the hand is a dotted path.
 */

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The element a target names, if it is on screen now. */
export const findTarget = (
  document: Document,
  target: TutorialTarget
): Element | null => {
  if ('card' in target) {
    return document.querySelector(
      `.ptcgsim-card[data-card-id="${CSS.escape(target.card)}"]`
    );
  }
  if ('zone' in target) {
    return document.querySelector(
      `.ptcgsim-zone[data-zone-id="${CSS.escape(target.zone)}"]`
    );
  }
  for (const selector of target.selectors) {
    const found = [...document.querySelectorAll(selector)].find(visible);
    if (found) return found;
  }
  return null;
};

const visible = (element: Element): boolean => {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const rectOf = (element: Element | null): ScreenRect | null => {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0
    ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    : null;
};

/**
 * A card's room in a zone that no card lies in, nearest its right end (a
 * Bench fills from the left), or the zone itself when there is none: a
 * card dropped there lands on its own, not on another.
 */
export const freeRoomIn = (
  zone: ScreenRect,
  cards: readonly ScreenRect[]
): ScreenRect => {
  const inside = cards.filter((card) => {
    const x = card.x + card.width / 2;
    const y = card.y + card.height / 2;
    return (
      x >= zone.x &&
      x <= zone.x + zone.width &&
      y >= zone.y &&
      y <= zone.y + zone.height
    );
  });
  const width = Math.min(zone.width, zone.height * 0.72);
  const steps = 12;
  for (let index = steps; index >= 0; index -= 1) {
    const x = zone.x + ((zone.width - width) * index) / steps;
    const room = { x, y: zone.y, width, height: zone.height };
    const clear = inside.every(
      (card) => card.x + card.width <= room.x || card.x >= room.x + room.width
    );
    if (clear) return room;
  }
  return zone;
};

/** Where a target is on screen now, if it is. */
export const targetRect = (
  document: Document,
  target: TutorialTarget
): ScreenRect | null => {
  const rect = rectOf(findTarget(document, target));
  if (!rect || !('zone' in target) || !target.free) return rect;
  const cards = [
    ...document.querySelectorAll('.ptcgsim-board-surface .ptcgsim-card'),
  ].flatMap((card) => {
    const box = rectOf(card);
    return box ? [box] : [];
  });
  return freeRoomIn(rect, cards);
};

const sameRects = (
  left: readonly (ScreenRect | null)[],
  right: readonly (ScreenRect | null)[]
): boolean =>
  left.length === right.length &&
  left.every((rect, index) => {
    const other = right[index];
    if (!rect || !other) return rect === other;
    return (
      Math.abs(rect.x - other.x) < 0.5 &&
      Math.abs(rect.y - other.y) < 0.5 &&
      Math.abs(rect.width - other.width) < 0.5 &&
      Math.abs(rect.height - other.height) < 0.5
    );
  });

/**
 * Where the targets are on screen, followed every frame while shown: the
 * table tilts, slides beside a docked log and animates its cards.
 */
export const useTargetRects = (
  targets: readonly TutorialTarget[],
  active: boolean
): readonly (ScreenRect | null)[] => {
  const [rects, setRects] = useState<readonly (ScreenRect | null)[]>([]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const key = JSON.stringify(targets);
  useLayoutEffect(() => {
    if (!active) {
      setRects([]);
      return;
    }
    let frame = 0;
    let last: readonly (ScreenRect | null)[] = [];
    const measure = (): void => {
      const next = targetsRef.current.map((target) =>
        targetRect(document, target)
      );
      if (!sameRects(next, last)) {
        last = next;
        setRects(next);
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [active, key]);
  return rects;
};

const RING_PAD_PX = 6;

export const TutorialSpotlight = ({
  rects,
  drag,
  demo,
  reducedMotion,
}: {
  readonly rects: readonly (ScreenRect | null)[];
  /** The drag to show: where it starts and where it lands. */
  readonly drag: {
    readonly from: ScreenRect | null;
    readonly to: ScreenRect | null;
  } | null;
  /** Counts up each time the hand should show the drag again. */
  readonly demo: number;
  readonly reducedMotion: boolean;
}) => {
  const from = drag?.from ? centre(drag.from) : null;
  const to = drag?.to ? centre(drag.to) : null;
  return (
    <div className="tutorial-spotlight" aria-hidden="true">
      {rects.map((rect, index) =>
        rect ? (
          <div
            key={index}
            className="tutorial-ring"
            style={{
              left: rect.x - RING_PAD_PX,
              top: rect.y - RING_PAD_PX,
              width: rect.width + 2 * RING_PAD_PX,
              height: rect.height + 2 * RING_PAD_PX,
            }}
          />
        ) : null
      )}
      {drag?.from ? (
        <div
          className="tutorial-ring tutorial-ring--from"
          style={{
            left: drag.from.x - RING_PAD_PX,
            top: drag.from.y - RING_PAD_PX,
            width: drag.from.width + 2 * RING_PAD_PX,
            height: drag.from.height + 2 * RING_PAD_PX,
          }}
        />
      ) : null}
      {drag?.to ? (
        <div
          className="tutorial-ring tutorial-ring--to"
          style={{
            left: drag.to.x - RING_PAD_PX,
            top: drag.to.y - RING_PAD_PX,
            width: drag.to.width + 2 * RING_PAD_PX,
            height: drag.to.height + 2 * RING_PAD_PX,
          }}
        />
      ) : null}
      {from && to ? (
        reducedMotion ? (
          <DragPath from={from} to={to} />
        ) : (
          <DragHand key={demo} from={from} to={to} />
        )
      ) : null}
    </div>
  );
};

const centre = (rect: ScreenRect) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

/**
 * A hand that presses on the card, carries it to where it goes and lets
 * go, three times, then rests at the start (WCAG 2.2.2: it stops by
 * itself well within five seconds a pass).
 */
const DragHand = ({
  from,
  to,
}: {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof element.animate !== 'function') return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const animation = element.animate(
      [
        { transform: 'translate(0px, 0px) scale(1)', opacity: 0, offset: 0 },
        { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0.12 },
        {
          transform: 'translate(0px, 0px) scale(0.86)',
          opacity: 1,
          offset: 0.24,
        },
        {
          transform: `translate(${String(dx)}px, ${String(dy)}px) scale(0.86)`,
          opacity: 1,
          offset: 0.72,
        },
        {
          transform: `translate(${String(dx)}px, ${String(dy)}px) scale(1)`,
          opacity: 1,
          offset: 0.84,
        },
        {
          transform: `translate(${String(dx)}px, ${String(dy)}px) scale(1)`,
          opacity: 0,
          offset: 1,
        },
      ],
      { duration: 1600, iterations: 3, easing: 'ease-in-out', delay: 250 }
    );
    return () => animation.cancel();
  }, [from.x, from.y, to.x, to.y]);
  return (
    <div
      ref={ref}
      className="tutorial-hand"
      style={{ left: from.x, top: from.y }}
    >
      <HandPointingIcon weight="fill" />
    </div>
  );
};

/** A still dotted path with an arrowhead, for reduced motion. */
const DragPath = ({
  from,
  to,
}: {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}) => (
  <svg className="tutorial-path" width="100%" height="100%">
    <defs>
      <marker
        id="tutorialArrow"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" />
      </marker>
    </defs>
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      markerEnd="url(#tutorialArrow)"
    />
  </svg>
);
