// Initialize empty deck array, lostzone array, discard pile, stadium, prize cards, active, bench, and link to HTML element
//deck
export const deck = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const deckDisplay_html = document.getElementById('deckDisplay_html');
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

export const cardData = [
    [4, 'comfey', 'cardScans/comfey.webp'],
    [2, 'sableye', 'cardScans/sableye.webp'],
    [1, 'cramorant', 'cardScans/cramorant.webp'],
    [1, 'kyogre', 'cardScans/kyogre.webp'],
    [1, 'pidgeotV', 'cardScans/pidgeotV.webp'],
    [1, 'manaphy', 'cardScans/manaphy.webp'],
    [1, 'radiantGreninja', 'cardScans/radiantGreninja.webp'],
    [1, 'zamazenta', 'cardScans/zamazenta.webp'],
    [4, 'metal', 'cardScans/metal.webp'],
    [4, 'water', 'cardScans/water.webp'],
    [3, 'psychic', 'cardScans/psychic.webp'],
    [4, 'colress\'sExperiment', 'cardScans/colress\'sExperiment.webp'],
    [4, 'battleVipPass', 'cardScans/battleVipPass.webp'],
    [4, 'mirageGate', 'cardScans/mirageGate.webp'],
    [4, 'switchCart', 'cardScans/switchCart.webp'],
    [3, 'escapeRope', 'cardScans/escapeRope.webp'],
    [4, 'nestBall', 'cardScans/nestBall.jpg'],
    [3, 'superRod', 'cardScans/superRod.webp'],
    [2, 'energyRecycler', 'cardScans/energyRecycler.webp'],
    [1, 'lostVacuum', 'cardScans/lostVacuum.webp'],
    [1, 'echoingHorn', 'cardScans/echoingHorn.jpg'],
    [1, 'hisuianHeavyBall', 'cardScans/hisuianHeavyBall.webp'],
    [1, 'palPad', 'cardScans/palPad.webp'],
    [1, 'artazon', 'cardScans/artazon.webp'],
    [1, 'pokestop', 'cardScans/pokestop.webp'],
    [1, 'beachCourt', 'cardScans/beachCourt.webp'],
    [2, 'forestSealStone', 'cardScans/forestSealStone.webp']
];