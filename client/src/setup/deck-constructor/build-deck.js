import { systemState } from '../../front-end.js';
import { determineDeckData } from '../general/determine-deckdata.js';
import { getZone } from '../zones/get-zone.js';
import { Card } from './card.js';
import { Cover } from './cover.js';

export const buildDeck = (user) => {
  const deckData = determineDeckData(user);
  const deck = getZone(user, 'deck');
  for (const [quantity, name, type, imageURL] of deckData) {
    for (let i = 0; i < quantity; i++) {
      const card = new Card(user, name, type, imageURL);
      deck.array.push(card);
      deck.element.appendChild(card.image);
    }
  }
  const targetCardBackSrc =
    user === 'self'
      ? systemState.cardBackSrc
      : systemState.isTwoPlayer
        ? systemState.p2OppCardBackSrc
        : systemState.p1OppCardBackSrc;
  const cover = new Cover(user, 'deckCover', targetCardBackSrc);
  deck.elementCover.appendChild(cover.image);

  deck.array.forEach((card) => {
    const img = new Image();
    img.src = card.image.src;
    document.body.appendChild(img);
    document.body.removeChild(img);
  });
};
