import { expect, it } from 'vitest';
import { tableSeamShare } from './table-seam.js';

it('puts the seam where the frames meet for the boards split as asked', () => {
  // Tilted on a wide window the frames are the boards.
  expect(tableSeamShare(0.5, true, { width: 1440, height: 900 })).toBeCloseTo(
    0.5,
    9
  );
  // Flat, or upright, the near frame holds the deeper hand strip.
  expect(tableSeamShare(0.5, false, { width: 1440, height: 900 })).toBeCloseTo(
    0.47,
    9
  );
  expect(tableSeamShare(0.5, true, { width: 390, height: 844 })).toBeCloseTo(
    0.47,
    9
  );
  expect(tableSeamShare(0.6, true, { width: 1440, height: 900 })).toBeCloseTo(
    0.4,
    9
  );
});
