# @ptcgsim/protocol

Versioned, bounded runtime schemas for PTCG Sim v2 client/server messages. Wire
types contain recipient-safe view IDs only. Canonical card IDs and canonical
match state must never enter this package.

The package also owns strict request/response schemas for the same-origin HTTP
socket-ticket exchange. The long-lived capability is accepted only in the
bounded POST body; the response contains one short-lived admission ticket and
its expiry.

Visibility presentation events use bounded actor/owner IDs, card-versus-zone
scope, and a closed semantic-source enum. Only public single-card reveal facts
may contain a bounded card display name; hide and private-inspection facts have
no card-identity field.
