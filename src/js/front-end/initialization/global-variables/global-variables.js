import { getZone } from "../../setup/zones/get-zone.js";

// exports a WebSocket connection using the Socket.IO library.
export const socket = io('https://ptcgsim.online');

// export const socket = io('http://localhost:4000/');
// export references to HTML elements 'selfContainer' and 'oppContainer', and their respective content window documents for ease of access to the iframes
export const selfContainer = document.getElementById('selfContainer');
export const selfContainerDocument = selfContainer.contentWindow.document;
export const oppContainer = document.getElementById('oppContainer');
export const oppContainerDocument = oppContainer.contentWindow.document;
// create globally accessible variable systemState, which holds information relevant to the state of the user's game
export const systemState = {
    undo: false,
    selfCounter: 0,
    selfActionData: [],
    oppActionData: [],
    oppCounter: 0,
    isTwoPlayer: false,
    turn: 0,
    get initiator() {
        return selfContainer.classList.contains('self') ? 'self' : 'opp'; 
        //refers to the user on the bottom half of the screen, e.g., initiator === 'self' means that the bottom half is the 'self' user
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
    cardUser: '',
    playContainer: '',
    playContainerParent: '',
    selectingCard: false,
    get card(){
        if (this.zoneId){
            return getZone(this.cardUser, this.zoneId).array[this.cardIndex];
        };
    }
};