import { selfContainersDocument } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { containerIdToLocation } from "../../setup/containers/container-reference.js";
import { stringToVariable, variableToString } from "../../setup/containers/string-to-variable.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { moveCard } from "../general/move-card.js";
import { shuffleContainer } from "./shuffle-container.js";

export const shuffleAll = (event) => {
    const containerId = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const location = containerIdToLocation(user, containerId);
    const locationAsString = variableToString(user, location);
    const count = location.count;

    for (let i = 0; i < count; i++) {
        moveCard(user, locationAsString, containerId, 'deck', 'deck_html', 0)
    };

    shuffleContainer(user, 'deck', 'deck_html');

    const container_html = stringToVariable(user, containerId);
    container_html.style.display = 'none';

    if (count > 0){
        let message;
        if (locationAsString === 'deck'){
            message = determineUsername(user) + ' shuffled deck';
        } else if (locationAsString === 'attachedCardPopup'){
            message = determineUsername(user) + ' shuffled ' + count + ' attached card(s) into deck';
        } else if (locationAsString === 'viewCards'){
            message = determineUsername(user) + ' shuffled ' + count + ' card(s) into deck';
        } else if (locationAsString === 'discard'){
            message = determineUsername(user) + ' shuffled discard into deck';
        };
        appendMessage(user, message, 'player');
    };
}

export const discardAll = (event) => {
    const containerId = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const location = containerIdToLocation(user, containerId);
    const locationAsString = variableToString(user, location);
    const count = location.count;

    for (let i = 0; i < count; i++) {
        moveCard(user, locationAsString, containerId, 'discard', 'discard_html', 0)
    };

    const container_html = stringToVariable(user, containerId);
    container_html.style.display = 'none';

    if (count > 0){
        let message;
        if (locationAsString === 'attachedCardPopup'){
            message = determineUsername(user) + ' discarded '+ count + ' attached card(s)';
        } else {
            message = determineUsername(user) + ' discarded ' + count + ' card(s)';
        };
        appendMessage(user, message, 'player');
    };
}

export const lostzoneAll = (event) => {
    const containerId = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const location = containerIdToLocation(user, containerId);
    const locationAsString = variableToString(user, location);
    const count = location.count;

    for (let i = 0; i < count; i++) {
        moveCard(user, locationAsString, containerId, 'lostzone', 'lostzone_html', 0)
    };

    const container_html = stringToVariable(user, containerId);
    container_html.style.display = 'none';

    if (count > 0){
        let message;
        if (locationAsString === 'attachedCardPopup'){
            message = determineUsername(user) + ' lost-zoned '+ count + ' attached card(s)';
        } else {
            message = determineUsername(user) + ' lost-zoned ' + count + ' card(s)';
        };
        appendMessage(user, message, 'player');
    };
}

export const handAll = (event) => {
    const containerId = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const location = containerIdToLocation(user, containerId);
    const locationAsString = variableToString(user, location);
    const count = location.count;

    for (let i = 0; i < count; i++) {
        moveCard(user, locationAsString, containerId, 'hand', 'hand_html', 0)
    };

    const container_html = stringToVariable(user, containerId);
    container_html.style.display = 'none';

    if (count > 0){
        let message;
        if (locationAsString === 'attachedCardPopup'){
            message = determineUsername(user) + ' put '+ count + ' attached card(s) into hand';
        } else {
            message = determineUsername(user) + ' put ' + count + ' card(s) into hand';
        };
        appendMessage(user, message, 'player');
    };
}

export const closeDisplay = (event) => {
    const containerId = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const container_html = stringToVariable(user, containerId);
    container_html.style.display = 'none';
}