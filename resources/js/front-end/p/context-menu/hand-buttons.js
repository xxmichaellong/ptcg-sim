revealOppHandButton.addEventListener('click', () => revealCards(oppHand, oppHand_html));
hideOppHandButton.addEventListener('click', () => hideCards(oppHand, oppHand_html));
discardHandButton.addEventListener('click', () => {
    let drawAmount;

    const userInput = window.prompt('Draw how many cards?', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, deck.count);
        socket.emit('discardAndDraw', roomId, hand.count, drawAmount);
        discardAndDraw('self', hand.count, drawAmount);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
});

shuffleHandButton.addEventListener('click', () => {
    let drawAmount;

    const userInput = window.prompt('Draw how many cards?', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, (deck.count + hand.count));
        shuffleAndDraw('self', hand.count, drawAmount);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
});

shuffleHandBottomButton.addEventListener('click', () => {
    let drawAmount;

    const userInput = window.prompt('Draw how many cards?', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, (deck.count + hand.count));
        shuffleBottomAndDraw('self', hand.count, drawAmount);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
});