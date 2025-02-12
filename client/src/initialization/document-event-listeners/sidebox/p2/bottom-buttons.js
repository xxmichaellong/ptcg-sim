import { reset } from '../../../../actions/general/reset.js';
import { setup } from '../../../../actions/general/setup.js';
import { systemState } from '../../../../front-end.js';
import { hideOptionsContextMenu } from '../../../../setup/chatbox/hide-options-context-menu.js';

export const initializeP2BottomButtons = () => {
  const optionsContextMenu = document.getElementById('optionsContextMenu');
  const p2Box = document.getElementById('p2Box');

  const p2SetupButton = document.getElementById('p2SetupButton');
  p2SetupButton.addEventListener('click', () => setup(systemState.initiator));

  const p2ResetButton = document.getElementById('p2ResetButton');
  p2ResetButton.addEventListener('click', () => reset(systemState.initiator));

  const p2OptionsButton = document.getElementById('p2OptionsButton');
  p2OptionsButton.addEventListener('click', () => {
    optionsContextMenu.style.display = 'block';
    const adjustment = p2Box.offsetHeight - p2OptionsButton.offsetTop;
    optionsContextMenu.style.bottom = `${adjustment}px`;
    document.addEventListener('mousedown', hideOptionsContextMenu);
  });
};
