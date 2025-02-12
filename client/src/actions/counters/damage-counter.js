import {
  oppContainerDocument,
  selfContainerDocument,
  systemState,
} from '../../front-end.js';
import { processAction } from '../../setup/general/process-action.js';
import { getZone } from '../../setup/zones/get-zone.js';

export const updateDamageCounter = (
  user,
  zoneId,
  index,
  damageAmount,
  emit = true
) => {
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'updateDamageCounter', [
      zoneId,
      index,
      damageAmount,
    ]);
    return;
  }

  const damageCounter = getZone(user, zoneId).array[index].image.damageCounter;
  if (damageCounter.textContent != damageAmount) {
    damageCounter.textContent = damageAmount;
  }

  processAction(user, emit, 'updateDamageCounter', [
    zoneId,
    index,
    damageAmount,
  ]);
};

export const removeDamageCounter = (user, zoneId, index, emit = true) => {
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'removeDamageCounter', [zoneId, index]);
    return;
  }

  const targetCard = getZone(user, zoneId).array[index];
  //make sure targetCard exists (it won't exist if it's already been removed)
  if (targetCard.image.damageCounter) {
    targetCard.image.damageCounter.removeEventListener(
      'input',
      targetCard.image.damageCounter.handleInput
    );
    targetCard.image.damageCounter.handleInput = null;
    targetCard.image.damageCounter.removeEventListener(
      'blur',
      targetCard.image.damageCounter.handleRemoveWrapper
    );
    targetCard.image.damageCounter.handleRemove = null;
    window.removeEventListener(
      'resize',
      targetCard.image.damageCounter.handleResize
    );
    targetCard.image.damageCounter.remove();
    targetCard.image.damageCounter = null;
  }

  processAction(user, emit, 'removeDamageCounter', [zoneId, index]);
};

export const addDamageCounter = (
  user,
  zoneId,
  index,
  damageAmount,
  emit = true
) => {
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'addDamageCounter', [
      zoneId,
      index,
      damageAmount,
    ]);
    return;
  }

  const zone = getZone(user, zoneId);
  const targetCard = zone.array[index];
  const targetRect = targetCard.image.getBoundingClientRect();
  const zoneElementRect = zone.element.getBoundingClientRect();

  let damageCounter = targetCard.image.damageCounter;
  //clean up existing event listeners
  if (damageCounter) {
    damageCounter.removeEventListener('input', damageCounter.handleInput);
    damageCounter.handleInput = null;
    damageCounter.removeEventListener(
      'blur',
      damageCounter.handleRemoveWrapper
    );
    damageCounter.handleRemove = null;
    window.removeEventListener('resize', damageCounter.handleResize);
  } else {
    if (user === 'self') {
      damageCounter = selfContainerDocument.createElement('div');
      damageCounter.className =
        systemState.initiator === 'self' ? 'self-circle' : 'opp-circle';
    } else {
      damageCounter = oppContainerDocument.createElement('div');
      damageCounter.className =
        systemState.initiator === 'self' ? 'opp-circle' : 'self-circle';
    }
    damageCounter.contentEditable = 'true';
    damageCounter.textContent = damageAmount ? damageAmount : '10';
  }

  damageCounter.style.display = 'inline-block';
  damageCounter.style.left = `${targetRect.left - zoneElementRect.left + targetRect.width / 1.5}px`;
  damageCounter.style.top = `${targetRect.top - zoneElementRect.top + targetRect.height / 4}px`;
  zone.element.appendChild(damageCounter);

  if (targetCard.image.parentElement.classList.contains('full-view')) {
    damageCounter.style.display = 'none';
  }
  //adjust size of the circle based on card size
  damageCounter.style.width = `${targetRect.width / 3}px`;
  damageCounter.style.height = `${targetRect.width / 3}px`;
  damageCounter.style.lineHeight = `${targetRect.width / 3}px`;
  damageCounter.style.fontSize = `${targetRect.width / 6}px`;
  damageCounter.style.zIndex = '1';

  const handleInput = () => {
    updateDamageCounter(user, zoneId, index, damageCounter.textContent);
  };

  const handleResize = () => {
    addDamageCounter(user, zoneId, index, false, false);
  };

  const handleRemove = (fromBlurEvent = false) => {
    //the reason the code below is repeated in removeDamageCounter is because it's difficult to get reference to the damage counter element when it's being removed through moving (i.e., move to hand)
    //since targetCard.image is already defined here, it's easier to deal with the removal on both sides separately when it's automatic removal, while still having the blur event function for manual removal.
    if (
      targetCard.image.damageCounter.textContent.trim() === '' ||
      targetCard.image.damageCounter.textContent <= 0
    ) {
      targetCard.image.damageCounter.removeEventListener(
        'input',
        targetCard.image.damageCounter.handleInput
      );
      targetCard.image.damageCounter.handleInput = null;
      targetCard.image.damageCounter.removeEventListener(
        'blur',
        targetCard.image.damageCounter.handleRemoveWrapper
      );
      targetCard.image.damageCounter.handleRemove = null;
      window.removeEventListener(
        'resize',
        targetCard.image.damageCounter.handleResize
      );
      targetCard.image.damageCounter.remove();
      targetCard.image.damageCounter = null;
      //manual removal
      if (fromBlurEvent) {
        removeDamageCounter(user, zoneId, index);
      }
    }
  };

  damageCounter.addEventListener('input', handleInput);
  damageCounter.handleInput = handleInput;

  damageCounter.handleRemoveWrapper = () => handleRemove(true);
  damageCounter.addEventListener('blur', damageCounter.handleRemoveWrapper);
  damageCounter.handleRemove = handleRemove;

  damageCounter.handleResize = handleResize;
  window.addEventListener('resize', handleResize);

  //save the damageCounter on the card
  targetCard.image.damageCounter = damageCounter;

  processAction(user, emit, 'addDamageCounter', [zoneId, index, damageAmount]);
};
