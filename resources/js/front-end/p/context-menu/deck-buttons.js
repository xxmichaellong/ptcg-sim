viewTopButton.addEventListener('click', () => handleViewButtonClick(true));
viewBottomButton.addEventListener('click', () => handleViewButtonClick(false));
shuffleDeckButton.addEventListener('click', function(){
    let deckCount = sCard.user === 'self' ? deck.count : oppDeck.count;
    const indices = shuffleIndices(deckCount);
    shuffleContainer(sCard.user, 'deck', 'deck_html', indices);
    socket.emit('shuffleContainer', roomId, sCard.oUser, 'deck', 'deck_html', indices);
});
drawButton.addEventListener('click', () => {
    let drawAmount;

    const userInput = window.prompt('Draw how many cards?', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, deck.count);
        draw('self', drawAmount);
        socket.emit('draw', roomId, drawAmount);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
});
