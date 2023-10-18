// Function to shuffle deck (Fisher-Yates)
export function shuffle(card, image) {
    for (let i = card.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [card[i], card[j]] = [card[j], card[i]];
      [image[i], image[j]] = [image[j], image[i]];
    }
  }