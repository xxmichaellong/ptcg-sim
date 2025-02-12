import {
  oppContainerDocument,
  selfContainerDocument,
} from '../../front-end.js';
import { adjustAlignment } from '../../setup/sizing/adjust-alignment.js';

export const initializeHandObserver = () => {
  const handElement = selfContainerDocument.getElementById('hand');
  const oppHandElement = oppContainerDocument.getElementById('hand');

  const handObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        [handElement, oppHandElement].forEach(adjustAlignment);
      }
    });
  });

  // Options for the observer (which mutations to observe)
  const handConfig = { childList: true };

  // Start observing the target nodes for configured mutations
  [handElement, oppHandElement].forEach((target) => {
    handObserver.observe(target, handConfig);
  });
};
