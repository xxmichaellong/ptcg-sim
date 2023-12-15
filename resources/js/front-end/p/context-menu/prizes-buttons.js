
shufflePrizesButton.addEventListener('click', function(){
    let prizesCount = sCard.user === 'self' ? prizes.count : oppPrizes.count;
    const indices = shuffleIndices(prizesCount);
    shuffleContainer(sCard.user, 'prizes', 'prizes_html', indices);
    socket.emit('shuffleContainer', roomId, sCard.oUser, 'prizes', 'prizes_html', indices);
});

revealPrizesButton.addEventListener('click', function(){revealCards(prizes, prizes_html)});
hidePrizesButton.addEventListener('click', function(){hideCards(prizes, prizes_html)});

