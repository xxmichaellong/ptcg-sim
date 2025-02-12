import { systemState } from '../../front-end.js';
import { Cover } from '../../setup/deck-constructor/cover.js';
import { getZone } from '../../setup/zones/get-zone.js';

export const updateOriginCover = (user, oZoneId, index) => {
  const oZone = getZone(user, oZoneId);
  // check if we need to replace the cover of the lostzone/discard (if the index of movingcard is equal to the length of the array)
  // ** note, the card has already been removed from oZoneArray in line 27, which is why we use oZoneArray.length and not oZoneArray.length - 1 **
  if (['lostZone', 'discard'].includes(oZoneId) && index === oZone.getCount()) {
    // remove existing cover image
    oZone.elementCover.removeChild(oZone.elementCover.firstElementChild);
    // if there are still cards in array, append new cover image
    if (oZone.getCount() > 0) {
      let cover;
      const imageURL = oZone.array[oZone.getCount() - 1].image.src;
      const name = oZoneId === 'discard' ? 'discardCover' : 'lostZoneCover';
      cover = new Cover(user, name, imageURL);
      oZone.elementCover.appendChild(cover.image);
    }
    // check if we need to delete the cover of the deck if the movingCard was the last card in deck, i.e., there's no cards left in deck
  } else if (['deck'].includes(oZoneId) && oZone.getCount() === 0) {
    oZone.elementCover.removeChild(oZone.elementCover.firstElementChild);
  }
};

export const updateDestinationCover = (user, movingCard, dZoneId) => {
  let imageURL = movingCard.image.src;
  const dZone = getZone(user, dZoneId);
  //update discard/lostzone cover
  if (['lostZone', 'discard'].includes(dZoneId)) {
    let cover;
    const name = dZoneId === 'discard' ? 'discardCover' : 'lostZoneCover';
    cover = new Cover(user, name, imageURL);

    if (dZone.elementCover.firstElementChild) {
      dZone.elementCover.removeChild(dZone.elementCover.firstElementChild);
    }
    dZone.elementCover.appendChild(cover.image);
    //add deck cover if it's the only card in deck
  } else if (['deck'].includes(dZoneId) && dZone.getCount() === 1) {
    const targetCardBackSrc =
      user === 'self'
        ? systemState.cardBackSrc
        : systemState.isTwoPlayer
          ? systemState.p2OppCardBackSrc
          : systemState.p1OppCardBackSrc;

    if (dZone.elementCover.firstElementChild) {
      dZone.elementCover.removeChild(dZone.elementCover.firstElementChild);
    }
    imageURL = targetCardBackSrc;
    const cover = new Cover(user, 'deckCover', imageURL);
    dZone.elementCover.appendChild(cover.image);
  }
};
