import type { ViewCardId } from '@ptcgsim/game-core';

import { arrangementIndexAt, benchRearrangementTarget } from './arrangement.js';
import { containsPoint, containsPointInRotatedRect } from './geometry.js';
import { groupCardsOf } from './group-carry.js';
import { TABLE_LAYOUT_GEOMETRY_VERSION } from './layout-table.js';
import type {
  BoardRendererAdapters,
  BoardScene,
  CardSceneNode,
} from './model.js';
import { topmostFirst } from './paint-order.js';

export interface BoardPointerInput {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly button: number;
  /** Optional projected picking results. x/y still describe the grab plane. */
  readonly screenPoint?: { readonly x: number; readonly y: number };
  readonly dropPoint?: { readonly x: number; readonly y: number };
  readonly targetId?: string | null;
  /** The place in an arranged zone, from projected picking (null: none). */
  readonly arrangementIndex?: number | null;
}

/**
 * What a press on a card holds beyond the card (ADR-042 §2), as the renderer
 * read it from the selection when the card was pressed.
 */
export interface BoardPress {
  /**
   * The items a drag of it carries, in selection order (its own among
   * them): the selection, when the card's item is in it with others, or
   * the selection and the card when `adds`. Absent: it goes alone.
   */
  readonly group?: readonly ViewCardId[];
  /**
   * Pressed with Shift or ⌘/Ctrl on a card not selected: once it moves, it
   * joins the selection (`CardSelected` with `add`) and drags the group.
   */
  readonly adds?: boolean;
}

interface ActiveGesture {
  readonly pointerId: number;
  readonly cardId: ViewCardId;
  /** The press's group, the same array for every move (onlyHeldCardMoved). */
  readonly group?: readonly ViewCardId[];
  /** It joins the selection once it starts to move (BoardPress.adds). */
  adds?: boolean;
  /** The painted element pressed: for a pile, its cover (`cover:<zone>`). */
  readonly renderKey: string | null;
  readonly startX: number;
  readonly startY: number;
  readonly centerOffsetX: number;
  readonly centerOffsetY: number;
  readonly screenStart: { readonly x: number; readonly y: number } | undefined;
  dragging: boolean;
  /** Lifted off its Pokémon by a long press: it moves alone. */
  detached: boolean;
}

export interface BoardInteractionCancellation {
  readonly pointerId: number | null;
  readonly wasDragging: boolean;
}

const cardAt = (
  scene: BoardScene,
  cardId: ViewCardId
): CardSceneNode | undefined =>
  scene.cards.find((candidate) => candidate.id === cardId);

/**
 * A Pokémon's card that a long press can lift off the rest of its stack (to
 * devolve it, say): a card of the Pokémon itself, with other cards under or
 * attached to it. A joined card's pieces never come apart.
 */
export const canDetachFromStack = (
  scene: BoardScene,
  cardId: ViewCardId
): boolean => {
  const card = cardAt(scene, cardId);
  return Boolean(
    card?.interactive &&
    card.role === 'stackEvolution' &&
    !card.composition &&
    scene.cards.some(
      (other) => other.id !== card.id && other.parentId === card.parentId
    )
  );
};

/**
 * On the redesigned table, empty felt is the board. A card dropped where no
 * zone or card claims the point lands on the loose board (v1's board zone)
 * of the half it was dropped in, where both players can see it -- a
 * Supporter being played, say. v1's own geometry keeps v1's behaviour.
 */
export const looseBoardTargetAt = (
  scene: BoardScene,
  x: number,
  y: number
): string | null => {
  if (scene.layout.geometryVersion !== TABLE_LAYOUT_GEOMETRY_VERSION) {
    return null;
  }
  const half = scene.layout.players.find(
    (player) => !player.hidden && containsPoint(player.bounds, x, y)
  );
  if (!half) return null;
  return (
    scene.zones.find(
      (zone) =>
        zone.kind === 'board' &&
        zone.playerId === half.playerId &&
        zone.interactive
    )?.id ?? null
  );
};

/**
 * How far past its edge a zone still takes a card on the table: a card held
 * near a pile's or the bench's border plainly means that zone, not the
 * loose board beside it. Generous: a drop that looks as if it will land
 * should land.
 */
export const dropReachFor = (scene: BoardScene): number =>
  scene.layout.geometryVersion === TABLE_LAYOUT_GEOMETRY_VERSION
    ? Math.max(20, Math.min(56, scene.viewport.width * 0.03))
    : 0;

