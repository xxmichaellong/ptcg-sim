# `@ptcgsim/renderer-contract`

Renderer-neutral board scene, parity geometry, interaction intents, lifecycle,
hit testing, and stable-ID scene diffing for the v2 client.

The package consumes only recipient-safe `MatchViewState` projections. It does
not import canonical match state, networking, React, PixiJS, or legacy DOM code.
Both competitive renderer spikes must consume this exact scene and emit the same
semantic intents.
