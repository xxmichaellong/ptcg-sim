import { describe, expect, it } from 'vitest';
import type { TableCardPose } from '@ptcgsim/renderer-contract';
import {
  RIFFLE_CUT,
  RIFFLE_DROPPED,
  RIFFLE_PACKETS,
  RIFFLE_SPREAD,
  riffleFrame,
  riffleOrder,
  rifflePacketTrip,
  riffleShift,
  riffleState,
} from './riffle.js';

/** The cut done, just before the first packet leaves the top half. */
const CUT = RIFFLE_CUT - 1e-9;

const deck: TableCardPose = {
  bounds: { x: 400, y: 300, width: 100, height: 140 },
  turns: 0,
  elevation: 24,
  thickness: 24,
  plane: 1,
};

describe('riffleOrder', () => {
  it('takes packets off the two halves by turns, the top half first', () => {
    const order = riffleOrder(47);
    expect(order.halves).toHaveLength(RIFFLE_PACKETS);
    expect(order.halves[0]).toBe('upper');
    for (let index = 1; index < order.halves.length; index += 1)
      expect(order.halves[index]).not.toBe(order.halves[index - 1]);
    expect(order.counts).toEqual({ upper: 4, lower: 4 });
    expect(order.cardsPerPacket).toBe(6);
  });

  it('gives a small pile a packet a card, the bottom half the odd one', () => {
    const order = riffleOrder(3);
    expect(order.halves).toEqual(['upper', 'lower', 'lower']);
    expect(order.counts).toEqual({ upper: 1, lower: 2 });
    expect(order.cardsPerPacket).toBe(1);
    expect(riffleOrder(1).halves).toHaveLength(2);
  });
});

describe('riffleState', () => {
  it('cuts, lands every packet in turn, then squares the pile', () => {
    const order = riffleOrder(60);
    const cut = riffleState(order, CUT);
    expect(cut.cut).toBeCloseTo(1);
    expect(cut.holds).toEqual(order.counts);
    expect(cut.landed).toBe(0);
    let landed = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const state = riffleState(order, t);
      // Every packet is in a half, in the air or on the new pile.
      expect(
        state.holds.upper +
          state.holds.lower +
          state.trips.filter((trip) => trip !== null).length +
          state.landed
      ).toBe(order.halves.length);
      expect(state.landed).toBeGreaterThanOrEqual(landed);
      landed = state.landed;
    }
    const dropped = riffleState(order, RIFFLE_DROPPED);
    expect(dropped.landed).toBe(order.halves.length);
    expect(dropped.holds).toEqual({ upper: 0, lower: 0 });
    expect(riffleState(order, 1).square).toBe(1);
    // Packets land in the order they leave, one after another.
    const trips = order.halves.map((_, index) =>
      rifflePacketTrip(order, index)
    );
    for (let index = 1; index < trips.length; index += 1)
      expect(trips[index]!.lands).toBeGreaterThan(trips[index - 1]!.lands);
  });
});

describe('riffleFrame', () => {
  const order = riffleOrder(47);

  it('lifts the top half off the deck and sets the halves down either side', () => {
    const mid = riffleFrame(deck, order, RIFFLE_CUT / 2);
    const cut = riffleFrame(deck, order, CUT);
    const upper = cut.get('upper')!.pose;
    const lower = cut.get('lower')!.pose;
    expect(upper.bounds.x).toBeCloseTo(deck.bounds.x - RIFFLE_SPREAD * 100);
    expect(lower.bounds.x).toBeCloseTo(deck.bounds.x + RIFFLE_SPREAD * 100);
    // On its way, above the bottom half it came off.
    expect(mid.get('upper')!.pose.elevation).toBeGreaterThan(
      deck.elevation + 1
    );
    // Set down, each is half the deck, standing on the table.
    expect(upper.thickness + lower.thickness).toBeCloseTo(deck.thickness);
    expect(upper.elevation).toBeCloseTo(upper.thickness);
    expect(lower.elevation).toBeCloseTo(lower.thickness);
    expect(cut.get('pile')).toBeNull();
  });

  it("takes the deck's old top card off first and lands each packet on the last", () => {
    const first = rifflePacketTrip(order, 0);
    const leaving = riffleFrame(deck, order, first.leaves + 1e-6).get(0)!;
    // Off the top of the top half, where the deck's top card was put down.
    const cut = riffleFrame(deck, order, CUT).get('upper')!.pose;
    expect(leaving.pose.bounds.x).toBeCloseTo(cut.bounds.x);
    expect(leaving.pose.elevation).toBeCloseTo(cut.elevation);
    let top = 0;
    order.halves.forEach((_, index) => {
      const { lands } = rifflePacketTrip(order, index);
      const pile = riffleFrame(deck, order, lands + 1e-6).get('pile')!.pose;
      expect(pile.bounds.x).toBeCloseTo(deck.bounds.x);
      expect(pile.elevation).toBeGreaterThan(top);
      top = pile.elevation;
      // In the air, it is over the pile it lands on and the half it left.
      const { leaves } = rifflePacketTrip(order, index);
      const trip = riffleFrame(deck, order, (leaves + lands) / 2);
      const flying = trip.get(index)!.pose;
      expect(flying.elevation).toBeGreaterThan(
        trip.get('pile')?.pose.elevation ?? 0
      );
    });
    expect(top).toBeCloseTo(deck.elevation);
    // Squared, it is the deck again, where it lay.
    const done = riffleFrame(deck, order, 1);
    expect(done.get('upper')).toBeNull();
    expect(done.get('lower')).toBeNull();
    expect(done.get('pile')!.pose).toMatchObject({
      bounds: deck.bounds,
      thickness: deck.thickness,
      elevation: deck.elevation,
    });
  });

  it('is drawn aside by a shift and put back as it squares up', () => {
    const shift = -40;
    const cut = riffleFrame(deck, order, CUT, shift);
    expect(cut.get('upper')!.pose.bounds.x).toBeCloseTo(
      deck.bounds.x + shift - RIFFLE_SPREAD * 100
    );
    const dropped = riffleFrame(deck, order, RIFFLE_DROPPED, shift);
    expect(dropped.get('pile')!.pose.bounds.x).toBeCloseTo(
      deck.bounds.x + shift
    );
    expect(riffleFrame(deck, order, 1, shift).get('pile')!.pose.bounds.x).toBe(
      deck.bounds.x
    );
  });
});

describe('riffleShift', () => {
  it('stays put with room either side and draws in from an edge', () => {
    expect(riffleShift({ left: 500, right: 500 }, 100)).toBe(0);
    // 12px to the window's right edge: drawn left until the right half fits.
    const shift = riffleShift({ left: 500, right: 12 }, 100);
    expect(shift).toBeLessThan(0);
    expect(12 - shift).toBeGreaterThanOrEqual(RIFFLE_SPREAD * 100);
    expect(riffleShift({ left: 12, right: 500 }, 100)).toBe(-shift);
    // Short both sides, it favours neither more than the room says.
    expect(riffleShift({ left: 20, right: 20 }, 100)).toBe(0);
  });
});
