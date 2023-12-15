import { POV, p1, roomId, socket } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';

export const flipCoin = (user, result, received = false) => {
    const randomValue = Math.random();
    const coinFlipResult = result !== undefined ? result : (randomValue < 0.5 ? 'heads' : 'tails');
    const message = determineUsername(user) + ' flipped ' + coinFlipResult;
    appendMessage(user, message, 'announcement');
    if (!p1[0] && !received){
        const data = {
            roomId : roomId,
            result: coinFlipResult,
            user : POV.oUser,
            received: true
        };
        socket.emit('flipCoin', data);
    };
}


