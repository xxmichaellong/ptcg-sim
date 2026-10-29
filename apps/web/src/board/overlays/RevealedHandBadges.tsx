import type { ViewCardId } from '@ptcgsim/game-core';
import type { BoardDepthProjection } from '@ptcgsim/renderer-contract';
import { useLingui } from '@lingui/react/macro';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';

import { actingPlayerIdOf } from '../acting-seat.js';
import type { BoardSessionControllerState } from '../BoardSessionController.js';
import { Tooltip } from '../../ui/Tooltip.js';
import { visualCardBounds } from './card-bounds.js';
import './RevealedHandBadges.css';

/** The badge's size, and how far it keeps inside the table. */
const BADGE_PX = 30;
const EDGE_PX = 4;

/**
 * An eye on each card of the player's own hand that their opponent can see
 * (revealed with Alt+Z or its menu): pressing it hides the card again. It
 * sits on the card's top left, the part of a fanned hand that shows, half
 * over its top edge so it stays clear of the card's name. v1 asked with a
 * centred popup that took the focus instead.
 */
export const RevealedHandBadges = ({
  state,
  depth,
  onHide,
}: {
  readonly state: BoardSessionControllerState;
  readonly depth?: BoardDepthProjection;
  readonly onHide: (cardId: ViewCardId) => void;
}) => {
  const { t } = useLingui();
  const view = state.view;
  const scene = state.scene;
  if (
    !view ||
    !scene ||
    !state.canSubmitCommands ||
    view.viewer.kind !== 'player'
  ) {
    return null;
  }
  const acting = actingPlayerIdOf(view, scene.bottomPlayerId);
  const hand = Object.values(view.zones).find(
    (zone) => zone.kind === 'hand' && zone.ownerId === acting
  );
  const revealed = hand?.cards.filter((card) => card.publiclyRevealed) ?? [];
  if (revealed.length === 0) return null;
  const width = scene.viewport.width;
  const height = scene.viewport.height;
  return revealed.map((card) => {
    const node = scene.cards.find((candidate) => candidate.id === card.id);
    if (!node || node.renderKey === null) return null;
    const box = visualCardBounds(node, depth);
    const left = Math.min(
      Math.max(box.x + EDGE_PX, EDGE_PX),
      width - EDGE_PX - BADGE_PX
    );
    const top = Math.min(
      Math.max(box.y - BADGE_PX / 2, EDGE_PX),
      height - EDGE_PX - BADGE_PX
    );
    const name = node.label;
    return (
      <Tooltip key={card.id} content={t`Shown to your opponent`} side="top">
        <button
          type="button"
          className="ptcgsim-revealed-badge"
          data-revealed-card={card.id}
          aria-label={t({
            message: `Hide ${name}`,
            comment:
              'A button on a hand card the opponent can see; it hides the card again. {name} is the card.',
          })}
          style={{ left, top }}
          onClick={() => onHide(card.id as ViewCardId)}
        >
          <EyeIcon aria-hidden="true" weight="bold" />
        </button>
      </Tooltip>
    );
  });
};
