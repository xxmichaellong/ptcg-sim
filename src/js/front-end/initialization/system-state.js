import { selfContainers } from "../front-end.js";

export const systemState = {
    isTwoPlayer: false,
    pov: {
        get user() {
            return selfContainers.classList.contains('self') ? 'self' : 'opp'; 
            //pov.user refers to the user on the bottom half of the screen, e.g., pov.user === 'self' means that the bottom half is the 'self' user
        },
        get oUser() {
            return selfContainers.classList.contains('self') ? 'opp' : 'self';
            //pov.oUser refers to the user on the top half of the screen
        }
    },
    roomId: '',
    p1Username: (user) => {
        return user === 'self' ? 'Blue' : 'Red';
    },
    p2SelfUsername: '',
    p2OppUsername: '',
    turn: 0,
    selfDeckData : '',
    p1OppDeckData: '', // refers to the opponent's data in 1 player mode, i.e., the "alt" deck data
    p2OppDeckData: '', // refers to the opponent's data in 2 player mode, i.e., the other player's deck data
    cardBackSrc: '../resources/cardback.png',
    oppCardBackSrc: ''
};

