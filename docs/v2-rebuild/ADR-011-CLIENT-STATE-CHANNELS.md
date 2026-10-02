# ADR-011: separate authoritative, pending, and presentation client state

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: browser session and UI state ownership

## Context

A responsive client needs local interaction state and command progress, but
letting either mutate the installed authority view creates a second reducer.
Animations and activity also have different lifetimes from recoverable game
state.

## Decision

Maintain three explicit client channels:

1. an immutable latest recipient view installed only from validated authority
   publications;
2. a bounded pending-command overlay for submission/progress feedback, without
   predicted random, hidden, bulk, or canonical game outcomes; and
3. bounded local presentation state for selection, hover, drag, menus, prompts,
   activity, accessibility announcements, animations, and replay position.

Use the implemented dependency-free external stores with immutable snapshots and
narrow React bindings. A library such as Zustand is unnecessary unless a future
measurement or maintenance review justifies it. Session, replay, and route
owners reset or cancel each channel explicitly on reconnect, mode change,
identity change, and disposal.

## Alternatives considered

- One mutable application store allows pending/UI writes to corrupt authority
  state.
- React component state for session truth makes lifecycle and reentrant updates
  authoritative.
- Full optimistic domain prediction duplicates the reducer and is unsafe for
  hidden or random outcomes.

## Evidence and consequences

`packages/client-session`, `packages/react-bindings`, and `apps/web/src/presentation`
implement immutable authority snapshots, serialized pending work, separate
presentation stores, replay isolation, and narrow subscriptions. Tests prove
atomic publication, result/publication reconciliation, queue and history bounds,
cancellation, reduced-motion switching, StrictMode lifecycle ownership, and
teardown.

Immediate pointer/selection feedback remains local while game outcomes wait for
authority. Store replacement is an internal refactor only if these channels,
ownership rules, and tests remain intact.

## Migration and rollback

Client store shapes are non-persisted implementation detail; admission always
installs a fresh protocol snapshot. A replacement store can roll back behind the
same session and React-binding contracts. It must atomically discard incompatible
pending/presentation state rather than migrate it into authority state.
