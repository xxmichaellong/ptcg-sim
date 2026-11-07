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
geometry and hit order. The pristine active-marker gate applies the same
comparison to card/marker compositing and typography, with an independent
smaller-card bench-marker companion.

Card image loading stays native so arbitrary external URLs retain v1-compatible
DOM behavior without a CORS opt-in. Each stable keyed image is hidden behind the
neutral card surface while a URL is pending or failed and becomes visible only
after browser decode succeeds. Missing and corrupt responses cannot remove card
input, and a later successful direct or redirected URL recovers the same button
and image nodes. The browser gate also follows a two-hop cross-origin redirect
to a no-CORS image with 32,768-square intrinsic dimensions while preserving the
assigned URL, exact card bounds, native input, and both node identities.
