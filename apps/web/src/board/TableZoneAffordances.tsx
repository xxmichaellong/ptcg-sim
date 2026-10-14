import type { MatchViewState, PlayerId } from '@ptcgsim/game-core';
import type {
  BoardDepthProjection,
  BoardLayoutSnapshot,
  BoardScene,
  Rect,
} from '@ptcgsim/renderer-contract';
import { EyeSlashIcon } from '@phosphor-icons/react/dist/csr/EyeSlash';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { memo, type CSSProperties } from 'react';

import { Tooltip } from '../ui/Tooltip.js';
import { seatStage } from './seat-stage.js';
import './TableZoneAffordances.css';

const decorative = { 'aria-hidden': true, focusable: false } as const;

/** A rect of the flat table where it shows on screen, tilted or not. */
const onScreen = (
  rect: Rect,
  depth: BoardDepthProjection | undefined
): Rect => {
  if (!depth) return rect;
  const topLeft = depth.point({ x: rect.x, y: rect.y });
  const bottomRight = depth.point({
    x: rect.x + rect.width,
    y: rect.y + rect.height,
  });
  return {
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y),
    width: Math.abs(bottomRight.x - topLeft.x),
    height: Math.abs(bottomRight.y - topLeft.y),
  };
};

const boxStyle = (rect: Rect): CSSProperties => ({
  left: rect.x,
  top: rect.y,
  width: rect.width,
  height: rect.height,
});

export interface TableZoneAffordancesProps {
  readonly layout: BoardLayoutSnapshot;
  readonly scene: BoardScene;
  readonly view: MatchViewState | undefined;
  readonly depth?: BoardDepthProjection;
  /** The seats whose empty deck offers to load one, and what that does. */
  readonly loadDeck?: {
    readonly playerIds: readonly PlayerId[];
    readonly onLoad: (playerId: PlayerId) => void;
  };
  /** The optional Lost Zone (ADR-030): shown even when empty, or not. */
  readonly lostZone?: {
    readonly shown: boolean;
    readonly onShownChange: (shown: boolean) => void;
  };
  /** A pile browser or work area is over the table. */
  readonly covered?: boolean;
}

/**
 * What the table itself offers where a zone stands empty (ADR-030): a `+`
 * on a seat's deck before it has one, and the optional Lost Zone's add and
 * hide controls, placed beneath the discard pile where the Lost Zone sits.
 * Laid over the board by its layout, so either renderer gets them.
 */
export const TableZoneAffordances = memo(function TableZoneAffordances({
  layout,
  scene,
  view,
  depth,
  loadDeck,
  lostZone,
  covered = false,
}: TableZoneAffordancesProps) {
  if (covered) return null;
  const bottom = layout.players.find(
    (frame) => frame.playerId === layout.bottomPlayerId && !frame.hidden
  );
  const region = (
    frame: (typeof layout.players)[number],
    kind: 'deck' | 'lostZone'
  ) => frame.regions.find((candidate) => candidate.kind === kind);
  const lostZoneHasCards = (playerId: PlayerId): boolean =>
    scene.zones.some(
      (zone) =>
        zone.kind === 'lostZone' && zone.playerId === playerId && zone.count > 0
    );

  const deckButtons = loadDeck
    ? layout.players.flatMap((frame) => {
        if (frame.hidden || !loadDeck.playerIds.includes(frame.playerId))
          return [];
        if (seatStage(view, frame.playerId) !== 'empty') return [];
        const deck = region(frame, 'deck');
        if (!deck) return [];
        const own = frame.playerId === layout.bottomPlayerId;
        const label = own ? 'Load a deck' : "Load the other side's deck";
        return [
          <div
            key={`deck-${frame.playerId}`}
            className="table-zone-affordance table-zone-affordance--deck"
            data-player-side={own ? 'local' : 'opponent'}
            style={boxStyle(onScreen(deck.physicalDeclaredBounds, depth))}
          >
            <Tooltip content={label} side={own ? 'top' : 'bottom'}>
              <button
                type="button"
                className="table-zone-add"
                data-load-deck-player={frame.playerId}
                aria-label={label}
                onClick={() => loadDeck.onLoad(frame.playerId)}
              >
                <PlusIcon {...decorative} weight="bold" />
              </button>
            </Tooltip>
          </div>,
        ];
      })
    : [];

  let lostZoneControl = null;
  const bottomLostZone = bottom ? region(bottom, 'lostZone') : undefined;
  if (
    lostZone &&
    bottom &&
    bottomLostZone &&
    !lostZoneHasCards(bottom.playerId)
  ) {
    const rect = onScreen(bottomLostZone.physicalDeclaredBounds, depth);
    lostZoneControl = lostZone.shown ? (
      <div
        className="table-zone-affordance table-zone-affordance--lost-zone-hide"
        style={boxStyle(rect)}
      >
        <Tooltip content="Hide the Lost Zone while it is empty" side="left">
          <button
            id="hideLostZoneButton"
            type="button"
            className="table-zone-chip table-zone-chip--icon"
            aria-label="Hide the Lost Zone"
            onClick={() => lostZone.onShownChange(false)}
          >
            <EyeSlashIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
      </div>
    ) : (
      <div
        className="table-zone-affordance table-zone-affordance--lost-zone-add"
        style={boxStyle(rect)}
      >
        <button
          id="addLostZoneButton"
          type="button"
          className="table-zone-ghost"
          aria-label="Add the Lost Zone"
          onClick={() => lostZone.onShownChange(true)}
        >
          <PlusIcon {...decorative} weight="bold" />
          <span>Lost Zone</span>
        </button>
      </div>
    );
  }

  if (deckButtons.length === 0 && !lostZoneControl) return null;
  return (
    <div className="table-zone-affordances" data-table-zone-affordances="true">
      {deckButtons}
      {lostZoneControl}
    </div>
  );
});
