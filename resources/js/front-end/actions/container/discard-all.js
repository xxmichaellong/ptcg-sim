import { moveCard } from '../general/move-card.js';

export const discardAll = (user, discardAmount) => {
    for (let i = 0; i < discardAmount; i++){
        moveCard(user, 'attachedCardPopup', 'attachedCardPopup_html', 'discard', 'discard_html', 0, false, true);
    };
};