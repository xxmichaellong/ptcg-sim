import { socket, systemState } from "../../front-end.js";

export const exchangeData = () => {
    const data = {
        roomId: systemState.roomId,
        username: systemState.p2SelfUsername,
        deckData: systemState.selfDeckData,
        emit: true
    };
    socket.emit('exchangeData', data);
}