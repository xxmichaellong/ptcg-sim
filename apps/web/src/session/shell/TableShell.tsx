import { useLingui } from '@lingui/react/macro';
import { APP_BAR_INSET_PX, tableRailWidth } from '@ptcgsim/renderer-contract';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

import {
  roomBackgroundCssImage,
  type RoomBackground,
} from '../browser-room-background.js';
import { usePageDirection } from '../../i18n/direction.js';
import '../../design/panel-controls.css';
import type { DockSlide } from './dock-slide.js';
import { useAppBarReserve } from './AppMenu.js';
import { useExitGhost } from './exit-ghost.js';
import './table-shell.css';

/**
 * How far the docked log has come in, for what sits over the table and
 * keeps clear of it (TableCentre). Read where it is used: set on the page,
 * every frame of a slide restyled everything on it, the board included.
 */
const DockRevealContext = createContext<{
  readonly docked: boolean;
  readonly slide: DockSlide | undefined;
}>({ docked: false, slide: undefined });

/**
 * In a right-to-left language the log docks at the left (ADR-034), but the
 * table lays itself out as it always does, leaving the log's column at its
 * right. So the table moves over by that column, as far as the log has slid
 * in, and the room it leaves at the right is the log's at the left. A
 * transform, not a restyle: every frame of a slide moves it.
 */
const useTableBesideStartDock = (
  column: RefObject<HTMLElement | null>,
  direction: 'ltr' | 'rtl',
  docked: boolean,
  slide: DockSlide | undefined
): void => {
  useLayoutEffect(() => {
    const element = column.current;
    if (!element) return;
    if (direction !== 'rtl') {
      element.style.translate = '';
      return;
    }
    const paint = (): void => {
      const shown = slide ? slide.value() : docked ? 1 : 0;
      // The same width the table's layout leaves (layout-table.ts).
      const width = tableRailWidth(Math.max(1, window.innerWidth)) * shown;
      element.style.translate = width > 0 ? `${String(width)}px 0` : '';
    };
    paint();
    const unsubscribe = slide?.subscribe(paint);
    window.addEventListener('resize', paint);
    return () => {
      unsubscribe?.();
      window.removeEventListener('resize', paint);
      element.style.translate = '';
    };
  }, [column, direction, docked, slide]);
};

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
  dockSlide,
  board,
  children,
}: {
  readonly route: 'remote-room' | 'remote-room-lobby';
  readonly darkMode: boolean;
  readonly background?: RoomBackground;
  readonly sessionPhase?: string;
  /**
   * The activity log is docked beside the table: at the right, or at the
   * left in a right-to-left language.
   */
  readonly docked?: boolean;
  /** How far the docked log has slid in; what sits over the table follows. */
  readonly dockSlide?: DockSlide;
  readonly board: ReactNode;
  readonly children?: ReactNode;
}) => {
  const { t } = useLingui();
  const reveal = useMemo(
    () => ({ docked, slide: dockSlide }),
    [docked, dockSlide]
  );
  const column = useRef<HTMLElement>(null);
  useTableBesideStartDock(column, usePageDirection(), docked, dockSlide);
  return (
    <DockRevealContext.Provider value={reveal}>
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
          ref={column}
          className="board-column board-column--table"
          aria-label={t`Game board`}
          data-board-shell="table"
        >
          {board}
        </section>
        {children}
      </main>
    </DockRevealContext.Provider>
  );
};

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
/** The upper area ends this far above the seam (table-shell.css). */
const UPPER_AREA_SEAM_GAP_PX = 24;
/** Between the app bar and what the table centres below it. */
const CENTRE_BAR_GAP_PX = 8;

export const TableCentre = ({
  seam,
  children,
}: {
  readonly seam?: number;
  readonly children: ReactNode;
}) => {
  // Put away (a deck loaded, the card dismissed), it fades rather than
  // vanishing from under the pointer.
  const ref = useRef<HTMLDivElement>(null);
  useExitGhost(ref);
  // Clear of a docked log, as far as it has slid in.
  const { docked, slide } = useContext(DockRevealContext);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const paint = (): void => {
      element.style.setProperty(
        '--activity-reveal',
        String(slide ? slide.value() : docked ? 1 : 0)
      );
    };
    paint();
    return slide?.subscribe(paint);
  }, [docked, slide]);
  // Clear of the app bar where the two would meet (a phone, a narrow
  // window), and above the seam where it fits there; otherwise over the
  // whole table. The bar's corner is the one the table keeps for it.
  const bar = useAppBarReserve();
  const [placement, setPlacement] = useState<{
    readonly fitsAbove: boolean;
    readonly top?: number;
  }>({ fitsAbove: true });
  useLayoutEffect(() => {
    const element = ref.current;
    const child = element?.firstElementChild;
    if (!element || !(child instanceof HTMLElement)) return;
    const check = (): void => {
      const barRight = element.getBoundingClientRect().right - APP_BAR_INSET_PX;
      const card = child.getBoundingClientRect();
      const top =
        card.left < barRight && barRight - bar.width < card.right
          ? APP_BAR_INSET_PX + bar.height + CENTRE_BAR_GAP_PX
          : undefined;
      const padding = Number.parseFloat(
        getComputedStyle(element).paddingBottom
      );
      const room =
        seam === undefined
          ? Number.POSITIVE_INFINITY
          : window.innerHeight * seam -
            UPPER_AREA_SEAM_GAP_PX -
            (top ?? padding) -
            padding;
      const fitsAbove = child.offsetHeight <= room;
      setPlacement((current) =>
        current.fitsAbove === fitsAbove && current.top === top
          ? current
          : { fitsAbove, ...(top === undefined ? {} : { top }) }
      );
    };
    check();
    // The card's own size, and the layer's: it narrows beside a docked log,
    // which moves the bar with it.
    const observer = new ResizeObserver(check);
    observer.observe(child);
    observer.observe(element);
    window.addEventListener('resize', check);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [seam, bar]);
  return (
    <div
      ref={ref}
      className="ptcgsim-table-centre"
      data-area={
        seam === undefined || !placement.fitsAbove ? undefined : 'upper'
      }
      style={
        {
          ...(seam === undefined ? {} : { '--table-seam': String(seam) }),
          ...(placement.top === undefined ? {} : { paddingTop: placement.top }),
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
};
