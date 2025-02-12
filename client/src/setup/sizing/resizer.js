import { addAbilityCounter } from '../../actions/counters/ability-counter.js';
import { addDamageCounter } from '../../actions/counters/damage-counter.js';
import { addSpecialCondition } from '../../actions/counters/special-condition.js';
import { closeFullView } from '../../actions/general/close-popups.js';
import {
  oppContainer,
  oppContainerDocument,
  selfContainer,
  selfContainerDocument,
} from '../../front-end.js';
import { getZone } from '../zones/get-zone.js';
import { adjustAlignment } from './adjust-alignment.js';

// Create the overlay div
const overlay = document.createElement('div');
overlay.style.position = 'fixed';
overlay.style.top = 0;
overlay.style.right = 0;
overlay.style.bottom = 0;
overlay.style.left = 0;
overlay.style.zIndex = 1000; // Adjust as needed

const handElement = selfContainerDocument.getElementById('hand');
const oppHandElement = oppContainerDocument.getElementById('hand');
const boardButtonContainer = document.getElementById('boardButtonContainer');
const stadiumElement = document.getElementById('stadium');
const selfResizer = document.getElementById('selfResizer');
const oppResizer = document.getElementById('oppResizer');

export const selfHandleMouseDown = (e) => {
  e.preventDefault();
  window.addEventListener('mousemove', selfResize);
  document.addEventListener('mouseup', stopSelfResize);

  // Add the overlay to the body
  document.body.appendChild(overlay);
  closeFullView(e);
};
export const oppHandleMouseDown = (e) => {
  e.preventDefault();
  window.addEventListener('mousemove', oppResize);
  document.addEventListener('mouseup', stopOppResize);
  // Add the overlay to the body
  document.body.appendChild(overlay);
  closeFullView(e);
};
export const stopSelfResize = () => {
  window.removeEventListener('mousemove', selfResize);
  document.removeEventListener('mouseup', stopSelfResize);
  // Remove the overlay from the body
  document.body.removeChild(overlay);
};
export const stopOppResize = () => {
  window.removeEventListener('mousemove', oppResize);
  document.removeEventListener('mouseup', stopOppResize);
  // Remove the overlay from the body
  document.body.removeChild(overlay);
};

export const selfResize = (e) => {
  [handElement, oppHandElement].forEach(adjustAlignment);

  const oldSelfHeight = parseInt(selfContainer.offsetHeight);
  const oldOppHeight = parseInt(oppContainer.offsetHeight);
  const clientY = Math.max(
    0,
    Math.min(e.clientY, window.innerHeight + window.innerHeight * 0.01)
  );
  let newSelfHeight =
    ((window.innerHeight - clientY) / window.innerHeight) * 100 + 1;
  let newOppHeight = 100 - newSelfHeight;

  // Apply the new heights
  selfContainer.style.height = Math.max(1, newSelfHeight) + '%';

  // Apply the new bottom position
  selfResizer.style.bottom = 100 - (clientY / window.innerHeight) * 100 + '%';
  newSelfHeight = parseInt(selfContainer.offsetHeight);
  const selfRatio = newSelfHeight / oldSelfHeight;
  // Readjust the width of containers on the active/bench
  adjustCards('self', 'bench', selfRatio);
  adjustCards('self', 'active', selfRatio);

  let selfResizerBottom = parseInt(
    window.getComputedStyle(selfResizer).getPropertyValue('bottom')
  );
  let oppResizerBottom = parseInt(
    window.getComputedStyle(oppResizer).getPropertyValue('bottom')
  );

  oppResizer.style.bottom = oppResizer.style.bottom
    ? oppResizer.style.bottom
    : '51%';
  if (selfResizerBottom + selfResizer.offsetHeight > oppResizerBottom) {
    oppResizer.style.bottom =
      100 + 2 - (clientY / window.innerHeight) * 100 + '%';
    oppContainer.style.height = Math.max(1, newOppHeight) + '%';
    oppContainer.style.bottom =
      100 + 1 - (clientY / window.innerHeight) * 100 + '%';
    newOppHeight = parseInt(oppContainer.offsetHeight);
    const oppRatio = newOppHeight / oldOppHeight;
    adjustCards('opp', 'bench', oppRatio);
    adjustCards('opp', 'active', oppRatio);
  }
  stadiumElement.style.bottom =
    Math.min(
      84,
      (parseFloat(oppResizer.style.bottom) +
        parseFloat(selfResizer.style.bottom)) /
        2 -
        8
    ) + '%';
  boardButtonContainer.style.bottom =
    Math.min(
      90,
      (parseFloat(oppResizer.style.bottom) +
        parseFloat(selfResizer.style.bottom)) /
        2 -
        3
    ) + '%';
  oppResizer.style.height = '2%';
  if (parseFloat(oppResizer.style.bottom) > 100) {
    oppResizer.style.height = '6%';
  }
  selfResizer.style.height = '2%';
  if (parseFloat(selfResizer.style.bottom) < 0) {
    selfResizer.style.height = '6%';
  }
};

