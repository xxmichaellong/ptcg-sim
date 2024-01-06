import { discardBoard, handBoard, lostZoneBoard, shuffleBoard } from "../../../actions/general/board-actions.js";
import { mouseClick } from "../../../front-end.js";

export const initializeBoardButtons = () => {
    const discardBoardButton = document.getElementById('discardBoardButton');
    discardBoardButton.addEventListener('click', () => discardBoard(mouseClick.user));

    const shuffleBoardButton = document.getElementById('shuffleBoardButton');
    shuffleBoardButton.addEventListener('click', () => shuffleBoard(mouseClick.user));

    const lostZoneBoardButton = document.getElementById('lostZoneBoardButton');
    lostZoneBoardButton.addEventListener('click', () => lostZoneBoard(mouseClick.user));

    const handBoardButton = document.getElementById('handBoardButton');
    handBoardButton.addEventListener('click', () => handBoard(mouseClick.user));
};