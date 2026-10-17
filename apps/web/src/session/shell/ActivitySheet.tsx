import { BroomIcon } from '@phosphor-icons/react/dist/csr/Broom';
import { ChatCircleTextIcon } from '@phosphor-icons/react/dist/csr/ChatCircleText';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { RailButton } from '../../board/rail/TableRail.js';
import type { ActivityFeedItem } from '../../presentation/ActivityFeedModel.js';
import {
  LegacyPresentationSurface,
  legacyActivityClassName,
  type LegacyActivityPerspective,
} from '../../presentation/LegacyPresentationSurface.js';
import type { LegacyGamePresentationRuntime } from '../../presentation/LegacyGamePresentationRuntime.js';
import { ActionMenu, type ActionMenuEntry } from '../../ui/ActionMenu.js';
import { OVERLAY_SURFACE_ATTRIBUTE } from '../../ui/overlay-surface.js';
import { Sheet } from '../../ui/Sheet.js';
import { Tooltip } from '../../ui/Tooltip.js';
import { useDockSlide, type DockSlide } from './dock-slide.js';
import {
  ChatComposer,
  type LiveRoomControls,
} from '../RemoteRoomLiveControls.js';
import './activity.css';

type ActivityRuntime = Pick<
  LegacyGamePresentationRuntime,
  'activityFeed' | 'liveRegion'
>;

export interface ActivityPanelProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Beside the table rather than over it: a wide screen keeps the log open
   * while play goes on, as the old sidebar did, and the table makes room.
   */
  readonly docked: boolean;
  /** Carries the docked log in and out (useActivityDocking). */
  readonly slide?: DockSlide;
  readonly presentation: ActivityRuntime;
  readonly perspective?: LegacyActivityPerspective;
  readonly feedId: 'chatbox' | 'p2Chatbox';
  /** Where the room stands: "Solo table", "Room ABC123". */
  readonly status?: ReactNode;
  /** Beside the title: copy an invitation. */
  readonly headerActions?: ReactNode;
  /** The chat field; absent in replay. */
  readonly controls?: LiveRoomControls;
  /** Save the log as text. */
  readonly onExportLog?: () => void;
  /** Empty the log on this screen. */
  readonly onClearLog?: () => void;
}

/** The log's own actions, behind a button beside its title. */
const LogMenu = ({
  onExportLog,
  onClearLog,
}: Pick<ActivityPanelProps, 'onExportLog' | 'onClearLog'>) => {
  const entries: ActionMenuEntry[] = [];
  if (onExportLog) {
    entries.push({
      id: 'exportLog',
      label: 'Download battle log',
      icon: DownloadSimpleIcon,
      onSelect: onExportLog,
    });
  }
  if (onClearLog) {
    entries.push({
      id: 'clearLog',
      label: 'Clear battle log',
      icon: BroomIcon,
      onSelect: onClearLog,
    });
  }
  if (entries.length === 0) return null;
  return (
    <ActionMenu
      label="Battle log"
      side="bottom"
      align="end"
      entries={entries}
      tooltip="Battle log options"
      tooltipSide="bottom"
      trigger={
        <button
          id="activityLogMenuButton"
          type="button"
          className="ds-icon-button"
          aria-label="Battle log options"
        >
          <DotsThreeIcon aria-hidden="true" weight="bold" />
        </button>
      }
    />
  );
};

const ActivityBody = ({
  presentation,
  perspective,
  feedId,
  controls,
}: Pick<
  ActivityPanelProps,
  'presentation' | 'perspective' | 'feedId' | 'controls'
>) => (
  <div className="ptcgsim-activity-content">
    <LegacyPresentationSurface
      runtime={presentation}
      {...(perspective ? { perspective } : {})}
      feedId={feedId}
      announcer={false}
    />
    {controls ? <ChatComposer controls={controls} /> : null}
  </div>
);

/** The log in its column beside the table, sliding in and out. */
const ActivityDock = ({
  slide,
  children,
}: {
  readonly slide: DockSlide | undefined;
  readonly children: ReactNode;
}) => {
  const ref = useRef<HTMLElement>(null);
  useDockSlide(ref, slide);
  return (
    <aside
      ref={ref}
      id="activitySheet"
      className="ptcgsim-activity-dock"
      aria-labelledby="activityDockTitle"
      {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'panel' }}
    >
      {children}
    </aside>
  );
};

/**
 * The battle log and chat (ADR-030). Docked beside the table on a wide
 * screen, so play goes on with it open; over the table on a smaller one,
 * and from the bottom on a phone. Its feed keeps v1's ids (`#chatbox`,
 * `#p2Chatbox`).
 */
export const ActivityPanel = ({
  open,
  onOpenChange,
  docked,
  slide,
  status,
  headerActions: extraActions,
  onExportLog,
  onClearLog,
  ...body
}: ActivityPanelProps) => {
  const headerActions = (
    <>
      {extraActions}
      <LogMenu
        {...(onExportLog ? { onExportLog } : {})}
        {...(onClearLog ? { onClearLog } : {})}
      />
    </>
  );
  if (docked) {
    return open ? (
      <ActivityDock slide={slide}>
        <header className="ptcgsim-sheet__header">
          <div className="ptcgsim-sheet__heading">
            <h2 id="activityDockTitle" className="ptcgsim-sheet__title">
              Activity
            </h2>
            {status ? (
              <p className="ptcgsim-sheet__description">{status}</p>
            ) : null}
          </div>
          <div className="ptcgsim-sheet__actions">{headerActions}</div>
          <Tooltip content="Close activity" side="bottom">
            <button
              type="button"
              className="ptcgsim-sheet__close"
              aria-label="Close activity"
              onClick={() => onOpenChange(false)}
            >
              <XIcon aria-hidden="true" />
            </button>
          </Tooltip>
        </header>
        <div className="ptcgsim-activity-dock__body">
          <ActivityBody {...body} />
        </div>
      </ActivityDock>
    ) : null;
  }
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Activity"
      {...(status ? { description: status } : {})}
      headerActions={headerActions}
      placement="side"
      modal={false}
      size="sm"
      id="activitySheet"
      className="ptcgsim-activity-sheet"
    >
      <ActivityBody {...body} />
    </Sheet>
  );
};

