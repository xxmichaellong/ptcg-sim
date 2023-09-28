// Initialize empty deck array, lostzone array, discard pile, stadium, prize cards, active, bench, and link to HTML element
export const deck = {
    cards: [],
    get count() {
        return this.cards.length;
    }
};
export const deck_html = document.getElementById('deck_html');

export let lostzone = [];
export const lostzone_html = document.getElementById('lostzone_html');

export let discard = [];
export const discard_html = document.getElementById('discard_html');

export let stadium = [];
export const stadium_html = document.getElementById('stadium_html');

export let prizes = [];
export const prizes_html = document.getElementById('prizes_html');

export let active = [];
export const active_html = document.getElementById('active_html');

export let bench = [];
export const bench_html = document.getElementById('bench_html');

export const hand = {
    cards: [],
    get count() {
        return this.cards.length;
    }
};
export const hand_html = document.getElementById('hand_html');