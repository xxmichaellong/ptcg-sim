const mainContainers = document.getElementById('mainContainers');
export const mainContainersDocument = mainContainers.contentWindow.document;
export const deckDisplay_html = mainContainersDocument.getElementById('deckDisplay_html');
export const deck_html = mainContainersDocument.getElementById('deck_html');
export const lostzone_html = mainContainersDocument.getElementById('lostzone_html');
export const lostzoneDisplay_html = mainContainersDocument.getElementById('lostzoneDisplay_html');
export const discard_html = mainContainersDocument.getElementById('discard_html');
export const discardDisplay_html = mainContainersDocument.getElementById('discardDisplay_html');
export const prizes_html = mainContainersDocument.getElementById('prizes_html');
export const prizesHidden_html = mainContainersDocument.getElementById('prizesHidden_html');
export const active_html = mainContainersDocument.getElementById('active_html');
export const bench_html = mainContainersDocument.getElementById('bench_html');
export const hand_html = mainContainersDocument.getElementById('hand_html');

//deck
export const deck = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};

//lostzone
export const lostzone = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};

//discard
export const discard = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};

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

//active
export const active = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};

//bench
export const bench = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};

//hand
export const hand = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};

export const flowerSelectingZone = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};

export const colresssExperimentZone = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};

// create global variable that holds the html index of a clicked card
export const selectedCard = {
    index: 0,
    location: '',
    container: '',
};

// Drag and drop functions
export const containerIds = [
    "hand_html",
    "prizesHidden_html",
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

export const cardData = [
    [4, 'comfey', 'resources/card-scans/comfey.webp', 'pokemon'],
    [2, 'sableye', 'resources/card-scans/sableye.webp', 'pokemon'],
    [1, 'cramorant', 'resources/card-scans/cramorant.webp', 'pokemon'],
    [1, 'kyogre', 'resources/card-scans/kyogre.webp', 'pokemon'],
    [1, 'pidgeotV', 'resources/card-scans/pidgeotV.webp', 'pokemon'],
    [1, 'manaphy', 'resources/card-scans/manaphy.webp', 'pokemon'],
    [1, 'radiantGreninja', 'resources/card-scans/radiantGreninja.webp', 'pokemon'],
    [1, 'zamazenta', 'resources/card-scans/zamazenta.webp', 'pokemon'],
    [4, 'metal', 'resources/card-scans/metal.webp', 'energy'],
    [4, 'water', 'resources/card-scans/water.webp', 'energy'],
    [3, 'psychic', 'resources/card-scans/psychic.webp', 'energy'],
    [4, 'colress\'sExperiment', 'resources/card-scans/colress\'sExperiment.webp', 'supporter'],
    [4, 'battleVipPass', 'resources/card-scans/battleVipPass.webp', 'item'],
    [4, 'mirageGate', 'resources/card-scans/mirageGate.webp', 'item'],
    [4, 'switchCart', 'resources/card-scans/switchCart.webp', 'item'],
    [3, 'escapeRope', 'resources/card-scans/escapeRope.webp', 'item'],
    [4, 'nestBall', 'resources/card-scans/nestBall.jpg', 'item'],
    [3, 'superRod', 'resources/card-scans/superRod.webp', 'item'],
    [2, 'energyRecycler', 'resources/card-scans/energyRecycler.webp', 'item'],
    [1, 'lostVacuum', 'resources/card-scans/lostVacuum.webp', 'item'],
    [1, 'echoingHorn', 'resources/card-scans/echoingHorn.jpg', 'item'],
    [1, 'hisuianHeavyBall', 'resources/card-scans/hisuianHeavyBall.webp', 'item'],
    [1, 'roxanne', 'resources/card-scans/roxanne.webp', 'supporter'],
    [1, 'artazon', 'resources/card-scans/artazon.webp', 'stadium'],
    [1, 'pokestop', 'resources/card-scans/pokestop.webp', 'stadium'],
    [1, 'beachCourt', 'resources/card-scans/beachCourt.webp', 'stadium'],
    [2, 'forestSealStone', 'resources/card-scans/forestSealStone.webp', 'tool']
];

//opp arrays
export const oppLostzone = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const oppDiscard = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const oppActive = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const oppBench = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const oppDeck = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const oppPrizes = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};
export const oppHand = {
    cards: [],
    images: [],
    get count() {
        return this.cards.length;
    }
};