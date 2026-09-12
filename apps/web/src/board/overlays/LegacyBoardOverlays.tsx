import type { ViewCardId } from '@ptcgsim/game-core';
import {
  isLegacyMarkerPresentation,
  layoutLegacyActiveQ0Markers,
  layoutLegacyBenchQ0Markers,
  legacyMarkerAppearance,
  legacyMarkerCssColor,
  type BoardScenePlayerFrame,
  type CardSceneNode,
  type MarkerSceneNode,
  type Rect,
  type ZoneSceneNode,
} from '@ptcgsim/renderer-contract';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type CSSProperties,
  type RefObject,
} from 'react';

import type {
  BoardPresentationDismissScope,
  BoardSessionControllerState,
  OpenedZoneCardIntent,
} from '../BoardSessionController.js';
import type {
  LegacyBoardCategoryChoice,
  LegacyBoardContextActionId,
  LegacyBoardMoveChoice,
  LegacyBoardZoneActionId,
} from '../resolveLegacyBoardOverlayAction.js';
import {
  LEGACY_BOARD_CATEGORY_CHOICES,
  LEGACY_BOARD_MOVE_CHOICES,
  parseLegacyDamageInput,
  parseLegacySpecialConditionInput,
} from '../resolveLegacyBoardOverlayAction.js';
import {
  parseLegacyCountInput,
  type LegacyBoardCountActionId,
  type LegacyBoardCountPrompt,
} from '../resolveLegacyBoardCountAction.js';
import type {
  LegacyBoardShortcutCountPrompt,
  LegacyOwnHandShortcutAction,
} from '../resolveLegacyBoardShortcutAction.js';
import './LegacyBoardOverlays.css';

export type {
  LegacyBoardCategoryChoice,
  LegacyBoardContextActionId,
  LegacyBoardMoveChoice,
  LegacyBoardZoneActionId,
} from '../resolveLegacyBoardOverlayAction.js';

export interface LegacyBoardOverlayActions {
  readonly emitOpenedZoneCardIntent: (intent: OpenedZoneCardIntent) => void;
  readonly dismiss: (scope: BoardPresentationDismissScope) => void;
  readonly invokeContextAction: (
    action: LegacyBoardContextActionId,
    cardId: ViewCardId
  ) => void;
  readonly invokeZoneAction: (
    action: LegacyBoardZoneActionId,
    zoneId: string
  ) => void;
  readonly submitDamageInput: (cardId: ViewCardId, value: string) => void;
  readonly submitSpecialConditionInput: (
    cardId: ViewCardId,
    value: string
  ) => void;
  readonly submitCountInput: (
    action: LegacyBoardCountActionId,
    cardId: ViewCardId,
    value: string
  ) => void;
  readonly submitShortcutCountInput: (
    action: LegacyOwnHandShortcutAction,
    value: string
  ) => void;
  readonly submitCategoryChoice: (
    cardId: ViewCardId,
    category: LegacyBoardCategoryChoice
  ) => void;
  readonly submitMoveChoice: (
    cardId: ViewCardId,
    destination: LegacyBoardMoveChoice
  ) => void;
}

type ContextEntry =
  | {
      readonly kind: 'header';
      readonly id: string;
      readonly label: string;
    }
  | {
      readonly kind: 'action';
      readonly id: string;
      readonly label: string;
      readonly action: LegacyBoardContextActionId;
      readonly boundary: boolean;
    };

const header = (id: string, label: string): ContextEntry => ({
  kind: 'header',
  id,
  label,
});

const action = (
  actionId: LegacyBoardContextActionId,
  label: string,
  boundary = false
): ContextEntry => ({
  kind: 'action',
  id: actionId,
  label,
  action: actionId,
  boundary,
});

const zoneForCard = (
  state: BoardSessionControllerState,
  card: CardSceneNode
): {
  readonly id: string;
  readonly kind: ZoneSceneNode['kind'];
  readonly playerId: ZoneSceneNode['playerId'];
} | null => {
  const direct = state.scene?.zones.find((zone) => zone.id === card.parentId);
  if (direct) {
    return { id: direct.id, kind: direct.kind, playerId: direct.playerId };
  }
  const stack = state.view?.stacks[card.parentId];
  return stack
    ? {
        id: stack.id,
        kind: stack.slot,
        playerId: stack.boardPlayerId,
      }
    : null;
};

