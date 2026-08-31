# v2 room runtime

Cloudflare Worker/Durable Object adapter for the platform-neutral room
authority. The first slice provides the transactionally tested storage boundary;
WebSocket admission is added after the session-capability contract is executable.

Operational patterns are adapted from MagicCircle commit
`39f871cd63800e2317326425345a26e4d61846de`: bounded ingress, server-derived
identity, explicit message tracking, admission freeze, and lifecycle race tests.
PTCG Sim does not reuse MagicCircle's debounced per-user persistence because an
accepted game command requires an atomic per-room journal commit.
