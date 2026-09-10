# ADR-013: preserve direct player-selected image URLs

- Status: **ACCEPTED**
- Decision date: 2026-09-10
- Scope: player-selected room backgrounds, custom card faces, custom card
  backs, native DOM image loading, and renderer selection
- Production wiring: the page-background path, renderer failure containment,
  bounded card-back command/event/projection path, multiplayer/solo authority,
  ordered legacy card-back conversion, and source-shaped foreground card-back
  browser chooser are implemented; the v2 deck-builder and visible card-back
  entry controls remain behind their parity gates

## Context

V1 lets a player paste an image URL for the local room background, create a
custom card whose face is loaded from a pasted URL, and replace either local
table side's card back. Requiring an approved host, same-origin proxy, or CORS
response would make some previously valid images stop working. Pixi/WebGL also
cannot reliably upload arbitrary cross-origin images as textures, while a native
DOM `<img>` can display them without a CORS opt-in.

Direct loading has a real privacy tradeoff. For a local background, only the
selecting browser contacts the host. A custom-card URL is canonical card
metadata: it is persisted and sent only in a projection authorized to reveal
that card. A card-back URL is public player presentation metadata and can be
sent to every room participant for concealed cards. Each receiving browser then
contacts the selected host. That host can observe ordinary request metadata such
as an IP address, timing, and browser headers. The product owner explicitly
chose compatibility and accepted this risk.

## Decision

### Preserve the pasted-URL behavior

A player may provide any non-empty image URL within the existing 4,096-code-unit
wire and state bound. PTCG Sim does not require a hostname allowlist, a proxy, or
CORS approval. The browser receives the value as a native DOM image source and
decides whether it can decode and display it. The application does not execute,
server-fetch, inspect, rewrite, or certify the referenced resource.

The v2 deck builder must retain the existing foreground preview/load check
before accepting a custom card or card back. A successful custom-card URL is
stored exactly as bounded card-definition metadata, survives the authoritative
event and snapshot lifecycle, and is projected exactly when that definition is
visible to the recipient. A successful custom card back becomes bounded,
canonical player presentation metadata through an owner-authorized command and
resolved event; it persists, replays, and projects to room recipients. Legacy
conversion preserves the last valid saved card-back URL for each side instead
of normalizing it to the shipped asset.

If a face or back URL later fails, the renderer keeps a neutral card surface and
all card input available; a later successful URL recovers the same stable card
node. Image failure never changes game state.

The local Change background control remains narrower: it directly preloads and
paints the selected browser's page background, but never enters room state,
protocol traffic, peer projections, replay, storage, telemetry, renderer
preferences, or Pixi. It lasts only for the mounted page.

### Visibility remains a hard boundary

Arbitrary URLs do not weaken hidden-information rules. A concealed or face-down
card projection contains the appropriate card-back URL, not its face URL. Its
face definition and URL must be absent from serialized delivery, rendered DOM,
accessibility output, diagnostics, and network requests. Once a card becomes
publicly visible or is privately revealed to an authorized viewer, that viewer
may receive and directly request its custom face URL. Concealment rotates the
opaque card handle as already specified and removes the face definition from
the current projected state.

The shipped v2 card back remains the default, not a restriction. A player may
replace only their own back in multiplayer. Solo mode may retain the v1
main/alternate-side controls. A card-back command cannot alter definitions,
card identity, visibility, ownership, or another multiplayer seat's setting.

### React DOM remains the compatibility renderer

The selected React DOM renderer is the production path for arbitrary card
images. No proxy is introduced merely to make those resources WebGL-compatible.
The dormant Pixi candidate may render only controlled CORS-capable assets; it
cannot replace the DOM renderer unless it later demonstrates the same arbitrary
URL behavior without weakening the visibility boundary.

## Rejected alternatives

- **Hostname allowlist:** breaks custom images on unlisted hosts and transfers an
  open-ended compatibility policy to maintainers.
- **Mandatory image proxy/CDN:** adds SSRF, redirect, resource-amplification,
  abuse, cost, availability, and content-custody obligations while changing the
  direct browser behavior.
- **Require CORS headers:** rejects images that a native `<img>` can display and
  makes upstream configuration part of gameplay.
- **Fetch and convert images in the client:** still contacts the host, is limited
  by CORS, increases memory work, and does not preserve arbitrary display.
- **Send hidden face URLs early and defer loading:** leaks private deck identity
  even if no image request occurs.

## Consequences and residual risk

- A custom face or card-back host can learn request metadata for participants
  whose browsers display that image. A player controlling the host can use
  unique URLs as tracking pixels. The UI and release notes must not imply these
  images are private or proxied.
- A URL can stop working, redirect, return corrupt bytes, or serve different art
  later. Replays and saves preserve the URL, not the remote bytes.
- Browser decoding and cache behavior remain browser-owned. Oversized images can
  consume client bandwidth or decode memory; renderer failure containment does
  not make an arbitrary host trustworthy.
- The server never dereferences the URL, so this decision does not create
  server-side request forgery. Telemetry and logs continue to exclude URLs.
- Content moderation, copyright, and malicious-image browser vulnerabilities are
  operational risks of displaying user-selected third-party media. Current
  browser support and security updates remain part of the release gate.

## Verification and rollback

Tests must prove that bounded arbitrary custom face and back URLs cross command
parsing, canonical storage, authorized projection, replay, scene creation, and
native DOM image assignment without rewriting or CORS attributes. Multiplayer
ownership tests reject changing another seat's back. Legacy conversion fixtures
must preserve final saved back values deterministically. Separate privacy tests
must prove that hidden face names, identities, and URLs never cross the
projection or network boundary; card-back URLs are intentionally public.
Browser tests retain direct cross-origin success, redirect, missing/corrupt
containment, stable input, and recovery coverage. Background tests retain
local-only, latest-request, failure, CSS-escaping, and teardown coverage.

This policy can be rolled back only through a new product/privacy ADR because a
host restriction would deliberately break accepted parity. Operationally, an
incident may temporarily disable custom image entry or external image loading,
while preserving the game state and neutral card fallback, without enabling a
server proxy or exposing hidden URLs.
