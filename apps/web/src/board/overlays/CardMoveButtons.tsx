import { useLingui } from '@lingui/react/macro';
import type {
  BoardScene,
  BoardZoneKind,
  CardSceneNode,
} from '@ptcgsim/renderer-contract';
import type { OpenedZoneCardIntent } from '../BoardSessionController.js';
import { ZONE_NAMES } from './zone-names.js';

const ORDER: readonly BoardZoneKind[] = [
  'hand',
  'discard',
  'deck',
  'active',
  'bench',
  'board',
  'stadium',
  'lostZone',
  'prizes',
];

/** Direct destinations shared by the card window and a viewer's selected-card bar. */
export const CardMoveButtons = ({
  card,
  scene,
  enabled,
  emit,
  inWindow = false,
}: {
  readonly card: CardSceneNode | undefined;
  readonly scene: BoardScene;
  readonly enabled: boolean;
  readonly emit: (intent: OpenedZoneCardIntent) => void;
  readonly inWindow?: boolean;
}) => {
  const { t, i18n } = useLingui();
  if (!card) return null;
  const targets = scene.zones
    .filter(
      (zone) =>
        zone.interactive &&
        (zone.id !== card.parentId || zone.kind === 'deck') &&
        ORDER.includes(zone.kind) &&
        (zone.playerId === card.ownerId || zone.playerId === null)
    )
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return (
    <div
      className={`ptcgsim-card-moves${inWindow ? ' is-grid' : ''}`}
      role="group"
      aria-label={t`Move to`}
    >
      {targets.flatMap((zone) =>
        (zone.kind === 'deck' ? (['top', 'bottom'] as const) : [undefined]).map(
          (position) => {
            const name = ZONE_NAMES[zone.kind];
            const label =
              position === 'top'
                ? t`Deck (top)`
                : position === 'bottom'
                  ? t`Deck (bottom)`
                  : name
                    ? i18n._(name)
                    : zone.label;
            return (
              <button
                key={`${zone.id}/${position ?? ''}`}
                type="button"
                className="ptcgsim-overlay-button"
                data-card-destination={
                  position ? `deck-${position}` : zone.kind
                }
                data-preview-tabbable={inWindow ? 'true' : undefined}
                disabled={!enabled}
                onClick={() =>
                  emit({
                    kind: 'CardDropRequested',
                    cardId: card.id,
                    targetId: zone.id,
                    x: zone.bounds.x + zone.bounds.width / 2,
                    y: zone.bounds.y + zone.bounds.height / 2,
                    ...(position ? { pilePosition: position } : {}),
                  })
                }
              >
                {label}
              </button>
            );
          }
        )
      )}
    </div>
  );
};
