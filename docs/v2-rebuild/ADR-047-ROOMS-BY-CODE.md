# ADR-047: rooms are joined by a short code

- Status: **ACCEPTED**
- Decision date: 2026-11-06
- Supersedes: the invitation transfer of ADR-020 (one-use links as the only
  way in); ADR-020's credentials (seat claims, socket tickets, resume
  bearers) stay as they are.

## Context

The owner, looking at Play online's "1 Host a room / 2 Join a room — paste
the link" and at the bar's "Online" while in a room: "you should be able to
join a room via room code? not link? please investigate why we chose to do
it this way … i think 4 letters is enough for room codes … i don't think we
separately need buttons for inviting player vs spectator, that's just up to
the player when they join." The bar should show the room's code; pressing it
should open the room, where its code can be copied or changed, and a host
should be able to choose a code when creating a room.

Why v2 used links (ADR-020): v1's room ID was both the address and the key —
anyone who learned it could take a seat or watch. v2 split them: a room's
12-character code only locates it, and getting in takes a credential — a
one-use, role-bound invitation (256 bits, 15 minutes) that the creator's
browser minted and handed over by the clipboard, never in a URL. That made
a leaked code harmless, but it made the everyday case heavy: a link that
works once, one kind per role, and nothing to read out loud.

## Decision

1. **A room opened to others has a short public code** — four characters
   from the room-code alphabet (no I, O, 0 or 1: about a million codes), or
   one its host types, four to twelve characters (`ROOM_ALIAS_PATTERN`).
   Codes are aliases: each is its own small Durable Object
   (`PtcgRoomCode`, named by the code) pointing at the room's 12-character
   code on a **12-hour lease**. The room keeps its code beside its snapshot
   (`room-alias:v1`, not in the authority snapshot, so no schema change).
   Codes are made only for multiplayer rooms — Create room, or a Solo table
   opened in place (ADR-044) — so per-visit Solo rooms never use the space.
2. **Reading and renewing** (`POST /v2/rooms/:room/code`, the session's own
   resume bearer): any session in the room reads the code; a player's ask
   makes one when the room has none (or its lease lapsed and another room
   took it). The client asks on every connection, every 30 minutes
   while the room is up and whenever Room opens (a guest learns a changed
   code there), which renews the lease, so a room in use keeps its
   code and a room left alone gives it back. Only the **host** (the first
   seat's session) may choose another; the old code is released at once.
3. **Joining by code** (`POST /v2/join`, `{code, requestedRole,
displayName}`): the Worker resolves the code, and the room mints an
   invitation for the free guest seat (never the host's) or to watch, and
   exchanges it for a socket ticket **in one turn of the room**
   (`admitByCode`), so two people joining at once never retire each other's
   invitation in between. From the ticket on, everything is as before: the
   seat claim, the resume bearer, reconnects. A seat someone holds stays
   theirs; with both taken, a code only lets someone watch. The joiner
   chooses Play or Watch.
4. **Abuse**: lookups and joins by code are rate-limited per address at the
   edge (`ROOM_CODE_RATE_LIMITER`, 20 a minute) before the code is looked
   up, on top of each room's own invitation budget. Nothing secret is
   logged; a wrong code answers `room_not_found` like an expired one.
5. **Old invitation links** (`#invite=…`, pasted `PTCGSIM2-INVITE:`
   envelopes) are still accepted when pasted or opened, for links already
   sent; nothing mints them any more. They can be removed later.
6. **Invite links** are `https://…/?room=CODE`: no secret, the code
   prefilled. The page takes `room` off its address on load
   (`invitation-link-capture.ts`) and opens Play online with the code in.
   Pasting such a link (or a bare code) into Play online fills the code.
7. **UI** (terse copy):
   - Play online: your name; **Host a room** (an optional custom code and
     Create) — a small round **or** — **Join a room** (the code with Paste;
     Play | Watch; Join). No numbered steps, no full-width buttons, and no
     Deck button in the sheet (the bar has it).
   - In a room the bar's Online side says the room's code (an eye beside it
     while watching); pressing it opens **Room**: the code large with Copy,
     Copy invite link, Change code (host only), who is here, Leave room.
     On a phone held upright Settings' room rows lead there.
   - The room-ready card on the table shows the code, Copy invite link and
     Copy code; the log's header and Settings have Copy invite link. There
     are no separate player and spectator invites.
   - Under a finger, Play online's, the room-ready card's and Room's
     controls are 44px tall (Play and Watch take presses across their
     control's padding).
8. **Restored games and who is here** (2026-11-06, from review):
   - The host is whoever restored a saved game (`room-restored-by:v1`), not
     always the first seat: a game the second player restores offers its
     first seat by code, and the restorer changes the code.
   - A join renews a code only while the room still holds it; one the host
     has just changed is never brought back by a join under way.
   - Watching by code works in every multiplayer room, a restored one
     included (it has no spectators' master credential to check).
   - Two joining by the code at once race for the free seat: the first to
     connect takes it, the other is told both seats are taken and offered
     Watch. A code join's invitation lasts 30 s, so one that never connects
     holds nothing for long.
   - The room's Welcome lists who is already here, so a guest sees the host
     at once (the invite card, the open-seat check and Room's "here" read
     it, kept current by Presence).
   - A room admits only by its code as it is now: a join by a code it
     changed from answers `room_not_found`, even where that code's record
     outlived the change (its release failed), and the record is given
     back then (`RoomAliasCustody.holds`, after any change under way).

## Consequences

- Anyone who learns a room's code can join it: to play while the guest seat
  is free, else to watch. This is v1's and Magic Circle's model. A seated
  player can't be displaced (their seat is held by their own claim), so the
  worst a stranger can do is take an empty guest seat or watch. Hosts who
  want privacy can choose a long custom code. Four-character codes can be
  guessed; the per-address budget makes guessing through them slow (20
  tries a minute), and a lapsed code points nowhere.
- A room that sits unused for more than the lease loses its code; on its
  players' return it is given a new one (or its old one if still free).
- The 12-character room code stays the room's identity for sockets, saves
  and replays; it is no longer shown to players.
- PARITY: v1 rooms were joined by an ID too (PX-096); v2 differs in that a
  code never takes an occupied seat.
