import { darkMode, showOutlines } from "../../../setup/settings/settings.js";

export const initializeSettings = () => {
    const darkModeCheckbox = document.getElementById('darkModeCheckbox');
    darkModeCheckbox.addEventListener('change', darkMode);

    const showZonesCheckbox = document.getElementById('showZonesCheckbox');
    showZonesCheckbox.addEventListener('change', showOutlines);
};