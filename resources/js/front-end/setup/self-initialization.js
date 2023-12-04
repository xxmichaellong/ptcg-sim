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
export const viewCards_html = selfContainersDocument.getElementById('viewCards_html');
export const board_html = selfContainersDocument.getElementById('board_html');

export const deck = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const lostzone = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const discard = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const stadium = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const stadium_html = document.getElementById('stadium_html');
export const prizes = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const active = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const bench = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const hand = {
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

export const viewCards = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const board = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

// create global variable that holds the html index of a clicked card
export const sCard = {
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
    "stadium_html",
    "board_html",
    "viewCards_html"
];