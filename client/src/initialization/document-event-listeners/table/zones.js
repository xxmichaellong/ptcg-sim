import {
  oppContainerDocument,
  selfContainerDocument,
} from '../../../front-end.js';
import { dragLeave, dragOver, drop } from '../../../setup/image-logic/drag.js';

const addZoneEventListeners = (zoneElement) => {
  zoneElement.addEventListener('dragover', dragOver);
  zoneElement.addEventListener('dragleave', dragLeave);
  zoneElement.addEventListener('drop', drop);
};

export const initializeZones = () => {
  const zoneIds = [
    'hand',
    'prizes',
    'active',
    'bench',
    'deck',
    'discard',
    'lostZone',
    'deckCover',
    'discardCover',
    'lostZoneCover',
    'stadium',
    'board',
    'viewCards',
    'attachedCards',
  ];

  zoneIds.forEach((zoneId) => {
    if (zoneId === 'stadium') {
      const element = document.getElementById(zoneId);
      addZoneEventListeners(element);
    } else {
      const selfElement = selfContainerDocument.getElementById(zoneId);
      addZoneEventListeners(selfElement);
      const oppElement = oppContainerDocument.getElementById(zoneId);
      addZoneEventListeners(oppElement);
    }
  });
};
