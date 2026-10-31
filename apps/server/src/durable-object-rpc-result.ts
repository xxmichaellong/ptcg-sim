/**
 * Cloudflare may attach an own Symbol.dispose method to object-valued RPC
 * results. Treat it as transport metadata, never as application payload.
 */
export const hasExactDurableObjectRpcResultKeys = (
  value: object,
  expected: readonly string[]
): boolean => {
  const keys = Reflect.ownKeys(value);
  const payloadKeys = keys.filter(
    (key): key is string => typeof key === 'string'
  );
  return (
    keys.every((key) => typeof key === 'string' || key === Symbol.dispose) &&
    JSON.stringify(payloadKeys.sort()) === JSON.stringify([...expected].sort())
  );
};

/** Release any RPC target retained by an object-valued result. */
export const disposeDurableObjectRpcResult = (value: object): void => {
  const dispose = Reflect.get(value, Symbol.dispose);
  if (typeof dispose === 'function') dispose.call(value);
};
