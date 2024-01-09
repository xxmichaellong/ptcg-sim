import { discardBoard, handBoard, lostZoneBoard, shuffleBoard } from "../../../actions/general/board-actions.js";
import { mouseClick, systemState } from "../../../front-end.js";

export const initializeBoardButtons = () => {
    const discardBoardButton = document.getElementById('discardBoardButton');
    discardBoardButton.addEventListener('click', () => discardBoard(systemState.initiator, mouseClick.cardUser));

    const shuffleBoardButton = document.getElementById('shuffleBoardButton');
    shuffleBoardButton.addEventListener('click', () => shuffleBoard(systemState.initiator, mouseClick.cardUser));

    const lostZoneBoardButton = document.getElementById('lostZoneBoardButton');
    lostZoneBoardButton.addEventListener('click', () => lostZoneBoard(systemState.initiator, mouseClick.cardUser));

    const handBoardButton = document.getElementById('handBoardButton');
    handBoardButton.addEventListener('click', () => handBoard(systemState.initiator, mouseClick.cardUser));
};