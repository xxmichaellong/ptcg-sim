import { active, bench, oppActive, oppBench, selfContainersDocument } from "../../front-end.js";
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

export const leaveAll = (event) => {
    const containerId = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const location = containerIdToLocation(user, containerId);
    const locationAsString = variableToString(user, location);
    const count = location.count;
    
    let mLocation;
    let mLocationAsString;
    let mLocation_html;

    const activeCount = user === 'self' ? active.count : oppActive.count;
    if (activeCount === 0){
        mLocation = stringToVariable(user, 'active');
        mLocationAsString = 'active';
        mLocation_html = 'active_html';
    } else {
        mLocation = stringToVariable(user, 'bench');
        mLocationAsString = 'bench';
        mLocation_html = 'bench_html';
    };

    let targetImage;

    for (let i = count - 1; i >= 0; i--){
        if (location.cards[i].type === 'pokemon'){
            targetImage = location.cards[i].image;
            moveCard(user, locationAsString, containerId, mLocationAsString, mLocation_html, i);
            break;
        };
    };
    const count1 = location.count;
    for (let i = count1 - 1; i >= 0; i--){
        if (location.cards[i].type === 'pokemon'){
            const targetIndex = mLocation.cards.findIndex(card => card.image === targetImage);
            targetImage = location.cards[i].image;
            moveCard(user, locationAsString, containerId, mLocationAsString, mLocation_html, i, targetIndex);
        };
    };
    const count2 = location.count;
    for (let i = 0; i < count2; i++){
        const targetIndex = mLocation.cards.findIndex(card => card.image === targetImage);
        moveCard(user, locationAsString, containerId, mLocationAsString, mLocation_html, 0, targetIndex);
    };

    const container_html = stringToVariable(user, containerId);
    container_html.style.display = 'none';

    if (count > 0){
        const message = determineUsername(user) + ' left ' + count + ' attached card(s) in play';      
        appendMessage(user, message, 'player');
    };
}