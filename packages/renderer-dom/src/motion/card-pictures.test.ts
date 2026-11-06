// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBoardSceneForViewport,
  createRendererSpikeView,
} from '@ptcgsim/renderer-contract';

import {
  forgetPicturesForTests,
  keepPicturesLeaving,
  pictureElement,
  pictureOf,
} from './card-pictures.js';

const drawn: unknown[] = [];

/** An image the page shows (`loaded`), or one still loading. */
const image = (src: string, loaded = true): HTMLImageElement => {
  const element = document.createElement('img');
  element.setAttribute('src', src);
  Object.defineProperty(element, 'complete', { value: loaded });
  Object.defineProperty(element, 'naturalWidth', { value: loaded ? 734 : 0 });
  Object.defineProperty(element, 'naturalHeight', {
    value: loaded ? 1024 : 0,
  });
  if (loaded) element.dataset.cardImageState = 'ready';
  return element;
};

/** A painted card as the table draws it: its face and picture. */
const cardElement = (id: string, picture: HTMLImageElement): HTMLElement => {
  const element = document.createElement('button');
  element.className = 'ptcgsim-card';
  element.dataset.cardId = id;
  const face = document.createElement('span');
  face.className = 'ptcgsim-card__face';
  face.append(picture);
  element.append(face);
  return element;
};

beforeEach(() => {
  drawn.length = 0;
  forgetPicturesForTests();
  // happy-dom draws nothing: a context that records what it was given.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        drawImage: (source: unknown) => drawn.push(source),
      }) as unknown as RenderingContext
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('card pictures that paint at once', () => {
  it('copies a picture shown on the page, never one still loading', () => {
    const shown = image('/face.webp');
    const loading = image('/face.webp', false);
    document.body.append(loading, shown);
    const copy = pictureOf('/face.webp', document)!;
    expect(copy).toBeInstanceOf(HTMLCanvasElement);
    expect(copy.dataset.cardPicture).toBe('/face.webp');
    expect(drawn).toEqual([shown]);
    // Kept to a card's size on screen.
    expect(copy.width).toBe(512);
    expect(copy.height).toBe(Math.round(1024 * (512 / 734)));
    expect(pictureOf('/other.webp', document)).toBeNull();
  });

  it('keeps a copy of a picture about to leave its place on the screen, and only those', () => {
    const view = createRendererSpikeView();
    const scene = createBoardSceneForViewport(view, {
      viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
      bottomPlayerId: view.playerOrder[0]!,
      splitRatio: 0.5,
      geometryVersion: 1,
    });
    const [staying, turned, moved] = scene.cards.filter(
      (card) => card.renderKey !== null
    );
    const url = (card: typeof staying) => card!.tableImageUrl ?? card!.imageUrl;
    const stayingPicture = image(url(staying));
    // Drawn next with another picture: a card turned over.
    const turnedPicture = image('/turned.webp');
    const movedPicture = image(url(moved));
    const root = document.createElement('div');
    root.append(
      cardElement(String(staying!.id), stayingPicture),
      cardElement(String(turned!.id), turnedPicture),
      cardElement(String(moved!.id), movedPicture)
    );
    // Drawn next by another node (a pile's top taking it): its picture too.
    const next = {
      ...scene,
      cards: scene.cards.map((card) =>
        card.id === moved!.id ? { ...card, renderKey: 'cover:elsewhere' } : card
      ),
    };
    keepPicturesLeaving(root, scene, next);
    expect(drawn).toEqual([turnedPicture, movedPicture]);
    // Off the screen now (the table drew over it), its copy is still had.
    turnedPicture.setAttribute('src', '/new-face.webp');
    drawn.length = 0;
    const copy = pictureOf('/turned.webp', root)!;
    expect(copy.dataset.cardPicture).toBe('/turned.webp');
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toBeInstanceOf(HTMLCanvasElement);
  });

  it('falls back to an image where no copy can be had', () => {
    const element = pictureElement('/nowhere.webp');
    expect(element).toBeInstanceOf(HTMLImageElement);
    expect(element.getAttribute('src')).toBe('/nowhere.webp');
    // Where the page can't draw at all, the same.
    document.body.append(image('/face.webp'));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(pictureElement('/face.webp')).toBeInstanceOf(HTMLImageElement);
  });
});
