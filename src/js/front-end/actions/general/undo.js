import { systemState } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/append-message.js";
import { acceptAction } from "../../setup/general/accept-action.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { processAction } from "../../setup/general/process-action.js";

export const undo = (user, actionData, emit = true) => {
    if (!systemState.isTwoPlayer){
        if (user === 'self' && systemState.selfCounter > 1){
            appendMessage('', determineUsername(user) + ' took back their last move!', 'announcement', false);
            systemState.undo = true;
            systemState.selfActionData.pop();
            systemState.selfCounter--;
            performActions(user, systemState.selfActionData);
        } else if (systemState.oppCounter > 1){
            appendMessage('', determineUsername(user) + ' took back their last move!', 'announcement', false);
            systemState.undo = true;
            systemState.oppCounter--;
            systemState.oppActionData.pop();
            performActions('opp', systemState.oppActionData);
        };
        systemState.undo = false;
    }
}

const performActions = (user, actionData) => {
    const mostRecentDeckDataIndex = [...actionData]
    .reverse()
    .findIndex(entry => entry.action === 'exchangeData' || entry.action === 'uploadDeckData');

    const mostRecentResetEntryIndex = [...actionData]
    .reverse()
    .findIndex(entry => entry.action === 'reset' || entry.action === 'setup');

    // Retrieve all entries starting from the most recent reset/setup entry
    const mostRecentResetAndAfterEntries = mostRecentResetEntryIndex !== -1
    ? actionData.slice(actionData.length - mostRecentResetEntryIndex - 1)
    : 0;

    const mostRecentDeckDataEntry = mostRecentDeckDataIndex !== -1
    ? actionData[actionData.length - mostRecentDeckDataIndex - 1]
    : 0;

    const entriesAfterMostRecentDeckData = mostRecentDeckDataIndex !== -1
    ? actionData.slice(actionData.length - mostRecentDeckDataIndex)
    : 0;
    
    if (mostRecentDeckDataEntry){
        acceptAction(user, mostRecentDeckDataEntry.action, mostRecentDeckDataEntry.parameters);
    };
    if (mostRecentResetAndAfterEntries && mostRecentResetEntryIndex < mostRecentDeckDataIndex){
        mostRecentResetAndAfterEntries.forEach(data => acceptAction(user, data.action, data.parameters));
    } else if (mostRecentDeckDataEntry){
        entriesAfterMostRecentDeckData.forEach(data => acceptAction(user, data.action, data.parameters));
    } else {
        actionData.forEach(data => acceptAction(user, data.action, data.parameters));
    };
}