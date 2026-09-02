# @ptcgsim/protocol

Versioned, bounded runtime schemas for PTCG Sim v2 client/server messages. Wire
types contain recipient-safe view IDs only. Canonical card IDs and canonical
match state must never enter this package.

Visibility presentation events use bounded actor/owner IDs, card-versus-zone
scope, and a closed semantic-source enum. Only public single-card reveal facts
may contain a bounded card display name; hide and private-inspection facts have
no card-identity field.
