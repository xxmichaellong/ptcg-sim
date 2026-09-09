# @ptcgsim/protocol

Versioned, bounded runtime schemas for PTCG Sim v2 client/server messages. Wire
types contain recipient-safe view IDs only. Canonical card IDs and canonical
match state must never enter this package.

The package also owns strict request/response schemas for the same-origin HTTP
socket-ticket exchange. The long-lived capability is accepted only in the
bounded POST body; the response contains one short-lived admission ticket, a
distinct server-minted resume bearer bound to its durable digest, and the ticket
expiry. Initial `Hello` may carry that exact pair so a lost Welcome can recover
the already-committed session; later reconnects carry only the resume bearer.
Strict invitation-issue and cross-browser handoff schemas carry a
bounded expiring one-use claim and its requested role without exposing the
creator's long-lived seat or spectator credential.

`ProjectionRefresh` is a separate, closed server message for authoritative
metadata changes that do not execute a game command. Its only current cause is
`authority_reconciled`; clients verify that a refresh is either identical or
changes only player display names before replacing the recipient-safe view.

Visibility presentation events use bounded actor/owner IDs, card-versus-zone
scope, and a closed semantic-source enum. Only public single-card reveal facts
may contain a bounded card display name; hide and private-inspection facts have
no card-identity field.

`CloseInspection` carries the recipient-projected inspection work-area handle
instead of requiring a separate canonical inspection token. The room validates
that handle against the actor's current work area before constructing the
domain command.

The parameterless `DeclareMulligan` and `DeclareDeckView` messages are typed
non-command room intents. Their server deliveries carry only current-revision
`MulliganDeclared` or `DeckViewDeclared` events with server-derived player
attribution; they contain no free-form text, client-supplied player/zone
identity, or replay-history record. General `SendChat`/`ChatMessage` remains a
separate authenticated ephemeral surface: clients provide only bounded text;
the server delivery supplies the bound session's display identity, an opaque
message ID, and timestamp. Chat is absent from canonical state and replay.
