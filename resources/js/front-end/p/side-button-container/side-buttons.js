import { VSTARGXFunction } from '../../actions/general/VSTAR-GX.js';
import { flipBoard } from '../../actions/general/flip-board.js';
import { flipCoin } from '../../actions/general/flip-coin.js';
import { takeTurn } from '../../actions/general/take-turn.js';
import { GXButton, flipBoardButton, flipCoinButton, p1, POV, roomId, socket, turnButton, vSTARButton } from '../../front-end.js';

turnButton.addEventListener('click', () => takeTurn(POV.user));

flipCoinButton.addEventListener('click', () => flipCoin(POV.user));

vSTARButton.addEventListener('click', () => VSTARGXFunction(POV.user, 'VSTAR'));

GXButton.addEventListener('click', () => VSTARGXFunction(POV.user, 'GX'));

flipBoardButton.addEventListener('click', flipBoard);