import { dragEnd, dragLeave, dragOver, dragStart, drop } from "./drag.js";
import { imageClick, discardCoverClick, deckCoverClick, lostzoneCoverClick, openCardContextMenu } from "./click-events.js";

export const imageFunctions = {
    imageClick: imageClick,
    deckCoverClick: deckCoverClick,
    lostzoneCoverClick: lostzoneCoverClick,
    discardCoverClick: discardCoverClick,
    dragStart: dragStart,
    dragOver: dragOver,
    dragLeave: dragLeave,
    drop: drop,
    dragEnd: dragEnd,
    openCardContextMenu: openCardContextMenu
};