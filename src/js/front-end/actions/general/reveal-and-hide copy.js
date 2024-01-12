// import { systemState } from '../../front-end.js';
// import { appendMessage } from '../../setup/chatbox/append-message.js';
// import { determineUsername } from '../../setup/general/determine-username.js';
// import { showPopup } from '../../setup/general/pop-up-message.js';
// import { processAction } from '../../setup/general/process-action.js';
// import { removeImages } from '../../setup/image-logic/remove-images.js';
// import { getZone } from '../../setup/zones/get-zone.js';
// import { convertZoneName } from '../move-card-bundle/move-card-message.js';
// import { moveCard } from '../move-card-bundle/move-card.js';
// import { deselectCard } from './close-popups.js';

// let rootDirectory = window.location.origin;

// export const hideCard = (card) => {
//     if (card.image.src !== rootDirectory + '/src/cardback.png'){
//         card.image.src2 = card.image.src;
//         card.image.src = '/src/cardback.png';
//     };
// }

// export const revealCard = (card) => {
//     if (card.image.src === rootDirectory + '/src/cardback.png'){
//         card.image.src = card.image.src2;
//     };
// }

// export const lookAtCards = (user, initiator, zoneId, emit = true) => {
//     const oInitiator = initiator === 'self' ? 'opp' : 'self';
//     if (user === 'opp' && emit && systemState.isTwoPlayer){
//         processAction(user, emit, 'lookAtCards', [oInitiator, zoneId]);
//         return;
//     };

//     if (emit){
//         const zone = getZone(user, zoneId);
//         removeImages(zone.element);
//         zone.array.forEach(card => {
//             revealCard(card);
//             zone.element.appendChild(card.image);
//         });
//     };
//     appendMessage(initiator, determineUsername(initiator) + ' looked at ' + determineUsername(user) + "'s " + zoneId, 'player', false);

//     processAction(user, emit, 'lookAtCards', [oInitiator, zoneId]);
// }

// export const stopLookingAtCards = (user, initiator, zoneId, message = true, emit = true) => {
//     const oInitiator = initiator === 'self' ? 'opp' : 'self';
//     if (user === 'opp' && emit && systemState.isTwoPlayer){
//         processAction(user, emit, 'stopLookingAtCards', [oInitiator, zoneId, message]);
//         return;
//     };

//     if (emit){
//         const zone = getZone(user, zoneId);
//         removeImages(zone.element);
//         zone.array.forEach(card => {
//             hideCard(card);
//             zone.element.appendChild(card.image);
//         });
//     };
//     if(message){
//         appendMessage(initiator, determineUsername(initiator) + ' stopped looking at ' + determineUsername(user) + "'s " + zoneId, 'player', false);
//     };

//     processAction(user, emit, 'stopLookingAtCards', [oInitiator, zoneId, message]);
// }

// export const revealCards = (user, initiator, zoneId, emit = true) => {
//     const oInitiator = initiator === 'self' ? 'opp' : 'self';
//     if (user === 'opp' && emit && systemState.isTwoPlayer){
//         processAction(user, emit, 'revealCards', [oInitiator, zoneId]);
//         return;
//     };

//     const prizesCount = getZone(user, 'prizes').getCount();
//     for (let i = 0; i < prizesCount; i++) {
//         revealShortcut(user, initiator, zoneId, i, false, false);
//     };
//     appendMessage(initiator, determineUsername(initiator) + ' revealed ' + determineUsername(user) + "'s " + zoneId, 'player', false);

//     processAction(user, emit, 'revealCards', [oInitiator, zoneId]);
// }

// export const hideCards = (user, initiator, zoneId, emit = true) => {
//     const oInitiator = initiator === 'self' ? 'opp' : 'self';
//     if (user === 'opp' && emit && systemState.isTwoPlayer){
//         processAction(user, emit, 'hideCards', [oInitiator, zoneId]);
//         return;
//     };

//     const prizesCount = getZone(user, 'prizes').getCount();
//     for (let i = 0; i < prizesCount; i++) {
//         hideShortcut(user, initiator, zoneId, i, false, false);
//     };
//     appendMessage(initiator, determineUsername(initiator) + ' hid ' + determineUsername(user) + "'s " + zoneId, 'player', false);

//     processAction(user, emit, 'hideCards', [oInitiator, zoneId]);
// }

// export const revealShortcut = (user, initiator, zoneId, index, message = true, emit = true) => {
//     const oInitiator = initiator === 'self' ? 'opp' : 'self';
//     if (user === 'opp' && emit && systemState.isTwoPlayer){
//         processAction(user, emit, 'revealShortcut', [oInitiator, zoneId, index, message]);
//         return;
//     };
    
