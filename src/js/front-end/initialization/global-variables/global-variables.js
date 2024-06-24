import { preloadImage } from "../../setup/general/preload-image.js";
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
    coachingMode: false,
    undo: false,
    selfCounter: 0,
    selfActionData: [],
    oppActionData: [],
    // spectatorActionData: [],
    spectatorCounter: 0,
    exportActionData: [],
    spectatorId: '',
    oppCounter: 0,
    isTwoPlayer: false,
    isReplay: false, // should be treated as false no matter what if isTwoPlayer is true
    replayActionData: [],
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
    spectatorUsername: '',
    selfDeckData : '',
    p1OppDeckData: '', // refers to the opponent's data in 1 player mode, i.e., the "alt" deck data
    p2OppDeckData: '', // refers to the opponent's data in 2 player mode, i.e., the other player's deck data
    cardBackSrc: "https://ptcgsim.online/src/cardback.png",
    p1OppCardBackSrc: "https://ptcgsim.online/src/cardback.png",
    p2OppCardBackSrc: "https://ptcgsim.online/src/cardback.png"
};

// preload image
preloadImage("https://ptcgsim.online/src/cardback.png");

// const randomNumber = Math.random();
// const backgroundUrl = randomNumber < 0.5 ? 'https://ptcgsim.online/background1.jpg' : 'https://ptcgsim.online/background2.webp';
// document.body.style.backgroundImage = `url('${backgroundUrl}')`;

// create global variable that holds the information of a selected card, i.e., the card that has been clicked and highlighted and can trigger keybinds
export const mouseClick = {
    cardIndex: '',
    zoneId: '',
    cardUser: '',
    playContainer: '',
    playContainerParent: '',
    selectingCard: false,
    isActiveZone: '',
    get card(){
        if (this.zoneId){
            return getZone(this.cardUser, this.zoneId).array[this.cardIndex];
        };
    }
};