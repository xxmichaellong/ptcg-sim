import { deck, deck_html, hand, hand_html, prizes, prizes_html, discard, discard_html, lostzone, lostzone_html, 
    active, active_html, bench, bench_html, stadium, stadium_html, deckDisplay_html } from "../setup/initialization.js";
import { oppDeck, oppDeck_html, oppHand, oppHand_html, oppPrizes, oppPrizes_html, oppDiscard, oppDiscard_html, oppLostzone, oppLostzone_html,
    oppActive, oppActive_html, oppBench, oppBench_html, oppDeckDisplay_html } from "../setup/opp-initialization.js";

    export let _deck;
    export let _deck_html;
    export let _hand;
    export let _hand_html;
    export let _prizes;
    export let _prizes_html;
    export let _discard;
    export let _discard_html;
    export let _lostzone;
    export let _lostzone_html;
    export let _active;
    export let _active_html;
    export let _bench;
    export let _bench_html;
    export let _stadium;
    export let _stadium_html;
    export let _deckDisplay_html;
    
export function updateUser(user){

    if (user === 'self'){
        _deck = deck;
        _deck_html = deck_html;
        _hand = hand;
        _hand_html = hand_html;
        _prizes = prizes;
        _prizes_html = prizes_html;
        _discard = discard;
        _discard_html = discard_html;
        _lostzone = lostzone;
        _lostzone_html = lostzone_html;
        _active = active;
        _active_html = active_html;
        _bench = bench;
        _bench_html = bench_html;
        _stadium = stadium;
        _stadium_html = stadium_html;
        _deckDisplay_html = deckDisplay_html;
    } else {
        _deck = oppDeck;
        _deck_html = oppDeck_html;
        _hand = oppHand;
        _hand_html = oppHand_html;
        _prizes = oppPrizes;
        _prizes_html = oppPrizes_html;
        _discard = oppDiscard;
        _discard_html = oppDiscard_html;
        _lostzone = oppLostzone;
        _lostzone_html = oppLostzone_html;
        _active = oppActive;
        _active_html = oppActive_html;
        _bench = oppBench;
        _bench_html = oppBench_html;
        _stadium = stadium;
        _stadium_html = stadium_html;
        _deckDisplay_html = oppDeckDisplay_html;
    };
}