/** Mirrors the legacy menu's source order without authorizing any mutation. */
export const selectLegacyContextEntries = (
  state: BoardSessionControllerState,
  card: CardSceneNode
): readonly ContextEntry[] => {
  if (state.view?.viewer.kind !== 'player') {
    return [];
  }
  const location = zoneForCard(state, card);
  if (!location) return [];
  const own = location.playerId === state.view.viewer.playerId;
  const opponent = location.playerId !== null && !own;
  if (!state.canSubmitCommands) {
    const permitsReplayDisclosure =
      state.sessionPhase === 'ready' &&
      state.source?.kind === 'replay' &&
      state.replayLocalDisplay?.disclosure.zoneIds.includes(location.id);
    if (!permitsReplayDisclosure) return [];
    if (location.kind === 'prizes') {
      return [
        header('prizes', 'Prizes'),
        action('revealPrizes', 'Reveal/hide prizes'),
        action('togglePrizes', 'Look/cover prizes'),
        action('revealCard', 'Reveal/hide card'),
      ];
    }
    if (location.kind === 'hand' && opponent) {
      return [
        header('hand', 'Hand'),
        action('toggleOpponentHand', 'Look/cover hand'),
        action('revealCard', 'Reveal/hide card'),
      ];
    }
    return [];
  }
  const entries: ContextEntry[] = [];

  if (
    location.kind === 'active' ||
    location.kind === 'bench' ||
    location.kind === 'stadium' ||
    location.kind === 'discard'
  ) {
    entries.push(action('toggleAbility', 'Toggle ability/effect'));
  }
  if (location.kind === 'active' || location.kind === 'bench') {
    entries.push(action('setDamage', 'Damage counter'));
  }
  if (location.kind === 'active') {
    entries.push(action('setSpecialCondition', 'Special condition'));
  }
  if (location.kind === 'prizes') {
    entries.push(header('prizes', 'Prizes'));
    if (own) entries.push(action('shufflePrizes', 'Shuffle prizes'));
    entries.push(
      action('revealPrizes', 'Reveal/hide prizes'),
      action('togglePrizes', 'Look/cover prizes')
    );
    if (own) {
      entries.push(
        action('shufflePrizesToDeckBottom', 'Shuffle to deck (bottom)')
      );
    }
  }
  if (location.kind === 'hand') {
    entries.push(header('hand', 'Hand'));
    if (own) {
      entries.push(
        action('discardHand', 'Discard hand'),
        action('shuffleHandToDeck', 'Shuffle hand to deck'),
        action('shuffleHandToDeckBottom', 'Shuffle hand to bottom')
      );
    } else if (opponent) {
      entries.push(
        action('toggleOpponentHand', 'Look/cover hand'),
        action('randomOpponentHandCard', 'Pick random card')
      );
    }
  }
  if (location.kind === 'deck') {
    entries.push(header('deck', 'Deck'), action('shuffleDeck', 'Shuffle deck'));
    if (own) entries.push(action('drawCards', 'Draw card(s)'));
    entries.push(
      action('viewDeckTop', 'View top card(s)'),
      action('viewDeckBottom', 'View bottom card(s)')
    );
  }
  if (location.kind === 'board') {
    entries.push(
      header('board', 'Playboard'),
      action('discardBoard', 'Discard all'),
      action('moveBoardToHand', 'Move all to hand'),
      action('shuffleBoardToDeck', 'Shuffle all to deck'),
      action('moveBoardToLostZone', 'Lost Zone all')
    );
  }

  entries.push(
    action('moveCard', 'Move card...', true),
    action('revealCard', 'Reveal/hide card')
  );
  if (location.kind === 'active' || location.kind === 'bench') {
    entries.push(action('changeCardType', 'Change type...'));
  }
  return entries;
};

const useFocusBoundary = (
  container: RefObject<HTMLElement | null>,
  focusSelector: string,
  identity: string
): void => {
  const opener = useRef<HTMLElement | null>(null);
  const focusCycle = useRef(0);
  useLayoutEffect(() => {
    const cycle = focusCycle.current + 1;
    focusCycle.current = cycle;
    const element = container.current;
    if (!element) return;
    const active = element.ownerDocument.activeElement;
    // Keep the external opener captured by the first setup. React StrictMode
    // immediately replays layout effects while focus is already inside the
    // overlay; replacing the opener in that replay would leave us trying to
    // restore focus to a button that disappears with the overlay.
    if (active instanceof HTMLElement && !element.contains(active)) {
      opener.current = active;
    }
    const first = element.querySelector<HTMLElement>(focusSelector) ?? element;
    first.focus();
    return () => {
      const previous = opener.current;
      const current = element.ownerDocument.activeElement;
      if (!previous?.isConnected || !element.contains(current)) return;
      queueMicrotask(() => {
        // React StrictMode replays layout effects without unmounting the DOM.
        // A replacement setup cancels the first cleanup's queued restoration;
        // a genuine overlay removal has no replacement cycle and still returns
        // focus to the opener.
        const activeNow = element.ownerDocument.activeElement;
        const replacementClaimedFocus =
          activeNow instanceof HTMLElement &&
          activeNow !== element.ownerDocument.body &&
          activeNow !== current &&
          !element.contains(activeNow);
        if (
          focusCycle.current === cycle &&
          previous.isConnected &&
          !replacementClaimedFocus
        ) {
          previous.focus();
        }
      });
    };
  }, [container, focusSelector, identity]);
};

