import { acceptAction } from '../../setup/general/accept-action.js';
import { refreshBoardImages } from '../../setup/sizing/refresh-board.js';

export function loadImportData() {
    try {
        const importDataJSON = document.getElementById('importDataJSON').textContent;
        if (importDataJSON && importDataJSON.trim() !== '') {
            const importData = JSON.parse(importDataJSON);
            let actions = importData.filter(obj => !('version' in obj)); // Remove any objects containing version property
            actions.forEach(data => {
                acceptAction(data.user, data.action, data.parameters, true);
            });
            refreshBoardImages();
        } else {
            console.log('No import data found or empty data.');
        }
    } catch (error) {
        console.error('Error parsing import data:', error);
    }
}