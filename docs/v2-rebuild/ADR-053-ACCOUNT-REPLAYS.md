# ADR-053: Games kept in the account

- Status: **ACCEPTED**
- Decision date: 2026-11-11
- Request: the same as ADR-052's. Replays need an account. Keep the last 100 games and up to 50 starred ones. Each player watches from their own seat, and a share link opens in spectator view.
- Amends: ADR-016 (compaction drops a block of moves at a time), ADR-051 (a few rows per game for signed-in seats), ADR-012 (a game's whole record is kept server-side for its player's account).
- Parity: PX-105.

## What a room keeps

The room's snapshot keeps its last moves (ADR-016): at most 128 batches and 512 KiB. Past either bound, compaction now drops the oldest quarter at once, down to 96 batches and 384 KiB, instead of one move each time. The newest move always stays, because undo needs it. Download replay and undo therefore reach back between 96 and 128 moves.

While a seat is signed in, each dropped block is kept in one row, beside the state the blocks start from (`replay-archive:<start>:…`, gzipped JSON). This happens inside the move's own transaction. Nothing is written per move. A room nobody signed in to keeps nothing.

**Which seats are signed in:**

- At the WebSocket upgrade, the room reads the session cookie. It asks the account's object whether that session is real, and only then keeps the account on the socket.
- When the socket's session claims a seat, the room records seat → account in one row (`replay:room`).
- A player who signs in or out with the table open tells the room with `POST /v2/rooms/<code>/account`. The request carries their resume token. The room checks the cookie itself.

## When a game is filed

A game ends when a seat that was playing is reset or loads a deck. A history begun again also ends the game as it was: a seat claimed under a new name, or a Solo table opened.

At that point the room assembles the game's record and files it straight to each signed-in seat's account object. The record is the game's start state plus every move: the kept blocks first, then the snapshot's own moves. Once filed, the game's blocks are deleted. The game is also filed as it stands when the room's last connection closes, and in the room's alarm before it can expire.

Filing the same game again replaces it with the longer record. The game's id is derived from the room, where the game starts, and the seat. A game that was never set up, or has fewer than four moves, isn't filed. An account that no longer exists keeps nothing.

## What an account keeps

Each game is one row in the account's SQLite: its listing, whether it is starred and shared, and the record, gzipped (at most 1 MiB).

- **Recent games.** Filing keeps the 100 most recent unstarred games and deletes older ones.
- **Starred games.** Up to 50 can be starred. They are kept until unstarred, and can't be deleted until then.
- **Storage location.** The records live in the account object, not R2, so nothing needs enabling on the Free plan. `AccountReplaysSql.record` and `file` are the seam where records would move to R2 (one object a game).

The record holds both players' hidden cards, so it never leaves the server unprojected.

**Watching a game:**

- The account's object rebuilds the state at the part's start and projects up to 128 moves with `buildProjectedReplay`, from the player's own seat. A Worker has only 10 ms of CPU on the Free plan; the object has 30 s.
- A part answers with the frames as the room streams them. The app writes them into an ordinary replay file (ADR-012's format) and plays that on the live Solo table.
- Stepping on from a part's last move loads the next part. Stepping back from a part's first move loads the previous part at its end. The bar then reads "Replay, part 2 of 4".

**Share links:**

- A share link is `/#replay=<account>.<game>.<secret>`. It is a fragment, so it never reaches a server or a Referer. The app takes it off the address as it starts, as it does an invitation (ADR-020).
- It opens the game as a spectator sees it: the public projection, even of a Solo game.
- The secret is kept as is, so the same link can be copied again. Unsharing forgets it.

## Routes

The account's routes are counted per address by `ACCOUNT_RATE_LIMITER`. Changes are same-origin, and reads refuse other sites.

| Method | Path                                            | Does                                                            |
| ------ | ----------------------------------------------- | --------------------------------------------------------------- |
| GET    | `/v2/account/replays`                           | Lists the games, newest first. A shared game includes its link. |
| PATCH  | `/v2/account/replays/<id>`                      | `{starred}`. Answers 409 `star_limit` past 50.                  |
| DELETE | `/v2/account/replays/<id>`                      | Deletes the game.                                               |
| GET    | `/v2/account/replays/<id>/parts/<n>`            | One part, from the player's own seat.                           |
| POST   | `/v2/account/replays/<id>/share`                | Shares the game.                                                |
| DELETE | `/v2/account/replays/<id>/share`                | Takes the share link back.                                      |
| GET    | `/v2/replays/<account>/<id>/<secret>/parts/<n>` | One part through a share link. Needs nobody signed in.          |

## Settings

Saves & replays leads to **Your games**: who you played, when, and how many moves. A row's press watches the game, and its buttons star it, copy its share link, or delete it (once unstarred). The Account page leads there too.

Signed out, where a provider is on offer, the row offers sign-in instead. Watching needs the live Solo table. A share link waits for it, then plays.

## Cost, measured

These numbers come from `account-replays-runtime.test.ts` on workerd: a Solo game of 142 moves with a 60-card deck.

- **Record size.** 5.8 KB gzipped.
- **Room rows.** The game's own moves write 284 rows. Beyond those, keeping the game writes about eight: the seat's account (once), the base and one block, the room's note twice, the filing, and the two deletes after it.
- **Longer games.** A 500-move game adds about one row a block of 32 moves, plus one to delete it: about 30 rows against the game's 1,000.
- **Viewing a part.** A full part of 128 moves is 4 MB of JSON before the edge compresses it. It took about 0.1 s to rebuild and project locally.

## Not done

- R2 storage for records, once the plan has it.
- A game played across a history reset (a player rejoining under a new name mid-game) is filed as two games.
- Spectators' own games aren't filed: they have no seat.

## Verification

- **Unit tests:**
  - what a commit drops, and where a game ends;
  - assembling a record from blocks and history;
  - one row a block;
  - filing at a game's end from a signed-in seat, then deleting its blocks;
  - pruning to 100, the 50-star cap, filing again, and sharing;
  - projection by part (the seat's view and a spectator's);
  - the routes' origin checks, sign-out and limits;
  - the app stepping across parts.
- **Runtime tests:**
  - a signed-in Solo game is filed at its reset, viewed by part, starred, shared and opened anonymously;
  - a cookie with a made-up secret files nothing.
- **Mutation checks.** Dropping the block write fails the unit and runtime tests. Trusting the cookie's account id without asking the account fails the runtime test.
- **Browser spec:** sign in at the Solo table, play and reset a game, find it under Your games, star it, copy its link, watch it, and open the link in another browser as a spectator.
