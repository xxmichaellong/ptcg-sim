# v2 room runtime

Cloudflare Worker/Durable Object adapter for the platform-neutral room
authority. The first slice provides the transactionally tested storage boundary;
WebSocket admission is added after the session-capability contract is executable.

Operational patterns are adapted from MagicCircle commit
`39f871cd63800e2317326425345a26e4d61846de`: bounded ingress, server-derived
identity, explicit message tracking, admission freeze, and lifecycle race tests.
PTCG Sim does not reuse MagicCircle's debounced per-user persistence because an
accepted game command requires an atomic per-room journal commit.

`pnpm run test:runtime` executes the isolated Cloudflare runtime suite through
`@cloudflare/vitest-plugin`. It covers the deployed Worker boundary, SQLite
Durable Object storage and alarms, WebSocket admission, real eviction with a
hibernated socket, attachment reconstruction, concurrent admission/command
traffic, pre-commit and ambiguous post-commit persistence failures, exact
retries, and post-wake idempotency. The repository-level `check:v2` gate runs
this suite after the fast unit tests.
