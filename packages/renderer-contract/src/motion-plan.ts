import type { QuarterTurns } from '@ptcgsim/game-core';

import type {
  BoardScene,
  BoardSceneMotionCause,
  CardSceneNode,
  MarkerSceneNode,
  Rect,
} from './model.js';

/**
 * How the table gets from one scene to the next. The plan is computed from the
 * two recipient-safe scenes alone, so pairing a card that vanished from one
 * place with a card that appeared in another discloses nothing the viewer
 * could not already see: the same counts changed in the same zones.
 *
 * Card identities are per-viewer aliases that change on purpose whenever a
 * card crosses a concealment boundary (a draw, a prize taken, a card returned
 * to the hand or deck). Continuity is therefore found in three steps: the same
 * painted node, then the same card id painted under another key, then -- for
 * re-keyed cards -- pairing departures with arrivals of the same owner.
 */
export interface CardFlight {
  /** The painted node in the next scene that travels. */
  readonly renderKey: string;
  /** Where it visually starts, in board coordinates. */
  readonly from: Rect;
  readonly fromRotationQuarterTurns: QuarterTurns;
  /**
   * The image it shows when it sets off, when that differs from where it
   * lands: a card drawn face down and turned up in the hand, a card played
   * from a hidden hand.
   */
  readonly fromImageUrl?: string;
  /** Seconds to wait before setting off, so a run of cards fans out. */
  readonly delay: number;
  /**
   * `move`: the same node changed place. `enter`: a node that was not painted
   * before arrives from where its card was. `appear`: nothing to fly from; it
   * grows into place.
   */
  readonly kind: 'move' | 'enter' | 'appear';
}

/** A card that leaves the painted table: a short-lived copy flies away. */
export interface CardGhost {
  readonly key: string;
  readonly imageUrl: string;
  readonly from: Rect;
  readonly fromRotationQuarterTurns: QuarterTurns;
  /** Null: it fades where it is (nothing to fly to). */
  readonly to: Rect | null;
  readonly toRotationQuarterTurns: QuarterTurns;
  /** The image it shows on arrival, when it turns over on the way. */
  readonly toImageUrl?: string;
  readonly delay: number;
  /**
   * Stay put, unmoving, until this painted node has landed: the card that
   * was on top of a pile keeps covering it while the new top flies in.
   */
  readonly holdFor?: string;
}

/** A counter on a stack whose value changed. */
export interface MarkerPulse {
  readonly markerId: string;
  readonly kind: MarkerSceneNode['kind'];
  readonly previousValue: string | null;
  readonly value: string;
}

/**
 * A pile that was shuffled: every card it held before has a new alias. A
 * shuffle is the one change that re-aliases a whole pile -- drawing, or
 * putting a card on top, re-aliases only the cards that moved -- so this
 * also catches a hand, a discard or prizes shuffled in, which change the
 * count. The viewer's own scenes show it, so the riffle reveals nothing new.
 */
export interface PileShuffle {
  readonly zoneId: string;
  readonly rect: Rect;
  readonly rotationQuarterTurns: QuarterTurns;
  readonly imageUrl: string;
  /** Seconds to wait so the cards flying into the pile land first. */
  readonly delay: number;
}

export interface MotionPlan {
  readonly cause: BoardSceneMotionCause;
  readonly flights: readonly CardFlight[];
  readonly ghosts: readonly CardGhost[];
  readonly pulses: readonly MarkerPulse[];
  readonly shuffles: readonly PileShuffle[];
}

const EMPTY_PLAN = (cause: BoardSceneMotionCause): MotionPlan => ({
  cause,
  flights: [],
  ghosts: [],
  pulses: [],
  shuffles: [],
});

/** Piles a shuffle can apply to and that paint a cover worth riffling. */
const SHUFFLED_PILE_KINDS = new Set(['deck']);

/** Roughly when a card flying into a pile has landed, after it sets off. */
const PILE_ARRIVAL_SECONDS = 0.3;

const centreInside = (rect: Rect, outer: Rect): boolean => {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  return (
    x >= outer.x &&
    x <= outer.x + outer.width &&
    y >= outer.y &&
    y <= outer.y + outer.height
  );
};

