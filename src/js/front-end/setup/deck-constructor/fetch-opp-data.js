import { socket, systemState } from "../../front-end.js";

export const exchangeData = () => {
    return new Promise((resolve, reject) => {
        const data = {
            roomId: systemState.roomId,
            username: systemState.p2SelfUsername,
            deckData: systemState.selfDeckData,
        };

        socket.emit('exchangeData', data);

        socket.once('sentData', (data) => {
            if (data.error) {
                reject(data.error);
            } else {
                systemState.p2OppUsername = data.username;
                systemState.p2OppDeckData = data.deckData;
                resolve();
            };
        });
    });
}


