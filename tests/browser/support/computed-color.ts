/**
 * Reading computed colours in the redesigned paint (ADR-027), whose tokens
 * resolve to `oklch(...)` rather than v1's `rgb(...)`.
 */

/** Alpha of a computed colour (`rgb`, `rgba`, `oklch`, ...); 1 when it has none. */
export const alphaOf = (color: string): number => {
  if (color === 'transparent') return 0;
  const slash = /\/\s*([\d.]+)(%?)\s*\)$/u.exec(color);
  if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
  const rgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/u.exec(color);
  return rgba ? Number(rgba[1]) : 1;
};
