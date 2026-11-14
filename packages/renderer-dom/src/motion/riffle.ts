import type { TableCardPose } from '@ptcgsim/renderer-contract';

/**
 * A riffle shuffle of a pile where it lies, shared by the tilted and the flat
 * table. The whole deck takes part, its top first: the top half is cut off
 * and lifted to one side while the bottom half slides to the other; then
 * packets come off the halves' tops, one side then the other, and land on a
 * new pile where the deck lay, so the pile's top changes with each; it
 * squares up. The deck's old top card is the first packet to go and ends at
 * the bottom of the new pile.
 */

/** A riffle shuffle, from cut to squared pile. */
export const RIFFLE_MS = 900;
/** Packets a pile is riffled in: enough to read as the halves interleaving. */
export const RIFFLE_PACKETS = 8;
/** Share of the riffle that cutting the deck into its two halves takes. */
export const RIFFLE_CUT = 0.24;
/** Share of the riffle by which the last packet has landed; then it squares. */
export const RIFFLE_DROPPED = 0.86;
/** Share of the riffle one packet takes from its half to the new pile. */
export const RIFFLE_TRIP = 0.16;
/** How far each half goes to its side, in widths of the pile. */
export const RIFFLE_SPREAD = 0.58;
/** Room kept clear between a half and the edge of the window, in pixels. */
export const RIFFLE_MARGIN = 8;
/** How far the halves turn as they splay apart, in quarter turns. */
export const RIFFLE_SPLAY = 0.025;

export type RiffleHalf = 'upper' | 'lower';

export interface RiffleOrder {
  /** Cards in the pile. */
  readonly cards: number;
  /** Cards a packet stands for, for the lines along its edge. */
  readonly cardsPerPacket: number;
  /** The half each packet comes off, in the order they land. */
  readonly halves: readonly RiffleHalf[];
  /** How many packets each half starts with. */
  readonly counts: Readonly<Record<RiffleHalf, number>>;
}

/** The packets of a pile of `cards`, taken off the halves by turns. */
export const riffleOrder = (cards: number): RiffleOrder => {
  const total = Math.max(2, Math.min(RIFFLE_PACKETS, Math.floor(cards)));
  const counts = { upper: Math.floor(total / 2), lower: Math.ceil(total / 2) };
  const halves: RiffleHalf[] = [];
  const left = { ...counts };
  // The top half goes first, so the old top card ends at the bottom; with an
  // odd count the bottom half has the extra packet and gives the last.
  for (let turn = 0; halves.length < total; turn += 1) {
    const half: RiffleHalf = turn % 2 === 0 ? 'upper' : 'lower';
    if (left[half] === 0) continue;
    left[half] -= 1;
    halves.push(half);
  }
  return {
    cards: Math.max(2, Math.floor(cards)),
    cardsPerPacket: Math.max(1, Math.round(cards / total)),
    halves,
    counts,
  };
};

/** When packet `index` leaves its half and lands, as shares of the riffle. */
export const rifflePacketTrip = (
  order: RiffleOrder,
  index: number
): { readonly leaves: number; readonly lands: number } => {
  const count = order.halves.length;
  const gap =
    count > 1 ? (RIFFLE_DROPPED - RIFFLE_CUT - RIFFLE_TRIP) / (count - 1) : 0;
  const leaves = RIFFLE_CUT + index * gap;
  return { leaves, lands: leaves + RIFFLE_TRIP };
};

export interface RiffleState {
  /** How far the cut is, eased: 0 a whole deck, 1 two halves apart. */
  readonly cut: number;
  /** Packets each half still holds. */
  readonly holds: Readonly<Record<RiffleHalf, number>>;
  /** Packets on the new pile. */
  readonly landed: number;
  /** How far each packet is between its half and the pile, or null. */
  readonly trips: readonly (number | null)[];
  /** How far the pile is through squaring up, 0 to 1. */
  readonly square: number;
}

const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Where the riffle stands `t` (0 to 1) of the way through. */
export const riffleState = (order: RiffleOrder, t: number): RiffleState => {
  const holds = { ...order.counts };
  let landed = 0;
  const trips = order.halves.map((half, index) => {
    const { leaves, lands } = rifflePacketTrip(order, index);
    if (t < leaves) return null;
    holds[half] -= 1;
    if (t >= lands) {
      landed += 1;
      return null;
    }
    return (t - leaves) / (lands - leaves);
  });
  return {
    cut: easeInOut(clamp(t / RIFFLE_CUT)),
    holds,
    landed,
    trips,
    square: clamp((t - RIFFLE_DROPPED) / (1 - RIFFLE_DROPPED)),
  };
};

/** Which way a half goes: the top half to the left, the bottom to the right. */
export const riffleSide = (half: RiffleHalf): number =>
  half === 'upper' ? -1 : 1;

