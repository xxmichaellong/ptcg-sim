import { deck_html, discard_html, lostzone_html, oppCloseDeckDisplayButton, oppCloseDiscardDisplayButton, oppCloseLostzoneDisplayButton, oppDeck_html, oppDiscard_html, oppLostzone_html, selfAttachedCardDiscardButton, selfCloseDeckDisplayButton, selfCloseDiscardDisplayButton, selfCloseLostzoneDisplayButton, selfDiscardShuffleButton } from '../../front-end.js';

selfAttachedCardDiscardButton.addEventListener('click', () => {
    const viewCount = sCard.user === 'self' ? viewCards.count : oppViewCards.count;
    for (let i = 0; i < viewCount; i++){
        moveCard(sCard.user, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', 0, false, true);
        socket.emit('moveCard', roomId, sCard.oUser, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', 0);
    };
    const deckCount = sCard.user === 'self' ? deck.count : oppDeck.count;
    const indices = shuffleIndices(deckCount);
    shuffleContainer(sCard.user, 'deck', 'deck_html', indices);
    socket.emit('shuffleContainer', roomId, sCard.oUser, 'deck', 'deck_html', indices);
});

selfDiscardShuffleButton.addEventListener('click', () => {
    const discardAmount = sCard.user === 'self' ? attachedCardPopup.count : oppAttachedCardPopup.count;
    socket.emit('discardAll', roomId, sCard.oUser, discardAmount);
    discardAll(sCard.user, discardAmount);
});

// Function to close the modal
selfCloseDeckDisplayButton.addEventListener('click', () => {
    deck_html.style.display = 'none';
});
selfCloseLostzoneDisplayButton.addEventListener('click', () => {
    lostzone_html.style.display = 'none';
});
selfCloseDiscardDisplayButton.addEventListener('click', () => {
    discard_html.style.display = 'none';
});
oppCloseDeckDisplayButton.addEventListener('click', () => {
    oppLostzone_html.style.display = 'none';
});
oppCloseLostzoneDisplayButton.addEventListener('click', () => {
    oppDiscard_html.style.display = 'none';
});
oppCloseDiscardDisplayButton.addEventListener('click', () => {
    oppDeck_html.style.display = 'none';
});