const detectShuffles = (
  previous: BoardScene,
  next: BoardScene,
  flights: readonly CardFlight[],
  ghosts: readonly CardGhost[]
): PileShuffle[] => {
  const shuffles: PileShuffle[] = [];
  for (const zone of next.zones) {
    if (!SHUFFLED_PILE_KINDS.has(zone.kind) || zone.count < 2) continue;
    const before = previous.zones.find((candidate) => candidate.id === zone.id);
    if (!before || before.count < 1) continue;
    const previousIds = new Set(
      previous.cards
        .filter((card) => card.parentId === zone.id)
        .map((card) => String(card.id))
    );
    const nextMembers = next.cards.filter((card) => card.parentId === zone.id);
    if (nextMembers.some((card) => previousIds.has(String(card.id)))) continue;
    const face =
      nextMembers.find((card) => card.renderKey !== null) ?? nextMembers[0];
    if (!face) continue;
    const memberRects = new Map(
      nextMembers.flatMap((card) =>
        card.renderKey === null ? [] : [[card.renderKey, card.bounds] as const]
      )
    );
    // Cards that travel into the pile; a re-keyed cover that stays put is
    // not one.
    const arrivals = [
      ...flights
        .filter((flight) => {
          const rect = memberRects.get(flight.renderKey);
          return rect !== undefined && !sameRect(flight.from, rect);
        })
        .map((flight) => flight.delay),
      ...ghosts
        .filter((ghost) => ghost.to && centreInside(ghost.to, zone.bounds))
        .map((ghost) => ghost.delay),
    ];
    shuffles.push({
      zoneId: zone.id,
      rect: face.bounds,
      rotationQuarterTurns: face.rotationQuarterTurns,
      imageUrl: paintedImage(face),
      delay:
        arrivals.length === 0
          ? 0
          : Math.max(...arrivals) + PILE_ARRIVAL_SECONDS,
    });
  }
  return shuffles;
};

/** Seconds between successive cards leaving the same place. */
export const MOTION_STAGGER_SECONDS = 0.045;
/** A long run (a whole hand shuffled away) still finishes promptly. */
const MAXIMUM_STAGGER_SECONDS = 0.4;

const sameRect = (left: Rect, right: Rect): boolean =>
  Math.abs(left.x - right.x) < 0.5 &&
  Math.abs(left.y - right.y) < 0.5 &&
  Math.abs(left.width - right.width) < 0.5 &&
  Math.abs(left.height - right.height) < 0.5;

const paintedImage = (card: CardSceneNode): string =>
  card.tableImageUrl ?? card.imageUrl;

const PILE_KINDS = new Set(['deck', 'discard', 'lostZone', 'stadium']);

interface Endpoint {
  readonly ownerId: string;
  /** Container (zone, stack or work area) the card left or entered. */
  readonly containerId: string;
  readonly rect: Rect;
  readonly rotationQuarterTurns: QuarterTurns;
  readonly imageUrl: string;
  /** Present for a painted card; absent for a card hidden inside a pile. */
  readonly renderKey?: string;
}

const endpointOf = (card: CardSceneNode): Endpoint => ({
  ownerId: card.ownerId,
  containerId: card.parentId,
  rect: card.bounds,
  rotationQuarterTurns: card.rotationQuarterTurns,
  imageUrl: paintedImage(card),
  ...(card.renderKey === null ? {} : { renderKey: card.renderKey }),
});

/** The painted top of a pile zone, or any card of it if none is painted. */
const pileFace = (
  scene: BoardScene,
  zoneId: string
): CardSceneNode | undefined => {
  const members = scene.cards.filter((card) => card.parentId === zoneId);
  return members.find((card) => card.renderKey !== null) ?? members[0];
};

const zoneCounts = (scene: BoardScene): Map<string, number> =>
  new Map(scene.zones.map((zone) => [zone.id, zone.count]));

/**
 * Stable key for a marker that survives its host being evolved (the marker id
 * follows the top card, the stack does not change).
 */
const markerSlot = (scene: BoardScene, marker: MarkerSceneNode): string => {
  const host = scene.cards.find((card) => card.id === marker.parentCardId);
  return `${host?.parentId ?? String(marker.parentCardId)}:${marker.kind}`;
};

