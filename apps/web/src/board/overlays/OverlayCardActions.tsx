import { CaretUpIcon } from '@phosphor-icons/react/dist/csr/CaretUp';
import { Trans, useLingui } from '@lingui/react/macro';
import type {
  BoardScene,
  BoardZoneKind,
  CardSceneNode,
} from '@ptcgsim/renderer-contract';
import type { OpenedZoneCardIntent } from '../BoardSessionController.js';
import { ActionMenu } from '../../ui/ActionMenu.js';
import { ZONE_NAMES } from './zone-names.js';

/**
 * Where a card can be moved, in the order play reaches them. Every place
 * offered is the card owner's or shared, so the owner's name would only
 * repeat itself.
 */
const DESTINATIONS: readonly BoardZoneKind[] = [
  'hand',
  'active',
  'bench',
  'board',
  'stadium',
  'discard',
  'lostZone',
  'prizes',
  'deck',
];
const destinationOrder = (kind: BoardZoneKind): number => {
  const index = DESTINATIONS.indexOf(kind);
  return index === -1 ? DESTINATIONS.length : index;
};

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
  const { t, i18n } = useLingui();
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
  const cardName = card?.label;
  return (
    <div className="ptcgsim-card-actions" aria-label={t`Selected card actions`}>
      <span className="ptcgsim-card-actions-label">{card?.label}</span>
      <button
        type="button"
        className="ptcgsim-overlay-button"
        disabled={!card || !enabled}
        onClick={() =>
          card && emit({ kind: 'CardContextRequested', cardId: card.id })
        }
      >
        <Trans context="open the selected card's menu">Actions</Trans>
      </button>
      <ActionMenu
        label={
          cardName
            ? t({
                message: `Move ${cardName} to`,
                comment: '{cardName} is a card; a list of places follows.',
              })
            : t`Move to`
        }
        side="top"
        align="end"
        entries={targets.map((zone) => {
          const name = ZONE_NAMES[zone.kind];
          return {
            label: name ? i18n._(name) : zone.label,
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
          };
        })}
        trigger={
          <button
            type="button"
            className="ptcgsim-overlay-button is-primary"
            data-card-action="move"
            disabled={!movable}
          >
            <Trans context="move the selected card">Move</Trans>
            <CaretUpIcon aria-hidden="true" weight="bold" />
          </button>
        }
      />
    </div>
  );
};
