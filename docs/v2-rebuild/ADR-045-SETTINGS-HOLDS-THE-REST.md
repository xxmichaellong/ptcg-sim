# ADR-045: Settings is the app bar's last button, and holds the rest

- Status: **ACCEPTED** (2026-11-05, the owner's request: "completely kill
  'menu' and just make the 'settings' … think logically about how we can
  organize all of the content that's currently in the menu and nested in
  the settings. we also don't need a hotkey for the settings menu. draw
  inspiration from the magiccircle repo and how they organize their
  settings drawer … like i love how there's an explicit language section
  in the magiccircle drawer, about, report bug, board, etc.").
- Decision date: 2026-11-05
- Supersedes: ADR-036's menu (☰) and its Settings key (`,`); ADR-030 §6's
  sections. ADR-030 §6's surfaces (docked beside the table, a side sheet,
  a bottom sheet) stand.
- Parity: PX-026 (the sidebar's place) records it.

## Context

Since 2026-10-29 the bar's last button was a menu (☰) of what could be
done here, with Settings as one of its rows; Settings itself was one long
sheet in sections (Room, Table, Cards, Motion, Keys, Language) with the
release, Discord and Sponsors at its foot, and `,` opened it. So Settings
was two presses away, the room's actions and the player's preferences were
in two places, and a long sheet put the language near the bottom.

Magic Garden's system menu (magiccircle.gg,
`QuinoaCanvas/systems/systemMenu`) is one drawer of grouped cards of rows,
each row with a coloured icon, its words, and at its end what it is set to
and a chevron that opens its page; pages stack, with a title and a way
back; Language is a page of its own, and Report a bug and About close the
first page.

## Decision

1. **The bar's last button is Settings** (`#settingsButton`, a gear). It
   opens Settings, and puts it away while it is open; it shows pressed
   (`aria-expanded`) while Settings is open. There is no menu (☰) and no
   key: `table.settings` leaves the key catalogue (a stored rebinding of it
   is ignored, and `,` is free). The palette still finds Settings and its
   pages ("Settings: Cards").
2. **Settings is pages** (`SETTINGS_PAGE_PARENTS` in
   `settings-sheet-state.ts`). The first page, top to bottom, each a card:
   - on a phone, what the bar has no room for: Deck, and (held upright)
     where to play;
   - in a room, under its name: Invite opponent ("Seat taken" once it is),
     Invite spectator, Allow board flip;
   - the game: Exit replay, Tutorial, Watch replay…, Save game, Resume saved
     game…, Download replay, as each applies;
   - **Table** (its look's name), **Cards**, **Motion**, **Language** (the
     language, named in itself), **Keyboard shortcuts** (its key; not on a
     touch screen, which has none);
   - **Report a bug**, **About**;
   - at the foot, the way out: Leave room (red), or Leave tutorial.

   Its pages:
   - **Table**: Look (Style, Background, Dark mode), View (Depth with its
     Angle and Thickness, Halves with its Split, Zone outlines), Reset
     table.
   - **Cards**: Opponent's cards face me, Preview on hover (not on touch),
     Natural placement, Opponents' custom backs; **Card images**, a page of
     its own (the page's language, or one of the six cards are printed in).
   - **Motion**: Reduce motion, Speed; Depth (Lift while dragging, Animate
     stacks, Parallax), each saying "Needs depth" while the table is flat.
   - **Language**: Browser language (naming it), then the twenty, each
     named in itself, one checked.
   - **Report a bug**: Report on Discord (outside), Copy details (the
     release and build, the kind of table and its room, the window, the
     pointer, the depth, the language and the browser -- never the page's
     address, an invitation or a player's name).
   - **About**: What's new (the release), Sponsors, Discord and Source code
     (outside).

3. **Rows** (`ui/SettingsList.tsx`): a coloured icon tile on the first
   page (fixed colours, white glyphs at 3:1 or better in both themes), the
   label, a line under it, then what it is set to and a chevron (a page),
   an arrow (outside), a switch, or a check. A hairline runs between rows
   from their words onward; headings above a card are small capitals, notes
   below it are muted. Pressed, a row's icon leans and sinks, springing
   back; under reduced motion it holds still.
4. **Moving between pages**: a page opened from a row slides in from the
   end of the line (from the start going back), and fades without travel
   under reduced motion. Its title takes the focus, to be read out. Back
   (the header's ‹, or Esc) returns to the row it came from, at the scroll
   it was left at; Esc on the first page puts Settings away. Each opening
   starts at the first page, or at the page asked for (the palette).
5. **What Settings opens gives way**: a row that acts (an invite, a save,
   the tutorial, the keys, the release notes, leaving) puts Settings away
   first -- one window at a time.
6. **Where it shows** is unchanged (ADR-030 §6): in the log's column
   beside the table where the log docks, a side sheet narrower, a bottom
   sheet on a phone.

## Consequences

- One place for everything that is not the game: a Solo table's Settings
  reads tutorial, replays, then preferences and help; a room's leads with
  its invites.
- Settings is one press from anywhere, and the language two.
- Rows keep the ids the menu's had (`#inviteOpponentMenuItem`,
  `#exportState`, `#leaveRoomButton`…), so specs reach them the same way
  (`chooseMenuItem`, `openSettings(page, 'cards')` in
  `tests/browser/support/table-shell.ts`).
- The tutorial's "Around the table" lesson points at Settings instead of
  the menu.

## Verification

`SettingsSheet.test.tsx` (the first page and each page's controls, the way
in and back with the focus and Esc, a page asked for, the room's actions
giving way, a phone's first rows, About, Report a bug's details, the keys,
board flip, docked), `AppMenu.test.tsx` (the bar, the actions' groups and
order), `settings-commands.test.ts` (the palette's pages, no key),
`RemoteRoomRoute.test.tsx`, `RemoteRoomLobby.test.tsx`, and the browser
specs that use it: `app-bar.spec.ts`, `board-view.spec.ts`,
`command-palette.spec.ts`, `localization.spec.ts`, `rtl-layout.spec.ts`,
`experience-refinement.spec.ts`, `tooltips.spec.ts` and the rest through
the shell helpers.
