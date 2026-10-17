import { CaretUpIcon } from '@phosphor-icons/react/dist/csr/CaretUp';
import type {
  BoardScene,
  BoardZoneKind,
  CardSceneNode,
} from '@ptcgsim/renderer-contract';
import type { OpenedZoneCardIntent } from '../BoardSessionController.js';
import { ActionMenu } from '../../ui/ActionMenu.js';

/**
 * Where a card can be moved, by name and in the order play reaches them.
 * Every place offered is the card owner's or shared, so the owner's name
 * would only repeat itself.
 */
const DESTINATIONS: readonly (readonly [BoardZoneKind, string])[] = [
  ['hand', 'Hand'],
  ['active', 'Active'],
  ['bench', 'Bench'],
  ['board', 'Board'],
  ['stadium', 'Stadium'],
  ['discard', 'Discard pile'],
  ['lostZone', 'Lost Zone'],
  ['prizes', 'Prizes'],
  ['deck', 'Deck'],
];
const destinationOrder = (kind: BoardZoneKind): number => {
  const index = DESTINATIONS.findIndex(([candidate]) => candidate === kind);
  return index === -1 ? DESTINATIONS.length : index;
};
const destinationName = (kind: BoardZoneKind, label: string): string =>
  DESTINATIONS.find(([candidate]) => candidate === kind)?.[1] ?? label;

/**
 * The selected card's actions without a drag or a right-click, for touch and
 * keyboards: its menu, and Move, which asks where to. Reading is a double
 * click or tap (or V), as everywhere else.
 */
export const OverlayCardActions = ({
  card,
  scene,
  enabled,
  emit,
}: {
  readonly card: CardSceneNode | undefined;
  readonly scene: BoardScene;
  readonly enabled: boolean;
  readonly emit: (intent: OpenedZoneCardIntent) => void;
}) => {
  const targets = scene.zones
    .filter(
      (zone) =>
        zone.interactive &&
        zone.id !== card?.parentId &&
        zone.kind !== 'inspection' &&
        zone.kind !== 'attachmentResolution' &&
        (zone.playerId === card?.ownerId || zone.playerId === null)
    )
    .sort(
      (left, right) =>
        destinationOrder(left.kind) - destinationOrder(right.kind)
    );
  const movable = Boolean(card) && enabled && targets.length > 0;
  return (
    <div className="ptcgsim-card-actions" aria-label="Selected card actions">
      <span className="ptcgsim-card-actions-label">{card?.label}</span>
      <button
        type="button"
        className="ptcgsim-overlay-button"
        disabled={!card || !enabled}
        onClick={() =>
          card && emit({ kind: 'CardContextRequested', cardId: card.id })
        }
      >
        Actions
      </button>
      <ActionMenu
        label={card ? `Move ${card.label} to` : 'Move to'}
        side="top"
        align="end"
        entries={targets.map((zone) => ({
          label: destinationName(zone.kind, zone.label),
          onSelect: () => {
            if (!card) return;
            emit({
              kind: 'CardDropRequested',
              cardId: card.id,
              targetId: zone.id,
              x: zone.bounds.x + zone.bounds.width / 2,
              y: zone.bounds.y + zone.bounds.height / 2,
            });
          },
        }))}
        trigger={
          <button
            type="button"
            className="ptcgsim-overlay-button is-primary"
            data-card-action="move"
            disabled={!movable}
          >
            Move
            <CaretUpIcon aria-hidden="true" weight="bold" />
          </button>
        }
      />
    </div>
  );
};
