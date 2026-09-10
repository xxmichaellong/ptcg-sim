# ADR-020: use a foreground clipboard handoff for anonymous invitations

- Status: **ACCEPTED**
- Decision date: 2026-09-10
- Scope: anonymous player-two and spectator invitation transfer
- Production wiring: enabled only on the isolated `?room-lobby=1` v2 route;
  default/public cutover remains disabled

## Context

V1 lets every participant type or copy the same room ID. That value is both
room discovery and admission authority, so anyone who learns it can join as a
player or spectator. V2 already separates the harmless 12-character room code
from 256-bit master credentials, 15-minute role-bound one-use invitations,
30-second socket tickets, and rotating resume credentials. The unresolved
question was how an account-free creator gives an invitation to another browser
without turning the room code, URL, browser storage, React state, DOM, logs, or
analytics back into authority.

The visible lobby should keep its existing Name, Room ID, Generate, Copy,
coaching, spectator, and Join controls. No account system or multiplayer lobby
service exists, and adding either solely for invitation delivery would expand
the product and operational trust boundary.

Clipboard access is a powerful browser feature. The current W3C Clipboard API
requires a secure context and defines user-activation/permission gates for
writes; its `ClipboardItem` input may contain a promise. Native paste events
provide `text/plain` only during the user-initiated event. Those properties let
the application start a copy during the button gesture even though invitation
minting finishes asynchronously, and intercept a paste before the browser puts
the bearer in an input.

## Decision

Use a manual, foreground copy/paste channel for the first v2 release.

The creator-side in-memory custodian exposes `copyPlayerInvitation` and
`copySpectatorInvitation`; it does not return an invitation to UI code. A copy
starts a plain-text `ClipboardItem` write synchronously, supplies a strict
branded invitation envelope through a promise, and returns only safe metadata:
room code, role, and expiry. Where promised `ClipboardItem` data is unavailable,
the adapter may use `writeText`; if the browser denies or lacks clipboard
access, the operation fails closed. Concurrent copy attempts are rejected so
two asynchronous issues cannot race the clipboard. It must not render or place
the secret in a URL as a fallback.

The joining lobby intercepts a native paste, calls `preventDefault`, strictly
parses the bounded `PTCGSIM2-INVITE:` envelope, and retains the validated object
only in a private non-serializing JavaScript custodian. The existing Room ID
input may show the receipt's 12-character room code, never the envelope. Join
derives the role from the invitation rather than trusting a checkbox or caller,
exchanges the claim through the existing no-store POST, and clears custody only
after successful bootstrap. A failed or ambiguously delivered exchange retains
the same claim for a bounded retry; the server rotates any prior linked ticket.
Concurrent join attempts, use after dispose, malformed input, expiry, and a
room-code-only join fail closed.

The Room ID control also canonicalizes manual input to the bounded 12-character
public room-code alphabet and rejects text drops. This prevents a copied bearer
from entering React/DOM state through character entry, autofill-like input, or
drag-and-drop around the native paste handler. A malformed replacement paste
disarms any older claim before reporting the error, so the UI cannot silently
join with a previously accepted invitation.

The familiar controls retain these semantics in the isolated lobby:

1. **Generate** creates a multiplayer room and establishes creator custody.
2. **Copy** mints and copies a player invitation by default. Selecting the
   existing spectator option before copying mints a distinct spectator
   invitation instead; repeating it mints another distinct spectator claim.
3. A player invitation copy rotates every older unclaimed player invitation.
4. A recipient pastes into **Room ID**. The input displays only the parsed room
   code and the spectator option reflects the invitation's authoritative role.
5. **Join Room** consumes the private custodian. Typing only a room code can
   locate a room but cannot authorize admission.

Manual character-by-character entry of the full bearer is deliberately not
supported in the initial release because it requires putting the authority in
an editable DOM value. Users may transfer the copied envelope through a private
messaging channel of their choice. That external channel and the operating
system clipboard can retain the envelope, but its role binding, short expiry,
rotation, and atomic one-use consumption bound the consequence. The lobby will
state that an invitation is temporary and should be shared only with the
intended participant without displaying the value.

## Rejected alternatives

- **Room code alone:** restores V1's authorization flaw and makes spectator
  choice caller-controlled.
- **Bearer in a link, hash, query, hidden field, or browser storage:** leaks into
  history, sharing surfaces, extensions, diagnostics, DOM inspection, or later
  sessions.
- **Account-free trusted relay:** adds global mutable state, abuse controls,
  expiry cleanup, metadata, and an availability dependency while still needing
  a bearer or authenticated identity at pickup. It does not improve the current
  account-free threat model enough to justify the added system.
- **Account identity:** can make a room code discovery-only, as in MagicCircle,
  but is a product/UX change outside this rebuild.
- **One envelope containing player and spectator authority:** lets one recipient
  choose or steal multiple roles and cannot support independently bounded repeat
  spectators.

## Consequences and residual risk

- Clipboard operations require HTTPS (localhost remains a development secure
  context), an explicit user gesture, and browser permission where applicable.
- A recipient, clipboard manager, extension, compromised device, or external
  messaging service can copy the bearer during its lifetime. No account-free
  manual transfer can prevent an intended recipient from resharing it.
- Copy failure may leave an unused digest-only spectator invitation until its
  15-minute expiry; the room cap and issue rate limit bound this. A later player
  copy rotates its predecessor.
- The browser-support decision in ADR-015 must ratify promised
  `ClipboardItem`/paste-event behavior. Unsupported browsers fail visibly and do
  not receive a URL/DOM fallback.
- The clipboard adapter is a transport boundary, not React state and not part of
  canonical game state, replay, or persistence.

## Evidence and rollout

The protocol owns a strict, 1,024-code-unit text codec. Web tests prove deferred
clipboard invocation, compatibility fallback, paste interception, expiry,
redacted failures, private retry custody, serialized joining, disposal, and
successful clearing. A Chromium journey uses five isolated browser contexts to
prove player-claim rotation, player-two admission, two distinct spectator
claims, correct projected roles, and absence of envelope text from URLs,
document HTML, and browser storage. A second journey drives the actual lobby
controls in four isolated contexts, including native clipboard copy/paste,
rotated-player rejection, player-two and spectator admission, safe rendered
receipts, and connected-route handoff. That same journey now submits player and
spectator chat through the visible input, uses the flower and player Attack
controls, proves spectator mutation buttons are absent, accepts the unchanged
Leave confirmation, observes server-attributed durable leave, exercises
recipient-safe battle-log download/clear and foreground full screen, and
verifies the departed client returns to an empty-code lobby with fresh custody. The
built-production topology lane proves the lobby chunk is reachable only through
its explicit flag and creates no room on mount.

The normal v2 entry and the v1 application remain unchanged. Rollback removes
the query-route branch and lobby presentation adapter without weakening or
migrating the existing authority, invitation, ticket, or persistence protocols.

## References

- [W3C Clipboard API and events](https://www.w3.org/TR/clipboard-apis/)
- [MDN Clipboard API security and browser behavior](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)
