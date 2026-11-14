# ADR-055: Friends

- Status: **ACCEPTED** (design; built in three steps, below)
- Decision date: 2026-11-12
- Request (the owner, 2026-11-12): "a full friend system which allows you to invite friends, etc." Their choices:
  - **Adding:** by sharing a User ID, an invite link, or from recent players. No public search by name.
  - **Presence:** live status (Online, In a game, Watching, Offline) with an Appear offline switch.
  - **Playing together:** invite a friend to my room, ask to join a friend, watch a friend's game.
  - **Placement:** a Friends button in the app bar, with a count of friends online.
- Builds on: ADR-052 (accounts: each account is a `PtcgAccount` Durable Object with its own SQLite), ADR-053 (rooms know which account holds each seat), ADR-051 (the beta runs on Workers Free, so writes and requests are budgeted), ADR-047 (rooms by short code), ADR-036 (the app bar).
- Modeled on: Magic Circle's friends PR (magiccircle.gg #4669, `xxl/friends-list-mvp`), where its Postgres model maps onto per-account objects. Magic Circle has no ask-to-join and no watching state; both are added here.
- Parity: PX-106.

## Who can be added

- **By User ID.** The `a_…` id already shown on the Account page, with Copy, is the friend handle; no second code. On Add a friend, a pasted id (or any text containing one, or an invite link) is looked up before anything is sent and shows who it is (name and avatar). Lookup answers: "That isn't a User ID.", "That's your own User ID.", "No player has that ID.", "Couldn't look that up. Try again."
- **By invite link.** `/#friend=<User ID>` opens the Friends sheet on that player with Add friend. The link is the id, not a secret: it adds a request, never a friendship.
- **From recent players.** Online games filed to the account (ADR-053) now carry each seat's account id beside its name. Friends lists the other seats of the last 20 such games, newest first, each with Add friend (or its state). Solo games and seats nobody signed in to don't count.
- **No search by name.** Names are not unique and are not a directory.

## The friendship

