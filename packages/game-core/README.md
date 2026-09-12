# @ptcgsim/game-core

Framework-independent PTCG Sim v2 domain state, commands, resolved events,
invariants, projection, and deterministic replay helpers.

This package must not import browser UI, React, a renderer, WebSockets, Worker
APIs, storage drivers, clocks, or implicit randomness. Authorities provide IDs,
time, and resolved random choices through explicit command context.
