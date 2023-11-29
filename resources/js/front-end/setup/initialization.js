const selfContainers = document.getElementById('selfContainers');
export const selfContainersDocument = selfContainers.contentWindow.document;
export const deckDisplay_html = selfContainersDocument.getElementById('deckDisplay_html');
export const deck_html = selfContainersDocument.getElementById('deck_html');
export const lostzone_html = selfContainersDocument.getElementById('lostzone_html');
export const lostzoneDisplay_html = selfContainersDocument.getElementById('lostzoneDisplay_html');
export const discard_html = selfContainersDocument.getElementById('discard_html');
export const discardDisplay_html = selfContainersDocument.getElementById('discardDisplay_html');
export const prizes_html = selfContainersDocument.getElementById('prizes_html');
export const active_html = selfContainersDocument.getElementById('active_html');
export const bench_html = selfContainersDocument.getElementById('bench_html');
export const hand_html = selfContainersDocument.getElementById('hand_html');
export const attachedCardPopup_html = selfContainersDocument.getElementById('attachedCardPopup_html');

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

export const attachedCardPopup = {
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
    locationAsString: '',
    oUser: '',
    user: ''
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