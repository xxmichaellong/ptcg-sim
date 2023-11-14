import { dragEnd, dragOver, dragStart, drop } from "./drag.js";
import { imageClick, discardCoverClick, deckCoverClick, lostzoneCoverClick } from "./click-events.js";

export const imageFunctions = {
    imageClick: imageClick,
    deckCoverClick: deckCoverClick,
    lostzoneCoverClick: lostzoneCoverClick,
    discardCoverClick: discardCoverClick,
    dragStart: dragStart,
    dragOver: dragOver,
    drop: drop,
    dragEnd: dragEnd
};