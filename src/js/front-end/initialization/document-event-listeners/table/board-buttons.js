import { VSTARGXFunction } from '../../../actions/general/VSTAR-GX.js';
import { flipBoard } from '../../../actions/general/flip-board.js';
import { flipCoin } from '../../../actions/general/flip-coin.js';
import { takeTurn } from '../../../actions/general/take-turn.js';
import { oppContainerDocument, selfContainerDocument, systemState } from '../../../front-end.js';
import { refreshBoardImages } from '../../../setup/sizing/refresh-board.js';

export const initializeBoardButtons = () => {
    const turnButton = document.getElementById('turnButton');
    turnButton.addEventListener('click', () => takeTurn(systemState.initiator, systemState.initiator));

    const flipCoinButton = document.getElementById('flipCoinButton');
    flipCoinButton.addEventListener('click', () => flipCoin(systemState.initiator));
    
    const flipBoardButton = document.getElementById('flipBoardButton');
    flipBoardButton.addEventListener('click', flipBoard);

    const refreshButton = document.getElementById('refreshButton');
    refreshButton.addEventListener('click', refreshBoardImages);

    const selfVSTARButton = selfContainerDocument.getElementById('VSTARButton');
    selfVSTARButton.addEventListener('click', () => {
        if (!(systemState.isTwoPlayer && document.getElementById('spectatorModeCheckbox').checked)){
            VSTARGXFunction('self', 'VSTAR');
        };
    });

    const selfGXButton = selfContainerDocument.getElementById('GXButton');
    selfGXButton.addEventListener('click', () => {
        if (!(systemState.isTwoPlayer && document.getElementById('spectatorModeCheckbox').checked)){
            VSTARGXFunction('self', 'GX');
        };
    });

    const oppVSTARButton = oppContainerDocument.getElementById('VSTARButton');
    oppVSTARButton.addEventListener('click', () => {
        if (!(systemState.isTwoPlayer && document.getElementById('spectatorModeCheckbox').checked)){
            VSTARGXFunction('opp', 'VSTAR');
        };
    });

    const oppGXButton = oppContainerDocument.getElementById('GXButton');
    oppGXButton.addEventListener('click', () => {
        if (!(systemState.isTwoPlayer && document.getElementById('spectatorModeCheckbox').checked)){
            VSTARGXFunction('opp', 'GX');
        };
    });
};