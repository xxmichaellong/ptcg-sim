import {
  oppContainerDocument,
  selfContainerDocument,
  systemState,
} from '../../front-end.js';

const toggleElementsVisibility = (elementIds, isVisible) => {
  elementIds.forEach((id) => {
    const element = document.getElementById(id);
    element.style.display = isVisible ? '' : 'none';
  });
  if (isVisible) {
    document.getElementById('p2FREEBUTTON').classList.remove('spectator-color');
  } else {
    document.getElementById('p2FREEBUTTON').classList.add('spectator-color');
  }
};

const toggleZoneElementsVisibility = (elementIds, isVisible) => {
  elementIds.forEach((id) => {
    const selfElement = selfContainerDocument.getElementById(id);
    const oppElement = oppContainerDocument.getElementById(id);
    selfElement.style.display = isVisible ? '' : 'none';
    oppElement.style.display = isVisible ? '' : 'none';
  });
};

export const handleSpectatorButtons = () => {
  const buttonIdsToToggle = [
    'p2AttackButton',
    'p2PassButton',
    'p2SetupButton',
    'p2ResetButton',
    'turnButton',
    'flipCoinButton',
  ];
  toggleElementsVisibility(
    buttonIdsToToggle,
    !(
      document.getElementById('spectatorModeCheckbox').checked &&
      systemState.isTwoPlayer
    )
  );

  const zoneButtonIdsToToggle = [
    'shuffleDeckButton',
    'shuffleDiscardButton',
    'viewCardsButtonContainer',
    'attachedCardsButtonContainer',
  ];
  toggleZoneElementsVisibility(
    zoneButtonIdsToToggle,
    !(
      document.getElementById('spectatorModeCheckbox').checked &&
      systemState.isTwoPlayer
    )
  );
};
