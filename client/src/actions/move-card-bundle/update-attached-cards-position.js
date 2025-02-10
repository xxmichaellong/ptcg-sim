export const updateAttachedCardsPosition = (oZone, movingCard) => {
  oZone.array.forEach((card) => {
    let cardPosition;
    let movingCardPosition;
    if (card.type !== 'Pokémon' && movingCard.type !== 'Pokémon') {
      cardPosition = card.image.style.left;
      movingCardPosition = movingCard.image.style.left;

      if (
        movingCard.image.relative instanceof HTMLImageElement &&
        movingCard.image.relative === card.image.relative &&
        parseInt(cardPosition) > parseInt(movingCardPosition)
      ) {
        const adjustment = movingCard.image.relative.clientWidth / 6;
        card.image.style.left = parseInt(cardPosition) - adjustment + 'px';
        card.image.style.zIndex = (
          parseInt(card.image.style.zIndex) + 1
        ).toString();
      }
    } else {
      cardPosition = card.image.style.bottom;
      movingCardPosition = movingCard.image.style.bottom;

      if (
        movingCard.image.relative instanceof HTMLImageElement &&
        movingCard.image.relative === card.image.relative &&
        parseInt(cardPosition) > parseInt(movingCardPosition) &&
        movingCard.type === 'Pokémon'
      ) {
        const adjustment = movingCard.image.relative.clientWidth / 15;
        card.image.style.bottom = parseInt(cardPosition) - adjustment + 'px';
        card.image.style.zIndex = (
          parseInt(card.image.style.zIndex) + 1
        ).toString();
      }
    }
  });
};
