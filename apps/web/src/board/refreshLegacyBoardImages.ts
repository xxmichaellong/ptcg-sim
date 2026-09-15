import type { BoardScene } from '@ptcgsim/renderer-contract';

const REFRESHED_ZONE_KINDS = new Set(['active', 'bench', 'deck', 'prizes']);

/** Reloads the same rendered image families as v1 without replacing card DOM. */
export const refreshLegacyBoardImages = async (
  host: ParentNode,
  scene: BoardScene
): Promise<void> => {
  const reloadableZoneIds = new Set(
    scene.zones
      .filter((zone) => REFRESHED_ZONE_KINDS.has(zone.kind))
      .map((zone) => zone.id)
  );
  const reloadableCardIds = new Set(
    scene.cards
      .filter(
        (card) =>
          reloadableZoneIds.has(card.parentId) ||
          card.role === 'stackEvolution' ||
          card.role === 'stackAttachment'
      )
      .map((card) => String(card.id))
  );
  const images = Array.from(
    host.querySelectorAll<HTMLImageElement>('[data-card-id] > img')
  ).filter(
    (image) =>
      image.parentElement?.dataset.cardId !== undefined &&
      reloadableCardIds.has(image.parentElement.dataset.cardId)
  );
  await Promise.all(
    images.map(async (image) => {
      try {
        const currentSource = image.src;
        image.src = currentSource;
        await image.decode?.().catch(() => undefined);
      } catch {
        // A failed card image remains contained by the renderer surface.
      }
    })
  );
};