export const oppResize = (e) => {
  [handElement, oppHandElement].forEach(adjustAlignment);

  const oldSelfHeight = parseInt(selfContainer.offsetHeight);
  const oldOppHeight = parseInt(oppContainer.offsetHeight);

  const clientY = Math.max(
    -window.innerHeight * 0.01,
    Math.min(e.clientY, window.innerHeight)
  ); // Calculate the new heights
  let newSelfHeight =
    ((window.innerHeight - clientY) / window.innerHeight) * 100 - 1;
  let newOppHeight = 100 - newSelfHeight;

  oppResizer.style.bottom = 100 - (clientY / window.innerHeight) * 100 + '%';
  oppContainer.style.height = Math.max(1, newOppHeight) + '%';
  oppContainer.style.bottom =
    100 - 1 - (clientY / window.innerHeight) * 100 + '%';
  newOppHeight = parseInt(oppContainer.offsetHeight);
  const oppRatio = newOppHeight / oldOppHeight;
  adjustCards('opp', 'bench', oppRatio);
  adjustCards('opp', 'active', oppRatio);

  let selfResizerBottom = parseInt(
    window.getComputedStyle(selfResizer).getPropertyValue('bottom')
  );
  let oppResizerBottom = parseInt(
    window.getComputedStyle(oppResizer).getPropertyValue('bottom')
  );

  selfResizer.style.bottom = selfResizer.style.bottom
    ? selfResizer.style.bottom
    : '49%';
  if (selfResizerBottom + selfResizer.offsetHeight > oppResizerBottom) {
    selfContainer.style.height = Math.max(1, newSelfHeight) + '%';
    selfResizer.style.bottom =
      100 - 2 - (clientY / window.innerHeight) * 100 + '%';
    newSelfHeight = parseInt(selfContainer.offsetHeight);
    const selfRatio = newSelfHeight / oldSelfHeight;
    adjustCards('self', 'bench', selfRatio);
    adjustCards('self', 'active', selfRatio);
  }
  stadiumElement.style.bottom =
    Math.min(
      84,
      (parseFloat(oppResizer.style.bottom) +
        parseFloat(selfResizer.style.bottom)) /
        2 -
        8
    ) + '%';
  boardButtonContainer.style.bottom =
    Math.min(
      90,
      (parseFloat(oppResizer.style.bottom) +
        parseFloat(selfResizer.style.bottom)) /
        2 -
        3
    ) + '%';
  oppResizer.style.height = '2%';
  if (parseFloat(oppResizer.style.bottom) > 100) {
    oppResizer.style.height = '6%';
  }
  selfResizer.style.height = '2%';
  if (parseFloat(selfResizer.style.bottom) < 0) {
    selfResizer.style.height = '6%';
  }
};

