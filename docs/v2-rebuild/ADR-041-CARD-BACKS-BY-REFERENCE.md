# ADR-041: card backs by reference

- Status: **ACCEPTED**
- Decision date: 2026-10-29
- Supersedes, for card backs only: ADR-013's direct loading of pasted
  card-back URLs, and with it the card-back parts of SEC-004 and PARITY-007.
  Room backgrounds and custom card faces keep ADR-013 until their own
  choosers move (a later stage).
- Scope: what a card back is on the wire, in state, in saves and replays; the
  image store; the import of an outside image; how each viewer draws a back

## Context

Under ADR-013 a card back was a pasted image URL. It was public player
presentation, so every opponent and spectator's browser loaded it from the
chooser's host. That host saw their address and browser, and could log each game
(a unique URL works as a tracking pixel). Links rot: Discord attachment
links now expire within a day, and Imgur has deleted anonymous uploads.
A host may also serve something else after the one-time check. No commercial
client hotlinks backs; tabletop tools that take custom images keep their own
copy.

The owner asked whether a URL is the best way (2026-10-29) and chose:

- uploads are stored in a Durable Object for now (no R2 until Workers Paid);
- backs already saved as URLs are imported (fetched once and kept as our own
  copy): an opponent never loads an outside host;
- opponents' custom backs show by default, with a setting to show the
  standard back instead.

## Decision

### 1. A back is a short reference

The field keeps its name, `cardBackUrl`, in commands, events, state,
projections, saves and replays (stored rooms and files keep loading), but
it now holds a **card-back reference** (`@ptcgsim/game-core` `card-back.ts`):

| Reference                                     | Meaning                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `preset:<id>`                                 | A back shipped with the app (`[a-z0-9-]{1,32}`): `standard` and its recoloured presets. |
| `design:1.<base>.<pattern>.<accent>.<emblem>` | A sleeve drawn by each viewer from four values, each from a fixed list (no free text).  |
| `img:<sha256>`                                | An image in our store, named by the SHA-256 of its bytes.                               |
| `url:<https URL>`                             | A legacy URL; also any older value without a prefix.                                    |

Every reference but `url:` fits in 128 characters. The old default path
`/v2/assets/cardback.png` reads as `preset:standard`. A value with one of the
prefixes must be well formed (the room refuses it otherwise); a value without
one is legacy and keeps ADR-013's bound (4,096 code units), so older clients,
rooms, saves and replays keep working. The frame budget for long backs in the
room authority stays, for legacy values only.

### 2. The image store

`PtcgImageStore` is one SQLite Durable Object.

- **Uploads:** `POST /v2/images` takes the body's bytes.
  - They must be WebP or JPEG (judged by their header, never by
    `Content-Type`), at most 200 KB and 1000×1400 px.
  - The store hashes them and keeps them once, then answers
    `{ "ref": "img:<sha256>" }`.
  - Uploads are rate-limited per address. A blocklist of hashes refuses
    banned images on upload and on serving.
- **Serving:** `GET /v2/images/<sha256>` serves the bytes from our own
  origin, `immutable` for a year, with `nosniff`. An unknown or blocked hash
  is a 404.
  - No copy is kept at the edge, so a ban takes effect at once for every
    browser that doesn't have the picture yet. Browsers keep what they have.
  - The cost is one store request per browser per picture: a player's back
    is asked for once by each opponent and spectator, then comes from their
    browser's cache.
  - On Workers Free that is well inside the daily request and row-read
    budgets: one row read per first view.
- **Importing:** `POST /v2/images/import` takes `{ "url" }`.
  - It fetches an outside `https` image once for the asking browser, which
    re-encodes it at card size and uploads it.
  - Limits: a timeout, 5 MB, three redirects each checked again, image types
    only, and no private, loopback, link-local or metadata hosts.
  - It is rate-limited per address.

### 3. Drawing a back

Each viewer resolves a reference itself, at the one place the table builds its
scene, and on the deck screen:

- `preset:` resolves to a WebP under `/v2/assets/backs/`, named by its
  content and cached `immutable`.
- `design:` resolves to an SVG drawn locally from its four values.
- `img:` resolves to `/v2/images/<sha256>`.
- `url:` resolves to the **standard back** for everyone, except on its owner's
  own deck screen, which imports it.

Back images send no referrer. A back that fails to load falls back to the
standard back; it used to go blank and retry every minute.

**Opponents' custom backs** (Settings, on by default): when it is off, an
opponent's `design:` or `img:` back draws as the standard back. Presets
always show, and so do the viewer's own backs (both seats in Solo).

### 4. Old URL backs are imported

A deck saved with a URL back keeps it as `url:`. The next time its owner puts
that deck on a seat, the browser imports it:

1. it fetches the image through the import endpoint;
2. it re-encodes it to WebP, or to JPEG where the browser can't encode WebP,
   at about 600×838;
3. it uploads it and swaps in the `img:` reference.

All of this is silent. The old reference stays if any step fails. A link
given in the chooser goes through the same import.

### 5. The chooser (stage 2, 2026-10-29)

The owner: typing `default` "is extremely tacky nowadays. there should just
be a button to use default cardback". The prompt that asked for "an image
URL, or 'default'" is gone; the deck screen's card back opens a chooser
(`card-backs/CardBackChooser.tsx`, through the shared dialog's `openPanel`),
and nothing in it is typed but a link.

- **The back, large,** beside the choices (above them on a phone): the one
  chosen so far, drawn as the table draws it.
- **Backs:** a grid of native radios (arrow keys move through it; every
  tile is 44px or more). The **Standard back** tile comes first
  (`preset:standard`), then the other presets, then **Yours**: the player's
  recent designs and pictures (the last 8, kept on this device) and the
  backs their saved decks wear, each once.
- **Design:** colour, pattern, accent and emblem, each a row of radios from
  the fixed lists, previewed with the same SVG module the table uses. It
  answers a `design:` reference.
- **Picture:** a file (Choose a picture), a drop anywhere on the dialog, a
  pasted image, or a link (Get), fetched through the import endpoint and
  shown before anything is saved. The picture is shown in a card's shape,
  centred; a drag or the arrow keys move it within the card, and the crop
  encoded is exactly the one shown. Use this back re-encodes it (a canvas
  in memory, never the GPU's), uploads it and answers its `img:` reference.
  A fetch or upload that fails or takes over 30 s says so in plain words
  and leaves the dialog open; files that aren't pictures or are over 20 MB
  are turned away before anything is sent.

Cancel, Escape or a superseded request change nothing.

## Consequences

- No browser but the chooser's own ever contacts an outside host for a card
  back.
- Backs survive their source going away.
- The store's writes count against the Free plan's daily row budget: one row
  per distinct image, uploads rate-limited.
- Stage 2's chooser (section 5) sits on this contract; no part of the app
  asks for a typed word to mean a back (PX-074).

## Rejected alternatives

- **Keep hotlinking behind an opt-in for viewers:** opponents' privacy would
  rest on each viewer finding a setting; the owner chose import.
- **R2 now:** it needs a payment method on the account; the Durable Object
  store moves to R2 behind the same endpoints when the account goes to Workers
  Paid.
- **A server-side proxy that serves outside images live (as GitHub's Camo
  does):** this still depends on the source staying up, and every view
  becomes a server fetch. Importing once is cheaper and keeps the back alive.