const distanceToRect = (
  rect: { x: number; y: number; width: number; height: number },
  x: number,
  y: number
): number =>
  Math.hypot(
    Math.max(rect.x - x, 0, x - (rect.x + rect.width)),
    Math.max(rect.y - y, 0, y - (rect.y + rect.height))
  );

/** The topmost zone that takes cards under a point, if any. */
const zoneUnder = (scene: BoardScene, x: number, y: number) =>
  topmostFirst(scene.zones).find(
    (zone) => zone.interactive && containsPoint(zone.bounds, x, y)
  );

/**
 * The zone a card dropped at (x, y) lands in: the topmost zone under the
 * point; else, on the table, the one under the held card's centre (a card
 * held by its top hangs its face over the pile meant); else the nearest
 * zone within reach of either (the loose board excepted, which is the felt
 * itself); else the loose board of the half it is over.
 */
export const zoneDropTargetAt = (
  scene: BoardScene,
  x: number,
  y: number,
  centre?: { readonly x: number; readonly y: number }
): string | null => {
  const under = zoneUnder(scene, x, y);
  if (under) return under.id;
  const table = scene.layout.geometryVersion === TABLE_LAYOUT_GEOMETRY_VERSION;
  const held = table && centre ? zoneUnder(scene, centre.x, centre.y) : null;
  if (held) return held.id;
  const reach = dropReachFor(scene);
  const points = table && centre ? [{ x, y }, centre] : [{ x, y }];
  let nearest: { readonly id: string; readonly distance: number } | null = null;
  for (const zone of topmostFirst(scene.zones)) {
    if (!zone.interactive || zone.kind === 'board') continue;
    const distance = Math.min(
      ...points.map((point) => distanceToRect(zone.bounds, point.x, point.y))
    );
    if (distance <= reach && (!nearest || distance < nearest.distance)) {
      nearest = { id: zone.id, distance };
    }
  }
  return nearest?.id ?? looseBoardTargetAt(scene, x, y);
};

/**
 * A card printed in pieces (a V-UNION, a LEGEND) takes a card dropped
 * anywhere on the whole card its pieces make, missing pieces and all: a
 * lone quarter of a V-UNION is a quarter of a card to aim at, and the rest
 * of it goes where the missing quarters would be. Cards actually under the
 * point come first; this only fills the gaps between them.
 */
export const joinedCardTargetAt = (
  scene: BoardScene,
  sourceCardId: ViewCardId,
  x: number,
  y: number,
  detached = false,
  /** Leave out the source's own Pokémon, which travels with it. */
  skipOwnStack = false,
  /** The cards of a group carried with it, which travel with it too. */
  exclude?: ReadonlySet<ViewCardId>
): string | null => {
  const source = cardAt(scene, sourceCardId);
  const card = topmostFirst(scene.cards).find(
    (candidate) =>
      candidate.id !== sourceCardId &&
      !exclude?.has(candidate.id) &&
      candidate.interactive &&
      candidate.role === 'stackEvolution' &&
      candidate.composition?.kind === 'joined' &&
      !(
        skipOwnStack &&
        source?.role === 'stackEvolution' &&
        !detached &&
        candidate.parentId === source.parentId
      ) &&
      containsPoint(candidate.composition.bounds, x, y)
  );
  if (!card) return null;
  return (
    benchRearrangementTarget(scene, sourceCardId, card, detached) ??
    card.parentId
  );
};

/**
 * The card under a held card's centre that it would join, when the
 * pointer itself is over bare felt: never the held card, nor a card of the
 * Pokémon it is part of, which travel with it.
 */
export const heldCentreCardTarget = (
  scene: BoardScene,
  sourceCardId: ViewCardId,
  pointer: { readonly x: number; readonly y: number },
  centre: { readonly x: number; readonly y: number },
  detached = false,
  /** The cards of a group carried with it, which travel with it too. */
  exclude?: ReadonlySet<ViewCardId>
): string | null => {
  if (
    scene.layout.geometryVersion !== TABLE_LAYOUT_GEOMETRY_VERSION ||
    zoneUnder(scene, pointer.x, pointer.y)
  )
    return null;
  const source = cardAt(scene, sourceCardId);
  const card = topmostFirst(scene.cards).find(
    (candidate) =>
      candidate.id !== sourceCardId &&
      !exclude?.has(candidate.id) &&
      candidate.interactive &&
      !(
        source?.role === 'stackEvolution' &&
        !detached &&
        candidate.parentId === source.parentId
      ) &&
      containsPointInRotatedRect(
        candidate.bounds,
        candidate.rotationQuarterTurns,
        centre.x,
        centre.y
      )
  );
  if (!card)
    return joinedCardTargetAt(
      scene,
      sourceCardId,
      centre.x,
      centre.y,
      detached,
      true,
      exclude
    );
  return (
    benchRearrangementTarget(scene, sourceCardId, card, detached) ??
    card.parentId
  );
};

