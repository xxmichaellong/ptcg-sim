import { useLingui } from '@lingui/react/macro';
import type { MatchViewState, PlayerId } from '@ptcgsim/game-core';
import type {
  BoardDepthProjection,
  BoardLayoutSnapshot,
  BoardScene,
  Rect,
} from '@ptcgsim/renderer-contract';
import { CheckSquareIcon } from '@phosphor-icons/react/dist/csr/CheckSquare';
import { EyeSlashIcon } from '@phosphor-icons/react/dist/csr/EyeSlash';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { SquareIcon } from '@phosphor-icons/react/dist/csr/Square';
import { memo, type CSSProperties } from 'react';

import { ActionMenu, type ActionMenuEntry } from '../ui/ActionMenu.js';
import { Tooltip } from '../ui/Tooltip.js';
import {
  ONCE_PER_GAME_TILE_ASPECT,
  OncePerGameTile,
  oncePerGameTooltip,
} from './OncePerGameTile.js';
import { seatStage } from './seat-stage.js';
import './TableZoneAffordances.css';

const decorative = { 'aria-hidden': true, focusable: false } as const;

type OncePerGameMarker = 'vstar' | 'gx';
const MARKER_LABEL: Readonly<Record<OncePerGameMarker, string>> = {
  vstar: 'VSTAR',
  gx: 'GX',
};

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
  /**
   * The once-per-game markers the viewer keeps on the table (off by
   * default), turning them on or off, and pressing one to mark it used.
   */
  readonly markers?: {
    readonly vstar: boolean;
    readonly gx: boolean;
    readonly onShownChange: (marker: OncePerGameMarker, shown: boolean) => void;
    readonly onToggle: (playerId: PlayerId, marker: OncePerGameMarker) => void;
  };
  /** A pile browser or work area is over the table. */
  readonly covered?: boolean;
}

/**
 * What the table itself offers (ADR-030): a `+` on a seat's deck before it
 * has one; the once-per-game markers, on the mat beside each player's
 * prizes when the viewer keeps them; a small `+` in the viewer's staging
 * area that adds or removes the optional pieces (the Lost Zone and the
 * markers); and a way to put an empty Lost Zone away again. Laid over the
 * board by its layout, so either renderer gets them.
 */
