import type { MatchState } from './model.js';
import { stableSerialize } from './stable-hash.js';

/**
 * One change between two match states: the value at `path` is replaced, or
 * removed when `remove` is set. Arrays and scalars are replaced whole; only
 * plain objects are descended into.
 */
export type MatchStatePatchOperation =
  | { readonly path: readonly string[]; readonly value: unknown }
  | { readonly path: readonly string[]; readonly remove: true };

/**
 * The difference from one match state to another. Undo records this rather
 * than the whole restored state: taking back one move changes a handful of
 * fields, while a full state is tens of kilobytes in every replay entry.
 */
export type MatchStatePatch = readonly MatchStatePatchOperation[];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const diffInto = (
  from: unknown,
  to: unknown,
  path: readonly string[],
  operations: MatchStatePatchOperation[]
): void => {
  if (isPlainObject(from) && isPlainObject(to)) {
    for (const key of Object.keys(from).sort()) {
      if (!Object.hasOwn(to, key)) {
        operations.push({ path: [...path, key], remove: true });
      }
    }
    for (const key of Object.keys(to).sort()) {
      if (Object.hasOwn(from, key)) {
        diffInto(from[key], to[key], [...path, key], operations);
      } else {
        operations.push({
          path: [...path, key],
          value: structuredClone(to[key]),
        });
      }
    }
    return;
  }
  if (from === to) return;
  if (stableSerialize(from) === stableSerialize(to)) return;
  operations.push({ path: [...path], value: structuredClone(to) });
};

/** The patch that turns `from` into a state structurally equal to `to`. */
export const diffMatchState = (
  from: MatchState,
  to: MatchState
): MatchStatePatch => {
  const operations: MatchStatePatchOperation[] = [];
  diffInto(from, to, [], operations);
  return operations;
};

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const applyAt = (
  target: unknown,
  path: readonly string[],
  depth: number,
  operation: MatchStatePatchOperation
): unknown => {
  const key = path[depth]!;
  if (FORBIDDEN_KEYS.has(key) || !isPlainObject(target)) {
    throw new Error('Match state patch does not address a plain object');
  }
  const next: Record<string, unknown> = { ...target };
  if (depth === path.length - 1) {
    if ('remove' in operation) {
      if (!Object.hasOwn(next, key)) {
        throw new Error('Match state patch removes a missing field');
      }
      delete next[key];
    } else {
      next[key] = structuredClone(operation.value);
    }
    return next;
  }
  if (!Object.hasOwn(next, key)) {
    throw new Error('Match state patch addresses a missing field');
  }
  next[key] = applyAt(next[key], path, depth + 1, operation);
  return next;
};

/**
 * Applies a patch without mutating `state`. Only the objects along each
 * changed path are copied; the caller verifies the result, normally against
 * the hash recorded with the patch.
 */
export const applyMatchStatePatch = (
  state: MatchState,
  patch: MatchStatePatch
): MatchState => {
  let next: unknown = state;
  for (const operation of patch) {
    if (!Array.isArray(operation.path) || operation.path.length === 0) {
      throw new Error('Match state patch path is empty');
    }
    if (operation.path.some((segment) => typeof segment !== 'string')) {
      throw new Error('Match state patch path is malformed');
    }
    next = applyAt(next, operation.path, 0, operation);
  }
  return next as MatchState;
};
