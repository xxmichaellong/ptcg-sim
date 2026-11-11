# ADR-052: Accounts and sign-in

- Status: **ACCEPTED**
- Decision date: 2026-11-10
- Request: accounts that keep decks, settings, saved games and replays beyond one browser. Sign in with Google (and Discord), run by the sim itself, with account management modeled on MagicCircle's. Keep the last 100 replays and up to 50 starred ones. Sign-out asks whether to clear the device. The avatar is the name's initial or an emblem.
- Amends: ADR-019 (account infrastructure now has its own requirement), ADR-045 (Settings gains the account's pages).
- Parity: PX-104.

## Why not MagicCircle's accounts

MagicCircle can't sign players in for another site as it stands (magiccircle.gg 8668411a7e):

- Its session is a host-only `mc_jwt` cookie on its own domain.
- That cookie holds an HS256 token signed with the same `JWT_SECRET` that signs every MagicCircle session. Sharing the secret would let the sim mint MagicCircle logins.
- It has no OAuth or OpenID endpoint and no public keys.

Using it would mean building a "Sign in with MagicCircle" service there first. Sign-in would then depend on MagicCircle's servers, and the sim's players would sit in the company's user database. The sim runs its own sign-in instead and copies MagicCircle's rules, flows and wording (ADR-019, with provenance).

## Sign-in

Players sign in with Google or Discord by the OAuth code flow:

- **Start.** `GET /v2/auth/<provider>/start` keeps the attempt in a ten-minute `__Host-` cookie: the provider, a state value, a PKCE verifier, the intent (sign in, or add a method), and where to return. Google gets the PKCE challenge. Discord is a confidential client, guarded by the state value and its secret, as at MagicCircle.
- **Callback.** `GET /v2/auth/<provider>/callback` checks the attempt and swaps the code. For Google it verifies the ID token with WebCrypto against Google's keys: signature, issuer, audience and times, after MagicCircle's `verifyGoogleIdToken`. Discord's code is read through `/users/@me` with the `identify` scope.
- **Scopes and tokens.** Google is asked for `openid email profile` without offline access. No provider token is kept, because the sim never calls a provider again after sign-in.
- **The popup.** The provider opens in a popup from the press itself, so a game in progress stays put. The callback answers a small page. It tells every tab the result on the `ptcgsim-account` BroadcastChannel (a popup that went through Google may have lost its opener), then closes. Where popups are blocked, the page itself goes and comes back with `?account=<result>`, which the app reads and removes.
- **Which providers show.** A provider appears only once its app's secrets are set: `GOOGLE_CLIENT_ID`/`SECRET` and `DISCORD_CLIENT_ID`/`SECRET`. With none set, Settings shows no sign-in at all.
- **The stand-in.** `AUTH_TEST_PROVIDER=on` adds a stand-in provider (a name and Continue) for local and test builds. It is `off` in the beta. The owner turned it on in the preview (2026-11-11) to try accounts before setting up Google and Discord: anyone typing the same name there shares an account, so it holds nothing worth keeping.

## Accounts and sessions

- **`PtcgAccount`.** One Durable Object per account (`a_` and 96 random bits), in SQLite. It holds the profile (name, avatar, joined), the sign-in methods, and the sessions.
- **`PtcgSignIn`.** One Durable Object per `<provider>:<id>`, pointing at its account, as `PtcgRoomCode` points at a room. The first claim wins, so a provider id belongs to one account. A record left pointing at an account that no longer has the method is released and claimed afresh.
- **Session cookie.** `__Host-ptcgsim-session` (HttpOnly, Secure, SameSite=Lax) holds `<account id>.<secret>`. The account stores only the secret's SHA-256.
- **Session lifetime.** A session lasts 90 days and is renewed on use at most once a day, so reading the account writes at most one row a day. An account keeps its 20 most recent sessions.
- **Ending sessions.** Sign out deletes its session for real. Signing in again in a browser ends that browser's earlier session.
- **Routes.** Every change is same-origin, rate-limited per address (`SIGN_IN_RATE_LIMITER`, `ACCOUNT_RATE_LIMITER`), and authorized by the session inside the account's own object, so checking and acting can't come apart. `GET /v2/account` refuses a cross-site read.
- **Rules from MagicCircle.**
  - One id per provider per account.
  - The last method can't be removed.
  - Deleting needs the id of the account on screen (`expectedAccountId`).
  - Linking an id that another account holds is refused rather than merged ("That account already has its own PTCG Sim account").
- **Deleting.** The provider ids are released first, then the account's storage is deleted whole.
- **Guests.** Guests stay entirely local. There are no server-side guest accounts.

On the Workers Free plan (ADR-051), a new account writes four rows and a returning sign-in about two. A visit writes at most one row a day. Nothing is written per move.

## Settings

- **The first row.** It sits above the player names: Sign in (shown only where a provider is on offer), or the avatar and name.
- **Sign in.** One button per provider, "For players 13 and older." and a Privacy link (`/privacy.html`).
- **Account.** About me (avatar, the name edited in place, User ID with Copy, Joined), then Connections (Sign-in methods; this device's decks not yet added; Sign out, which asks whether to clear this device), then Delete account at the foot.
- **Avatar.** The sleeve designer's emblem picker, where None means the initial.
- **Sign-in methods.** Connect and Disconnect, with the current session marked and the last method locked.
- **Delete account.** Hold to delete. The press must be held (pointer, Space or Enter) rather than a word typed.
- **The player's name.** A first sign-in fills Play online's name when none was given.

## Sync (step 2)

A signed-in player's decks, and the settings and looks that follow them, are the same on every device.

- **What follows the account.** Saved decks, and each preference marked `synced` in its `definePreference`: the player's names, card backs and coins with their recent lists, deck themes, the table's look and view, depth, shortcuts, motion, language, card images, tutorial progress and the tournament search. Layout, panels, the deck screen's own state and recent commands stay on the device.
- **The account's side.** `PtcgAccount` keeps one row per record (`synced_record`: kind, id, revision, the device's change time, the JSON) and one counter row. `POST /v2/account/sync` takes a device's changes and answers what changed since the revision it last read, in pages. A change names the revision it was made from and is taken only if the record is still there, so two devices can't overwrite each other unseen; the later one is told and decides again. A deletion is kept six months as an empty row, then let go; a device last seen before that reads everything again.
- **Limits.** 1,000 decks of up to 256 KB each, 64 settings of up to 32 KB, 8 MB in all, 100 changes a request.
- **The device's side** (`apps/web/src/account/account-sync.ts`). It remembers, per record, the revision and a hash of the contents it last agreed with the account on. Changed only here: sent. Changed only there: taken. Changed in both: the later deck change wins, and for a setting, the change that reached the account first. A deck's cards' rule facts aren't compared, since each device works them out from its own catalog.
- **Tabs.** One tab syncs at a time (a Web Lock), and each reads the decks from IndexedDB and the settings from storage afresh, so a tab behind another's change can't send it back. A library that can't use IndexedDB doesn't sync decks: it can't tell a deleted deck from one never loaded.
- **When.** At sign-in, three seconds after a change, when the page is hidden (what's pending goes then), when it comes back after a minute, and every five minutes while it's in view.
- **A device's first sync** takes the account's settings over its own, and keeps the decks it already had out of the account until the player adds them: "Add this device's 12 decks to your account?" with Add, and the same on the Account page ("This device's decks"). A borrowed computer's decks aren't the player's.
- **Signing out** asks: Sign out (keep your decks and settings here), or Sign out and clear (remove the account's decks and settings from this device; decks it had before, never added, stay). Changes not yet sent go first.

On the Free plan a change writes its record and the counter; reading writes nothing. A deck edited in a burst is one write after three seconds of quiet.

## Saved games

With continuation on (ADR-012), a signed-in player's Save game goes to the account instead of a `.ptcgsave` file, and Saves & replays lists the account's saves to resume. `GET /v2/account/saves`, `PUT` and `DELETE /v2/account/saves/<save id>`; each is the file's text, checked against its own save id. They are capabilities, so they are read from the account when the list is shown and kept in memory only, never in browser storage. A save goes at its own expiry, after it is resumed from the list, and past 50 the oldest goes. Continuation is still off in both deployed Workers, so neither shows yet.

## Replays (step 3)

Full-game replays kept in the account, 100 recent and 50 starred: ADR-053.

## Verification

- **Unit tests.**
  - Sign-in, a repeat sign-in, a new browser's sign-in ending the old session, and returning only to this origin.
  - Wrong, missing, expired and cancelled attempts, and providers on offer only when configured.
  - Rename and avatar validation, and same-origin enforcement.
  - Sign out, 90-day expiry against daily renewal, and Google's ID-token checks (another client, issuer, key or algorithm).
  - Linking, a held id, a second id at a provider, the last method, and deleting.
  - Stale and unfinished records.
  - Mutation checks confirm that removing the state check or the held-id check fails them.
- **Runtime tests.** The flow runs on real Durable Objects and cookies.
- **Browser specs.** They sign in through the stand-in's popup, rename, choose an emblem avatar, sign out, sign in again, and delete by holding the button. A sign-in or sign-out in one tab shows in another.
- **Sync.** Unit tests cover the account's revisions (a change from a stale revision refused and answered, deletions kept and let go, a device away too long reading everything, limits, pages) and the device's merge (a deck to another device, the later of two changes winning, facts alone not sent, deletions, a new device taking the account's settings, a device's own decks held back until added). A browser spec signs two browsers in as one person: a deck made before signing in is added from the offer, a deck and the table's theme reach the other browser, and Sign out and clear takes them off it. Turning sync off fails it.
