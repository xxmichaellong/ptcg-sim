# `@ptcgsim/renderer-pixi`

Raw PixiJS v8 implementation of the renderer-neutral board contract. React is
intentionally not part of this package: the web application owns the host and
DOM overlays, while this adapter owns only the play surface and WebGL lifecycle.

The current Phase 4 implementation provides stable card views, deduplicated and
stale-safe texture binding, immediate private-texture release, on-demand renders,
semantic input intents, bounded context-loss reconstruction, and idempotent deep
teardown. Renderer selection remains provisional until browser parity and
performance evidence is recorded.
