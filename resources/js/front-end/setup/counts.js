import { hand, discard, prizes, lostzone, bench, active, stadium, deck, mainContainersDocument } from "./initialization.js";

export function updateCount(){
    const deckCountElement = mainContainersDocument.getElementById('deckCount');
    const discardCountElement = mainContainersDocument.getElementById('discardCount');
    const lostzoneCountElement = mainContainersDocument.getElementById('lostzoneCount');
    
    /* 
    const prizesCountElement = mainContainersDocument.getElementById('prizesCount');
    const activeCountElement = mainContainersDocument.getElementById('activeCount');
    const benchCountElement = mainContainersDocument.getElementById('benchCount');
    const handCountElement = mainContainersDocument.getElementById('handCount');
    */

    deckCountElement.textContent = deck.count;
    discardCountElement.textContent = discard.count;
    lostzoneCountElement.textContent = lostzone.count;
    /*
    prizesCountElement.textContent = prizes.count;
    activeCountElement.textContent = active.count;
    benchCountElement.textContent = bench.count;
    handCountElement.textContent = hand.count;
    */
}