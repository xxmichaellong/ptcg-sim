import { systemState } from "../../front-end.js"

const allowedDuringReplay = {
    "action": ["changeCardBack", "viewDeck", "lookAtCards", "stopLookingAtCards", "revealCards", "hideCards", "revealShortcut", "hideShortcut", "lookShortcut", "stopLookingShortcut"],
    "keybind": ['v','c','z','r','f','esc'],
    "contextMenu": ['lookPrizesButton','revealHidePrizesButton','lookHandButton','prizesHeader','handHeader','deckHeader','boardHeader'],
};

export const replayBlock = (type, value, isFromReplay = false) => {
    return systemState.isReplay && !systemState.isTwoPlayer && !isFromReplay && !allowedDuringReplay[type].includes(value);
};