# `@ptcgsim/renderer-dom`

The normalized, stable-keyed React DOM implementation of the renderer-neutral
board contract. It is a competitive Phase 4 spike and a safe fallback—not an
assumed temporary implementation.

React reconciliation only sees recipient-safe immutable board scenes. It does
not own game rules, canonical state, networking, or renderer-derived state.
