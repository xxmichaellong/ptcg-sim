# `@ptcgsim/renderer-dom`

The normalized, stable-keyed React DOM implementation of the renderer-neutral
board contract. It is a competitive Phase 4 spike and a safe fallback—not an
assumed temporary implementation.

React reconciliation only sees recipient-safe immutable board scenes. It does
not own game rules, canonical state, networking, or renderer-derived state.
Renderer preferences update the mounted tree in place, including removal of
zone/stadium paint while retaining the same accessible DOM hit regions.
Card nodes retain the legacy side-specific border radii and shadow opacity. The
contained pile/stadium, ordinary-evolution, stable one- and two-Energy,
rotated Trainer-as-Tool, and settled mixed-stack browser gates compare
isolated source/candidate card paint in addition to exact structured
geometry and hit order.
