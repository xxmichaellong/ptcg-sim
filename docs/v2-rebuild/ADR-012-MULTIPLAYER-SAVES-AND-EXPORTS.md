# ADR-012: separate perspective replay exports from resumable multiplayer saves

- Status: **ACCEPTED**
- Decision date: 2026-09-10
- Scope: replay downloads, canonical multiplayer continuation, and full-state
  disclosure
- Production wiring: perspective replay export and inert replay-file import may
  ship on the isolated v2 route; canonical save/resume remains disabled until
  its capability, retention, recovery, and abuse gates pass

## Context

V1's downloadable game-state file is also a continuation mechanism. Repeating
that design in an authoritative multiplayer room would require sending one
browser the canonical match, including the other player's concealed deck
definitions, card identities, and order. Hiding those fields in the UI after
download would not protect them.

V2 already has two different representations with different trust properties:

- the room owns a canonical snapshot and resolved event history that can resume
  the match but contains both players' secrets; and
- each connected participant can receive a freshly generated, opaque-ID replay
  projected only for that participant's role.

One artifact cannot safely serve both purposes. The product owner approved
separating them while retaining the existing export control and replay UX.

## Decision

### Default download is a perspective replay

The normal **Export game state** action downloads a versioned replay from the
requester's effective perspective. A player receives only information that
player was authorized to see at each revision. A spectator receives only the
public spectator projection. A durably solo room may retain its already-defined
local replay disclosure because no second human can claim the other seat.

The file contains projected snapshots, projected presentation facts, opaque
artifact-local aliases, explicit format/protocol/privacy versions, and an
integrity digest. It contains no canonical snapshot, canonical event batch,
canonical card or definition identity, room admission authority, invitation,
socket ticket, resume credential, save capability, or chat. It is immutable,
view-only, and explicitly marked `resumable: false` and
`canonicalState: false`.

Export must use the authority-produced replay artifact; it must not infer a
larger view from rendered DOM, browser caches, prior private looks, or the live
client projection. Exporting while live requests a fresh artifact and does not
enter replay mode. Exporting while replaying writes the installed artifact.
Malformed, oversized, integrity-failing, wrong-version, or semantically
inconsistent files fail before playback and can never submit commands.

The package import transaction owns caller bytes before asynchronous work,
enforces an encoded-byte bound before decode or hashing, requires fatal UTF-8,
and installs a completely validated artifact atomically. A concurrent authority
replay request/import, route disposal, cancellation, non-ready session, or live
identity change prevents late installation. An imported perspective may belong
to another match or viewer because it is inert shared viewing data; exiting
always returns to the latest live projection. The isolated live Solo route wires
this transaction to the source-shaped `Enter replay mode` control and a hidden
`.json` picker. Browser admission rejects invalid declared sizes before reading,
checks the returned byte length independently, resets the input for same-file
retries, and aborts stale reads on teardown. This does not enable canonical
state import or continuation.

The initial format uses SHA-256 to detect corruption. The digest does not
authenticate an author and does not make an imported file trusted; imported
replays remain inert untrusted input. Serialization is deterministic for the
same artifact so audits and migration fixtures can compare exact bytes.

### Multiplayer continuation remains server-held

A resumable multiplayer save is a canonical server-side checkpoint plus its
required versioned journal tail. No browser downloads or receives that state.
It is addressed by a distinct, high-entropy save capability, stored as a digest
and never derived from or interchangeable with the visible room code,
invitation, socket ticket, or live resume credential. The stored payload must be
encrypted at rest, integrity checked, bounded, versioned, expiring, revocable,
and covered by rate/count/cleanup limits.

Only an authenticated player may create a continuation. A spectator cannot.
Restoring transactionally forks the immutable checkpoint into a new room; it
does not revive or overwrite the original room. The capability is role-bound to
the requesting player's original seat. The other seat is unclaimed in the
forked room and joins through a newly issued ordinary invitation, so a save
bearer never grants both players' authority. Restore rotates all room, session,
invitation, ticket, resume, projection, and command-idempotency identities.
Neither the old room nor a second restore can mutate the new room.

The operational defaults are a 30-day TTL and explicit delete/revoke support.
They remain configuration values that may be shortened by the operator after
measured storage and abuse testing; extending retention is a separately
reviewed privacy change. Creation, restore, expiry, revocation, collision, and
ambiguous-response behavior must be transactional and fail closed.

### Full hidden-state export requires both players' consent

No ordinary download contains both hidden decks. A future full canonical export
may be added only after both currently authenticated player seats independently
and explicitly consent to that exact export request. Consent is server-owned,
short-lived, request-bound, and withdrawable until issuance; reconnect status,
coaching consent, room creation, a save request, or one player's confirmation
cannot imply the other player's consent. Spectators cannot consent.

The initial v2 release may omit full canonical export entirely. If implemented,
the UI must warn that a completed download cannot be revoked and the audit must
prove that declining, disconnecting, expiring, or withdrawing either consent
prevents issuance.

## Rejected alternatives

- **Download canonical multiplayer state by default:** discloses the opponent's
  concealed deck and order to preserve an implementation detail of V1.
- **Redact a canonical file and later resume it:** redaction destroys the secret
  state required for an exact continuation and invites client/server divergence.
- **Put both seat credentials in one save link/file:** lets one bearer impersonate
  both participants and silently grants access to both perspectives.
- **Use a live room resume token as a long-lived save:** couples short transport
  recovery to archival retention and bypasses save-specific revocation, quotas,
  and migration.
- **Infer consent from coaching/private-look consent:** those permissions have a
  different scope and lifetime and do not authorize permanent disclosure.

## Consequences and residual risk

- The existing label remains, but its safe v2 meaning is a view-only replay, not
  an offline resumable multiplayer state file.
- A player can intentionally share everything that was visible from that
  player's perspective. The product cannot retract a downloaded file.
- Opaque aliases prevent canonical correlation but are not anonymity guarantees;
  display names and public game actions remain part of the replay.
- A bearer continuation model means anyone holding an unexpired save capability
  can exercise its role. Clipboard managers, extensions, devices, and external
  sharing channels remain outside the application trust boundary.
- Server-held continuation adds storage, encryption-key custody, deletion,
  migration, quota, recovery, and incident-response obligations. It stays off
  until those gates are implemented and reviewed.

## Verification and rollout

Perspective export and the wired inert replay-import transaction prove
deterministic serialization, strict format/code-unit/encoded-byte bounds, fatal UTF-8,
SHA-256 mismatch rejection, artifact semantic validation, checked-in file-v1
compatibility, exact round-trip playback, player/spectator privacy, absence of
credentials and canonical sentinels, no replay-mode transition for a live
export, and inert failure after route teardown or identity change. A real
Worker/Chromium Solo journey exports the live artifact, imports its downloaded
bytes through the native input, enters and exits replay, restores the exact live
revision, and rejects malformed JSON without losing the room. Compressed and
unknown-version inputs are not accepted or guessed.

Continuation must prove encrypted and digest-only durable custody, independent
role-bound capabilities, exact canonical hash/projections after restore,
transactional one-time fork behavior, credential rotation, expiry/revocation,
quota/rate enforcement, corrupt/truncated recovery, and rollback compatibility.

The v1 app and default route remain unchanged. Perspective export can be rolled
back by hiding its isolated-route action without invalidating files already
downloaded. Canonical continuation has its own feature gate and storage version
and can be disabled independently while previously created saves remain
readable by the last compatible deployment until expiry.