export const adjustCards = (user, zoneId, ratio) => {
  const zone = getZone(user, zoneId);
  zone.array.forEach((card) => {
    if (card.image.attached) {
      if (card.type === 'Pokémon') {
        const oldBottom = parseFloat(card.image.style.bottom);
        const newBottom = oldBottom * ratio;
        card.image.style.bottom = `${newBottom}px`;
      } else {
        const oldLeft = parseFloat(card.image.style.left);
        const newLeft = oldLeft * ratio;
        card.image.style.left = `${newLeft}px`;
      }
    } else {
      const baseWidth = parseFloat(card.image.clientWidth);
      const adjustment = parseFloat(card.image.clientWidth / 6);
      const newWidth =
        (baseWidth + card.image.energyLayer * adjustment) * ratio;
      card.image.parentElement.style.width = `${newWidth}px`;
    }
    if (card.image.damageCounter) {
      const index = zone.array.findIndex((loopCard) => loopCard === card);
      addDamageCounter(user, zoneId, index, false, false);
    }
    if (card.image.specialCondition) {
      const index = zone.array.findIndex((loopCard) => loopCard === card);
      addSpecialCondition(user, zoneId, index, false);
    }
    if (card.image.abilityCounter) {
      const index = zone.array.findIndex((loopCard) => loopCard === card);
      addAbilityCounter(user, zoneId, index);
    }
  });
};

export const flippedSelfHandleMouseDown = (e) => {
  e.preventDefault();
  window.addEventListener('mousemove', flippedSelfResize);
  document.addEventListener('mouseup', flippedStopSelfResize);
  // Add the overlay to the body
  document.body.appendChild(overlay);
  closeFullView(e);
};
export const flippedOppHandleMouseDown = (e) => {
  e.preventDefault();
  window.addEventListener('mousemove', flippedOppResize);
  document.addEventListener('mouseup', flippedStopOppResize);
  // Add the overlay to the body
  document.body.appendChild(overlay);
  closeFullView(e);
};
export const flippedStopSelfResize = () => {
  window.removeEventListener('mousemove', flippedSelfResize);
  document.removeEventListener('mouseup', flippedStopSelfResize);
  // Remove the overlay from the body
  document.body.removeChild(overlay);
};
export const flippedStopOppResize = () => {
  window.removeEventListener('mousemove', flippedOppResize);
  document.removeEventListener('mouseup', flippedStopOppResize);
  // Remove the overlay from the body
  document.body.removeChild(overlay);
};

export const flippedSelfResize = (e) => {
  [handElement, oppHandElement].forEach(adjustAlignment);

  const oldSelfHeight = parseInt(selfContainer.offsetHeight);
  const oldOppHeight = parseInt(oppContainer.offsetHeight);

  const clientY = Math.max(1, Math.min(e.clientY, window.innerHeight - 1));
  let newOppHeight =
    ((window.innerHeight - clientY) / window.innerHeight) * 100;
  let newSelfHeight = 100 - newOppHeight;

  // Apply the new heights
  oppContainer.style.height = newOppHeight + '%';

  // Apply the new bottom position
  selfResizer.style.bottom =
    100 - 1 - (clientY / window.innerHeight) * 100 + '%';
  newOppHeight = parseInt(oppContainer.offsetHeight);
  const oppRatio = newOppHeight / oldOppHeight;
  // Readjust the width of containers on the active/bench
  adjustCards('opp', 'bench', oppRatio);
  adjustCards('opp', 'active', oppRatio);

  let selfResizerBottom = parseInt(
    window.getComputedStyle(selfResizer).getPropertyValue('bottom')
  );
  let oppResizerBottom = parseInt(
    window.getComputedStyle(oppResizer).getPropertyValue('bottom')
  );

  oppResizer.style.bottom = oppResizer.style.bottom
    ? oppResizer.style.bottom
    : '51%';
  if (selfResizerBottom + selfResizer.offsetHeight > oppResizerBottom) {
    oppResizer.style.bottom =
      100 + 1 - (clientY / window.innerHeight) * 100 + '%';
    selfContainer.style.height = newSelfHeight + '%';
    selfContainer.style.bottom =
      100 - (clientY / window.innerHeight) * 100 + '%';
    newSelfHeight = parseInt(selfContainer.offsetHeight);
    const selfRatio = newSelfHeight / oldSelfHeight;
    adjustCards('self', 'bench', selfRatio);
    adjustCards('self', 'active', selfRatio);
  }
  stadiumElement.style.bottom =
    Math.min(
      84,
      (parseFloat(selfResizer.style.bottom) +
        parseFloat(oppResizer.style.bottom)) /
        2 -
        8
    ) + '%';
  boardButtonContainer.style.bottom =
    Math.min(
      90,
      (parseFloat(selfResizer.style.bottom) +
        parseFloat(oppResizer.style.bottom)) /
        2 -
        3
    ) + '%';
  oppResizer.style.height = '2%';
  if (parseFloat(oppResizer.style.bottom) > 100) {
    oppResizer.style.height = '5%';
  }
  selfResizer.style.height = '2%';
  if (parseFloat(selfResizer.style.bottom) < 0) {
    selfResizer.style.height = '6%';
  }
};

