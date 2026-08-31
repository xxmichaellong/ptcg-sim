# PTCG Sim v2 web application

The current route is an isolated renderer decision harness. It does not replace
or alter the v1 production client. Use `?renderer=pixi` or `?renderer=dom` to
mount the same deterministic 61-card scene behind either adapter.

This shell intentionally preserves the v1 75.5% board / 24% side-panel split so
geometry evidence can be gathered before broader UI migration.