export const planBoardMotion = (
  previous: BoardScene | null,
  next: BoardScene,
  cause: BoardSceneMotionCause
): MotionPlan => {
  if (
    !previous ||
    cause === 'layout' ||
    cause === 'replace' ||
    previous.matchId !== next.matchId
  ) {
    return EMPTY_PLAN(cause);
  }

  const previousByKey = new Map<string, CardSceneNode>();
  const previousById = new Map<string, CardSceneNode>();
  for (const card of previous.cards) {
    previousById.set(String(card.id), card);
    if (card.renderKey !== null) previousByKey.set(card.renderKey, card);
  }
  const nextPainted = next.cards.filter((card) => card.renderKey !== null);
  const nextPaintedIds = new Set(nextPainted.map((card) => String(card.id)));
  const nextById = new Map(next.cards.map((card) => [String(card.id), card]));

  const flights: CardFlight[] = [];
  const ghosts: CardGhost[] = [];
  const unmatchedArrivals: CardSceneNode[] = [];

  for (const card of nextPainted) {
    const key = card.renderKey!;
    const sameNode = previousByKey.get(key);
    const sameCard = previousById.get(String(card.id));
    if (sameNode && sameNode.id === card.id) {
      if (
        !sameRect(sameNode.bounds, card.bounds) ||
        sameNode.rotationQuarterTurns !== card.rotationQuarterTurns
      ) {
        flights.push({
          renderKey: key,
          from: sameNode.bounds,
          fromRotationQuarterTurns: sameNode.rotationQuarterTurns,
          delay: 0,
          kind: 'move',
        });
      }
      continue;
    }
    if (sameCard) {
      // The card was on the table under another key -- a pile cover now shows
      // it, or it came off a pile -- so the node arrives from there.
      if (
        !sameRect(sameCard.bounds, card.bounds) ||
        sameCard.rotationQuarterTurns !== card.rotationQuarterTurns
      ) {
        const fromImage = paintedImage(sameCard);
        flights.push({
          renderKey: key,
          from: sameCard.bounds,
          fromRotationQuarterTurns: sameCard.rotationQuarterTurns,
          ...(fromImage !== paintedImage(card)
            ? { fromImageUrl: fromImage }
            : {}),
          delay: 0,
          kind: sameNode ? 'move' : 'enter',
        });
        // A pile cover now shows the incoming card while it is still on its
        // way; the card that was on top keeps the pile covered until then.
        if (
          sameNode &&
          nextById.has(String(sameNode.id)) &&
          paintedImage(sameNode) !== paintedImage(card)
        ) {
          ghosts.push({
            key: `hold:${key}:${String(next.revision)}`,
            imageUrl: paintedImage(sameNode),
            from: sameNode.bounds,
            fromRotationQuarterTurns: sameNode.rotationQuarterTurns,
            to: sameNode.bounds,
            toRotationQuarterTurns: sameNode.rotationQuarterTurns,
            delay: 0,
            holdFor: key,
          });
        }
      }
      continue;
    }
    unmatchedArrivals.push(card);
  }

  // Painted cards whose card is gone from the painted table.
  const unmatchedDepartures: Endpoint[] = [];
  for (const card of previousByKey.values()) {
    if (nextPaintedIds.has(String(card.id))) continue;
    const stillThere = nextById.get(String(card.id));
    if (stillThere) {
      // Now hidden inside a pile (no longer its top): it slides under.
      if (
        !sameRect(card.bounds, stillThere.bounds) ||
        card.rotationQuarterTurns !== stillThere.rotationQuarterTurns
      ) {
        ghosts.push({
          key: `ghost:${card.renderKey!}:${String(next.revision)}`,
          imageUrl: paintedImage(card),
          from: card.bounds,
          fromRotationQuarterTurns: card.rotationQuarterTurns,
          to: stillThere.bounds,
          toRotationQuarterTurns: stillThere.rotationQuarterTurns,
          delay: 0,
        });
      }
      continue;
    }
    unmatchedDepartures.push(endpointOf(card));
  }

  // Cards that left or entered a pile without ever being painted: a pile only
  // paints its top, so a draw shows up as the deck's count falling.
  const previousCounts = zoneCounts(previous);
  const nextCounts = zoneCounts(next);
  const hiddenSources: Endpoint[] = [];
  const hiddenSinks: Endpoint[] = [];
  for (const zone of next.zones) {
    if (!PILE_KINDS.has(zone.kind)) continue;
    const before = previousCounts.get(zone.id) ?? 0;
    const after = nextCounts.get(zone.id) ?? 0;
    const paintedLeaving = unmatchedDepartures.filter(
      (endpoint) => endpoint.containerId === zone.id
    ).length;
    const paintedArriving = unmatchedArrivals.filter(
      (card) => card.parentId === zone.id
    ).length;
    // A hidden pile member is not a painted node: it has no render key, so
    // an unpaired one never turns into a ghost of the pile's own cover.
    const hiddenEndpoint = (face: CardSceneNode): Endpoint => ({
      ownerId: face.ownerId,
      containerId: zone.id,
      rect: face.bounds,
      rotationQuarterTurns: face.rotationQuarterTurns,
      imageUrl: paintedImage(face),
    });
    if (after < before) {
      const face = pileFace(previous, zone.id);
      for (let index = 0; index < before - after - paintedLeaving; index += 1) {
        if (face) hiddenSources.push(hiddenEndpoint(face));
      }
    } else if (after > before) {
      const face = pileFace(next, zone.id);
      for (
        let index = 0;
        index < after - before - paintedArriving;
        index += 1
      ) {
        if (face) hiddenSinks.push(hiddenEndpoint(face));
      }
    }
  }

  // Pair what left with what arrived, owner by owner, in table order. Both
  // sides come from the recipient's own scenes.
  const sources = [...unmatchedDepartures, ...hiddenSources];
  const sinks: Array<
    | { readonly kind: 'painted'; readonly card: CardSceneNode }
    | { readonly kind: 'hidden'; readonly endpoint: Endpoint }
  > = [
    ...unmatchedArrivals.map((card) => ({ kind: 'painted' as const, card })),
    ...hiddenSinks.map((endpoint) => ({ kind: 'hidden' as const, endpoint })),
  ];
  const usedSources = new Set<number>();
  const staggerBySource = new Map<string, number>();
  const stagger = (containerId: string): number => {
    const index = staggerBySource.get(containerId) ?? 0;
    staggerBySource.set(containerId, index + 1);
    return Math.min(MAXIMUM_STAGGER_SECONDS, index * MOTION_STAGGER_SECONDS);
  };
  /**
   * The best unused departure for an arrival of `ownerId` at `rect` in
   * `container`: one in that very spot first (the card turned over where it
   * lies), then one from elsewhere (it travelled), then any left in the same
   * place (it was re-dealt within it).
   */
  const takeSource = (
    ownerId: string,
    container: string,
    rect: Rect
  ): Endpoint | null => {
    const candidates = sources
      .map((source, index) => ({ source, index }))
      .filter(
        ({ source, index }) =>
          !usedSources.has(index) && source.ownerId === ownerId
      );
    const pick =
      candidates.find(
        ({ source }) =>
          source.containerId === container && sameRect(source.rect, rect)
      ) ??
      candidates.find(({ source }) => source.containerId !== container) ??
      candidates[0];
    if (!pick) return null;
    usedSources.add(pick.index);
    return pick.source;
  };

  for (const sink of sinks) {
    if (sink.kind === 'painted') {
      const card = sink.card;
      const source = takeSource(
        String(card.ownerId),
        card.parentId,
        card.bounds
      );
      if (source) {
        flights.push({
          renderKey: card.renderKey!,
          from: source.rect,
          fromRotationQuarterTurns: source.rotationQuarterTurns,
          ...(source.imageUrl !== paintedImage(card)
            ? { fromImageUrl: source.imageUrl }
            : {}),
          delay: stagger(source.containerId),
          kind: 'enter',
        });
      } else {
        flights.push({
          renderKey: card.renderKey!,
          from: card.bounds,
          fromRotationQuarterTurns: card.rotationQuarterTurns,
          delay: 0,
          kind: 'appear',
        });
      }
      continue;
    }
    const destination = sink.endpoint;
    const source = takeSource(
      destination.ownerId,
      destination.containerId,
      destination.rect
    );
    if (!source) continue;
    ghosts.push({
      key: `ghost:${source.renderKey ?? source.containerId}:${destination.containerId}:${String(
        ghosts.length
      )}:${String(next.revision)}`,
      imageUrl: source.imageUrl,
      from: source.rect,
      fromRotationQuarterTurns: source.rotationQuarterTurns,
      to: destination.rect,
      toRotationQuarterTurns: destination.rotationQuarterTurns,
      ...(destination.imageUrl !== source.imageUrl
        ? { toImageUrl: destination.imageUrl }
        : {}),
      delay: stagger(source.containerId),
    });
  }

  // Whatever left the table with nowhere to go fades where it was.
  sources.forEach((source, index) => {
    if (usedSources.has(index) || source.renderKey === undefined) return;
    ghosts.push({
      key: `ghost:${source.renderKey}:fade:${String(next.revision)}`,
      imageUrl: source.imageUrl,
      from: source.rect,
      fromRotationQuarterTurns: source.rotationQuarterTurns,
      to: null,
      toRotationQuarterTurns: source.rotationQuarterTurns,
      delay: 0,
    });
  });

  const previousMarkers = new Map(
    previous.markers.map((marker) => [markerSlot(previous, marker), marker])
  );
  const pulses: MarkerPulse[] = [];
  for (const marker of next.markers) {
    const before = previousMarkers.get(markerSlot(next, marker));
    if (before?.value === marker.value) continue;
    pulses.push({
      markerId: marker.id,
      kind: marker.kind,
      previousValue: before?.value ?? null,
      value: marker.value,
    });
  }

  return {
    cause,
    flights,
    ghosts,
    pulses,
    shuffles: detectShuffles(previous, next, flights, ghosts),
  };
};
