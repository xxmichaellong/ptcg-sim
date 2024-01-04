import { discardBoard, handBoard, lostZoneBoard, shuffleBoard } from "../../actions/general/board-actions.js";
import { discardBoardButton, handBoardButton, lostZoneBoardButton, sCard, shuffleBoardButton } from "../../front-end.js";

discardBoardButton.addEventListener('click', () => discardBoard(sCard.user));

shuffleBoardButton.addEventListener('click', () => shuffleBoard(sCard.user));

lostZoneBoardButton.addEventListener('click', () => lostZoneBoard(sCard.user));

handBoardButton.addEventListener('click', () => handBoard(sCard.user));