const useOutsideDismiss = (
  container: RefObject<HTMLElement | null>,
  dismiss: () => void,
  ignoreClosest?: string
): void => {
  useEffect(() => {
    const element = container.current;
    const document = element?.ownerDocument;
    if (!element || !document) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (element.contains(target as Node)) return;
      if (
        ignoreClosest &&
        target instanceof Element &&
        target.closest(ignoreClosest)
      ) {
        return;
      }
      dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, [container, dismiss, ignoreClosest]);
};

const trapModalTab = (
  event: ReactKeyboardEvent<HTMLElement>,
  container: HTMLElement,
  selector: string
): void => {
  if (event.key !== 'Tab') return;
  const items = [...container.querySelectorAll<HTMLElement>(selector)];
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const active = container.ownerDocument.activeElement;
  if (event.shiftKey && (active === items[0] || active === container)) {
    event.preventDefault();
    items.at(-1)?.focus();
  } else if (!event.shiftKey && active === items.at(-1)) {
    event.preventDefault();
    items[0]?.focus();
  }
};

const moveMenuFocus = (
  event: ReactKeyboardEvent<HTMLElement>,
  direction: 'first' | 'last' | 'next' | 'previous',
  selector = ':scope > ul > li > [role="menuitem"]'
): void => {
  const menu = event.currentTarget;
  const items = [...menu.querySelectorAll<HTMLElement>(selector)];
  if (items.length === 0) return;
  const current = items.indexOf(
    menu.ownerDocument.activeElement as HTMLElement
  );
  const index =
    direction === 'first'
      ? 0
      : direction === 'last'
        ? items.length - 1
        : direction === 'next'
          ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
  items[index]?.focus();
  event.preventDefault();
};

interface ContextSubmenuChoice<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

const CATEGORY_SUBMENU_CHOICES: readonly ContextSubmenuChoice<LegacyBoardCategoryChoice>[] =
  LEGACY_BOARD_CATEGORY_CHOICES.map((category) => ({
    value: category,
    label: category === 'Trainer' ? 'to Tool' : `to ${category}`,
  }));

const MOVE_CHOICE_LABELS = {
  board: 'to Board',
  deckTop: 'to Deck (top)',
  deckBottom: 'to Deck (bottom)',
  deckSwitch: 'to Deck (switch)',
  deckShuffle: 'to Deck (shuffle)',
} as const satisfies Readonly<Record<LegacyBoardMoveChoice, string>>;

const MOVE_SUBMENU_CHOICES: readonly ContextSubmenuChoice<LegacyBoardMoveChoice>[] =
  LEGACY_BOARD_MOVE_CHOICES.map((destination) => ({
    value: destination,
    label: MOVE_CHOICE_LABELS[destination],
  }));

const ContextSubmenu = <Value extends string>({
  entry,
  open,
  ariaLabel,
  choiceKind,
  choices,
  onOpenChange,
  onSelect,
}: {
  readonly entry: Extract<ContextEntry, { readonly kind: 'action' }>;
  readonly open: boolean;
  readonly ariaLabel: string;
  readonly choiceKind: 'category' | 'move';
  readonly choices: readonly ContextSubmenuChoice<Value>[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (value: Value) => void;
}) => {
  const trigger = useRef<HTMLButtonElement>(null);
  const submenu = useRef<HTMLUListElement>(null);
  return (
    <li
      className={`has-submenu${entry.boundary ? ' is-boundary' : ''}`}
      data-submenu-open={open ? 'true' : undefined}
      role="none"
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={(event) => {
        if (
          event.currentTarget.contains(
            event.currentTarget.ownerDocument.activeElement
          )
        ) {
          return;
        }
        onOpenChange(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onOpenChange(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        data-context-action={entry.action}
        onClick={() => onOpenChange(true)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight') return;
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(true);
          queueMicrotask(() => {
            submenu.current
              ?.querySelector<HTMLElement>('[role="menuitem"]')
              ?.focus();
          });
        }}
      >
        {entry.label}
      </button>
      <ul
        ref={submenu}
        className="ptcgsim-legacy-card-sub-menu"
        data-context-submenu={entry.action}
        role="menu"
        aria-label={ariaLabel}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            onOpenChange(false);
            trigger.current?.focus();
          } else if (event.key === 'ArrowDown') {
            event.stopPropagation();
            moveMenuFocus(event, 'next', ':scope > li > [role="menuitem"]');
          } else if (event.key === 'ArrowUp') {
            event.stopPropagation();
            moveMenuFocus(event, 'previous', ':scope > li > [role="menuitem"]');
          } else if (event.key === 'Home') {
            event.stopPropagation();
            moveMenuFocus(event, 'first', ':scope > li > [role="menuitem"]');
          } else if (event.key === 'End') {
            event.stopPropagation();
            moveMenuFocus(event, 'last', ':scope > li > [role="menuitem"]');
          }
        }}
      >
        {choices.map((choice) => (
          <li key={choice.value} role="none">
            <button
              type="button"
              role="menuitem"
              data-category-choice={
                choiceKind === 'category' ? choice.value : undefined
              }
              data-move-choice={
                choiceKind === 'move' ? choice.value : undefined
              }
              onClick={() => onSelect(choice.value)}
            >
              {choice.label}
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
};

const visualCardBounds = (card: CardSceneNode) => {
  if (card.rotationQuarterTurns % 2 === 0) return card.bounds;
  const centerX = card.bounds.x + card.bounds.width / 2;
  const centerY = card.bounds.y + card.bounds.height / 2;
  return {
    x: centerX - card.bounds.height / 2,
    y: centerY - card.bounds.width / 2,
    width: card.bounds.height,
    height: card.bounds.width,
  };
};

const ContextMenu = ({
  state,
  card,
  anchorBounds,
  darkMode,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly card: CardSceneNode;
  readonly anchorBounds?: Rect;
  readonly darkMode: boolean;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<
    'changeCardType' | 'moveCard' | null
  >(null);
  const dismiss = useCallback(() => actions.dismiss('context'), [actions]);
  const entries = useMemo(
    () => selectLegacyContextEntries(state, card),
    [card, state]
  );
  useFocusBoundary(container, '[role="menuitem"]', String(card.id));
  useOutsideDismiss(container, dismiss);
  useEffect(() => setOpenSubmenu(null), [card.id]);
  const bounds = anchorBounds ?? visualCardBounds(card);
  const width = 180;
  const preferredLeft = Math.max(
    0,
    Math.min(bounds.x + bounds.width, state.scene!.viewport.width - width)
  );
  const [position, setPosition] = useState({
    left: preferredLeft,
    top: Math.max(0, Math.min(bounds.y, state.scene!.viewport.height)),
  });
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measuredHeight = element.getBoundingClientRect().height;
    const next = {
      left: preferredLeft,
      top: Math.max(
        0,
        Math.min(bounds.y, state.scene!.viewport.height - measuredHeight)
      ),
    };
    setPosition((current) =>
      current.left === next.left && current.top === next.top ? current : next
    );
  }, [bounds.y, card.id, entries.length, preferredLeft, state.scene]);

  return (
    <div
      ref={container}
      className={`ptcgsim-legacy-card-context-menu${darkMode ? ' is-dark' : ''}`}
      data-legacy-card-context-menu="true"
      data-context-card-id={card.id}
      role="menu"
      aria-label={`Actions for ${card.label}`}
      tabIndex={-1}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dismiss();
        } else if (event.key === 'ArrowDown') {
          moveMenuFocus(event, 'next');
        } else if (event.key === 'ArrowUp') {
          moveMenuFocus(event, 'previous');
        } else if (event.key === 'Home') {
          moveMenuFocus(event, 'first');
        } else if (event.key === 'End') {
          moveMenuFocus(event, 'last');
        }
      }}
    >
      <ul>
        {entries.length === 0 ? (
          <li className="ptcgsim-legacy-context-empty" role="none">
            No actions available
          </li>
        ) : (
          entries.map((entry) =>
            entry.kind === 'header' ? (
              <li
                key={entry.id}
                className="ptcgsim-legacy-context-header"
                role="presentation"
              >
                {entry.label}
              </li>
            ) : entry.action === 'moveCard' ? (
              <ContextSubmenu
                key={entry.id}
                entry={entry}
                open={openSubmenu === 'moveCard'}
                ariaLabel="Move card"
                choiceKind="move"
                choices={MOVE_SUBMENU_CHOICES}
                onOpenChange={(open) =>
                  setOpenSubmenu(open ? 'moveCard' : null)
                }
                onSelect={(destination) => {
                  actions.submitMoveChoice(card.id, destination);
                  dismiss();
                }}
              />
            ) : entry.action === 'changeCardType' ? (
              <ContextSubmenu
                key={entry.id}
                entry={entry}
                open={openSubmenu === 'changeCardType'}
                ariaLabel="Change card type"
                choiceKind="category"
                choices={CATEGORY_SUBMENU_CHOICES}
                onOpenChange={(open) =>
                  setOpenSubmenu(open ? 'changeCardType' : null)
                }
                onSelect={(category) => {
                  actions.submitCategoryChoice(card.id, category);
                  dismiss();
                }}
              />
            ) : (
              <li
                key={entry.id}
                className={entry.boundary ? 'is-boundary' : undefined}
                role="none"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-context-action={entry.action}
                  onClick={() => {
                    actions.invokeContextAction(entry.action, card.id);
                    dismiss();
                  }}
                >
                  {entry.label}
                </button>
              </li>
            )
          )
        )}
      </ul>
    </div>
  );
};

const STACK_PREVIEW_WIDTH_RATIO = 0.69;
const STACK_PREVIEW_HEIGHT_RATIO = 0.7;
const ZONE_BROWSER_WIDTH_RATIO = 0.85;
const ZONE_BROWSER_HEIGHT_RATIO = 0.75;
const ZONE_BROWSER_VERTICAL_PADDING_AND_BORDER_PX = 22;

export const legacyStackPreviewFrameStyle = (
  frame: BoardScenePlayerFrame,
  side: CardSceneNode['side']
): CSSProperties => ({
  left: frame.bounds.x + frame.bounds.width / 2,
  top: frame.bounds.y + frame.bounds.height / 2,
  width: frame.bounds.width * STACK_PREVIEW_WIDTH_RATIO,
  height: frame.bounds.height * STACK_PREVIEW_HEIGHT_RATIO,
  transform: `translate(-50%, -50%)${side === 'opponent' ? ' rotate(180deg)' : ''}`,
});

export const legacyZoneBrowserFrameStyle = (
  frame: BoardScenePlayerFrame,
  side: ZoneSceneNode['side']
): CSSProperties => {
  const contentHeight = frame.bounds.height * ZONE_BROWSER_HEIGHT_RATIO;
  return {
    left: frame.bounds.x + frame.bounds.width / 2,
    top:
      side === 'opponent'
        ? frame.bounds.y +
          frame.bounds.height -
          contentHeight -
          ZONE_BROWSER_VERTICAL_PADDING_AND_BORDER_PX
        : frame.bounds.y + frame.bounds.height / 2,
    width: frame.bounds.width * ZONE_BROWSER_WIDTH_RATIO,
    height: contentHeight,
    transform:
      side === 'opponent' ? 'translateX(-50%)' : 'translate(-50%, -50%)',
  };
};

const Preview = ({
  cards,
  kind,
  frame,
  actions,
}: {
  readonly cards: readonly CardSceneNode[];
  readonly kind: 'card' | 'stack';
  readonly frame?: BoardScenePlayerFrame;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const dismiss = useCallback(() => actions.dismiss('preview'), [actions]);
  const identity = cards.map((card) => card.id).join(':');
  useFocusBoundary(container, '[data-preview-focus]', identity);
  useOutsideDismiss(container, dismiss);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (kind === 'stack' && container.current) {
      trapModalTab(event, container.current, '[data-preview-tabbable]');
    }
    if (
      event.key === 'Escape' ||
      (!event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'v')
    ) {
      event.preventDefault();
      dismiss();
    }
  };

  return kind === 'card' ? (
    <div
      ref={container}
      className="ptcgsim-legacy-card-preview"
      data-legacy-card-preview="true"
      data-preview-kind="card"
      role="dialog"
      aria-modal="true"
      aria-label={cards[0]?.label ?? 'Card preview'}
      tabIndex={-1}
      data-preview-focus="true"
      onClick={dismiss}
      onKeyDown={onKeyDown}
    >
      {cards[0] ? (
        <img
          src={cards[0].imageUrl}
          alt={cards[0].label}
          data-overlay-card-id={cards[0].id}
          draggable={false}
        />
      ) : null}
    </div>
  ) : (
    <div
      ref={container}
      className="ptcgsim-legacy-stack-preview"
      data-legacy-card-preview="true"
      data-preview-kind="stack"
      role="dialog"
      aria-modal="true"
      aria-label="Card stack preview"
      data-overlay-side={cards[0]?.side}
      tabIndex={-1}
      data-preview-focus="true"
      style={
        frame && cards[0]
          ? legacyStackPreviewFrameStyle(frame, cards[0].side)
          : undefined
      }
      onKeyDown={onKeyDown}
    >
      {cards.map((card) => (
        <img
          key={card.id}
          src={card.imageUrl}
          alt={card.label}
          data-overlay-card-id={card.id}
          draggable={false}
        />
      ))}
    </div>
  );
};

const zoneAction = (
  zone: ZoneSceneNode
): { readonly id: LegacyBoardZoneActionId; readonly label: string } | null =>
  zone.kind === 'deck'
    ? { id: 'shuffleDeck', label: 'Shuffle' }
    : zone.kind === 'discard'
      ? { id: 'shuffleDiscardToDeck', label: 'Shuffle all to Deck' }
      : null;

/**
 * Produces a paint-only ordering from data already disclosed in the scene.
 * Equal labels retain authoritative scene order, which keeps concealed and
 * duplicate cards stable without consulting opaque IDs or hidden definitions.
 */
export const sortRecipientSafeZoneCards = (
  cards: readonly CardSceneNode[]
): readonly CardSceneNode[] =>
  cards
    .map((card, index) => ({ card, index }))
    .sort((left, right) => {
      if (left.card.label < right.card.label) return -1;
      if (left.card.label > right.card.label) return 1;
      return left.index - right.index;
    })
    .map(({ card }) => card);

const ZoneBrowser = ({
  state,
  zone,
  cards,
  frame,
  captureContextAnchor,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly zone: ZoneSceneNode;
  readonly cards: readonly CardSceneNode[];
  readonly frame?: BoardScenePlayerFrame;
  readonly captureContextAnchor: (
    cardId: ViewCardId,
    zoneId: string,
    bounds: Rect
  ) => void;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  const container = useRef<HTMLElement>(null);
  const [sortEnabled, setSortEnabled] = useState(false);
  const dismiss = useCallback(() => actions.dismiss('zone'), [actions]);
  useFocusBoundary(container, '[data-zone-close]', zone.id);
  useOutsideDismiss(container, dismiss, '[data-legacy-card-preview]');
  const primary = zoneAction(zone);
  const renderedCards = useMemo(
    () => (sortEnabled ? sortRecipientSafeZoneCards(cards) : cards),
    [cards, sortEnabled]
  );

  return (
    <section
      ref={container}
      className="ptcgsim-legacy-zone-browser"
      data-legacy-zone-browser="true"
      data-zone-browser-id={zone.id}
      role="dialog"
      aria-modal="true"
      aria-label={`${zone.label}, ${zone.count} cards`}
      data-overlay-side={zone.side}
      tabIndex={-1}
      style={frame ? legacyZoneBrowserFrameStyle(frame, zone.side) : undefined}
      onKeyDown={(event) => {
        if (container.current) {
          trapModalTab(
            event,
            container.current,
            'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
          );
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      <div className="ptcgsim-legacy-zone-toolbar">
        {primary ? (
          <button
            type="button"
            className="ptcgsim-legacy-zone-button"
            data-zone-action={primary.id}
            onClick={() => actions.invokeZoneAction(primary.id, zone.id)}
          >
            {primary.label}
          </button>
        ) : null}
        <button
          type="button"
          className="ptcgsim-legacy-zone-button"
          data-zone-close="true"
          onClick={dismiss}
        >
          Close
        </button>
        <label>
          <input
            type="checkbox"
            data-zone-action="sortZone"
            checked={sortEnabled}
            onChange={(event) => setSortEnabled(event.currentTarget.checked)}
          />{' '}
          Sort
        </label>
      </div>
      <div className="ptcgsim-legacy-zone-cards">
        {renderedCards.map((card) => (
          <button
            type="button"
            key={card.id}
            data-overlay-card-id={card.id}
            aria-label={card.label}
            aria-pressed={state.presentation.selectedCardId === card.id}
            onClick={() =>
              actions.emitOpenedZoneCardIntent({
                kind: 'CardSelected',
                cardId: card.id,
              })
            }
            onDoubleClick={() =>
              actions.emitOpenedZoneCardIntent({
                kind: 'CardPreviewRequested',
                cardId: card.id,
              })
            }
            onContextMenu={(event) => {
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              captureContextAnchor(card.id, zone.id, {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
              });
              actions.emitOpenedZoneCardIntent({
                kind: 'CardContextRequested',
                cardId: card.id,
              });
            }}
          >
            <img src={card.imageUrl} alt="" draggable={false} />
          </button>
        ))}
      </div>
    </section>
  );
};

const markerEditorMarker = (
  state: BoardSessionControllerState
): MarkerSceneNode | null => {
  const input = state.overlays.input;
  const scene = state.scene;
  const view = state.view;
  if (
    !input ||
    input.kind === 'count' ||
    input.kind === 'shortcutCount' ||
    !scene ||
    !view
  ) {
    return null;
  }
  const selected = scene.cards.find((card) => card.id === input.cardId);
  const stack = selected ? view.stacks[selected.parentId] : undefined;
  const topCardId = stack?.evolutionCards.at(-1)?.id;
  const topCard = topCardId
    ? scene.cards.find((card) => card.id === topCardId)
    : undefined;
  if (!stack || !topCard || topCard.side === 'shared') return null;
  const existing = scene.markers.find(
    (marker) => marker.parentCardId === topCard.id && marker.kind === input.kind
  );
  if (existing) return existing;
  const sibling = scene.markers.find(
    (marker) =>
      marker.parentCardId === topCard.id &&
      isLegacyMarkerPresentation(marker.presentation)
  );
  const presentation = sibling?.presentation ?? 'generic';
  const characterizedBounds =
    presentation === 'legacyActiveQ0'
      ? layoutLegacyActiveQ0Markers(topCard.bounds, topCard.side)[input.kind]
          .bounds
      : presentation === 'legacyBenchQ0' && input.kind === 'damage'
        ? layoutLegacyBenchQ0Markers(topCard.bounds, topCard.side).damage.bounds
        : null;
  const size = Math.max(
    14,
    Math.min(topCard.bounds.width, topCard.bounds.height) * 0.22
  );
  return {
    id: `${topCard.id}:${input.kind}-editor`,
    parentCardId: topCard.id,
    side: topCard.side,
    kind: input.kind,
    presentation,
    value: input.initialValue,
    bounds: characterizedBounds ?? {
      x:
        input.kind === 'specialCondition'
          ? topCard.bounds.x
          : topCard.bounds.x + topCard.bounds.width - size,
      y: topCard.bounds.y,
      width: size,
      height: size,
    },
    zIndex:
      sibling?.zIndex ??
      topCard.zIndex + (characterizedBounds === null ? 100 : 1),
    label: `${input.kind}: ${input.initialValue}`,
  };
};

const MarkerEditor = ({
  state,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  const input = state.overlays.input;
  const marker = markerEditorMarker(state);
  const editor = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const [invalid, setInvalid] = useState(false);
  const [draft, setDraft] = useState(input?.initialValue ?? '');
  const [edited, setEdited] = useState(false);
  useLayoutEffect(() => {
    if (
      editor.current &&
      input &&
      input.kind !== 'count' &&
      input.kind !== 'shortcutCount'
    ) {
      editor.current.textContent = input.initialValue;
    }
  }, [input]);
  if (
    !input ||
    input.kind === 'count' ||
    input.kind === 'shortcutCount' ||
    !marker
  ) {
    return null;
  }
  const legacy = isLegacyMarkerPresentation(marker.presentation);
  const markerWasPresent = state.scene?.markers.some(
    (candidate) =>
      candidate.parentCardId === marker.parentCardId &&
      candidate.kind === input.kind
  );
  const appearance =
    legacy ||
    (input.kind === 'specialCondition' && (edited || !markerWasPresent))
      ? legacyMarkerAppearance({ ...marker, value: draft })
      : null;
  const submit = (element: HTMLDivElement): void => {
    if (cancelled.current) return;
    const value = element.textContent ?? '';
    if (value === input.initialValue) {
      actions.dismiss('input');
      return;
    }
    const parsed =
      input.kind === 'damage'
        ? parseLegacyDamageInput(value)
        : parseLegacySpecialConditionInput(value);
    if (parsed === undefined) {
      setInvalid(true);
      element.focus();
      return;
    }
    if (input.kind === 'damage') {
      actions.submitDamageInput(input.cardId, value);
    } else {
      actions.submitSpecialConditionInput(input.cardId, value);
    }
  };

  return (
    <div
      ref={editor}
      className="ptcgsim-legacy-marker-editor"
      data-legacy-marker-editor={input.kind}
      data-marker-card-id={input.cardId}
      role="textbox"
      aria-label={
        input.kind === 'damage' ? 'Damage counter' : 'Special condition'
      }
      aria-invalid={invalid}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      inputMode={input.kind === 'damage' ? 'numeric' : 'text'}
      onInput={(event) => {
        setDraft(event.currentTarget.textContent ?? '');
        setEdited(true);
        setInvalid(false);
      }}
      onBlur={(event) => submit(event.currentTarget)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelled.current = true;
          actions.dismiss('input');
        }
      }}
      style={{
        position: 'absolute',
        left: marker.bounds.x,
        top: marker.bounds.y,
        width: marker.bounds.width,
        height: marker.bounds.height,
        zIndex: marker.zIndex,
        display: legacy ? 'block' : 'grid',
        placeItems: legacy ? undefined : 'center',
        overflow: 'hidden',
        borderRadius: appearance?.shape === 'tab' ? '10%' : '50%',
        background: appearance
          ? legacyMarkerCssColor(appearance.fill)
          : input.kind === 'damage'
            ? '#e64242'
            : '#efefef',
        color: appearance
          ? legacyMarkerCssColor(appearance.text)
          : input.kind === 'damage'
            ? '#fff'
            : '#111',
        fontSize:
          appearance?.fontSizePx ?? Math.max(10, marker.bounds.height * 0.42),
        fontWeight: legacy ? undefined : 700,
        lineHeight: legacy ? `${marker.bounds.width}px` : undefined,
        textAlign: 'center',
        pointerEvents: 'auto',
        outline: invalid ? '2px solid #fff' : 'none',
      }}
    />
  );
};

// The object identity survives React's development StrictMode effect probe, so
// one controller prompt can never produce two native modal dialogs.
type LegacyBoardCountInput =
  LegacyBoardCountPrompt | LegacyBoardShortcutCountPrompt;

const promptedCountInputs = new WeakSet<LegacyBoardCountInput>();

const CountPrompt = ({
  input,
  actions,
}: {
  readonly input: LegacyBoardCountInput;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  useEffect(() => {
    if (promptedCountInputs.has(input)) return;
    promptedCountInputs.add(input);
    const value = window.prompt(input.message, input.initialValue);
    if (value === null) {
      if (input.kind === 'shortcutCount') {
        window.alert(input.invalidMessage);
      }
      actions.dismiss('input');
      return;
    }
    if (parseLegacyCountInput(value, input.minimum) === undefined) {
      window.alert(input.invalidMessage);
      actions.dismiss('input');
      return;
    }
    if (input.kind === 'shortcutCount') {
      actions.submitShortcutCountInput(input.action, value);
    } else {
      actions.submitCountInput(input.action, input.cardId, value);
    }
  }, [actions, input]);
  return null;
};

/**
 * Renderer-external legacy popup paint. It consumes only recipient-safe scene
 * data and semantic controller callbacks; it never owns canonical game state.
 */
export const LegacyBoardOverlays = memo(function LegacyBoardOverlays({
  state,
  darkMode,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly darkMode: boolean;
  readonly actions: LegacyBoardOverlayActions;
}) {
  const [contextAnchor, setContextAnchor] = useState<{
    readonly cardId: ViewCardId;
    readonly zoneId: string;
    readonly bounds: Rect;
  } | null>(null);
  const scene = state.scene;
  if (!scene) return null;
  const contextCard = state.overlays.contextMenuCardId
    ? (scene.cards.find(
        (card) => card.id === state.overlays.contextMenuCardId
      ) ?? null)
    : null;
  const preview = state.overlays.preview;
  const previewCards = preview
    ? preview.kind === 'card'
      ? scene.cards.filter((card) => card.id === preview.cardId)
      : scene.cards
          .filter((card) => card.parentId === preview.stackId)
          .sort((left, right) => left.zIndex - right.zIndex)
    : [];
  const openedZone = state.presentation.openedZoneId
    ? (scene.zones.find(
        (zone) => zone.id === state.presentation.openedZoneId
      ) ?? null)
    : null;
  const openedZoneCards = openedZone
    ? scene.cards.filter((card) => card.parentId === openedZone.id)
    : [];
  const openedZoneFrame = openedZone?.playerId
    ? scene.layout.players.find(
        (player) => player.playerId === openedZone.playerId
      )
    : undefined;
  const previewFrame =
    preview?.kind === 'stack'
      ? scene.layout.players.find(
          (player) =>
            player.playerId ===
            state.view?.stacks[preview.stackId]?.boardPlayerId
        )
      : undefined;

  return (
    <div
      className={`ptcgsim-legacy-board-overlays${darkMode ? ' is-dark' : ''}`}
      data-legacy-board-overlays="true"
      style={{ width: scene.viewport.width, height: scene.viewport.height }}
    >
      {openedZone ? (
        <ZoneBrowser
          key={openedZone.id}
          state={state}
          zone={openedZone}
          cards={openedZoneCards}
          frame={openedZoneFrame}
          captureContextAnchor={(cardId, zoneId, bounds) =>
            setContextAnchor({ cardId, zoneId, bounds })
          }
          actions={actions}
        />
      ) : null}
      {state.overlays.input?.kind === 'count' ||
      state.overlays.input?.kind === 'shortcutCount' ? (
        <CountPrompt
          key={`${state.overlays.input.kind}:${state.overlays.input.action}:${state.overlays.input.zoneId}`}
          input={state.overlays.input}
          actions={actions}
        />
      ) : state.overlays.input ? (
        <MarkerEditor
          key={`${state.overlays.input.kind}:${state.overlays.input.cardId}`}
          state={state}
          actions={actions}
        />
      ) : null}
      {contextCard ? (
        <ContextMenu
          state={state}
          card={contextCard}
          anchorBounds={
            contextAnchor?.cardId === contextCard.id &&
            contextAnchor.zoneId === state.presentation.openedZoneId
              ? contextAnchor.bounds
              : undefined
          }
          darkMode={darkMode}
          actions={actions}
        />
      ) : null}
      {preview ? (
        <Preview
          cards={previewCards}
          kind={preview.kind}
          frame={previewFrame}
          actions={actions}
        />
      ) : null}
    </div>
  );
});
