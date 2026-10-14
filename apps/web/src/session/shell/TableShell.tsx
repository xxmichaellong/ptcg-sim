import type { CSSProperties, ReactNode } from 'react';

import {
  roomBackgroundCssImage,
  type RoomBackground,
} from '../browser-room-background.js';
import '../../design/panel-controls.css';
import './table-shell.css';

/**
 * The page around the table (ADR-030): the table fills the window, and
 * whatever is not the table -- the welcome, a banner, the sheets, the deck
 * screen -- is laid over it by the children. The lobby and the room both
 * use it, so the page looks the same before and after a room opens.
 */
export const TableShell = ({
  route,
  darkMode,
  background,
  sessionPhase,
  docked = false,
  board,
  children,
}: {
  readonly route: 'remote-room' | 'remote-room-lobby';
  readonly darkMode: boolean;
  readonly background?: RoomBackground;
  readonly sessionPhase?: string;
  /** The activity log is docked at the right, and the table beside it. */
  readonly docked?: boolean;
  readonly board: ReactNode;
  readonly children?: ReactNode;
}) => (
  <main
    className={`app-shell remote-room-route table-shell${
      darkMode ? ' remote-room-route--dark' : ''
    }`}
    data-app-route={route}
    data-session-phase={sessionPhase}
    data-dark-mode={String(darkMode)}
    data-room-background={background?.kind ?? 'default'}
    data-activity-docked={docked ? 'true' : undefined}
    style={
      background
        ? {
            backgroundImage: roomBackgroundCssImage(background),
            backgroundSize: '100% 100%',
            backgroundRepeat: 'no-repeat',
          }
        : undefined
    }
  >
    <section
      className="board-column board-column--table"
      aria-label="Game board"
      data-board-shell="table"
    >
      {board}
    </section>
    {children}
  </main>
);

/** Something the table must say until it is resolved: a lost room. */
export const TableBanner = ({
  children,
  tone = 'danger',
  action,
}: {
  readonly children: ReactNode;
  readonly tone?: 'danger' | 'neutral';
  readonly action?: ReactNode;
}) => (
  <div
    id="roomHeader"
    className="ptcgsim-table-banner"
    data-tone={tone}
    role="status"
    aria-live="polite"
  >
    <span id="roomHeaderText">{children}</span>
    {action}
  </div>
);

/**
 * A layer over the table for the welcome card: the half above the seam
 * when `seam` (its height as a share of the window) is given, so the rail
 * stays in reach, or the middle of the window.
 */
export const TableCentre = ({
  seam,
  children,
}: {
  readonly seam?: number;
  readonly children: ReactNode;
}) => (
  <div
    className="ptcgsim-table-centre"
    data-area={seam === undefined ? undefined : 'upper'}
    style={
      seam === undefined
        ? undefined
        : ({ '--table-seam': String(seam) } as CSSProperties)
    }
  >
    {children}
  </div>
);