/** How many packets of its half went before packet `index`. */
const riffleRank = (order: RiffleOrder, index: number): number =>
  order.halves.slice(0, index).filter((half) => half === order.halves[index])
    .length;

/**
 * How far along the table (x) the riffle is drawn from the pile, so both
 * halves stay in view: not at all where there is room for them either side;
 * otherwise toward the side with room, as a player draws a deck at the
 * table's edge in to riffle it and puts it back squared. `room` is the space
 * beside the pile on each side, `across` its width along the table.
 */
export const riffleShift = (
  room: { readonly left: number; readonly right: number },
  across: number
): number => {
  // A half splays a little as it goes, so it needs a touch more than that.
  const need = (RIFFLE_SPREAD + 0.06) * across;
  const shortLeft = Math.max(0, need - room.left);
  const shortRight = Math.max(0, need - room.right);
  // Short both sides, it splits the difference.
  return shortLeft > 0 && shortRight > 0
    ? (shortLeft - shortRight) / 2
    : shortLeft - shortRight;
};

/**
 * Where the new pile is, along the table from the pile, `state` of the way
 * through: drawn aside by `shift` while it is riffled and put back as it
 * squares up, with a small settle.
 */
const riffleCentre = (
  state: RiffleState,
  shift: number,
  width: number
): number =>
  shift * (1 - easeInOut(state.square)) + riffleSettle(state.square) * width;

/** A small side-to-side settle as the new pile is squared up. */
const riffleSettle = (square: number): number =>
  square > 0 && square < 1
    ? Math.sin(square * Math.PI * 2) * 0.02 * (1 - square)
    : 0;

export interface RifflePiece {
  readonly pose: TableCardPose;
  /** Cards the piece stands for, for the lines along its edge. */
  readonly bands: number;
}

/**
 * The stand-ins of a pile `base` riffled `t` of the way through, on a tilted
 * table, drawn `shift` along it (riffleShift): each half, the new pile and
 * each packet (by its index), or null where it is not to be seen.
 */
export const riffleFrame = (
  base: TableCardPose,
  order: RiffleOrder,
  t: number,
  shift = 0
): Map<RiffleHalf | 'pile' | number, RifflePiece | null> => {
  const state = riffleState(order, t);
  const packets = order.halves.length;
  const packet = base.thickness / packets;
  const floor = base.elevation - base.thickness;
  const width = base.bounds.width;
  // Across the table: a pile turned sideways is as wide as a card is tall.
  const across = Math.round(base.turns) % 2 === 0 ? width : base.bounds.height;
  const spread = RIFFLE_SPREAD * across;
  const at = (x: number, turns: number) => ({
    bounds: { ...base.bounds, x: base.bounds.x + x },
    turns: base.turns + turns,
  });
  const frame = new Map<RiffleHalf | 'pile' | number, RifflePiece | null>();
  for (const half of ['upper', 'lower'] as const) {
    const holds = state.holds[half];
    const side = riffleSide(half);
    const thickness = holds * packet;
    // The top half is lifted off the bottom one and set down beside it.
    const resting =
      half === 'upper'
        ? order.counts.lower * packet * (1 - state.cut) +
          0.1 * width * Math.sin(Math.PI * state.cut)
        : 0;
    frame.set(
      half,
      holds === 0
        ? null
        : {
            pose: {
              ...base,
              ...at(
                (shift + side * spread) * state.cut,
                side * RIFFLE_SPLAY * state.cut
              ),
              thickness,
              elevation: floor + thickness + resting,
            },
            bands: holds * order.cardsPerPacket,
          }
    );
  }
  frame.set(
    'pile',
    state.landed === 0
      ? null
      : {
          pose: {
            ...base,
            ...at(riffleCentre(state, shift, width), 0),
            thickness: state.landed * packet,
            elevation: floor + state.landed * packet,
          },
          bands: state.landed * order.cardsPerPacket,
        }
  );
  state.trips.forEach((trip, index) => {
    if (trip === null) {
      frame.set(index, null);
      return;
    }
    const half = order.halves[index]!;
    const side = riffleSide(half);
    const eased = easeInOut(trip);
    const lift = Math.sin(Math.PI * trip);
    // Off the top of its half, as it was just before it went...
    const from =
      floor + (order.counts[half] - riffleRank(order, index)) * packet;
    // ...onto the top of the new pile, over the packets landed before it.
    const to = floor + (index + 1) * packet;
    frame.set(index, {
      pose: {
        ...base,
        ...at(
          shift + side * spread * (1 - eased),
          side * RIFFLE_SPLAY * (1 - eased)
        ),
        thickness: packet,
        elevation: from + (to - from) * eased + 0.08 * width * lift,
        // Its leading edge dips toward the pile, as a card tossed onto it.
        flip: side * 0.22 * lift,
      },
      bands: order.cardsPerPacket,
    });
  });
  return frame;
};
