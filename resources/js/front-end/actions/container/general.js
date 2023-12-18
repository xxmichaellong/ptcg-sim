import { selfContainersDocument } from "../../front-end.js";
import { containerIdToLocation } from "../../setup/containers/container-reference.js";
import { stringToVariable, variableToString } from "../../setup/containers/string-to-variable.js";
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
}

export const closeDisplay = (event) => {
    const containerId = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const container_html = stringToVariable(user, containerId);
    container_html.style.display = 'none';
}