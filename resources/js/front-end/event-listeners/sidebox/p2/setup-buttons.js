import { reset } from '../../../actions/general/reset.js';
import { setup } from '../../../actions/general/setup.js';
import { systemState, hideOptionsContextMenu, optionsContextMenu, p2Box, p2OptionsButton, p2ResetButton, p2SetupButton } from '../../../front-end.js';

p2SetupButton.addEventListener('click', () => setup(systemState.pov.user));

p2ResetButton.addEventListener('click', () => reset(systemState.pov.user));

p2OptionsButton.addEventListener('click', () => {
    optionsContextMenu.style.display = 'block';
    const adjustment = p2Box.offsetHeight - p2OptionsButton.offsetTop
    optionsContextMenu.style.bottom = `${adjustment}px`;
    document.addEventListener('mousedown', hideOptionsContextMenu);
});