- **Rows.** Each account object keeps a `friend` table of the accounts it relates to: `other`, `state` (`friend`, `outgoing`, `incoming`), `since`, `requested_at`, and the other's `name` and `avatar` as last heard. A `blocked` table keeps the accounts it has blocked. Tables are made on first use, as ADR-052's are, so an account that never adds anyone writes nothing.
- **A change is two writes, the sender's object first asking the other's.** Every change is idempotent, so a retry after a failure in between converges:
  - **Request.** If the other already asked, it is accepted on both sides (crossing requests become a friendship). Otherwise the other records `incoming` and the sender `outgoing`.
  - **Accept, decline, cancel, remove.** Accept makes both rows `friend`. Decline is silent: the decliner's row goes, the sender's stays `outgoing` and still reads "Request sent". Cancel removes both rows and keeps a 24-hour cooldown on asking that player again (in the sender's row, as `cancelled_at`). Remove deletes both rows.
  - **Block.** It ends any friendship, request and invite either way and is never revealed: a request to someone who blocked you is answered as if it were pending. Unblock removes the block row only.
  - **Refusals** never say why the other side refused: the other being full reads as "{name} can't take friend requests right now".
- **Limits.** 200 friends; 50 sent requests waiting; 100 received waiting (more are refused as "can't take"); one request a second per account (the client spaces taps), and the `ACCOUNT_RATE_LIMITER` per address as today.
- **Names and avatars.** Each row keeps the other's name and avatar as last heard. A rename or avatar change is sent to every friend's object (at most 200 writes, and renames are rare), and every request or accept carries them.
- **Every write answers with the whole list**, so the client swaps it in, as Magic Circle's does.
- **Deleting an account** removes it from every friend's and requester's list (the same fan-out), then erases as ADR-052 does.

## Presence

- **States:** Online, In a game (holding a seat in an online room), Watching (a spectator in an online room), Offline (with last seen, to the minute). Solo play reads Online: there is nothing to join or watch.
- **Appear offline** (a switch at the top of Friends, kept on the account): friends see Offline. Invites and ask-to-join still work toward friends the player has invited or asked.
- **How it travels.** Each signed-in tab opens one hibernatable WebSocket to its own account object (`/v2/account/live`, the session cookie checked at the upgrade). The tab says where it is (no room, a room as player, a room as spectator, and the room's code). The socket's attachment holds that, so a hibernated object still knows. The account's state is the most present of its tabs.
- **One presence hub.** A single `PtcgPresence` object keeps each online account's state in one row (`account`, `state`, `room`, `updated`). An account that changes state tells the hub once, with its friend ids. The hub writes the row and pushes the change to those friends that it knows are online (their account objects pass it to their tabs). Coming online, the hub answers with the states of the account's online friends. So a change costs one row and one request plus one per online friend, never one per friend. The hub's state survives eviction in its rows (`account`, `state`, `room`, `hidden`, `updated`). A row is written only when what it says changes, so it can look old while its account is still online: one older than 20 minutes is checked with its account's object (are tabs still open?) before it is shown, at most once in 5 minutes, and set offline if none are (a deploy can drop sockets without a goodbye). (Built so, 2026-11-12: the design first had each account refresh its row every 2 minutes through an alarm, which would cost a request every 2 minutes per online player for nothing.)
- **A tab counts once it says hello** (its socket's attachment, `greeted`): its first message says where it is, and only then can the account come online, so the hub hears it once with the right state.
- **Rooms.** A friend's room code reaches the client only to join or watch through it, never as text, as Magic Circle never prints a private room's id.

## Playing together

- **Invite to my room.** From a friend who is online (not one already in that room), Invite. Their tabs show a toast, "{name} invited you to play" with Join and Not now, for 30 minutes or until the inviter leaves that room, whichever is first. Join takes them into the room (as Play online's join does). The room is the inviter's current one, as the server knows it, not one the client names. Invites are not stored: they go to the friend's open tabs, and a friend with none can't be invited (offline friends aren't listed under Invite).
- **Ask to join.** On a friend In a game, Ask to join. The friend's tabs show "{name} wants to join you" with Let in and Not now. Let in sends the asker an invite as above, and they join at once.
- **Watch.** On a friend In a game or Watching, unless they appear offline, Watch opens their room as a spectator.
- **Spacing.** Invites and asks once a second per account, at most one waiting per pair and direction (a newer one replaces it).

## Where it lives

- **The app bar** gains Friends (a people glyph) just before Settings, for a signed-in player only: a guest's bar and table keep their room (Settings' Sign in row says "Decks, replays, friends & more"). It shows a cream count of friends online (ADR-036's badge), and a dot while requests wait. The table's corner keeps a slot more for it. On a phone, whose bar has no room, Friends is a row under the account at the top of Settings, its value the requests waiting or friends online. Opened signed out (an invite link), the sheet shows Sign in first.
- **The Friends sheet** has its own pages, in Settings' style (ADR-045):
  - **Friends**, from the top: the Appear offline switch, Add a friend, Friend requests (Accept and Decline), Friends (In a game, then Watching, then Online, then Offline by last seen; each with its action, Invite, Ask to join or Watch, and a chevron to the friend's page), Recent players, Sent requests (Cancel).
  - **A friend's page:** avatar, name, status, Friends since, the actions, then Remove friend and Block apart in a danger group, each confirmed ("Remove {name} as a friend?" "You can send them a new friend request any time." Remove / Keep).
  - **Add a friend:** the field ("Paste a User ID or invite link"), the lookup, and Your User ID with Copy and Copy invite link.
  - **Empty states:** "No friends yet. Share your User ID or invite link to add one." and "No friends online to invite".
- **Toasts:** "{name} wants to be friends" (Answer); "You and {name} are now friends!"; the invites above. A per-device "read up to" time (`ptcgsim.friends.v1`) keeps a request from being announced twice, and a device's first look announces nothing old.
- **Built (step 1):** server `accounts/account-friends.ts` (the rows and the state machine, `FriendGraph`), `friends-http.ts` (`GET /v2/friends`, `POST /v2/friends/<id>` `{ action }`, `GET /v2/players/<id>`); client `apps/web/src/friends/` (the store, the sheet, the bar button, `#friend=` link capture). A request writes its sender's row before asking the other's object, so two that cross both find a friendship.
- **Commands** (ADR-035): Friends, Add a friend, Copy invite link.

## Budget (Workers Free, ADR-051)

- **Friendship changes** write two to four rows each, and a rename one per friend.
- **Presence** writes one hub row per change of state. A session that comes online, plays a game and leaves changes state about four times. At 1,000 sessions a day that is about 4,000 rows, and a few thousand requests for the pushes to online friends. Nothing is written per move or per heartbeat, and nothing is asked on a timer: a tab's ping is answered by the runtime without waking its object. A list read asks the hub once; a stale-looking row costs one more request, at most once in 5 minutes.
- **WebSockets** hibernate, so an idle tab costs no duration.

## As built (steps 2 and 3)

- **Presence:** `accounts/presence-hub.ts` (`PtcgPresence`, one object by name `hub`), `account-live.ts` (a tab's place, kept on its socket), the live line `GET /v2/account/live` and `PUT /v2/friends/settings { appearOffline }`; client `friends-live.ts` (one socket a signed-in tab, pings every 50 s, retries 1 s to 30 s), `friends-presence.ts`. The room route tells the line where the tab is (`FriendsWhere`).
- **Playing together:** `POST /v2/friends/<id>/invite { kind: 'invite' | 'ask', answering? }`. An invite's room is the one the inviter's own tabs say they play in. The friend's object sends it to its open tabs, or answers `offline`; nothing is kept. Client `friends-invites.ts`: the invite notice (Join), the ask notice (Let in, which invites back with `answering`, and the asker, having asked within 5 minutes, goes straight in), and `goToRoom`, which asks first when the tab would leave an online room ("Leave this room to join {name}?"). Joining goes through Play online's own join by code (`session/room-join-request.ts`, taken by the lobby when it is free). A friend's row offers one action, Invite (from a room this tab plays in), Ask to join (a friend in a game) or Watch; their page offers all that apply. An invite's notice goes when its sender is seen in another room.

## Steps

1. **Friends** (no presence): the tables, requests, accept, decline, cancel, remove, block, Add by id or link, recent players (seat accounts in filings), the app bar button and sheet, the request toasts.
2. **Presence:** the live socket, the hub, Appear offline, statuses and the online count.
3. **Playing together:** invite, ask to join, watch.

## Verification

- Unit tests for the friend state machine on both sides (crossing requests, silent decline, the cooldown, block, limits, idempotent retries), the hub (online friends only, eviction, stale rows), and the client models (sorting, statuses).
- Runtime tests: two accounts befriend each other through the Worker; a third blocked; presence pushed between two live sockets.
- Browser specs: two browsers add each other by User ID and by link, see each other online and In a game, invite and join, ask to join, and watch.