/**
 * What a card dropped with the pointer at (x, y) lands on: the topmost card
 * under the pointer (its stack, to join it), or the whole of a card printed
 * in pieces, else a zone. Players aim with the pointer: a hand card is
 * gripped by its visible top, its face hanging below. Over bare felt, the
 * held card's `centre` aims too. A group's cards (`exclude`) are never
 * where it lands: they travel with it.
 */
export const resolveBoardDropTarget = (
  scene: BoardScene,
  sourceCardId: ViewCardId,
  x: number,
  y: number,
  detached = false,
  centre?: { readonly x: number; readonly y: number },
  exclude?: ReadonlySet<ViewCardId>
): string | null => {
  const card = topmostFirst(scene.cards).find(
    (candidate) =>
      candidate.id !== sourceCardId &&
      !exclude?.has(candidate.id) &&
      candidate.interactive &&
      containsPointInRotatedRect(
        candidate.bounds,
        candidate.rotationQuarterTurns,
        x,
        y
      )
  );
  if (card)
    return (
      benchRearrangementTarget(scene, sourceCardId, card, detached) ??
      card.parentId
    );
  return (
    joinedCardTargetAt(scene, sourceCardId, x, y, detached, false, exclude) ||
    (centre &&
      heldCentreCardTarget(
        scene,
        sourceCardId,
        { x, y },
        centre,
        detached,
        exclude
      )) ||
    zoneDropTargetAt(scene, x, y, centre)
  );
};

const pressOf = (
  press: BoardPress | undefined
): Pick<ActiveGesture, 'group' | 'adds'> => ({
  ...(press?.group && press.group.length > 1 ? { group: press.group } : {}),
  ...(press?.adds ? { adds: true } : {}),
});

/** The group a drag carries: none for a card lifted off its Pokémon alone. */
const groupOf = (gesture: ActiveGesture): readonly ViewCardId[] | undefined =>
  gesture.detached ? undefined : gesture.group;

/** Pointer gesture state that turns presses and moves into drag intent. */
export class BoardDragController {
  private active: ActiveGesture | null = null;
  /**
   * The press a finished drag leaves behind, whose click the renderer drops.
   * A pile's cover is one element for whichever card is on top, so by the
   * time its click arrives it may stand for the next card: the click is
   * matched by the element pressed as well as by the card.
   */
  private suppressedClick: {
    readonly cardId: ViewCardId;
    readonly renderKey: string | null;
  } | null = null;

  constructor(
    private readonly adapters: Pick<
      BoardRendererAdapters,
      'emitIntent' | 'emitPresentationUpdate'
    >,
    private readonly thresholdPixels = 5
  ) {
    if (!Number.isFinite(thresholdPixels) || thresholdPixels < 0) {
      throw new Error('Drag threshold must be a non-negative finite number');
    }
  }

  pointerDown(
    scene: BoardScene,
    cardId: ViewCardId,
    input: BoardPointerInput,
    press?: BoardPress
  ): boolean {
    if (this.active || input.button !== 0 || !this.validPoint(input)) {
      return false;
    }
    const card = cardAt(scene, cardId);
    if (!card?.interactive) return false;
    this.suppressedClick = null;
    this.active = {
      pointerId: input.pointerId,
      cardId,
      ...pressOf(press),
      renderKey: card.renderKey,
      startX: input.x,
      startY: input.y,
      centerOffsetX: card.bounds.x + card.bounds.width / 2 - input.x,
      centerOffsetY: card.bounds.y + card.bounds.height / 2 - input.y,
      screenStart: input.screenPoint,
      dragging: false,
      detached: false,
    };
    return true;
  }

  /**
   * A long press on a Pokémon lifts the pressed card off its stack: it rises
   * where it is and the drag that follows moves it alone. Only before the
   * pointer has started a drag, and only for a card that has a stack to
   * leave.
   */
  detach(scene: BoardScene, pointerId: number): boolean {
    const gesture = this.active;
    if (
      !gesture ||
      gesture.pointerId !== pointerId ||
      gesture.dragging ||
      !canDetachFromStack(scene, gesture.cardId)
    ) {
      return false;
    }
    const card = cardAt(scene, gesture.cardId)!;
    gesture.dragging = true;
    gesture.detached = true;
    const x = card.bounds.x + card.bounds.width / 2;
    const y = card.bounds.y + card.bounds.height / 2;
    this.adapters.emitPresentationUpdate({
      kind: 'DragChanged',
      drag: {
        cardId: gesture.cardId,
        x,
        y,
        targetId: resolveBoardDropTarget(
          scene,
          gesture.cardId,
          x - gesture.centerOffsetX,
          y - gesture.centerOffsetY,
          true
        ),
        detached: true,
      },
    });
    return true;
  }

