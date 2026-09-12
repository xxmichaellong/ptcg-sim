# ADR-021: defer v1 saved-game and share-link import

- Status: **ACCEPTED**
- Decision date: 2026-09-12
- Scope: the first v2 release and its production compatibility promises

## Context

PTCG Sim v1 saved games are executable action histories rather than canonical
state snapshots. Historical files can vary by displayed version, action shape,
positional board state, and browser-era presentation metadata. Old
`/import?key=` links add a separate dependency on weak four-character server
records and an undefined retention window.

The repository contains a bounded, allowlisted, transactional converter and
source-shaped fixtures for the known `1.5` and `1.5.1` exporters. That work is
valuable characterization and proves that conversion can fail without partial
state. It is not evidence that real historical exports, every action-parameter
shape, or old hosted links are compatible. No representative real-user corpus
is available to make that promise honestly.

V2 deck-list/CSV import and v2 perspective-replay files are different formats
with different trust boundaries. This decision does not defer either of them.

## Decision

The first v2 release will not expose or promise import of v1 saved-game/action
history files or old `/import?key=` share links.

`@ptcgsim/legacy-import` remains a quarantined development and test package. It
must not be a production dependency, appear in the web or Worker bundles, own a
route, or accept user uploads. Its fixtures, conversion reports, action mapping,
and private-corpus runner remain available for characterization and a possible
future compatibility project.

The v1 application remains available according to the separately approved
rollout and retirement window. Existing v1 rooms are never live-converted into
v2 rooms. The first-release v2 compatibility surface consists of supported deck
inputs and v2-native perspective replay files only.

Future v1 saved-game support requires a new accepted ADR. That review must name
the exact source versions and input paths, include representative privacy-
reviewed real-user corpus evidence, define any old-link retention deadline, and
repeat transactional, privacy, resource, migration, browser, and rollback
gates before production wiring is permitted.

## Consequences

- The first release makes no unverifiable promise about historical v1 files or
  expired/unknown share records.
- Users who need an old saved match must continue opening it in the supported v1
  application during the rollout window; v2 cannot resume it.
- The isolated converter continues preventing knowledge loss and supports
  future investigation without increasing the production attack surface or
  bundle size.
- Retiring v1 is a separate product decision. This ADR does not authorize
  deletion of the v1 application, its data, or its fixtures.

## Verification and rollout

- Workspace dependency checks reject the legacy converter from every production
  package.
- Web and Worker bundle provenance checks reject converter modules and v1
  runtime code.
- The v2 route exposes no v1 saved-game file picker and does not consume
  `/import?key=` records.
- Converter fixtures and tooling continue to run only as isolated tests or
  explicit operator commands.
- Deck import and v2 perspective-replay import retain their independent tests
  and product behavior.

Rollback is unnecessary because this decision enables no production path. A
future compatibility implementation is additive and remains feature-gated
until its replacement ADR and evidence are accepted.
