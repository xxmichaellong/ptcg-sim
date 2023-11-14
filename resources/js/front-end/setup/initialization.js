const mainContainers = document.getElementById('mainContainers');
export const mainContainersDocument = mainContainers.contentWindow.document;
export const deckDisplay_html = mainContainersDocument.getElementById('deckDisplay_html');
export const deck_html = mainContainersDocument.getElementById('deck_html');
export const lostzone_html = mainContainersDocument.getElementById('lostzone_html');
export const lostzoneDisplay_html = mainContainersDocument.getElementById('lostzoneDisplay_html');
export const discard_html = mainContainersDocument.getElementById('discard_html');
export const discardDisplay_html = mainContainersDocument.getElementById('discardDisplay_html');
export const prizes_html = mainContainersDocument.getElementById('prizes_html');
export const active_html = mainContainersDocument.getElementById('active_html');
export const bench_html = mainContainersDocument.getElementById('bench_html');
export const hand_html = mainContainersDocument.getElementById('hand_html');

//deck
export const deck = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

//lostzone
export const lostzone = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

//discard
export const discard = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

//stadium
export const stadium = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const stadium_html = document.getElementById('stadium_html');

//prizes
export const prizes = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

//active
export const active = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

//bench
export const bench = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

//hand
export const hand = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const flowerSelectingZone = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const colresssExperimentZone = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

// create global variable that holds the html index of a clicked card
export const selectedCard = {
    index: 0,
    location: '',
    container: '',
    containerId: '',
    locationAsString: ''
};

export const target = {
    index: 0,
    location: '',
    container: '',
    containerId: '',
    locationAsString: ''
};

// Drag and drop functions
export const containerIds = [
    "hand_html",
    "prizes_html",
    "lostzoneDisplay_html",
    "lostzone_html",
    "active_html",
    "bench_html",
    "deckDisplay_html",
    "deck_html",
    "discard_html",
    "discardDisplay_html",
    "stadium_html"
];