# ADR-003: use React for the application shell

- Status: **ACCEPTED**
- Decision date: 2026-09-14
- Last reviewed: 2026-09-14
- Scope: v2 application composition and lifecycle

## Context

PTCG Sim must preserve its visible controls and workflows while removing global
listeners, iframe ownership, and DOM-owned game state. Menus, forms, chat,
settings, deck tools, overlays, focus, and accessibility are naturally semantic
DOM UI. The board renderer must remain replaceable and must not become a second
state authority.

## Decision

React and TypeScript own the v2 application shell and unchanged DOM chrome.
React mounts one renderer-neutral board host and binds it through narrow
external-store subscriptions. It may hold component-local form drafts, but not
canonical match state, recipient authority state, credentials, or renderer
truth.

The selected first-release board remains normalized React DOM under ADR-004,
behind the same `BoardRenderer` and session contracts used by the retained Pixi
spike. Route owners explicitly create, replace, and dispose sessions, stores,
renderers, listeners, and asynchronous work.

## Alternatives considered

- Continuing imperative global DOM modules preserves the current lifecycle and
  circular-dependency failures.
- Making Pixi own the complete application sacrifices native controls and
  accessibility without solving state authority.
- A React-only unabstracted board would make renderer testing and replacement
  unnecessarily invasive.

## Evidence and consequences

`apps/web/src`, `packages/react-bindings`, `packages/renderer-contract`, and
`packages/client-session` implement the split. StrictMode lifecycle tests,
browser parity journeys, bundle provenance, and teardown/resource tests cover
ownership. The default route and v1 remain unchanged; the application shell is
isolated behind the v2 route gate.

React version changes cannot alter domain or wire behavior. If the shell is
rolled back, the core, authority, protocol, fixtures, and renderer contract
remain reusable.

## Migration and rollback

The shell replaces workflows vertically behind the isolated route while v1
remains the baseline. A failed shell slice can be removed from that route or new
sessions routed to v1 without changing an active room's canonical state. React
component state is never a migration source.
