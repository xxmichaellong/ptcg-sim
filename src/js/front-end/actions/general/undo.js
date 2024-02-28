import { systemState } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/append-message.js";
import { acceptAction } from "../../setup/general/accept-action.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { processAction } from "../../setup/general/process-action.js";

export const undo = (user, filteredActionData, emit = true) => {
    if (user === 'opp' && emit && systemState.isTwoPlayer){
        processAction(user, emit, 'undo', [filteredActionData]);
        return;
    };

    if (!filteredActionData){
        const actionData = user === 'self' ? systemState.selfActionData : systemState.oppActionData;
        filteredActionData = [];
    
        for (let i = 0; i < actionData.length; i++) {
            let currentEntry = actionData[i];
    
            // Skip the current entry and the one before if action === 'undo'
            if (currentEntry.action === 'undo') {
                filteredActionData.pop(); // Remove the entry before 'undo'
                continue; // Skip the 'undo' entry
            };
            if (currentEntry.action === 'exchangeData' || currentEntry.action === 'loadDeckData'){
                filteredActionData = []; //reset action data if initial exchange of deck/uploading deck data
                currentEntry = {user: 'self', emit: true, action: 'reset', parameters: [false, true, true]}; //replace entry with reset
            };
            filteredActionData.push(currentEntry);
        };
        filteredActionData.pop(); //remove the most recent entry
    };

    if (filteredActionData.length > 0){
        systemState.undo = true;
    
        const mostRecentResetEntryIndex = [...filteredActionData]
        .reverse()
        .findIndex(entry => entry.action === 'reset' || entry.action === 'setup');
    
        // Retrieve all entries starting from the most recent reset/setup entry
        const mostRecentResetAndAfterEntries = mostRecentResetEntryIndex !== -1
        ? filteredActionData.slice(filteredActionData.length - mostRecentResetEntryIndex - 1)
        : 0;
        
        if (mostRecentResetAndAfterEntries){
            mostRecentResetAndAfterEntries.forEach(data => acceptAction(user, data.action, data.parameters));
        } else {
            filteredActionData.forEach(data => acceptAction(user, data.action, data.parameters));
        };

        systemState.undo = false;
        appendMessage('', determineUsername(user) + ' took back their last move!', 'announcement', false);
        processAction(user, emit, 'undo', [filteredActionData]);
    };
    const undoButton = systemState.isTwoPlayer ? document.getElementById('p2UndoButton') : document.getElementById('undoButton');
    undoButton.textContent = "Undo";
}