//     const zone = getZone(user, zoneId);
//     const card = zone.array[index];
//     card.image.faceDown = false;
//     card.image.public = true;

//     if (card.image.src === rootDirectory + '/src/cardback.png'){
//         card.image.src = card.image.src2;
//     };
//     if (message){
//         appendMessage(initiator, determineUsername(initiator) + ' revealed ' + card.name + ' in ' + determineUsername(card.image.user) + "'s " + convertZoneName(zoneId), 'player', false);
//     };

//     processAction(user, emit, 'revealShortcut', [oInitiator, zoneId, index, message]);

//     //deal with case when revealing a card in your own hand
//     if (systemState.isTwoPlayer && emit && zoneId === 'hand' && initiator === card.image.user) {
//         deselectCard();
//         showPopup('Press OK to stop revealing card to opponent', () => {
//             processAction('opp', true, 'stopLookingShortcut', ['self', zoneId, index]);
//         });
//     };
// }

// export const hideShortcut = (user, initiator, zoneId, index, message = true, emit = true) => {
//     const oInitiator = initiator === 'self' ? 'opp' : 'self';
//     if (user === 'opp' && emit && systemState.isTwoPlayer){
//         processAction(user, emit, 'hideShortcut', [oInitiator, zoneId, index, message]);
//         return;
//     };

//     const zone = getZone(user, zoneId);
//     const card = zone.array[index];

//     if (card.image.src !== rootDirectory + '/src/cardback.png'){
//         card.image.src2 = card.image.src;
//         card.image.src = '/src/cardback.png';
//     };
//     const appendMessageEmit = zoneId === 'hand' && initiator !== user;
//     if (message){
//         appendMessage(initiator, determineUsername(initiator) + ' hid card in ' + determineUsername(user) + "'s " + convertZoneName(zoneId), 'player', appendMessageEmit);
//     };
//     //deal with handling faceDown card locations
//     if (zoneId !== 'prizes' && !(zoneId === 'hand' && initiator !== user)){
//         card.image.faceDown = true;
//     };
    
//     processAction(user, emit, 'hideShortcut', [oInitiator, zoneId, index, message]);
// }

// export const lookShortcut = (user, initiator, zoneId, index, emit = true) => {
//     const oInitiator = initiator === 'self' ? 'opp' : 'self';
//     if (user === 'opp' && emit && systemState.isTwoPlayer){
//         processAction(user, emit, 'lookShortcut', [oInitiator, zoneId, index]);
//         return;
//     };

//     if (emit){ //only apply for initiator
//         const zone = getZone(user, zoneId);
//         const card = zone.array[index];    
//         card.image.src = card.image.src2;
//     };
//     appendMessage(initiator, determineUsername(initiator) + ' looked at card in ' + determineUsername(user) + "'s " + zoneId, 'player', false);

//     processAction(user, emit, 'lookShortcut', [oInitiator, zoneId, index]);
// }

// export const stopLookingShortcut = (user, initiator, zoneId, index, emit = true) => {
//     const oInitiator = initiator === 'self' ? 'opp' : 'self';
//     if (user === 'opp' && emit && systemState.isTwoPlayer){
//         processAction(user, emit, 'stopLookingShortcut', [oInitiator, zoneId, index]);
//         return;
//     };

//     if (emit){ //only apply for initiator
//         const zone = getZone(user, zoneId);
//         const card = zone.array[index];
//         card.image.src2 = card.image.src;
//         card.image.src = '/src/cardback.png';
//     };
//     appendMessage(initiator, determineUsername(initiator) + ' stopped looking at card in ' + determineUsername(user) + "'s " + zoneId, 'player', false);

//     processAction(user, emit, 'stopLookingShortcut', [oInitiator, zoneId, index]);
// }

// export const playRandomCardFaceDown = (user, initiator, randomIndex, emit = true) => {
//     const oInitiator = initiator === 'self' ? 'opp' : 'self';
//     if (user === 'opp' && emit && systemState.isTwoPlayer){
//         processAction(user, emit, 'playRandomCardFaceDown', [oInitiator, randomIndex]);
//         return;
//     };

//     const hand = getZone(user, 'hand');
//     randomIndex = typeof randomIndex === 'number' ? randomIndex : Math.floor(Math.random() * hand.getCount());
//     hand.array[randomIndex].image.faceDown = true;
//     hideShortcut(user, initiator, 'hand', randomIndex, false, false);
//     moveCard(user, initiator, 'hand', 'board', randomIndex);
//     appendMessage(initiator, determineUsername(initiator) + ' moved a random card from ' + determineUsername(user) + "'s hand to board", 'player', false);

//     processAction(user, emit, 'playRandomCardFaceDown', [oInitiator, randomIndex]);
// }