export const TableZoneAffordances = memo(function TableZoneAffordances({
  layout,
  scene,
  view,
  depth,
  loadDeck,
  lostZone,
  markers,
  covered = false,
}: TableZoneAffordancesProps) {
  const { t } = useLingui();
  const bottom = layout.players.find(
    (frame) => frame.playerId === layout.bottomPlayerId && !frame.hidden
  );
  const region = (
    frame: (typeof layout.players)[number],
    kind: 'deck' | 'lostZone'
  ) => frame.regions.find((candidate) => candidate.kind === kind);
  // A seat's colour follows the player, not the half it sits in: turned
  // around, the seat at the bottom keeps its own colour (SeatTone).
  const toneOf = (playerId: PlayerId) =>
    scene.layout.players.find((frame) => frame.playerId === playerId)?.tone ??
    'opponent';
  const lostZoneHasCards = (playerId: PlayerId): boolean =>
    scene.zones.some(
      (zone) =>
        zone.kind === 'lostZone' && zone.playerId === playerId && zone.count > 0
    );

  const deckButtons =
    loadDeck && !covered
      ? layout.players.flatMap((frame) => {
          if (frame.hidden || !loadDeck.playerIds.includes(frame.playerId))
            return [];
          if (seatStage(view, frame.playerId) !== 'empty') return [];
          const deck = region(frame, 'deck');
          if (!deck) return [];
          const own = frame.playerId === layout.bottomPlayerId;
          const label = own ? t`Load a deck` : t`Load the other side's deck`;
          return [
            <div
              key={`deck-${frame.playerId}`}
              className="table-zone-affordance table-zone-affordance--deck"
              data-player-side={own ? 'local' : 'opponent'}
              data-seat-tone={toneOf(frame.playerId)}
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
  const bottomLostZoneInUse = bottom
    ? lostZoneHasCards(bottom.playerId)
    : false;
  if (
    !covered &&
    lostZone?.shown &&
    bottom &&
    bottomLostZone &&
    !bottomLostZoneInUse
  ) {
    lostZoneControl = (
      <div
        className="table-zone-affordance table-zone-affordance--lost-zone-hide"
        style={boxStyle(onScreen(bottomLostZone.physicalDeclaredBounds, depth))}
      >
        <Tooltip content={t`Hide Lost Zone`} side="left">
          <button
            id="hideLostZoneButton"
            type="button"
            className="table-zone-chip table-zone-chip--icon"
            aria-label={t`Hide Lost Zone`}
            onClick={() => lostZone.onShownChange(false)}
          >
            <EyeSlashIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
      </div>
    );
  }

  const markerLabel = (markerName: string) =>
    t({
      message: `${markerName} marker`,
      comment: 'markerName is VSTAR or GX.',
    });
  // The viewer's own `+` for the optional pieces, in their staging area.
  const extrasRect = bottom?.extras?.control;
  const pieceEntry = (
    id: string,
    label: string,
    shown: boolean,
    onSelect: () => void,
    inUse = false
  ): ActionMenuEntry => ({
    id,
    label: (
      <>
        {label}
        <span className="ds-visually-hidden">
          {shown
            ? t({
                message: ', on',
                comment:
                  'Read after a table piece\'s name by screen readers: "Lost Zone, on".',
              })
            : t({
                message: ', off',
                comment:
                  'Read after a table piece\'s name by screen readers: "Lost Zone, off".',
              })}
        </span>
      </>
    ),
    icon: shown ? CheckSquareIcon : SquareIcon,
    ...(inUse
      ? {
          hint: t({
            message: 'In use',
            context: 'a table piece holding cards',
          }),
          disabled: true,
        }
      : {}),
    onSelect,
  });
  const extrasControl =
    !covered && extrasRect && (lostZone || markers) ? (
      <div
        className="table-zone-affordance table-zone-affordance--extras"
        style={boxStyle(onScreen(extrasRect, depth))}
      >
        <ActionMenu
          label={t`Lost Zone and markers`}
          side="top"
          align="start"
          tooltip={t`Lost Zone and markers`}
          entries={[
            ...(lostZone
              ? [
                  pieceEntry(
                    'lostZoneToggle',
                    t`Lost Zone`,
                    lostZone.shown || bottomLostZoneInUse,
                    () => lostZone.onShownChange(!lostZone.shown),
                    bottomLostZoneInUse
                  ),
                ]
              : []),
            ...(markers
              ? (['vstar', 'gx'] as const).map((marker) =>
                  pieceEntry(
                    `${marker}MarkerToggle`,
                    markerLabel(MARKER_LABEL[marker]),
                    markers[marker],
                    () => markers.onShownChange(marker, !markers[marker])
                  )
                )
              : []),
          ]}
          trigger={
            <button
              id="tableExtrasButton"
              type="button"
              className="table-zone-extras"
              aria-label={t`Add to the table`}
            >
              <PlusIcon {...decorative} weight="bold" />
            </button>
          }
        />
      </div>
    ) : null;

  // Each player's markers, on the mat beside their prizes.
  const markerTiles = markers
    ? layout.players.flatMap((frame) => {
        const rect = frame.extras?.markers;
        const player = view?.players[frame.playerId];
        if (frame.hidden || !rect || !player) return [];
        const shown = (['vstar', 'gx'] as const).filter(
          (marker) => markers[marker]
        );
        if (shown.length === 0) return [];
        const own = frame.playerId === layout.bottomPlayerId;
        const box = onScreen(rect, depth);
        return [
          <div
            key={`markers-${frame.playerId}`}
            className="table-zone-affordance table-markers"
            data-player-side={own ? 'local' : 'opponent'}
            // Under an open pile or work area they stay in view, faded, and
            // take no presses, as v1's markers did beneath its cover.
            data-covered={covered ? 'true' : undefined}
            // The far player's markers stack from the centre line too.
            data-order={own ? 'down' : 'up'}
            style={boxStyle(box)}
          >
            {shown.map((marker) => {
              const used =
                marker === 'gx'
                  ? player.oncePerGame.gxUsed
                  : player.oncePerGame.vstarUsed;
              const playerName = player.displayName;
              const markerName = MARKER_LABEL[marker];
              return (
                <Tooltip
                  key={marker}
                  content={oncePerGameTooltip(marker, used)}
                  // Beside the column, clear of the other marker.
                  side={own ? 'right' : 'left'}
                >
                  <button
                    type="button"
                    className={`table-marker${used ? ' used-special-move' : ''}`}
                    data-once-per-game-marker={marker}
                    data-player-id={frame.playerId}
                    data-player-side={own ? 'local' : 'opponent'}
                    aria-label={t({
                      message: `${playerName} ${markerName}`,
                      comment:
                        "A player's once-per-game marker, e.g. 'Red VSTAR'.",
                    })}
                    aria-pressed={used}
                    style={
                      {
                        '--table-marker-aspect':
                          ONCE_PER_GAME_TILE_ASPECT[marker],
                      } as CSSProperties
                    }
                    onClick={() => markers.onToggle(frame.playerId, marker)}
                  >
                    <OncePerGameTile marker={marker} />
                  </button>
                </Tooltip>
              );
            })}
          </div>,
        ];
      })
    : [];

  if (
    deckButtons.length === 0 &&
    !lostZoneControl &&
    !extrasControl &&
    markerTiles.length === 0
  ) {
    return null;
  }
  return (
    <div className="table-zone-affordances" data-table-zone-affordances="true">
      {deckButtons}
      {markerTiles}
      {lostZoneControl}
      {extrasControl}
    </div>
  );
});
