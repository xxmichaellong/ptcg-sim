import { mouseClick } from '../../front-end.js';
import { resetImage } from '../../setup/image-logic/reset-image.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { addDamageCounter } from '../counters/damage-counter.js';
import { moveCard } from './move-card.js';

export const relocateAttachedCards = (
  user,
  initiator,
  movingCard,
  oZoneId,
  oZone,
  dZoneId,
  dZone
) => {
  for (let i = 0; i < oZone.getCount(); i++) {
    const image = oZone.array[i].image;
    if (image === movingCard.image) {
      break;
    }
    if (image.relative === movingCard.image) {
      resetImage(image);
      //moving to active or bench
      if (['active', 'bench'].includes(dZoneId)) {
        image.attached = true;
        const targetIndex = dZone.array.findIndex(
          (card) => card.image === movingCard.image
        );
        moveCard(user, initiator, oZoneId, dZoneId, i, targetIndex);
      } else {
        if (
          oZone.array[i].type === 'Pokémon' &&
          movingCard.image.damageCounter
        ) {
          addDamageCounter(user, oZoneId, i, false, false);
          image.damageCounter.textContent =
            movingCard.image.damageCounter.textContent;
        }
        getZone(user, 'attachedCards').element.style.display = 'block';
        moveCard(user, initiator, oZoneId, 'attachedCards', i);
        mouseClick.isActiveZone = oZoneId === 'active';
      }
      i--;
    }
  }
};
