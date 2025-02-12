import {
  oppContainerDocument,
  selfContainerDocument,
  systemState,
} from '../../front-end.js';
import { processAction } from '../../setup/general/process-action.js';
import { getZone } from '../../setup/zones/get-zone.js';

export const removeAbilityCounter = (user, zoneId, index, emit = true) => {
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'removeAbilityCounter', [zoneId, index]);
    return;
  }

  const targetCard = getZone(user, zoneId).array[index];
  //make sure targetCard exists (it won't exist if it's already been removed)
  if (targetCard.image.abilityCounter) {
    targetCard.image.abilityCounter.handleRemove = null;
    window.removeEventListener(
      'resize',
      targetCard.image.abilityCounter.handleResize
    );
    targetCard.image.abilityCounter.remove();
    targetCard.image.abilityCounter = null;
  }

  processAction(user, emit, 'removeAbilityCounter', [zoneId, index]);
};

export const addAbilityCounter = (user, zoneId, index) => {
  //identify target image and zone
  const zone = getZone(user, zoneId);
  const targetCard = zone.array[index];
  const targetRect = targetCard.image.getBoundingClientRect();
  const zoneElementRect = zone.element.getBoundingClientRect();

  let abilityCounter = targetCard.image.abilityCounter;
  //clean up existing event listeners
  if (abilityCounter) {
    abilityCounter.handleRemove = null;
    window.removeEventListener('resize', abilityCounter.handleResize);
  } else {
    if (zoneId !== 'stadium') {
      if (user === 'self') {
        abilityCounter = selfContainerDocument.createElement('div');
        abilityCounter.className = 'self-tab';
      } else {
        abilityCounter = oppContainerDocument.createElement('div');
        abilityCounter.className = 'opp-tab';
      }
    } else {
      abilityCounter = document.createElement('div');
      abilityCounter.className = 'tab';
    }
  }

  abilityCounter.style.display = 'inline-block';
  abilityCounter.style.width = `${targetRect.width}px`;
  abilityCounter.style.height = `${targetRect.width / 5}px`;
  abilityCounter.style.lineHeight = `${targetRect.width / 3}px`;
  abilityCounter.style.zIndex = '1';

  if (systemState.initiator === user) {
    abilityCounter.style.right = '';
    abilityCounter.style.bottom = '';
    abilityCounter.style.left = `${targetRect.left - zoneElementRect.left}px`;
    abilityCounter.style.top = `${targetRect.top - zoneElementRect.top + targetRect.height / 2}px`;
  } else {
    abilityCounter.style.left = '';
    abilityCounter.style.top = '';
    abilityCounter.style.right = '';
    if (zoneId === 'discard') {
      abilityCounter.style.right = `${targetRect.left - zoneElementRect.left}px`;
    } else {
      abilityCounter.style.left = `${targetRect.left - zoneElementRect.left}px`;
    }
    abilityCounter.style.bottom = `${targetRect.top - zoneElementRect.top + targetRect.height / 2 - parseFloat(abilityCounter.style.height)}px`;
  }
  zone.element.appendChild(abilityCounter);

  if (targetCard.image.parentElement.classList.contains('full-view')) {
    abilityCounter.style.display = 'none';
  }

  const handleResize = () => {
    addAbilityCounter(user, zoneId, index);
  };

  const handleRemove = (emit = true) => {
    targetCard.image.abilityCounter.handleRemove = null;
    window.removeEventListener(
      'resize',
      targetCard.image.abilityCounter.handleResize
    );
    targetCard.image.abilityCounter.remove();
    targetCard.image.abilityCounter = null;

    if (emit) {
      removeAbilityCounter(user, zoneId, index, emit);
    }
  };

  //attach functions to abilityCounter so they can accessed later to handle changes to it
  abilityCounter.handleRemove = handleRemove;
  abilityCounter.handleResize = handleResize;
  window.addEventListener('resize', handleResize);

  //save the abilityCounter on the card
  targetCard.image.abilityCounter = abilityCounter;
};
