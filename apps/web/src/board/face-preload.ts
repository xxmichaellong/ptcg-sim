import type { MatchViewState } from '@ptcgsim/game-core';
import type { BoardPresentation, BoardScene } from '@ptcgsim/renderer-contract';

import { localizedCardImage } from '../i18n/card-image-language.js';

/**
 * The faces of cards about to be turned up, so they are in the page before
 * they turn. A card the player knows but the table shows as a back -- the
 * top of their deck, the card in their hand right now -- turns over as soon
 * as it lands; its face loading only then holds the turn up. Only faces the
 * view already gives this player are looked at, so nothing is loaded that
 * they could not see.
 */
export const facesAboutToTurn = (
  view: MatchViewState,
  scene: BoardScene,
  presentation: Pick<BoardPresentation, 'drag'>
): readonly string[] => {
  const urls = new Set<string>();
  for (const card of scene.cards) {
    if (card.renderKey === null) continue;
    // A pile cover painted as a back over a face the player knows (their
    // own deck's top card).
    if (
      card.tableImageUrl !== undefined &&
      card.imageUrl &&
      card.imageUrl !== card.tableImageUrl
    )
      urls.add(card.imageUrl);
  }
  // The card in the hand, when it is one the player knows face down.
  const held = presentation.drag?.cardId;
  if (held !== undefined)
    for (const zone of Object.values(view.zones))
      for (const card of zone.cards) {
        if (card.id !== held || card.kind !== 'known' || card.face !== 'down')
          continue;
        const definition = view.definitions[card.definitionId];
        const url = definition?.imageUrlSmall ?? definition?.imageUrl;
        // As the table will ask for it: in the player's card language.
        if (url) urls.add(localizedCardImage(url).url);
      }
  return [...urls];
};

/** How many faces stay loaded and decoded, most recent first. */
const KEPT_FACES = 32;

/** Loads faces ahead and keeps the last few decoded. */
export class FacePreloader {
  private readonly images = new Map<string, HTMLImageElement>();
  private lastKey = '';

  /** Called with every board snapshot; does nothing until it changes. */
  update(
    view: MatchViewState | undefined,
    scene: BoardScene | undefined,
    presentation: Pick<BoardPresentation, 'drag'>
  ): void {
    if (!view || !scene || typeof Image !== 'function') return;
    const key = `${view.matchId}:${String(view.revision)}:${String(scene.revision)}:${String(presentation.drag?.cardId ?? '')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const url of facesAboutToTurn(view, scene, presentation))
      this.load(url);
  }

  private load(url: string): void {
    const kept = this.images.get(url);
    if (kept) {
      this.images.delete(url);
      this.images.set(url, kept);
      return;
    }
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    if (typeof image.decode === 'function')
      void image.decode().catch(() => undefined);
    this.images.set(url, image);
    for (const stale of this.images.keys()) {
      if (this.images.size <= KEPT_FACES) break;
      this.images.delete(stale);
    }
  }
}
