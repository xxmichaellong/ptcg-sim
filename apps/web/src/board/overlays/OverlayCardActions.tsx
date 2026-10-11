import { useState } from 'react';
import type { BoardScene, CardSceneNode } from '@ptcgsim/renderer-contract';
import type { OpenedZoneCardIntent } from '../BoardSessionController.js';

/** A native select keeps the single-pointer alternative usable on touch and keyboards. */
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
  const [destination, setDestination] = useState('');
  const targets = scene.zones.filter(
    (zone) =>
      zone.interactive &&
      zone.id !== card?.parentId &&
      zone.kind !== 'inspection' &&
      zone.kind !== 'attachmentResolution' &&
      (zone.playerId === card?.ownerId || zone.playerId === null)
  );
  const target = targets.find((zone) => zone.id === destination) ?? targets[0];
  return (
    <div className="ptcgsim-card-actions" aria-label="Selected card actions">
      <span className="ptcgsim-card-actions-label">
        {card?.label ?? 'Select a card to read or move it'}
      </span>
      <button
        type="button"
        className="ptcgsim-overlay-button"
        disabled={!card}
        onClick={() =>
          card && emit({ kind: 'CardPreviewRequested', cardId: card.id })
        }
      >
        Read
      </button>
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
      <select
        aria-label="Move selected card to"
        value={target?.id ?? ''}
        disabled={!card || !enabled || !target}
        onChange={(event) => setDestination(event.currentTarget.value)}
      >
        {!target ? <option value="">Destination</option> : null}
        {targets.map((zone) => (
          <option key={zone.id} value={zone.id}>
            {zone.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="ptcgsim-overlay-button is-primary"
        disabled={!card || !enabled || !target}
        onClick={() => {
          if (!card || !target) return;
          emit({
            kind: 'CardDropRequested',
            cardId: card.id,
            targetId: target.id,
            x: target.bounds.x + target.bounds.width / 2,
            y: target.bounds.y + target.bounds.height / 2,
          });
        }}
      >
        Move
      </button>
    </div>
  );
};
