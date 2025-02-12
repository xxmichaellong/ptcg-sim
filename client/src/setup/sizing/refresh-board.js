import { rotateCard } from '../../actions/general/rotate-card.js';
import { moveCard } from '../../actions/move-card-bundle/move-card.js';
import { getZone } from '../zones/get-zone.js';
import { adjustCards } from './resizer.js';

const refreshZone = (user, zoneId) => {
  const zone = getZone(user, zoneId);
  // find all playContainers
  const playContainers = zone.element.querySelectorAll('DIV');
  playContainers.forEach((playContainer) => {
    // find all images within box
    const images = playContainer.querySelectorAll('img');
    // loop through each image and update the attached cards
    images.forEach((image) => {
      const img = new Image();
      img.src = image.src;
      document.body.appendChild(img);
      document.body.removeChild(img);
      if (!image.attached) {
        // re-append the card to the end of the same zone
        let currentRotation;
        if (image.PokémonBreak) {
          currentRotation =
            (parseInt(image.style.transform.replace(/[^0-9-]/g, '')) || 0) - 90;
        } else {
          currentRotation =
            parseInt(image.style.transform.replace(/[^0-9-]/g, '')) || 0;
        }
        const numberRotations = currentRotation / 90;
        const index = zone.array.findIndex((card) => card.image === image);
        moveCard(user, user, zoneId, zoneId, index);
        const newIndex = zone.array.findIndex((card) => card.image === image);
        for (let i = 0; i < numberRotations; i++) {
          rotateCard(user, zoneId, newIndex, false, false);
        }
      }
    });
  });
  adjustCards(user, zoneId, 1);
};

export const refreshBoard = () => {
  const zones = [
    ['self', 'active'],
    ['self', 'bench'],
    ['opp', 'active'],
    ['opp', 'bench'],
  ];
  zones.forEach(([user, zoneId]) => {
    refreshZone(user, zoneId);
  });
};

export const refreshBoardImages = () => {
  document.getElementById('refreshIcon').style.display = 'none';
  document.getElementById('loadingCircle').style.display = 'block';
  const zones = [
    ['self', 'active'],
    ['self', 'bench'],
    ['opp', 'active'],
    ['opp', 'bench'],
    ['self', 'deck'],
    ['self', 'prizes'],
    ['opp', 'deck'],
    ['opp', 'prizes'],
  ];

  const reloadImages = (images) => {
    // Convert images to an array
    const imagesArray = Array.from(images);
    return Promise.all(
      imagesArray.map((image) => {
        return new Promise((resolve) => {
          image.onload = () => resolve();
          image.onerror = () => resolve();
          // eslint-disable-next-line no-self-assign
          image.src = image.src;
        });
      })
    );
  };

  const loadImagesForZone = ([user, zoneId]) => {
    const promises = [];
    const zone = getZone(user, zoneId);
    if (zoneId === 'deck') {
      const images = zone.elementCover.querySelectorAll('img');
      promises.push(reloadImages(images));
    } else if (zoneId === 'prizes') {
      const images = zone.element.querySelectorAll('img');
      promises.push(reloadImages(images));
    } else {
      const playContainers = zone.element.querySelectorAll('div');
      playContainers.forEach((playContainer) => {
        const images = playContainer.querySelectorAll('img');
        promises.push(reloadImages(images));
      });
    }
    return Promise.all(promises);
  };

  Promise.all(zones.map((zone) => loadImagesForZone(zone))).finally(() => {
    document.getElementById('refreshIcon').style.display = 'block';
    document.getElementById('loadingCircle').style.display = 'none';
    refreshBoard();
  });
};