  /**
   * A press not yet dragging picks up another card and drags it at once: a
   * finger slid along a crowded hand, raising each card in turn, then moved
   * toward the table with the one it shows. `centre` is where that card's
   * centre is painted (raised out of the hand), so it is held where it is
   * seen; without it the card is held as a press on it would hold it.
   */
  pick(
    scene: BoardScene,
    cardId: ViewCardId,
    input: BoardPointerInput,
    centre?: { readonly x: number; readonly y: number },
    press?: BoardPress
  ): boolean {
    const gesture = this.active;
    if (
      !gesture ||
      gesture.pointerId !== input.pointerId ||
      gesture.dragging ||
      !this.validPoint(input)
    ) {
      return false;
    }
    const card = cardAt(scene, cardId);
    if (!card?.interactive) return false;
    this.active = {
      pointerId: input.pointerId,
      cardId,
      ...pressOf(press),
      renderKey: card.renderKey,
      startX: input.x,
      startY: input.y,
      centerOffsetX:
        (centre?.x ?? card.bounds.x + card.bounds.width / 2) - input.x,
      centerOffsetY:
        (centre?.y ?? card.bounds.y + card.bounds.height / 2) - input.y,
      screenStart: input.screenPoint,
      dragging: true,
      detached: false,
    };
    this.join(this.active);
    return this.pointerMove(scene, input);
  }

  pointerMove(scene: BoardScene, input: BoardPointerInput): boolean {
    const gesture = this.active;
    if (
      !gesture ||
      gesture.pointerId !== input.pointerId ||
      !this.validPoint(input)
    ) {
      return false;
    }
    const card = cardAt(scene, gesture.cardId);
    if (!card?.interactive) {
      this.cancel(input.pointerId);
      return false;
    }
    if (!gesture.dragging) {
      const xDistance =
        input.screenPoint && gesture.screenStart
          ? input.screenPoint.x - gesture.screenStart.x
          : input.x - gesture.startX;
      const yDistance =
        input.screenPoint && gesture.screenStart
          ? input.screenPoint.y - gesture.screenStart.y
          : input.y - gesture.startY;
      if (
        xDistance * xDistance + yDistance * yDistance <
        this.thresholdPixels * this.thresholdPixels
      ) {
        return false;
      }
      gesture.dragging = true;
      this.join(gesture);
    }
    const group = groupOf(gesture);
    const targetId =
      input.targetId !== undefined
        ? input.targetId
        : resolveBoardDropTarget(
            scene,
            gesture.cardId,
            input.x,
            input.y,
            gesture.detached,
            {
              x: input.x + gesture.centerOffsetX,
              y: input.y + gesture.centerOffsetY,
            },
            group ? groupCardsOf(scene, group) : undefined
          );
    const index = this.arrangementIndex(scene, gesture, targetId, input);
    this.adapters.emitPresentationUpdate({
      kind: 'DragChanged',
      drag: {
        cardId: gesture.cardId,
        x: input.x + gesture.centerOffsetX,
        y: input.y + gesture.centerOffsetY,
        targetId,
        ...(index === null ? {} : { index }),
        ...(gesture.detached ? { detached: true } : {}),
        ...(group ? { groupCardIds: group } : {}),
      },
    });
    return true;
  }

  /**
   * A card pressed with Shift or ⌘/Ctrl that starts to move joins the
   * selection first, then drags the group (ADR-042 §2). Once per gesture.
   */
  private join(gesture: ActiveGesture): void {
    if (!gesture.adds || gesture.detached) return;
    gesture.adds = false;
    this.adapters.emitIntent({
      kind: 'CardSelected',
      cardId: gesture.cardId,
      mode: 'add',
    });
  }

  private arrangementIndex(
    scene: BoardScene,
    gesture: ActiveGesture,
    targetId: string | null,
    input: BoardPointerInput
  ): number | null {
    return input.arrangementIndex !== undefined
      ? input.arrangementIndex
      : arrangementIndexAt(
          scene,
          gesture.cardId,
          targetId,
          input.x,
          input.y,
          undefined,
          groupOf(gesture)
        );
  }

