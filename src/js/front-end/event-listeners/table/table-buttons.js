import { VSTARGXFunction } from '../../actions/general/VSTAR-GX.js';
import { flipBoard } from '../../actions/general/flip-board.js';
import { flipCoin } from '../../actions/general/flip-coin.js';
import { takeTurn } from '../../actions/general/take-turn.js';
import { flipBoardButton, flipCoinButton, systemState, turnButton, selfVSTARButton, selfGXButton, oppVSTARButton, oppGXButton } from '../../front-end.js';

turnButton.addEventListener('click', () => takeTurn(systemState.pov.user));

flipCoinButton.addEventListener('click', () => flipCoin(systemState.pov.user));

selfVSTARButton.addEventListener('click', () => VSTARGXFunction('self', 'VSTAR'));

selfGXButton.addEventListener('click', () => VSTARGXFunction('self', 'GX'));

oppVSTARButton.addEventListener('click', () => VSTARGXFunction('opp', 'VSTAR'));

oppGXButton.addEventListener('click', () => VSTARGXFunction('opp', 'GX'));

flipBoardButton.addEventListener('click', flipBoard);