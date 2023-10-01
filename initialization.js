// Initialize empty deck array, lostzone array, discard pile, stadium, prize cards, active, bench, and link to HTML element
//deck
export const deck = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const deck_html = document.getElementById('deck_html');

//lostzone
export const lostzone = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const lostzone_html = document.getElementById('lostzone_html');

//discard
export const discard = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const discard_html = document.getElementById('discard_html');

//stadium
export const stadium = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const stadium_html = document.getElementById('stadium_html');

//prizes
export const prizes = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const prizes_html = document.getElementById('prizes_html');

//active
export const active = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const active_html = document.getElementById('active_html');

//bench
export const bench = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const bench_html = document.getElementById('bench_html');

//hand
export const hand = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const hand_html = document.getElementById('hand_html');

//create global variable that holds the html index of a the clicked card
export const selectedCard = {
    index: 0,
    location: ''
};