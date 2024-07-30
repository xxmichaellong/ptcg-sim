import { acceptAction } from '../../setup/general/accept-action.js';
import { refreshBoardImages } from '../../setup/sizing/refresh-board.js';

export function loadImportData() {
    try {
        const importDataJSON = document.getElementById('importDataJSON').textContent;
        if (importDataJSON && importDataJSON.trim() !== '') {
            const importData = JSON.parse(importDataJSON);
            let actions;
            if ('version' in importData[0]) {
                actions = importData.slice(1); // first element is the version #
            } else {
                actions = importData; // no version object, treat all data as actions
            }
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