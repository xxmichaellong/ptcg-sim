import { VSTARGXFunction } from '../../../actions/general/VSTAR-GX.js';
import { flipBoard } from '../../../actions/general/flip-board.js';
import { flipCoin } from '../../../actions/general/flip-coin.js';
import { takeTurn } from '../../../actions/general/take-turn.js';
import {
  oppContainerDocument,
  selfContainerDocument,
  systemState,
} from '../../../front-end.js';
import { refreshBoardImages } from '../../../setup/sizing/refresh-board.js';

export const initializeBoardButtons = () => {
  const turnButton = document.getElementById('turnButton');
  turnButton.addEventListener('click', () =>
    takeTurn(systemState.initiator, systemState.initiator)
  );

  const flipCoinButton = document.getElementById('flipCoinButton');
  flipCoinButton.addEventListener('click', () =>
    flipCoin(systemState.initiator)
  );

  const flipBoardButton = document.getElementById('flipBoardButton');
  flipBoardButton.addEventListener('click', flipBoard);

  const refreshButton = document.getElementById('refreshButton');
  refreshButton.addEventListener('click', refreshBoardImages);

  const fullscreenPlaymatButton = document.getElementById(
    'fullscreenPlaymatButton'
  );
  fullscreenPlaymatButton.addEventListener('click', () => {
    // Get all sidebox elements and the top button container
    const sideboxes = document.querySelectorAll('.sidebox');
    const topButtonContainer = document.getElementById('topButtonContainer');
    const greyFiller = document.getElementById('greyFiller');

    // Check if sideboxes are currently visible
    const isVisible = sideboxes[0] && sideboxes[0].style.display !== 'none';

    // Toggle the CSS class on body for layout adjustments
    document.body.classList.toggle('sidebox-hidden', isVisible);

    // Toggle background position based on sidebox visibility
    if (isVisible) {
      // Sidebox is being hidden (going to fullscreen) - normal background position
      document.body.style.backgroundPosition = '';
    } else {
      // Sidebox is being shown - shift background
      document.body.style.backgroundPosition = '-200px 0';
    }

    // Toggle visibility of all sidebox elements
    sideboxes.forEach((sidebox) => {
      sidebox.style.display = isVisible ? 'none' : '';
    });

    // Also toggle the top button container and grey filler
    if (topButtonContainer) {
      topButtonContainer.style.display = isVisible ? 'none' : '';
    }
    if (greyFiller) {
      greyFiller.style.display = isVisible ? 'none' : '';
    }
  });

  const selfVSTARButton = selfContainerDocument.getElementById('VSTARButton');
  selfVSTARButton.addEventListener('click', () => {
    if (
      !(
        systemState.isTwoPlayer &&
        document.getElementById('spectatorModeCheckbox').checked
      ) &&
      !systemState.isReplay
    ) {
      VSTARGXFunction('self', 'VSTAR');
    }
  });

  const selfGXButton = selfContainerDocument.getElementById('GXButton');
  selfGXButton.addEventListener('click', () => {
    if (
      !(
        systemState.isTwoPlayer &&
        document.getElementById('spectatorModeCheckbox').checked
      ) &&
      !systemState.isReplay
    ) {
      VSTARGXFunction('self', 'GX');
    }
  });

  const oppVSTARButton = oppContainerDocument.getElementById('VSTARButton');
  oppVSTARButton.addEventListener('click', () => {
    if (
      !(
        systemState.isTwoPlayer &&
        document.getElementById('spectatorModeCheckbox').checked
      ) &&
      !systemState.isReplay
    ) {
      VSTARGXFunction('opp', 'VSTAR');
    }
  });

  const oppGXButton = oppContainerDocument.getElementById('GXButton');
  oppGXButton.addEventListener('click', () => {
    if (
      !(
        systemState.isTwoPlayer &&
        document.getElementById('spectatorModeCheckbox').checked
      ) &&
      !systemState.isReplay
    ) {
      VSTARGXFunction('opp', 'GX');
    }
  });
};
