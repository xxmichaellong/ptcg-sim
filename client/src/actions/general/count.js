import {
  oppContainerDocument,
  selfContainerDocument,
} from '../../front-end.js';
import { getZone } from '../../setup/zones/get-zone.js';

export const updateCount = () => {
  const zoneIds = ['deck', 'discard', 'lostZone', 'hand'];

  zoneIds.forEach((zoneId) => {
    const selfZoneCount = selfContainerDocument.getElementById(
      `${zoneId}Count`
    );
    const oppZoneCount = oppContainerDocument.getElementById(`${zoneId}Count`);

    selfZoneCount.textContent = getZone('self', zoneId).getCount();
    oppZoneCount.textContent = getZone('opp', zoneId).getCount();
  });
};
