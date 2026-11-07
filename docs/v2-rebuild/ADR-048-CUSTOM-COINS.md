# ADR-048: Coins edited like sleeves

- Status: **ACCEPTED**
- Decision date: 2026-11-06
- Request: "make it so you can edit your coin just like you can edit your sleeves"
- Parity: PX-097

## Decision

Coins reuse the sleeve chooser's Presets, Design and Image workflow, with
round previews, square image encoding and a circular crop. Design keeps the
same colors, patterns and Pokémon, Poké Ball and Energy emblems. Upload,
drop, paste and image links use the existing app-owned image store. Images
are encoded at 600×600; no viewer loads an outside image host. The original
Poké Ball coin remains Standard. The reverse uses the chosen art in silver,
matching the original coin's color-heads and silver-tails distinction.

Settings → Cards → Coin opens the chooser. The coin's context menu also has
Edit coin. In Solo either seat's coin can be edited; in a room only the
viewer's own coin can. Each room player has an optional `coin` reference;
older games without it draw Standard. `SetCoin` / `PlayerCoinSet` validate
bounded preset, design or stored-image references, and authority rejects
cross-seat changes outside Solo. All viewers, saves and replay projections
carry the coin. The device keeps the player's choice for future rooms and
keeps recent coins separately from sleeves. The optional projection field
is ignored by older tabs; there is no new presentation event or log verb.

The existing flip and multi-coin controls, randomness, animation, result
chips and log stay the same. Failed images fall back to the standard face.
