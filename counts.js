import { hand, discard, prizes, lostzone, bench, active, stadium, deck } from "./initialization.js";

export function updateCount(){
    const deckCountElement = document.getElementById('deckCount');
    const discardCountElement = document.getElementById('discardCount');
    const lostzoneCountElement = document.getElementById('lostzoneCount');
    const prizesCountElement = document.getElementById('prizesCount');
    const activeCountElement = document.getElementById('activeCount');
    const benchCountElement = document.getElementById('benchCount');
    const stadiumCountElement = document.getElementById('stadiumCount');
    const handCountElement = document.getElementById('handCount');

    deckCountElement.textContent = deck.count;
    discardCountElement.textContent = discard.count;
    lostzoneCountElement.textContent = lostzone.count;
    prizesCountElement.textContent = prizes.count;
    activeCountElement.textContent = active.count;
    benchCountElement.textContent = bench.count;
    stadiumCountElement.textContent = stadium.count;
    handCountElement.textContent = hand.count;
}