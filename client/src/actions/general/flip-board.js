import {
  oppContainer,
  oppContainerDocument,
  selfContainer,
  selfContainerDocument,
  systemState,
} from '../../front-end.js';
import { refreshBoard } from '../../setup/sizing/refresh-board.js';
import {
  flippedOppHandleMouseDown,
  flippedSelfHandleMouseDown,
  oppHandleMouseDown,
  selfHandleMouseDown,
} from '../../setup/sizing/resizer.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { lookAtCards, stopLookingAtCards } from './reveal-and-hide.js';

export const flipBoard = () => {
  const selfResizer = document.getElementById('selfResizer');
  const oppResizer = document.getElementById('oppResizer');
  const attackButton = document.getElementById('attackButton');
  const passButton = document.getElementById('passButton');
  const undoButton = document.getElementById('undoButton');
  const FREEBUTTON = document.getElementById('FREEBUTTON');
  const setupButton = document.getElementById('setupButton');
  const resetButton = document.getElementById('resetButton');
  const p2AttackButton = document.getElementById('p2AttackButton');
  const p2PassButton = document.getElementById('p2PassButton');
  // const p2UndoButton = document.getElementById('p2UndoButton');
  const p2FREEBUTTON = document.getElementById('p2FREEBUTTON');
  const p2SetupButton = document.getElementById('p2SetupButton');
  const p2ResetButton = document.getElementById('p2ResetButton');
  const boardElement = selfContainerDocument.getElementById('board');
  const oppBoardElement = oppContainerDocument.getElementById('board');
  const viewCardsElement = selfContainerDocument.getElementById('viewCards');
  const oppViewCardsElement = oppContainerDocument.getElementById('viewCards');

  if (systemState.initiator === 'self') {
    selfResizer.removeEventListener('mousedown', selfHandleMouseDown);
    oppResizer.removeEventListener('mousedown', oppHandleMouseDown);
    selfResizer.addEventListener('mousedown', flippedSelfHandleMouseDown);
    oppResizer.addEventListener('mousedown', flippedOppHandleMouseDown);

    if (
      systemState.isTwoPlayer ||
      (!systemState.isTwoPlayer &&
        document.getElementById('hideHandCheckbox').checked)
    ) {
      lookAtCards('opp', '', 'hand', false, true);
      stopLookingAtCards('self', '', 'hand', false, true);
    }
  } else {
    selfResizer.addEventListener('mousedown', selfHandleMouseDown);
    oppResizer.addEventListener('mousedown', oppHandleMouseDown);
    selfResizer.removeEventListener('mousedown', flippedSelfHandleMouseDown);
    oppResizer.removeEventListener('mousedown', flippedOppHandleMouseDown);

    if (
      systemState.isTwoPlayer ||
      (!systemState.isTwoPlayer &&
        document.getElementById('hideHandCheckbox').checked)
    ) {
      lookAtCards('self', '', 'hand', false, true);
      stopLookingAtCards('opp', '', 'hand', false, true);
    }
  }

  viewCardsElement.classList.toggle('flip-image');
  oppViewCardsElement.classList.toggle('flip-image');

  const toggleClasses = (element, class1, class2) => {
    element.classList.toggle(class1);
    element.classList.toggle(class2);
  };

  toggleClasses(selfResizer, 'self-color', 'opp-color');
  toggleClasses(oppResizer, 'opp-color', 'self-color');
  toggleClasses(selfContainer, 'self', 'opp');
  toggleClasses(oppContainer, 'opp', 'self');
  toggleClasses(boardElement, 'self-board', 'opp-board');
  toggleClasses(oppBoardElement, 'opp-board', 'self-board');
  toggleClasses(attackButton, 'self-color', 'opp-color');
  toggleClasses(passButton, 'self-color', 'opp-color');
  toggleClasses(undoButton, 'self-color', 'opp-color');
  toggleClasses(FREEBUTTON, 'self-color', 'opp-color');
  toggleClasses(p2AttackButton, 'self-color', 'opp-color');
  toggleClasses(p2PassButton, 'self-color', 'opp-color');
  // toggleClasses(p2UndoButton, 'self-color', 'opp-color');
  toggleClasses(p2FREEBUTTON, 'self-color', 'opp-color');
  toggleClasses(p2SetupButton, 'self-color', 'opp-color');
  toggleClasses(p2ResetButton, 'self-color', 'opp-color');
  if (!systemState.isReplay) {
    toggleClasses(setupButton, 'self-color', 'opp-color');
    toggleClasses(resetButton, 'self-color', 'opp-color');
  }

  const users = ['self', 'opp'];
  const textIds = [
    'deckText',
    'discardText',
    'lostZoneText',
    'handText',
    'sortHandText',
    'sortHandCheckbox',
  ];
  const zoneIds = ['deck', 'discard', 'lostZone', 'attachedCards', 'viewCards'];
  const buttonContainers = [
    'viewCardsButtonContainer',
    'attachedCardsButtonContainer',
  ];
  const headerIds = ['attachedCardsHeader', 'viewCardsHeader'];
  const specialMoveButtonContainers = ['specialMoveButtonContainer'];

  for (const user of users) {
    const document =
      user === 'self' ? selfContainerDocument : oppContainerDocument;

    for (const textId of textIds) {
      const text = document.getElementById(textId);
      text.classList.toggle('self-text');
      text.classList.toggle('opp-text');
    }
    for (const zoneId of zoneIds) {
      const element = document.getElementById(zoneId);
      element.classList.toggle('self-view');
      element.classList.toggle('opp-view');
    }
    for (const buttonContainerId of buttonContainers) {
      const container = document.getElementById(buttonContainerId);
      container.classList.toggle('self-zone-button-container');
      container.classList.toggle('opp-zone-button-container');
    }
    for (const headerId of headerIds) {
      const header = document.getElementById(headerId);
      header.classList.toggle('self-header');
      header.classList.toggle('opp-header');
      if (header.textContent === 'Move attached cards') {
        header.textContent = 'Opponent moving cards...';
      } else if (header.textContent === 'Opponent moving cards...') {
        header.textContent = 'Move attached cards';
      }
    }
    for (const containerId of specialMoveButtonContainers) {
      const container = document.getElementById(containerId);
      container.classList.toggle('self-special-move-button-container');
      container.classList.toggle('opp-special-move-button-container');
    }
  }

  const selfCircleElements = selfContainerDocument.querySelectorAll(
    '.self-circle, .opp-circle'
  );
  const oppCircleElements = oppContainerDocument.querySelectorAll(
    '.self-circle, .opp-circle'
  );

  selfCircleElements.forEach((element) => {
    element.classList.toggle('self-circle');
    element.classList.toggle('opp-circle');
  });
  oppCircleElements.forEach((element) => {
    element.classList.toggle('self-circle');
    element.classList.toggle('opp-circle');
  });

  // Swap heights
  let tempHeight = selfContainer.style.height;
  selfContainer.style.height = oppContainer.style.height;
  oppContainer.style.height = tempHeight;

  // Swap bottom lengths
  let tempBottom = selfContainer.style.bottom;
  selfContainer.style.bottom = oppContainer.style.bottom;
  oppContainer.style.bottom = tempBottom;

  // Flip the stadium
  const stadiumZone = getZone('', 'stadium');
  if (stadiumZone.array[0]) {
    if (stadiumZone.array[0].image.user === systemState.initiator) {
      stadiumZone.element.style.transform = 'scaleX(1) scaleY(1)';
    } else {
      stadiumZone.element.style.transform = 'scaleX(-1) scaleY(-1)';
    }
  }
  refreshBoard();
};
