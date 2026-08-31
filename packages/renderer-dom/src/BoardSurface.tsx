import type {
  BoardPreferences,
  BoardPresentation,
  BoardRendererAdapters,
  BoardScene,
  CardSceneNode,
  MarkerSceneNode,
  Rect,
  ZoneSceneNode,
} from '@ptcgsim/renderer-contract';
import {
  useLayoutEffect,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';

const absoluteRect = (bounds: Rect, zIndex: number): CSSProperties => ({
  position: 'absolute',
  left: bounds.x,
  top: bounds.y,
  width: bounds.width,
  height: bounds.height,
  zIndex,
  boxSizing: 'border-box',
});

const ZoneNode = ({
  zone,
  emitIntent,
}: {
  readonly zone: ZoneSceneNode;
  readonly emitIntent: BoardRendererAdapters['emitIntent'];
}) => (
  <div
    className={`ptcgsim-zone ptcgsim-zone-${zone.kind}`}
    data-zone-id={zone.id}
    data-zone-kind={zone.kind}
    aria-label={`${zone.label}, ${zone.count} cards`}
    style={{
      ...absoluteRect(zone.bounds, zone.zIndex),
      borderRadius: 15,
      background: 'rgba(255, 255, 255, 0.1)',
      boxShadow: '2px 2px 5px rgba(0, 0, 0, 0.1)',
      pointerEvents: zone.interactive ? 'auto' : 'none',
    }}
    onDoubleClick={() => emitIntent({ kind: 'ZoneOpened', zoneId: zone.id })}
  />
);

const CardNode = ({
  card,
  presentation,
  emitIntent,
}: {
  readonly card: CardSceneNode;
  readonly presentation: BoardPresentation;
  readonly emitIntent: BoardRendererAdapters['emitIntent'];
}) => {
  const selected = presentation.selectedCardId === card.id;
  const hovered = presentation.hoveredCardId === card.id;
  const dragging = presentation.drag?.cardId === card.id;
  const context = (event: ReactMouseEvent) => {
    event.preventDefault();
    emitIntent({ kind: 'CardContextRequested', cardId: card.id });
  };
  return (
    <button
      type="button"
      className="ptcgsim-card"
      data-card-id={card.id}
      data-card-role={card.role}
      aria-label={card.label}
      aria-pressed={selected}
      style={{
        ...absoluteRect(card.bounds, dragging ? 10_000 : card.zIndex),
        display: 'block',
        margin: 0,
        padding: 0,
        border: selected
          ? '4px solid rgba(143, 215, 153, 0.864)'
          : hovered
            ? '3px solid rgba(90, 110, 188, 0.864)'
            : 0,
        borderRadius: '0.375rem',
        background: '#777',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.5)',
        cursor: card.interactive ? 'pointer' : 'default',
        overflow: 'hidden',
        transform: `rotate(${card.rotationQuarterTurns * 90}deg)`,
        transformOrigin: 'center',
      }}
      disabled={!card.interactive}
      onClick={() => emitIntent({ kind: 'CardSelected', cardId: card.id })}
      onDoubleClick={() =>
        emitIntent({ kind: 'CardPreviewRequested', cardId: card.id })
      }
      onContextMenu={context}
    >
      <img
        src={card.imageUrl}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </button>
  );
};

const MarkerNode = ({ marker }: { readonly marker: MarkerSceneNode }) => (
  <div
    className={`ptcgsim-marker ptcgsim-marker-${marker.kind}`}
    data-marker-id={marker.id}
    aria-hidden="true"
    style={{
      ...absoluteRect(marker.bounds, marker.zIndex),
      display: 'grid',
      placeItems: 'center',
      borderRadius: '50%',
      background: marker.kind === 'damage' ? '#e64242' : '#efefef',
      color: marker.kind === 'damage' ? '#fff' : '#111',
      fontSize: Math.max(10, marker.bounds.height * 0.42),
      fontWeight: 700,
      pointerEvents: 'none',
    }}
  >
    {marker.value}
  </div>
);

export const BoardSurface = ({
  scene,
  presentation,
  preferences,
  adapters,
  onCommit,
}: {
  readonly scene: BoardScene;
  readonly presentation: BoardPresentation;
  readonly preferences: BoardPreferences;
  readonly adapters: BoardRendererAdapters;
  readonly onCommit?: () => void;
}) => {
  useLayoutEffect(() => {
    onCommit?.();
  }, [onCommit]);
  return (
    <div
      className="ptcgsim-board-surface"
      data-match-id={scene.matchId}
      data-revision={scene.revision}
      data-reduced-motion={preferences.reducedMotion ? 'true' : 'false'}
      data-high-contrast={preferences.highContrast ? 'true' : 'false'}
      data-dark-mode={preferences.darkMode ? 'true' : 'false'}
      style={{
        position: 'relative',
        width: scene.viewport.width,
        height: scene.viewport.height,
        overflow: 'hidden',
        background: preferences.darkMode ? '#081212' : 'transparent',
        touchAction: 'none',
        userSelect: 'none',
        contain: 'strict',
      }}
    >
      {scene.zones.map((zone) => (
        <ZoneNode key={zone.id} zone={zone} emitIntent={adapters.emitIntent} />
      ))}
      {scene.cards.map((card) => (
        <CardNode
          key={card.id}
          card={card}
          presentation={presentation}
          emitIntent={adapters.emitIntent}
        />
      ))}
      {scene.markers.map((marker) => (
        <MarkerNode key={marker.id} marker={marker} />
      ))}
    </div>
  );
};
