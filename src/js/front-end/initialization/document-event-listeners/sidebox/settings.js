import { changeBackground, darkMode, showOutlines } from "../../../setup/settings/settings.js";
import { systemState } from "../../../front-end.js";
import { lookAtCards, stopLookingAtCards } from "../../../actions/general/reveal-and-hide.js";

export const initializeSettings = () => {
    const darkModeCheckbox = document.getElementById('darkModeCheckbox');
    darkModeCheckbox.addEventListener('change', darkMode);

    const showZonesCheckbox = document.getElementById('showZonesCheckbox');
    showZonesCheckbox.addEventListener('change', showOutlines);

    const hideHandCheckbox = document.getElementById('hideHandCheckbox');
    hideHandCheckbox.addEventListener('change', () => {
        if (hideHandCheckbox.checked){
            if (systemState.initiator === 'self' && !systemState.isTwoPlayer){
                stopLookingAtCards('opp', '', 'hand', false, true);
            } else if (!systemState.isTwoPlayer){
                stopLookingAtCards('self', '', 'hand', false, true);
            };
        } else {
            if (systemState.initiator === 'self' && !systemState.isTwoPlayer){
                lookAtCards('opp', '', 'hand', false, true);
            } else if (!systemState.isTwoPlayer){
                lookAtCards('self', '', 'hand', false, true);
            };
        };
    });

    const changeBackgroundButton = document.getElementById('changeBackgroundButton');
    changeBackgroundButton.addEventListener('click', () => {
        changeBackground();
    });
}