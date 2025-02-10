import {
  mouseClick,
  oppContainerDocument,
  selfContainerDocument,
} from '../../front-end.js';
import { refreshBoard } from '../../setup/sizing/refresh-board.js';
import { getZone } from '../../setup/zones/get-zone.js';

export const hideZoneElements = () => {
  const zonesToHide = [
    'deck',
    'discard',
    'attachedCards',
    'viewCards',
    'lostZone',
  ];

  zonesToHide.forEach((zoneId) => {
    selfContainerDocument.getElementById(zoneId).style.display = 'none';
    oppContainerDocument.getElementById(zoneId).style.display = 'none';
  });
};

const isOutsideZoneClick = (event, zone) => {
  if (!event) {
    return false;
  } else if (zone.element.contains(event.target)) {
    return false;
  } else if (zone.elementCover && zone.elementCover.contains(event.target)) {
    return false;
  } else if (event.target.id && event.target.id === 'fullImage') {
    return false;
  } else if (
    event.target.parentElement &&
    event.target.parentElement.id &&
    event.target.parentElement.id === 'fullImage'
  ) {
    return false;
  }
  return true;
};

export const hideZoneElementsIfEmpty = (event) => {
  const zoneIds = ['discard', 'lostZone', 'deck', 'attachedCards', 'viewCards'];
  const users = ['self', 'opp'];

  users.forEach((user) => {
    zoneIds.forEach((zoneId) => {
      const zone = getZone(user, zoneId);
      const outsideZoneClick = isOutsideZoneClick(event, zone);
      if (
        zone.getCount() === 0 ||
        (outsideZoneClick && !['attachedCards', 'viewCards'].includes(zoneId))
      ) {
        zone.element.style.display = 'none';
      } else if (
        zone.getCount() !== 0 &&
        ['attachedCards', 'viewCards'].includes(zoneId)
      ) {
        zone.element.style.display = 'block';
      }
    });
  });
};

export const deselectCard = () => {
  if (mouseClick.card) {
    mouseClick.card.image.classList.remove('highlight');
    mouseClick.selectingCard = false;

    const users = ['self', 'opp'];
    const zoneIds = ['active', 'bench'];

    users.forEach((user) => {
      zoneIds.forEach((zoneId) => {
        getZone(user, zoneId).array.forEach((card) => {
          card.image.classList.remove('selectHighlight');
        });
      });
    });
  }
};

export const closeFullView = (event) => {
  const fullViewElement =
    selfContainerDocument.querySelector('.full-view') ||
    oppContainerDocument.querySelector('.full-view');

  if (fullViewElement && (!event || !fullViewElement.contains(event.target))) {
    //use the !event as a guard for closeFullView to trigger when using the escape keybind
    // Revert the styles
    fullViewElement.className = 'play-container';
    fullViewElement.style.zIndex = '';
    fullViewElement.style.height = '';

    const allImages = fullViewElement.querySelectorAll('*');
    const targetImage = Array.from(allImages).filter((element) => {
      return !element.attached;
    });

    // Revert the position of the images
    const images = fullViewElement.querySelectorAll('img');
    images.forEach((image) => {
      image.classList.remove('default-rotation');
      if (image.attached) {
        image.style.position = 'absolute';
      }
    });

    const currentWidth = parseFloat(targetImage[0].clientWidth);
    const newWidth =
      currentWidth +
      (targetImage[0].clientWidth / 6) * targetImage[0].energyLayer;
    fullViewElement.style.width = newWidth + 'px';
    fullViewElement.style.zIndex = '0';

    // Revert the z-indexes
    fullViewElement.parentElement.style.zIndex = '0';
    document.getElementById('stadium').style.zIndex = '0';
    refreshBoard();
  }
};

export const closePopups = (event) => {
  deselectCard();
  closeFullView(event);
  hideZoneElementsIfEmpty(event);
  document.getElementById('cardContextMenu').style.display = 'none';
};
