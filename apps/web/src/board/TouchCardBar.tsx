import { Trans, useLingui } from '@lingui/react/macro';
import type { ViewCardId } from '@ptcgsim/game-core';
import type {
  BoardDepthProjection,
  BoardScene,
  BoardViewport,
} from '@ptcgsim/renderer-contract';
import { DotsThreeCircleIcon } from '@phosphor-icons/react/dist/csr/DotsThreeCircle';
import { MagnifyingGlassPlusIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlassPlus';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { memo } from 'react';

import './TouchCardBar.css';

const decorative = { 'aria-hidden': true, focusable: false } as const;

/** The bar's size, for placing it clear of the card and the window edges. */
const BAR_WIDTH_PX = 236;
const BAR_HEIGHT_PX = 52;
const GAP_PX = 8;

/**
 * What a finger gets for the card it tapped (ADR-030): a mouse reads a card
 * with a double-click and opens its actions with a right-click, and a
 * finger has neither. The bar sits by the tapped card with both, and a
 * press elsewhere puts it away with the selection. Dragging is unchanged.
 */
export const TouchCardBar = memo(function TouchCardBar({
  scene,
  cardId,
  depth,
  viewport,
  onRead,
  onActions,
  onDismiss,
}: {
  readonly scene: BoardScene;
  readonly cardId: ViewCardId;
  readonly depth?: BoardDepthProjection;
  readonly viewport: BoardViewport;
  readonly onRead: () => void;
  readonly onActions: () => void;
  readonly onDismiss: () => void;
}) {
  const { t } = useLingui();
  const card = scene.cards.find((candidate) => candidate.id === cardId);
  if (!card) return null;
  const cardLabel = card.label;
  const bounds = depth ? depth.bounds(card) : card.bounds;
  // Above the card where there is room (the hand is at the bottom edge),
  // below it otherwise; never past the window's edges.
  const above = bounds.y - GAP_PX - BAR_HEIGHT_PX >= GAP_PX;
  const top = above
    ? bounds.y - GAP_PX - BAR_HEIGHT_PX
    : Math.min(
        viewport.height - BAR_HEIGHT_PX - GAP_PX,
        bounds.y + bounds.height + GAP_PX
      );
  const left = Math.min(
    Math.max(GAP_PX, bounds.x + bounds.width / 2 - BAR_WIDTH_PX / 2),
    viewport.width - BAR_WIDTH_PX - GAP_PX
  );
  return (
    <div
      className="touch-card-bar"
      role="toolbar"
      aria-label={
        cardLabel
          ? t({
              message: `${cardLabel}: actions`,
              comment: 'The touch toolbar for a card, e.g. "Pikachu: actions".',
            })
          : t`Card actions`
      }
      data-touch-card-bar="true"
      data-placement={above ? 'above' : 'below'}
      style={{ left, top, width: BAR_WIDTH_PX, height: BAR_HEIGHT_PX }}
    >
      <button
        id="touchReadCardButton"
        type="button"
        className="touch-card-bar__button"
        onClick={onRead}
      >
        <MagnifyingGlassPlusIcon {...decorative} weight="bold" />
        <Trans context="read a card up close">Read</Trans>
      </button>
      <button
        id="touchCardActionsButton"
        type="button"
        className="touch-card-bar__button"
        aria-haspopup="menu"
        onClick={onActions}
      >
        <DotsThreeCircleIcon {...decorative} weight="bold" />
        <Trans context="a card's actions">Actions</Trans>
      </button>
      <button
        type="button"
        className="touch-card-bar__button touch-card-bar__button--icon"
        aria-label={t`Deselect`}
        onClick={onDismiss}
      >
        <XIcon {...decorative} weight="bold" />
      </button>
    </div>
  );
});
