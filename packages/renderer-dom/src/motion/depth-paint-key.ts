/** Immutable scene values can be recreated by an acknowledgement. Cache their
 * small value keys so unchanged card faces do not rebuild their SVG geometry. */
const keys = new WeakMap<object, string>();

export const depthPaintKey = (value: object): string => {
  let key = keys.get(value);
  if (key === undefined) {
    key = JSON.stringify(value);
    keys.set(value, key);
  }
  return key;
};
