# ADR-044: the Solo table is kept across reloads

- Status: **ACCEPTED** (2026-11-05, the owner's request: "can we remember
  the state when you reload the game?", and "aren't solo rooms technically
  still a room? … that allows us to persist state across reloads").
- Decision date: 2026-11-05
- Number: 044; its parity exception is PX-085.
- Amends: ADR-018 (a seat capability may now outlive the page that was
  given it), ADR-020 (the creator's custody keeps one claim beyond memory).

## Context

The page lands on a Solo table (ADR-030), and since the room rebuild that
table is a Durable Object room like any other: `POST /v2/rooms` with
`mode: "solo"`, the creator's `playerOneSeatCapability` exchanged for an
admission ticket, one session acting for both seats. A claimed room is
never deleted; its snapshot, history and undo stay with it.

The page kept the seat capability in memory only. A reload therefore made
a new room, and the game -- deck, board, log, undo -- was left behind in
a room nobody could reach again.

The authority already allows a return: the seat's claim stays valid after
its first use. While the old session's reconnect lease (30 s) runs, a
ticket redeemed for the seat resumes that session; after it, the seat is
free again and the claim takes it with a new session.

## Decision

1. **The page remembers its Solo room.** When a Solo room's table is shown,
   its room code and seat claim are written to session storage (this tab's
   room) and local storage (the browser's latest), as
   `ptcgsim.solo-room.v1` (`solo-room-memory.ts`). A tutorial's practice
   room is never remembered.
2. **Landing on Solo sits back down first.** `openRemoteSoloRoom` tries this
   tab's room, then the browser's latest: it exchanges the claim, connects,
   and waits for admission (12 s at most). A room that refuses, has gone, or
   never admits is passed over, and a new room is made; the new room then
   replaces what was remembered. If the new room can't be made either (the
   network is down), nothing is forgotten, and the next load tries again.
3. **One tab per room.** A Web Lock named by the room is held by the page
   that sits at it, for as long as the page lives or until it sits at
   another. A tab that finds a room taken makes its own. This tab's own room
   is waited for up to 2 s, for the page a reload replaces to let go; another
   tab's is not waited for. The hold is page-wide, so StrictMode's replayed
   lobby shares it rather than racing itself. Without Web Locks (an insecure
   origin), tabs are trusted not to share.
4. **Nothing else changes.** The room, its admission rules and its protocol
   are untouched; the rejoin is an ordinary exchange and Hello.

## Consequences

- A reload, a crash, or the next visit returns to the same Solo game with
  its log, prizes, deck order and undo.
- The seat claim now lives in this browser's storage. It admits only to
  that Solo room, whose only other seat no human can claim, so the exposure
  is the player's own practice game. Script that could read it could already
  act in the room through the live page.
- Clearing site data, or a private window closing, starts a new table.
- Going online from Solo (the switch) still parks the Solo table and makes
  a multiplayer room; turning the Solo room itself into a multiplayer room
  needs an authority transition of its own (mode, seat limit, disclosure)
  and is not part of this decision.

## Verification

`RemoteSoloRoom.test.ts` (recall order, damaged storage, the page-wide
hold, rejoin, fallback on refusal or silence, another tab's room, cancel),
`RemoteRoomCreation.test.ts` (only a taken Solo seat is handed over),
`RemoteRoomLobby.test.tsx` (only the shown room is kept, under
StrictMode), and `solo-room-reload.spec.ts` (a reload returns to the same
game; a second tab makes its own).
