import type { CSSProperties } from 'react';

/** Rotate the original portrait bitmap inside its reading-shaped frame. */
export const readingImageStyle = (quarterTurns: number): CSSProperties => ({
  position: 'absolute',
  inset: 'auto',
  left: '50%',
  top: '50%',
  width: quarterTurns % 2 ? `${(63 / 88) * 100}%` : '100%',
  height: quarterTurns % 2 ? `${(88 / 63) * 100}%` : '100%',
  maxWidth: 'none',
  maxHeight: 'none',
  transform: `translate(-50%, -50%) rotate(${quarterTurns * 90}deg)`,
});
