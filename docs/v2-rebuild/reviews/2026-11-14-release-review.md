# November 14 release review

Scope: the 31 commits after `45d477b3` through `c1615247`, plus the fixes from
this review. This is a source and test review by the primary agent, not an
independent GitHub approval.

The review covered account sign-in/session custody and synchronization; replay
filing and spectator projection; friends, presence and invitations; the ops
access boundary and analytics; room expiry/storage changes; and the table-name,
shuffle and settings changes. Generated translations are checked by the existing
i18n gate. Existing unit, runtime and browser suites cover the unchanged paths.

## Findings and changes

1. **P1 — Revoked live account access.** Friends sockets were authenticated only
   at upgrade and continued receiving private presence after sign-out. Each
   attachment now carries the session digest. Reads, sends and incoming messages
   check expiry/revocation without renewing the session on background traffic;
   sign-out closes that session's sockets, and session-cap eviction also prunes
   connections. Legacy attachments fail closed. Runtime regressions for sign-out
   and expiry both fail on the original code.
2. **P2 — Unverified room presence.** A tab could claim any public room code and
   invite friends to it. The room now verifies an admitted, active socket for the
   account and the claimed role, under its current code. Signing in with a room
   open binds the existing authenticated room session before announcing presence;
   spectators are supported without acquiring player status. Invites recheck
   membership. An integration test for a forged room claim fails on the original
   account implementation. Checks finishing after a newer report are discarded.
3. **P2 — Pending social actions survived their context.** An answer to an old
   ask could auto-join after the asker changed rooms or accounts; a retained Let
   in action could invite to a different room. Pending asks and notices are now
   cleared on those changes, and asynchronous actions check their original
   context and expiry. Three regressions fail on the original implementation;
   an answer to a current ask still joins normally.
4. **P1 — Account synchronization crossed account changes.** A queued/in-flight
   sync could send using a new account cookie or apply an old account's response
   after switching accounts. Requests now name the expected account and the
   server refuses mismatches. The client abandons a run after an account change
   before sending or applying responses. Both server and client regressions fail
   on the original implementation. Older pages without the expected account
   field must reload before synchronization resumes; they receive 409 rather
   than writing to an unintended account.
5. **P2 — Presence trusted a one-sided friendship.** A failed peer-removal
   notification could leave a stale friend row able to read the other account's
   presence. The hub now checks the source account's authoritative friendship
   before returning its presence, and fails closed if that check fails. This
   adds bounded, read-only RPC calls when presence is requested, without adding
   heartbeat writes.

## Release checks

Regression proofs, full quality gate, local browser checks and GitHub CI results
are recorded in PR #39's Verification section for the shipped commit. Neither
this report nor passing automated tests claims physical-phone testing, a real
user's OAuth consent flow, or an independent reviewer approval.

The public beta deployment was explicitly authorized for this release by the
owner. It must retain `AUTH_TEST_PROVIDER=off` and `DECK_INDEX_SOURCE=off`, use
only `beta.ptcgsim.online`, and leave v1's domains unchanged. Beta sign-in requires
the four OAuth secrets on `ptcgsim-v2`; preview secrets do not transfer on deploy.
