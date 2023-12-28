import { discardBoard, handBoard, lostzoneBoard, shuffleBoard } from "../../actions/general/clear-board.js";
import { discardBoardButton, handBoardButton, lostzoneBoardButton, sCard, shuffleBoardButton } from "../../front-end.js";

discardBoardButton.addEventListener('click', () => discardBoard(sCard.user));

shuffleBoardButton.addEventListener('click', () => shuffleBoard(sCard.user));

lostzoneBoardButton.addEventListener('click', () => lostzoneBoard(sCard.user));

handBoardButton.addEventListener('click', () => handBoard(sCard.user));