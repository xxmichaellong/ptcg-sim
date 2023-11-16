const oppContainers = document.getElementById('oppContainers');
export const oppContainersDocument = oppContainers.contentWindow.document;
export const oppDeckDisplay_html = oppContainersDocument.getElementById('deckDisplay_html');
export const oppLostzone_html = oppContainersDocument.getElementById('lostzone_html');
export const oppLostzoneDisplay_html = oppContainersDocument.getElementById('lostzoneDisplay_html');
export const oppDiscard_html = oppContainersDocument.getElementById('discard_html');
export const oppDiscardDisplay_html = oppContainersDocument.getElementById('discardDisplay_html');
export const oppActive_html = oppContainersDocument.getElementById('active_html');
export const oppBench_html = oppContainersDocument.getElementById('bench_html');
export const oppHand_html = oppContainersDocument.getElementById('hand_html');
export const oppPrizes_html = oppContainersDocument.getElementById('prizes_html');
export const oppDeck_html = oppContainersDocument.getElementById('deck_html');
export const oppAttachedCardPopup_html = oppContainersDocument.getElementById('attachedCardPopup_html');

//opp arrays
export const oppLostzone = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};
export const oppDiscard = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};
export const oppActive = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};
export const oppBench = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};
export const oppDeck = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};
export const oppPrizes = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};
export const oppHand = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};

export const oppAttachedCardPopup = {
    cards: [],
    get count(){
        return this.cards.length;
    }
};