  pointerUp(scene: BoardScene, input: BoardPointerInput): boolean {
    const gesture = this.active;
    if (!gesture || gesture.pointerId !== input.pointerId) {
      return false;
    }
    if (!this.validPoint(input)) return this.cancel(input.pointerId);
    this.pointerMove(scene, input);
    if (this.active !== gesture) return false;
    this.active = null;
    if (!gesture.dragging) return false;
    // It comes down centred where it was held, so it never jumps by the
    // grip on release.
    const centreX = input.x + gesture.centerOffsetX;
    const centreY = input.y + gesture.centerOffsetY;
    const group = groupOf(gesture);
    const targetId =
      input.targetId !== undefined
        ? input.targetId
        : resolveBoardDropTarget(
            scene,
            gesture.cardId,
            input.x,
            input.y,
            gesture.detached,
            { x: centreX, y: centreY },
            group ? groupCardsOf(scene, group) : undefined
          );
    const index = this.arrangementIndex(scene, gesture, targetId, input);
    this.suppressClickOf(gesture);
    this.adapters.emitPresentationUpdate({ kind: 'DragChanged', drag: null });
    if (targetId) {
      this.adapters.emitIntent({
        kind: 'CardDropRequested',
        cardId: gesture.cardId,
        targetId,
        x: input.dropPoint?.x ?? centreX,
        y: input.dropPoint?.y ?? centreY,
        ...(index === null ? {} : { index }),
        ...(gesture.detached ? { detached: true } : {}),
        ...(group ? { groupCardIds: group } : {}),
      });
    }
    return true;
  }

  cancel(pointerId?: number): boolean {
    const gesture = this.active;
    if (
      !gesture ||
      (pointerId !== undefined && pointerId !== gesture.pointerId)
    ) {
      return false;
    }
    this.active = null;
    if (gesture.dragging) {
      this.suppressClickOf(gesture);
      this.adapters.emitPresentationUpdate({ kind: 'DragChanged', drag: null });
    }
    return gesture.dragging;
  }

  private suppressClickOf(gesture: ActiveGesture): void {
    this.suppressedClick = {
      cardId: gesture.cardId,
      renderKey: gesture.renderKey,
    };
  }

  reconcile(scene: BoardScene): void {
    const gesture = this.active;
    if (gesture && !cardAt(scene, gesture.cardId)?.interactive) this.cancel();
  }

  /**
   * Whether a click on this card -- painted under `renderKey` -- is the one
   * a drag just ended with, which must not also select it or open its pile.
   * Asked once per click: it is forgotten once matched.
   */
  consumeSuppressedClick(
    cardId: ViewCardId,
    renderKey?: string | null
  ): boolean {
    const suppressed = this.suppressedClick;
    if (
      !suppressed ||
      (suppressed.cardId !== cardId &&
        (renderKey == null || suppressed.renderKey !== renderKey))
    ) {
      return false;
    }
    this.suppressedClick = null;
    return true;
  }

  /**
   * Drops the click a press on this card is about to make: the press was
   * on something lying on it (a damage counter), which answered it instead.
   */
  suppressClick(cardId: ViewCardId, renderKey: string | null): void {
    this.suppressedClick = { cardId, renderKey };
  }

  /** Clears one local gesture without emitting a second presentation update. */
  cancelInteraction(): number | null {
    const pointerId = this.active?.pointerId ?? null;
    this.active = null;
    this.suppressedClick = null;
    return pointerId;
  }

  /**
   * Renderer-owned failure boundary. Unlike an application-requested cancel,
   * this must tell presentation state when an in-flight drag is lost.
   */
  cancelForRendererFailure(): BoardInteractionCancellation {
    const gesture = this.active;
    if (!gesture) {
      this.suppressedClick = null;
      return { pointerId: null, wasDragging: false };
    }
    const pointerId = gesture.pointerId;
    const wasDragging = gesture.dragging;
    this.active = null;
    this.suppressedClick = null;
    if (wasDragging) {
      this.adapters.emitPresentationUpdate({ kind: 'DragChanged', drag: null });
    }
    return { pointerId, wasDragging };
  }

  destroy(): void {
    this.cancelInteraction();
  }

  private validPoint(input: BoardPointerInput): boolean {
    return (
      Number.isSafeInteger(input.pointerId) &&
      Number.isFinite(input.x) &&
      Number.isFinite(input.y) &&
      (!input.screenPoint ||
        (Number.isFinite(input.screenPoint.x) &&
          Number.isFinite(input.screenPoint.y))) &&
      (!input.dropPoint ||
        (Number.isFinite(input.dropPoint.x) &&
          Number.isFinite(input.dropPoint.y)))
    );
  }
}
