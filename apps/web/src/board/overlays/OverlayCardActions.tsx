import { CaretUpIcon } from '@phosphor-icons/react/dist/csr/CaretUp';
import { ArrowLineUpIcon } from '@phosphor-icons/react/dist/csr/ArrowLineUp';
import { ArrowLineDownIcon } from '@phosphor-icons/react/dist/csr/ArrowLineDown';
import { Trans, useLingui } from '@lingui/react/macro';
import type {
  BoardScene,
  CardSceneNode,
  ZoneSceneNode,
} from '@ptcgsim/renderer-contract';
import type { OpenedZoneCardIntent } from '../BoardSessionController.js';
import { Tooltip } from '../../ui/Tooltip.js';
import { CardMoveButtons } from './CardMoveButtons.js';

/**
 * Select all, worded for what it does: every card of the pile into the
 * selection, every copy of every tile -- or, all of them in it, out again.
 */
const SelectAllButton = ({
  selection,
  enabled,
}: {
  readonly selection: {
    readonly allSelected: boolean;
    readonly onSelectAll: () => void;
  };
  readonly enabled: boolean;
}) => {
  const { t } = useLingui();
  return (
    <button
      type="button"
      className="ptcgsim-overlay-button"
      data-card-action="select-all"
      disabled={!enabled}
      onClick={selection.onSelectAll}
    >
      {selection.allSelected
        ? t({
            message: 'Deselect all',
            comment: 'Takes every card of the open pile out of the selection.',
          })
        : t({
            message: 'Select all',
            comment: 'Takes every card of the open pile into the selection.',
          })}
    </button>
  );
};

/**
 * The selected card's actions without a drag or a right-click, for touch and
 * keyboards: direct destinations and the same action window as a double
 * click. Wide panels show more destinations; narrow ones scroll the row.
 */
export const OverlayCardActions = ({
  card,
  scene,
  enabled,
  inert = false,
  emit,
  pile,
  selection,
}: {
  readonly card: CardSceneNode | undefined;
  readonly scene: BoardScene;
  readonly enabled: boolean;
  /** Keep its layout while the containing panel is showing the board. */
  readonly inert?: boolean;
  readonly emit: (intent: OpenedZoneCardIntent) => void;
  /** Canonical bottom-to-top order, before local sorting or copy grouping. */
  readonly pile?: {
    readonly zone: ZoneSceneNode;
    readonly cards: readonly CardSceneNode[];
  };
  /**
   * A pile's selection (ADR-042 §2): Select all, and, for several
   * selected, Move N… (the group menu) in place of one card's actions; in
   * touch's selection mode, Done.
   */
  readonly selection?: {
    /** How many items are selected, here and on the table. */
    readonly count: number;
    /** How many of this pile's cards are. */
    readonly here: number;
    readonly allSelected: boolean;
    readonly selectionMode: boolean;
    readonly onSelectAll: () => void;
    readonly onMove?: (button: HTMLElement) => void;
    readonly onDone: () => void;
  };
}) => {
  const { t } = useLingui();
  if (selection && (selection.count >= 2 || selection.selectionMode))
    return (
      <div
        className="ptcgsim-card-actions"
        aria-label={t`Selected cards actions`}
        data-card-actions-group="true"
        inert={inert || undefined}
        aria-hidden={inert || undefined}
      >
        <span
          className="ptcgsim-card-actions-label"
          data-selected-count={selection.count}
        >
          {t({
            message: `${selection.count} selected`,
            comment: 'How many cards are selected, e.g. "3 selected".',
          })}
        </span>
        <SelectAllButton selection={selection} enabled={enabled} />
        {selection.onMove ? (
          <button
            type="button"
            className="ptcgsim-overlay-button is-primary"
            data-card-action="move-group"
            aria-haspopup="menu"
            disabled={!enabled || selection.count < 2}
            onClick={(event) => selection.onMove?.(event.currentTarget)}
          >
            {t({
              message: `Move ${selection.count}…`,
              comment:
                'Opens the menu of what the selected cards can do, e.g. "Move 3…".',
            })}
            <CaretUpIcon aria-hidden="true" weight="bold" />
          </button>
        ) : null}
        {selection.selectionMode ? (
          <button
            type="button"
            className="ptcgsim-overlay-button"
            data-card-action="selection-done"
            onClick={selection.onDone}
          >
            <Trans context="stop picking cards">Done</Trans>
          </button>
        ) : null}
      </div>
    );
  const orderedPile =
    pile &&
    (pile.zone.kind === 'discard' || pile.zone.kind === 'lostZone') &&
    pile.cards.length > 1
      ? pile
      : undefined;
  const selectedIndex =
    orderedPile?.cards.findIndex((entry) => entry.id === card?.id) ?? -1;
  return (
    <div
      className="ptcgsim-card-actions"
      aria-label={t`Selected card actions`}
      inert={inert || undefined}
      aria-hidden={inert || undefined}
    >
      <span className="ptcgsim-card-actions-label">{card?.label}</span>
      {selection ? (
        <SelectAllButton selection={selection} enabled={enabled} />
      ) : null}
      {orderedPile
        ? [
            {
              position: 'top' as const,
              label: t({
                message: 'Put on top',
                comment:
                  'Move the selected card to the top of this discard or Lost Zone pile.',
              }),
              icon: ArrowLineUpIcon,
              endpoint: orderedPile.cards.length - 1,
            },
            {
              position: 'bottom' as const,
              label: t({
                message: 'Put on bottom',
                comment:
                  'Move the selected card to the bottom of this discard or Lost Zone pile.',
              }),
              icon: ArrowLineDownIcon,
              endpoint: 0,
            },
          ].map(({ position, label, icon: Icon, endpoint }) => (
            <Tooltip key={position} content={label}>
              <button
                type="button"
                className="ptcgsim-overlay-button ptcgsim-card-order"
                data-card-action={`pile-${position}`}
                aria-label={label}
                disabled={
                  !enabled ||
                  !orderedPile.zone.interactive ||
                  selectedIndex < 0 ||
                  selectedIndex === endpoint
                }
                onClick={() => {
                  if (!card) return;
                  const { zone } = orderedPile;
                  emit({
                    kind: 'CardDropRequested',
                    cardId: card.id,
                    targetId: zone.id,
                    pilePosition: position,
                    x: zone.bounds.x + zone.bounds.width / 2,
                    y: zone.bounds.y + zone.bounds.height / 2,
                  });
                }}
              >
                <Icon aria-hidden="true" weight="bold" />
              </button>
            </Tooltip>
          ))
        : null}
      <CardMoveButtons
        card={card}
        scene={scene}
        enabled={enabled}
        emit={emit}
      />
      <button
        type="button"
        className="ptcgsim-overlay-button is-quiet"
        data-card-action="actions"
        disabled={!card || !enabled}
        onClick={() =>
          card && emit({ kind: 'CardPreviewRequested', cardId: card.id })
        }
      >
        <Trans context="open the selected card's menu">Actions</Trans>
      </button>
    </div>
  );
};
