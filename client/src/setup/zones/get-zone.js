import {
  oppContainerDocument,
  selfContainerDocument,
} from '../../front-end.js';

const selfZoneArrays = {
  deck: [],
  lostZone: [],
  discard: [],
  prizes: [],
  active: [],
  bench: [],
  hand: [],
  attachedCards: [],
  viewCards: [],
  board: [],
};

const oppZoneArrays = {
  deck: [],
  lostZone: [],
  discard: [],
  prizes: [],
  active: [],
  bench: [],
  hand: [],
  attachedCards: [],
  viewCards: [],
  board: [],
};

const neutralZoneArrays = {
  stadium: [],
};

export const getZone = (user, zoneId) => {
  let documentType;
  let zoneArrays;
  if (zoneId === 'stadium') {
    documentType = document;
    zoneArrays = neutralZoneArrays;
  } else {
    documentType =
      user === 'self' ? selfContainerDocument : oppContainerDocument;
    zoneArrays = user === 'self' ? selfZoneArrays : oppZoneArrays;
  }

  let element;
  let elementCover;
  if (zoneId.includes('Cover')) {
    elementCover = documentType.getElementById(zoneId);
    zoneId = zoneId.replace('Cover', '');
    element = documentType.getElementById(zoneId);
  } else {
    element = documentType.getElementById(zoneId);
    if (['deck', 'discard', 'lostZone'].includes(zoneId)) {
      elementCover = documentType.getElementById(zoneId + 'Cover');
    }
  }

  const array = zoneArrays[zoneId];

  const getCount = () => {
    return array ? array.length : 0;
  };

  return { array, element, elementCover, getCount };
};
