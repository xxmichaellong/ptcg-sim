import { socket, systemState } from "../../front-end.js";

export const processAction = (user, emit, action, parameters) => {
    if (!systemState.undo && emit){
        if (!systemState.isTwoPlayer || user === 'self'){ //log the move if it's 1 player, or if it's yourself
            const data = {
                user: user,
                emit: emit,
                action: action,
                parameters: parameters,
            };
            if (user === 'self'){
                systemState.selfCounter++;
                systemState.selfActionData.push(data);
            } else {
                systemState.oppCounter++;
                systemState.oppActionData.push(data);
            };

            if (systemState.isTwoPlayer){ //if it's two player, push your move to the opponent
                const data = {
                    action: action,
                    counter: systemState.selfCounter,
                    roomId: systemState.roomId,
                    parameters: parameters
                };
                socket.emit('pushAction', data)
            };
        } else { //if it's two player and you're moving an opponent's card, request the action before implementing
            const data = {
                action: action,
                counter: systemState.oppCounter,
                roomId: systemState.roomId,
                parameters: parameters
            };
            socket.emit('requestAction', data);
        };
    };
}