/** A canonical reference names an own record entry, never its prototype. */
export const ownEntry = <Value>(
  record: Readonly<Record<string, Value>>,
  key: string
): Value | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);
