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
export const lostzoneDisplay_html = document.getElementById('lostzoneDisplay_html');

//discard
export const discard = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const discard_html = document.getElementById('discard_html');
export const discardDisplay_html = document.getElementById('discardDisplay_html');

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
export const prizesHidden_html = document.getElementById('prizesHidden_html');

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

//create global variable that holds the html index of a clicked card
export const selectedCard = {
    index: 0,
    location: '',
    container: '',
    image: '',
};

// Drag and drop functions
export const containerIds = [
    "hand_html",
    "prizesHidden_html",
    "prizes_html",
    "lostzoneDisplay_html",
    "lostzone_html",
    "active_html",
    "stadium_html",
    "bench_html",
    "deckDisplay_html",
    "deck_html",
    "discard_html",
    "discardDisplay_html"
];

export const cardData = [
    [4, 'comfey', 'cardScans/comfey.webp', 'pokemon'],
    [2, 'sableye', 'cardScans/sableye.webp', 'pokemon'],
    [1, 'cramorant', 'cardScans/cramorant.webp', 'pokemon'],
    [1, 'kyogre', 'cardScans/kyogre.webp', 'pokemon'],
    [1, 'pidgeotV', 'cardScans/pidgeotV.webp', 'pokemon'],
    [1, 'manaphy', 'cardScans/manaphy.webp', 'pokemon'],
    [1, 'radiantGreninja', 'cardScans/radiantGreninja.webp', 'pokemon'],
    [1, 'zamazenta', 'cardScans/zamazenta.webp', 'pokemon'],
    [4, 'metal', 'cardScans/metal.webp', 'energy'],
    [4, 'water', 'cardScans/water.webp', 'energy'],
    [3, 'psychic', 'cardScans/psychic.webp', 'energy'],
    [4, 'colress\'sExperiment', 'cardScans/colress\'sExperiment.webp', 'supporter'],
    [4, 'battleVipPass', 'cardScans/battleVipPass.webp', 'item'],
    [4, 'mirageGate', 'cardScans/mirageGate.webp', 'item'],
    [4, 'switchCart', 'cardScans/switchCart.webp', 'item'],
    [3, 'escapeRope', 'cardScans/escapeRope.webp', 'item'],
    [4, 'nestBall', 'cardScans/nestBall.jpg', 'item'],
    [3, 'superRod', 'cardScans/superRod.webp', 'item'],
    [2, 'energyRecycler', 'cardScans/energyRecycler.webp', 'item'],
    [1, 'lostVacuum', 'cardScans/lostVacuum.webp', 'item'],
    [1, 'echoingHorn', 'cardScans/echoingHorn.jpg', 'item'],
    [1, 'hisuianHeavyBall', 'cardScans/hisuianHeavyBall.webp', 'item'],
    [1, 'roxanne', 'cardScans/roxanne.webp', 'supporter'],
    [1, 'artazon', 'cardScans/artazon.webp', 'stadium'],
    [1, 'pokestop', 'cardScans/pokestop.webp', 'stadium'],
    [1, 'beachCourt', 'cardScans/beachCourt.webp', 'stadium'],
    [2, 'forestSealStone', 'cardScans/forestSealStone.webp', 'tool']
];