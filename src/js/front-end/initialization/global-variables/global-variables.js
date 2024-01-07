import { getZone } from "../../setup/zones/get-zone.js";

// exports a WebSocket connection using the Socket.IO library. initialize serverOffset to keep track of the socket events received
// export const socket = io('https://ptcgsim.online', {
//     auth: {
//       serverOffset: 0
//     }
// });

export const socket = io('http://localhost:4000/', {
    auth: {
      serverOffset: 0
    }
});
// export references to HTML elements 'selfContainer' and 'oppContainer', and their respective content window documents for ease of access to the iframes
export const selfContainer = document.getElementById('selfContainer');
export const selfContainerDocument = selfContainer.contentWindow.document;
export const oppContainer = document.getElementById('oppContainer');
export const oppContainerDocument = oppContainer.contentWindow.document;
// create globally accessible variable systemState, which holds information relevant to the state of the user's game
export const systemState = {
    isTwoPlayer: false,
    turn: 0,
    pov: {
        get user() {
            return selfContainer.classList.contains('self') ? 'self' : 'opp'; 
            //pov.user refers to the user on the bottom half of the screen, e.g., pov.user === 'self' means that the bottom half is the 'self' user
        },
        get oUser() {
            return selfContainer.classList.contains('self') ? 'opp' : 'self';
            //pov.oUser refers to the user on the top half of the screen
        }
    },
    roomId: '',
    p1Username: (user) => {
        return user === 'self' ? 'Blue' : 'Red';
    },
    p2SelfUsername: '',
    p2OppUsername: '',
    selfDeckData : '',
    p1OppDeckData: '', // refers to the opponent's data in 1 player mode, i.e., the "alt" deck data
    p2OppDeckData: '', // refers to the opponent's data in 2 player mode, i.e., the other player's deck data
    cardBackSrc: '../src/cardback.png',
    oppCardBackSrc: ''
};
// create global variable that holds the information of a selected card, i.e., the card that has been clicked and highlighted and can trigger keybinds
export const mouseClick = {
    cardIndex: '',
    zoneId: '',
    user: '',
    oUser: '',
    playContainer: '',
    playContainerParent: '',
    selectingCard: false,
    get card(){
        if (this.zoneId){
            return getZone(this.user, this.zoneId).array[this.cardIndex];
        };
    }
};

//Create a counter to keep track of moves

export const counter = {
    turn: 0,
    data: [],
};