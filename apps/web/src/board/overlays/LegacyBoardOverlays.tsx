import type { ViewCardId } from '@ptcgsim/game-core';
import type {
  CardSceneNode,
  Rect,
  ZoneSceneNode,
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
  type RefObject,
} from 'react';

import type {
  BoardPresentationDismissScope,
  BoardSessionControllerState,
  OpenedZoneCardIntent,
} from '../BoardSessionController.js';
import type {
  LegacyBoardContextActionId,
  LegacyBoardZoneActionId,
} from '../resolveLegacyBoardOverlayAction.js';
import './LegacyBoardOverlays.css';

export type {
  LegacyBoardContextActionId,
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
  readonly kind: ZoneSceneNode['kind'];
  readonly playerId: ZoneSceneNode['playerId'];
} | null => {
  const direct = state.scene?.zones.find((zone) => zone.id === card.parentId);
  if (direct) return { kind: direct.kind, playerId: direct.playerId };
  const stack = state.view?.stacks[card.parentId];
  return stack ? { kind: stack.slot, playerId: stack.boardPlayerId } : null;
};

/** Mirrors the legacy menu's source order without authorizing any mutation. */
export const selectLegacyContextEntries = (
  state: BoardSessionControllerState,
  card: CardSceneNode
): readonly ContextEntry[] => {
  if (!state.canSubmitCommands || state.view?.viewer.kind !== 'player') {
    return [];
  }
  const location = zoneForCard(state, card);
  if (!location) return [];
  const own = location.playerId === state.view.viewer.playerId;
  const opponent = location.playerId !== null && !own;
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
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const active = element.ownerDocument.activeElement;
    opener.current = active instanceof HTMLElement ? active : null;
    const first = element.querySelector<HTMLElement>(focusSelector) ?? element;
    first.focus();
    return () => {
      const previous = opener.current;
      const current = element.ownerDocument.activeElement;
      if (!previous?.isConnected || !element.contains(current)) return;
      queueMicrotask(() => {
        if (previous.isConnected) previous.focus();
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

const moveMenuFocus = (
  event: ReactKeyboardEvent<HTMLElement>,
  direction: 'first' | 'last' | 'next' | 'previous'
): void => {
  const menu = event.currentTarget;
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
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
  const dismiss = useCallback(() => actions.dismiss('context'), [actions]);
  const entries = useMemo(
    () => selectLegacyContextEntries(state, card),
    [card, state]
  );
  useFocusBoundary(container, '[role="menuitem"]', String(card.id));
  useOutsideDismiss(container, dismiss);
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

const Preview = ({
  cards,
  kind,
  actions,
}: {
  readonly cards: readonly CardSceneNode[];
  readonly kind: 'card' | 'stack';
  readonly actions: LegacyBoardOverlayActions;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const dismiss = useCallback(() => actions.dismiss('preview'), [actions]);
  const identity = cards.map((card) => card.id).join(':');
  useFocusBoundary(container, '[data-preview-focus]', identity);
  useOutsideDismiss(container, dismiss);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
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
      aria-label="Card stack preview"
      tabIndex={-1}
      data-preview-focus="true"
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
  captureContextAnchor,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly zone: ZoneSceneNode;
  readonly cards: readonly CardSceneNode[];
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
      aria-label={`${zone.label}, ${zone.count} cards`}
      tabIndex={-1}
      onKeyDown={(event) => {
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
          captureContextAnchor={(cardId, zoneId, bounds) =>
            setContextAnchor({ cardId, zoneId, bounds })
          }
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
        <Preview cards={previewCards} kind={preview.kind} actions={actions} />
      ) : null}
    </div>
  );
});
