import { systemState } from '../../front-end.js';
import { resetImage } from '../../setup/image-logic/reset-image.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { closePopups, deselectCard } from '../general/close-popups.js';
import { updateCount } from '../general/count.js';
import { hideCard, revealCard } from '../general/reveal-and-hide.js';
import { sort } from '../zones/general.js';
import { attachCard } from './attach-card.js';
import { autoMoveActiveBenchCard } from './auto-move-active-bench-card.js';
import { decreaseCardLayer } from './decrease-card-layer.js';
import { evolveCard } from './evolve-card.js';
import { initializeActiveBenchCard } from './initialize-active-bench-card.js';
import { relocateAttachedCards } from './relocate-attached-cards.js';
import { updateAttachedCardsPosition } from './update-attached-cards-position.js';
import { updateCounters } from './update-counters.js';
import { updateDestinationCover, updateOriginCover } from './update-cover.js';
import { updateStadiumCard } from './update-stadium-card.js';

export const moveCard = (
  user,
  initiator,
  oZoneId,
  dZoneId,
  index,
  targetIndex
) => {
  oZoneId = oZoneId.replace('Cover', '');
  dZoneId = dZoneId.replace('Cover', '');

  deselectCard(); //remove highlight from all images before moving cards

  // convert the string into the actual arrays/html elements
  const oZone = getZone(user, oZoneId);
  const dZone = getZone(user, dZoneId);

  // define the card that's being targeted, i.e., the pokemon that is being attached to, if a target index is defined
  let targetCard;
  if (typeof targetIndex === 'number') {
    targetCard = dZone.array[targetIndex];
  }
  // define the card that's being moved
  const movingCard = oZone.array[index];
  // move card from origin array to destination array
  dZone.array.push(...oZone.array.splice(index, 1));

  // update the cover of deck/discard/lostzone, if necessary
  updateOriginCover(user, oZoneId, index);

  // update the zIndex and positioning of any attached cards if they have shifted, i.e., shifting energies to the left if the movingcard an energy attached to a pokemon
  updateAttachedCardsPosition(oZone, movingCard);

  // if the image was attached to another image, decrease the level of layering on the base image, i.e., the count of how many attached cards there are
  //this is relevant for determining the location/adjustment for the future attached images
  if (movingCard.image.target === 'on') {
    decreaseCardLayer(movingCard);
  }

  //redraw trick. for some reason, sometimes images disappear, so we will use this trick to make sure they properly load in the DOM
  // const nonRedrawElements = ['active', 'bench', 'attachedCards'];
  // if (!nonRedrawElements.includes(dZoneId)){
  //     hideCard(user, movingCard);
  //     revealCard(user, movingCard);
  // };

  // determine whether to hide/reveal card
  const isP1HideZone =
    ['prizes'].includes(dZoneId) ||
    (document.getElementById('hideHandCheckbox').checked &&
      ['hand'].includes(dZoneId) &&
      systemState.initiator !== user);
  const isP2HideZone =
    ['hand'].includes(dZoneId) &&
    systemState.isTwoPlayer &&
    systemState.initiator !== user;
  const isFaceDownCard =
    movingCard.image.faceDown && ['active', 'bench', 'board'].includes(dZoneId);

  if (isP1HideZone || isP2HideZone || isFaceDownCard) {
    hideCard(user, movingCard);
    if (isP1HideZone || isP2HideZone) {
      movingCard.image.faceDown = false;
    }
  } else {
    revealCard(user, movingCard);
    movingCard.image.faceDown = false;
  }
  if (dZoneId !== oZoneId) {
    movingCard.image.public = false; //if the revealed card moves to another location, it no longer has the public status,
    //i.e., whether the card is faceup/facedown and how it's recorded in the battle log is dependent on dZone
  }

  // first, check if image is being attached to another card
  const activeOrBenchZone = ['active', 'bench'];
  const isTargetCardValid =
    targetCard &&
    activeOrBenchZone.includes(dZoneId) &&
    !targetCard.image.attached;
  const isAttachAllowed =
    !activeOrBenchZone.includes(oZoneId) || movingCard.image.attached;

  if (isTargetCardValid && isAttachAllowed) {
    if (movingCard.type === 'Pokémon' && !activeOrBenchZone.includes(oZoneId)) {
      evolveCard(user, initiator, movingCard, targetCard, dZoneId, dZone);
    } else {
      attachCard(user, initiator, movingCard, targetCard, dZoneId, dZone);
    }
    // if image is not being attached to another card, proceed with normal card move
  } else {
    resetImage(movingCard.image, dZoneId);

    //special initialization is needed for cards in the active and bench since pokemon has its own container with its attached cards
    if (activeOrBenchZone.includes(dZoneId)) {
      initializeActiveBenchCard(user, movingCard, dZoneId, dZone);
    } else {
      dZone.element.appendChild(movingCard.image);
    }
    //update the cover of the deck/lostzone/discard if applicable
    updateDestinationCover(user, movingCard, dZoneId);
    //automatically move cards from the active to the bench and vice versa, if applicable
    autoMoveActiveBenchCard(
      user,
      initiator,
      movingCard,
      targetCard,
      oZoneId,
      oZone,
      dZoneId,
      dZone,
      targetIndex
    );
    //automatically bump any existing stadiums and make sure it's facing right-side-up for the user
    updateStadiumCard(user, initiator, dZoneId, dZone);
  }

  const zonesWithAttachedCards = ['active', 'bench', 'attachedCards'];
  // deal with any attached cards
  if (zonesWithAttachedCards.includes(oZoneId) && !movingCard.image.attached) {
    relocateAttachedCards(
      user,
      initiator,
      movingCard,
      oZoneId,
      oZone,
      dZoneId,
      dZone
    );
  }
  //update the ability, special condtion, and damage counters on all applicable cards
  updateCounters(user, movingCard, oZoneId, oZone, dZoneId, dZone);

  //reset type classification of the card if the card is no longer in play
  if (
    !['active', 'board', 'bench', 'attachedCards'].includes(dZoneId) &&
    movingCard.type2
  ) {
    movingCard.type = movingCard.type2;
  }
  //update counter texts
  updateCount();

  //hide any empty arrays, such as attachedCards or viewCards if there's no more cards left
  closePopups();

  //sort the array, if applicable
  if (['deck', 'lostZone', 'discard', 'hand'].includes(dZoneId)) {
    sort(user, dZoneId);
  }
};
