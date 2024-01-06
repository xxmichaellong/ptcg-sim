import { VSTARGXFunction } from '../../../actions/general/VSTAR-GX.js';
import { flipBoard } from '../../../actions/general/flip-board.js';
import { flipCoin } from '../../../actions/general/flip-coin.js';
import { takeTurn } from '../../../actions/general/take-turn.js';
import { oppContainerDocument, selfContainerDocument, systemState } from '../../../front-end.js';

export const initializeBoardButtons = () => {
    const turnButton = document.getElementById('turnButton');
    turnButton.addEventListener('click', () => takeTurn(systemState.pov.user));

    const flipCoinButton = document.getElementById('flipCoinButton');
    flipCoinButton.addEventListener('click', () => flipCoin(systemState.pov.user));
    
    const flipBoardButton = document.getElementById('flipBoardButton');
    flipBoardButton.addEventListener('click', flipBoard);

    const selfVSTARButton = selfContainerDocument.getElementById('VSTARButton');
    selfVSTARButton.addEventListener('click', () => VSTARGXFunction('self', 'VSTAR'));

    const selfGXButton = selfContainerDocument.getElementById('GXButton');
    selfGXButton.addEventListener('click', () => VSTARGXFunction('self', 'GX'));

    const oppVSTARButton = oppContainerDocument.getElementById('VSTARButton');
    oppVSTARButton.addEventListener('click', () => VSTARGXFunction('opp', 'VSTAR'));

    const oppGXButton = oppContainerDocument.getElementById('GXButton');
    oppGXButton.addEventListener('click', () => VSTARGXFunction('opp', 'GX'));
};