export const flippedOppResize = (e) => {
  [handElement, oppHandElement].forEach(adjustAlignment);

  const oldSelfHeight = parseInt(selfContainer.offsetHeight);
  const oldOppHeight = parseInt(oppContainer.offsetHeight);

  const clientY = Math.max(1, Math.min(e.clientY, window.innerHeight - 1)); // Calculate the new heights
  let newOppHeight =
    ((window.innerHeight - clientY) / window.innerHeight) * 100;
  let newSelfHeight = 100 - newOppHeight;

  oppResizer.style.bottom =
    100 + 1 - (clientY / window.innerHeight) * 100 + '%';
  selfContainer.style.height = newSelfHeight + '%';
  selfContainer.style.bottom = 100 - (clientY / window.innerHeight) * 100 + '%';
  newSelfHeight = parseInt(selfContainer.offsetHeight);
  const selfRatio = newSelfHeight / oldSelfHeight;
  adjustCards('self', 'bench', selfRatio);
  adjustCards('self', 'active', selfRatio);

  let selfResizerBottom = parseInt(
    window.getComputedStyle(selfResizer).getPropertyValue('bottom')
  );
  let oppResizerBottom = parseInt(
    window.getComputedStyle(oppResizer).getPropertyValue('bottom')
  );

  selfResizer.style.bottom = selfResizer.style.bottom
    ? selfResizer.style.bottom
    : '49%';
  if (selfResizerBottom + selfResizer.offsetHeight > oppResizerBottom) {
    oppContainer.style.height = newOppHeight + '%';
    selfResizer.style.bottom =
      100 - 1 - (clientY / window.innerHeight) * 100 + '%';
    newOppHeight = parseInt(oppContainer.offsetHeight);
    const oppRatio = newOppHeight / oldOppHeight;
    adjustCards('opp', 'bench', oppRatio);
    adjustCards('opp', 'active', oppRatio);
  }
  stadiumElement.style.bottom =
    Math.min(
      84,
      (parseFloat(selfResizer.style.bottom) +
        parseFloat(oppResizer.style.bottom)) /
        2 -
        8
    ) + '%';
  boardButtonContainer.style.bottom =
    Math.min(
      90,
      (parseFloat(selfResizer.style.bottom) +
        parseFloat(oppResizer.style.bottom)) /
        2 -
        3
    ) + '%';
  oppResizer.style.height = '2%';
  if (parseFloat(oppResizer.style.bottom) > 100) {
    oppResizer.style.height = '5%';
  }
  selfResizer.style.height = '2%';
  if (parseFloat(selfResizer.style.bottom) < 0) {
    selfResizer.style.height = '6%';
  }
};
