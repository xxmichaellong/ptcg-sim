import { p2OppUsername, p2SelfUsername, roomId, socket } from "../front-end.js";
import { mainDeckData } from "../setup/deck-constructor/import.js";

export const p2DeckData = [];

export const exchangeData = () => {
    return new Promise((resolve, reject) => {
        const data = {
          roomId : roomId[0],
          username : p2SelfUsername[0],
          deckData : mainDeckData[0]
        }
        socket.emit('exchangeData', data);

        socket.once('sentData', (data) => {
            if (data.error){
              reject(data.error);
            } else {
              p2OppUsername[0] = data.username;
              p2DeckData[0] = data.deckData;
              resolve();
            };
        });
      });
    }


