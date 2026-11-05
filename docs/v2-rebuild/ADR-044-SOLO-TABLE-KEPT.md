# ADR-044: the Solo table is a room: kept across reloads, opened in place

- Status: **ACCEPTED** (2026-11-05, the owner's request: "can we remember
  the state when you reload the game?", and "aren't solo rooms technically
  still a room? … that allows us to persist state across reloads. that also
  means that solo rooms could just be turned into multiplayer rooms without
  the player actually needing to leave and join a new room").
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

1. **The page remembers its Solo room.** When a Solo room's table is shown
   and its room has admitted the player (a table that never got going never
   replaces one that did), its room code and seat claim are written to
   session storage (this tab's room) and local storage (the browser's
   latest), as `ptcgsim.solo-room.v1` (`solo-room-memory.ts`), and its log
   beside them as it changes (`ptcgsim.solo-log.v1`): the room sends a table
   on rejoining, not the lines that told it. A log read back is checked line
   by line and dropped whole if any is damaged. The deck screen's seats are
   kept with it too (`ptcgsim.solo-decks.v2`, `seat-deck-memory.ts`): each
   seat's deck and label once the room takes it (the deck as it was sent,
   though the seat was edited since; a save or rename of that deck follows),
   put back on a seat not being edited when the page sits down at the same
   room (2026-11-05: a reload had left both seats "No deck yet" over a game
   in play). Each storage keeps the last four rooms' seats by room code, so
   a tab still at an older room never writes over the latest room's. A
   tutorial's practice room is never remembered.
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
4. **Rejoining needs no new protocol.** The rejoin is an ordinary exchange
   and Hello.
5. **A Solo room opens to an opponent in place.** Play online's Create room,
   with a Solo table at hand (open or parked behind the sheet), opens that
   table instead of making a room: `POST /v2/rooms/:code/open` with the Solo
   player's own seat claim and the name they now play under
   (`RoomOpenRequest`). Asked again once opened (its answer lost on the way:
   a gateway's error), it renews the second seat's and spectators' claims
   and answers again, sending each session the room's view once more,
   nothing else changed (`room_reopened`), while the second seat is free;
   once someone has taken it, it refuses. The Welcome says the kind of
   room (`roomMode`), so a page sitting back down at a remembered Solo
   table whose room was opened meanwhile comes back as that room, its
   invitations renewed, and stops remembering it as Solo. Opening waits
   until every move sent has been answered (the room's rules change as it
   opens). An opening whose answer is lost but whose room says it opened
   (the session's `roomMode`) still makes the table the room's, here and in
   the lobby whenever the room says so; its invitation custody then fetches
   the claims with the first invitation (`renew`), and the claim stays
   remembered until they come, so neither a gateway's error nor a reload
   strands the room without invitations. The authority (`openSoloRoom`, admission kind
   `room_opened`) turns the room multiplayer with two seats, gives the second
   seat and the spectators new claims (the second seat's claim made with the
   room was never handed out) and answers with them (`RoomOpenResponse`),
   for the page's invitation custody alone. The host plays under their name;
   the second seat waits as "Player 2" until someone takes it. Solo's
   board-flip consent, given for both seats, is withdrawn from both as each
   player's own withdrawal would (`CoachingConsentSet`), with the looks
   across seats it allowed: in a room each player gives their own, and a
   consent left on the new player's seat would let the host act for it. The replay history, and with it undo,
   starts again from that state. Each session is sent its view under the
   room's rules (`ProjectionRefresh` with cause `room_opened`, which the
   client takes at the same revision). Only the first seat's claim asks;
   it is checked before the mode, and a room opens once. The transition's
   invariant (`roomOpeningProblems`) allows exactly these changes. The page
   forgets the room as its Solo table (a reload makes a new one) and starts
   announcing arrivals.

## Consequences

- A reload, a crash, or the next visit returns to the same Solo game with
  its log, prizes, deck order and undo.
- The seat claim now lives in this browser's storage. It admits only to
  that Solo room, whose only other seat no human can claim, so the exposure
  is the player's own practice game. Script that could read it could already
  act in the room through the live page.
- Clearing site data, or a private window closing, starts a new table.
- Nobody leaves or joins another room to play a friend: the table, its
  decks and its game become the room's. The board stays as it stood, so
  the new player takes over a side whose hidden cards the host has seen
  (they played both); a fair game starts with Reset or Set up again.
- Joining another room by its link still parks the Solo table, as before.

## Verification

Opening in place: `room-opening.test.ts` (the transition, the new claim
taken and the old refused, the claims and modes that may not open it, and
the invariant refusing a kept consent, a renewed host claim or a changed
match), `room-open-http.test.ts`, `worker-runtime.test.ts` (opened once
through the Worker, the seated player refreshed, the second seat claimed),
`session.test.ts` (the `room_opened` refresh), `RemoteSoloRoom.test.ts`,
`RemoteRoomLobby.test.tsx` and `solo-room-opens.spec.ts` (a Solo game opened,
invited into and joined by a second browser, the same game on both).

Reloading:

`RemoteSoloRoom.test.ts` (recall order, damaged storage, the page-wide
hold, rejoin, fallback on refusal or silence, another tab's room, cancel),
`RemoteRoomCreation.test.ts` (only a taken Solo seat is handed over),
`RemoteRoomLobby.test.tsx` (only the shown room is kept, under
StrictMode), and `solo-room-reload.spec.ts` (a reload returns to the same
game; a second tab makes its own).
