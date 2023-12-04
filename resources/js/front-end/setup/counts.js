import { hand, discard, prizes, lostzone, bench, active, stadium, deck, selfContainersDocument } from "./self-initialization.js";
import { oppContainersDocument, oppDeck, oppDiscard, oppLostzone } from "./opp-initialization.js";

export function updateCount(){
    const deckCountElement = selfContainersDocument.getElementById('deckCount');
    const discardCountElement = selfContainersDocument.getElementById('discardCount');
    const lostzoneCountElement = selfContainersDocument.getElementById('lostzoneCount');
    
    /* 
    const prizesCountElement = selfContainersDocument.getElementById('prizesCount');
    const activeCountElement = selfContainersDocument.getElementById('activeCount');
    const benchCountElement = selfContainersDocument.getElementById('benchCount');
    const handCountElement = selfContainersDocument.getElementById('handCount');
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

    //opp containers
    const oppDeckCountElement =  oppContainersDocument.getElementById('deckCount');
    const oppDiscardCountElement = oppContainersDocument.getElementById('discardCount');
    const oppLostzoneCountElement = oppContainersDocument.getElementById('lostzoneCount');

    oppDeckCountElement.textContent = oppDeck.count;
    oppDiscardCountElement.textContent = oppDiscard.count;
    oppLostzoneCountElement.textContent = oppLostzone.count;
}