/** How long a new line stays over the table. */
const TICKER_LINE_MS = 5_000;
const TICKER_LINES = 3;

/**
 * What the player would not otherwise know: what the other side does and
 * says, and the room's announcements. A player's own moves are already in
 * front of them.
 */
const newsToPlayer = (
  item: ActivityFeedItem,
  ownSeat: string | undefined,
  solo: boolean
): boolean => {
  if (item.category === 'announcement') return true;
  if (solo) return false;
  return item.playerId === undefined || item.playerId !== ownSeat;
};

/**
 * Attack and Pass change nothing on the table (v1 only wrote them in its
 * always-open log), so the line is the button's only answer: it is said
 * over the table even when it is the player's own.
 */
const DECLARATIONS: ReadonlySet<ActivityFeedItem['eventType']> = new Set([
  'AttackDeclared',
  'PassDeclared',
]);

/** What is worth a word over the table while the log is closed. */
const worthTicking = (
  item: ActivityFeedItem,
  ownSeat: string | undefined,
  solo: boolean
): boolean =>
  newsToPlayer(item, ownSeat, solo) || DECLARATIONS.has(item.eventType);

/**
 * What counts toward the unread badge: what the player would not otherwise
 * know, and who came and went.
 */
const worthCounting = (
  item: ActivityFeedItem,
  ownSeat: string | undefined,
  solo: boolean
): boolean =>
  item.eventType === 'Presence' || newsToPlayer(item, ownSeat, solo);

/**
 * The rail's Activity button: a count of what others did and said since
 * the log was last open, and, while it is closed, their newest lines over
 * the table for a few seconds.
 */
export const ActivityLauncher = ({
  presentation,
  perspective,
  open,
  onToggle,
  ownSeat,
  solo,
}: {
  readonly presentation: Pick<LegacyGamePresentationRuntime, 'activityFeed'>;
  readonly perspective?: LegacyActivityPerspective;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly ownSeat: string | undefined;
  readonly solo: boolean;
}) => {
  const feed = useSyncExternalStore(
    presentation.activityFeed.subscribe,
    presentation.activityFeed.getSnapshot
  );
  // Everything already in the log when the table appears counts as read,
  // and everything up to the newest line whenever the log is open.
  const [seenThrough, setSeenThrough] = useState(feed.newestItemId ?? -1);
  useEffect(() => {
    if (open) setSeenThrough(feed.newestItemId ?? -1);
  }, [open, feed.newestItemId]);
  const tickedThrough = useRef(feed.newestItemId ?? -1);
  const unread = open
    ? 0
    : feed.items.filter(
        (item) => item.id > seenThrough && worthCounting(item, ownSeat, solo)
      ).length;

  const [ticker, setTicker] = useState<
    readonly { readonly item: ActivityFeedItem; readonly until: number }[]
  >([]);
  useEffect(() => {
    const fresh = feed.items.filter((item) => item.id > tickedThrough.current);
    tickedThrough.current = feed.newestItemId ?? tickedThrough.current;
    if (open || fresh.length === 0) return;
    const now = Date.now();
    const shown = fresh
      .filter((item) => worthTicking(item, ownSeat, solo))
      .map((item) => ({ item, until: now + TICKER_LINE_MS }));
    if (shown.length === 0) return;
    setTicker((current) => [...current, ...shown].slice(-TICKER_LINES));
  }, [feed, open, ownSeat, solo]);
  useEffect(() => {
    if (open) setTicker([]);
  }, [open]);
  useEffect(() => {
    const first = ticker[0];
    if (!first) return;
    const timer = setTimeout(
      () =>
        setTicker((current) =>
          current.filter((line) => line.until > Date.now())
        ),
      Math.max(0, first.until - Date.now())
    );
    return () => clearTimeout(timer);
  }, [ticker]);

  return (
    <div className="ptcgsim-activity-launcher">
      {ticker.length > 0 ? (
        // The live region already reads these out; this is for the eyes.
        <ol className="ptcgsim-activity-ticker" aria-hidden="true">
          {ticker.map(({ item }) => (
            <li
              key={item.id}
              className={`ptcgsim-activity-ticker__line ${legacyActivityClassName(item, perspective)}`}
            >
              <span>{item.message}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {/* Beside the button: the newest lines rise above it. */}
      <Tooltip
        content={open ? 'Hide battle log and chat' : 'Battle log and chat'}
        side="left"
      >
        <RailButton
          id="activityButton"
          icon={ChatCircleTextIcon}
          label="Activity"
          iconOnly
          badge={unread}
          aria-expanded={open}
          aria-controls={open ? 'activitySheet' : undefined}
          onClick={onToggle}
        />
      </Tooltip>
    </div>
  );
};
