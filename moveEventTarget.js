import { hand_html, hand, discard, discard_html, prizes, prizes_html, lostzone, lostzone_html, 
    bench, bench_html, active, active_html, stadium, stadium_html, deck, deckDisplay_html } from "./initialization.js";
import { moveCard } from "./moveCard.js";
import { updateCount } from "./counts.js";

export function moveEventTarget(selectedCard, mLocation){
    switch (selectedCard.location){
        case 'hand':
            switch (mLocation){
                case 'bench':
                    moveCard(hand, hand_html, bench, bench_html, selectedCard.index);
                    break;
                case 'discard':
                    moveCard(hand, hand_html, discard, discard_html, selectedCard.index);
                    break;
                case 'prizes':
                    moveCard(hand, hand_html, prizes, prizes_html, selectedCard.index);
                    break;
                case 'lostzone':
                    moveCard(hand, hand_html, lostzone, lostzone_html, selectedCard.index);
                    break;
                case 'active':
                    moveCard(hand, hand_html, active, active_html, selectedCard.index);
                    break;
                case 'stadium':
                    moveCard(hand, hand_html, stadium, stadium_html, selectedCard.index);
                    break;
                case 'deck':
                    moveCard(hand, hand_html, deck, deckDisplay_html, selectedCard.index);
                    break;
                case 'hand':
                    moveCard(hand, hand_html, hand, hand_html, selectedCard.index);
                    break;
            };
            break;
        case 'bench':
            switch (mLocation){
                case 'bench':
                    moveCard(bench, bench_html, bench, bench_html, selectedCard.index);
                    break;
                case 'discard':
                    moveCard(bench, bench_html, discard, discard_html, selectedCard.index);
                    break;
                case 'prizes':
                    moveCard(bench, bench_html, prizes, prizes_html, selectedCard.index);
                    break;
                case 'lostzone':
                    moveCard(bench, bench_html, lostzone, lostzone_html, selectedCard.index);
                    break;
                case 'active':
                    moveCard(bench, bench_html, active, active_html, selectedCard.index);
                    break;
                case 'stadium':
                    moveCard(bench, bench_html, stadium, stadium_html, selectedCard.index);
                    break;
                case 'deck':
                    moveCard(bench, bench_html, deck, deckDisplay_html, selectedCard.index);
                    break;
                case 'hand':
                    moveCard(bench, bench_html, hand, hand_html, selectedCard.index);
                    break;
            };
            break;
        case 'discard':
            switch (mLocation){
                case 'bench':
                    moveCard(discard, discard_html, bench, bench_html, selectedCard.index);
                    break;
                case 'discard':
                    moveCard(discard, discard_html, discard, discard_html, selectedCard.index);
                    break;
                case 'prizes':
                    moveCard(discard, discard_html, prizes, prizes_html, selectedCard.index);
                    break;
                case 'lostzone':
                    moveCard(discard, discard_html, lostzone, lostzone_html, selectedCard.index);
                    break;
                case 'active':
                    moveCard(discard, discard_html, active, active_html, selectedCard.index);
                    break;
                case 'stadium':
                    moveCard(discard, discard_html, stadium, stadium_html, selectedCard.index);
                    break;
                case 'deck':
                    moveCard(discard, discard_html, deck, deckDisplay_html, selectedCard.index);
                    break;
                case 'hand':
                    moveCard(discard, discard_html, hand, hand_html, selectedCard.index);
                    break;
            };
            break;
        case 'prizes':
            switch (mLocation){
                case 'bench':
                    moveCard(prizes, prizes_html, bench, bench_html, selectedCard.index);
                    break;
                case 'discard':
                    moveCard(prizes, prizes_html, discard, discard_html, selectedCard.index);
                    break;
                case 'prizes':
                    moveCard(prizes, prizes_html, prizes, prizes_html, selectedCard.index);
                    break;
                case 'lostzone':
                    moveCard(prizes, prizes_html, lostzone, lostzone_html, selectedCard.index);
                    break;
                case 'active':
                    moveCard(prizes, prizes_html, active, active_html, selectedCard.index);
                    break;
                case 'stadium':
                    moveCard(prizes, prizes_html, stadium, stadium_html, selectedCard.index);
                    break;
                case 'deck':
                    moveCard(prizes, prizes_html, deck, deckDisplay_html, selectedCard.index);
                    break;
                case 'hand':
                    moveCard(prizes, prizes_html, hand, hand_html, selectedCard.index);
                    break;
            };
            break;
        case 'lostzone':
            switch (mLocation){
                case 'bench':
                    moveCard(lostzone, lostzone_html, bench, bench_html, selectedCard.index);
                    break;
                case 'discard':
                    moveCard(lostzone, lostzone_html, discard, discard_html, selectedCard.index);
                    break;
                case 'prizes':
                    moveCard(lostzone, lostzone_html, prizes, prizes_html, selectedCard.index);
                    break;
                case 'lostzone':
                    moveCard(lostzone, lostzone_html, lostzone, lostzone_html, selectedCard.index);
                    break;
                case 'active':
                    moveCard(lostzone, lostzone_html, active, active_html, selectedCard.index);
                    break;
                case 'stadium':
                    moveCard(lostzone, lostzone_html, stadium, stadium_html, selectedCard.index);
                    break;
                case 'deck':
                    moveCard(lostzone, lostzone_html, deck, deckDisplay_html, selectedCard.index);
                    break;
                case 'hand':
                    moveCard(lostzone, lostzone_html, hand, hand_html, selectedCard.index);
                    break;
            };
            break;
        case 'active':
            switch (mLocation){
                case 'bench':
                    moveCard(active, active_html, bench, bench_html, selectedCard.index);
                    break;
                case 'discard':
                    moveCard(active, active_html, discard, discard_html, selectedCard.index);
                    break;
                case 'prizes':
                    moveCard(active, active_html, prizes, prizes_html, selectedCard.index);
                    break;
                case 'lostzone':
                    moveCard(active, active_html, lostzone, lostzone_html, selectedCard.index);
                    break;
                case 'active':
                    moveCard(active, active_html, active, active_html, selectedCard.index);
                    break;
                case 'stadium':
                    moveCard(active, active_html, stadium, stadium_html, selectedCard.index);
                    break;
                case 'deck':
                    moveCard(active, active_html, deck, deckDisplay_html, selectedCard.index);
                    break;
                case 'hand':
                    moveCard(active, active_html, hand, hand_html, selectedCard.index);
                    break;
            };
            break;
        case 'stadium':
            switch (mLocation){
                case 'bench':
                    moveCard(stadium, stadium_html, bench, bench_html, selectedCard.index);
                    break;
                case 'discard':
                    moveCard(stadium, stadium_html, discard, discard_html, selectedCard.index);
                    break;
                case 'prizes':
                    moveCard(stadium, stadium_html, prizes, prizes_html, selectedCard.index);
                    break;
                case 'lostzone':
                    moveCard(stadium, stadium_html, lostzone, lostzone_html, selectedCard.index);
                    break;
                case 'active':
                    moveCard(stadium, stadium_html, active, active_html, selectedCard.index);
                    break;
                case 'stadium':
                    moveCard(stadium, stadium_html, stadium, stadium_html, selectedCard.index);
                    break;
                case 'deck':
                    moveCard(stadium, stadium_html, deck, deckDisplay_html, selectedCard.index);
                    break;
                case 'hand':
                    moveCard(stadium, stadium_html, hand, hand_html, selectedCard.index);
                    break;
            };
            break;
        case 'deck':
            switch (mLocation){
                case 'bench':
                    moveCard(deck, deckDisplay_html, bench, bench_html, selectedCard.index);
                    break;
                case 'discard':
                    moveCard(deck, deckDisplay_html, discard, discard_html, selectedCard.index);
                    break;
                case 'prizes':
                    moveCard(deck, deckDisplay_html, prizes, prizes_html, selectedCard.index);
                    break;
                case 'lostzone':
                    moveCard(deck, deckDisplay_html, lostzone, lostzone_html, selectedCard.index);
                    break;
                case 'active':
                    moveCard(deck, deckDisplay_html, active, active_html, selectedCard.index);
                    break;
                case 'stadium':
                    moveCard(deck, deckDisplay_html, stadium, stadium_html, selectedCard.index);
                    break;
                case 'deck':
                    moveCard(deck, deckDisplay_html, deck, deckDisplay_html, selectedCard.index);
                    break;
                case 'hand':
                    moveCard(deck, deckDisplay_html, hand, hand_html, selectedCard.index);
                    break;
            };
            break;
        case 'hand':
            switch (mLocation){
                case 'bench':
                    moveCard(hand, hand_html, bench, bench_html, selectedCard.index);
                    break;
                case 'discard':
                    moveCard(hand, hand_html, discard, discard_html, selectedCard.index);
                    break;
                case 'prizes':
                    moveCard(hand, hand_html, prizes, prizes_html, selectedCard.index);
                    break;
                case 'lostzone':
                    moveCard(hand, hand_html, lostzone, lostzone_html, selectedCard.index);
                    break;
                case 'active':
                    moveCard(hand, hand_html, active, active_html, selectedCard.index);
                    break;
                case 'stadium':
                    moveCard(hand, hand_html, stadium, stadium_html, selectedCard.index);
                    break;
                case 'deck':
                    moveCard(hand, hand_html, deck, deckDisplay_html, selectedCard.index);
                    break;
                case 'hand':
                    moveCard(hand, hand_html, hand, hand_html, selectedCard.index);
                    break;
            };
            break;
    };
    updateCount();
}