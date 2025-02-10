// this is only relevant for the active/bench, where there is a div container holding the pokemon and its attached cards
// this is for adjusting the size of the container holding the pokemon/attached cards and the counter of how many cards are attached,
// so future cards are appended in the right location
export const decreaseCardLayer = (movingCard) => {
  if (movingCard.type !== 'Pokémon') {
    movingCard.image.relative.energyLayer -= 1;
    //adjust width of container
    const adjustment = movingCard.image.relative.clientWidth / 6;
    const currentWidth = parseFloat(
      movingCard.image.relative.parentElement.clientWidth
    );
    const newWidth = currentWidth - adjustment;
    movingCard.image.relative.parentElement.style.width = newWidth + 'px';
  } else {
    movingCard.image.relative.layer -= 1;
  }
};
