import { systemState } from "../../front-end.js";
import { processAction } from "../../setup/general/process-action.js";
import { moveCardMessage } from "./move-card-message.js";
import { moveCard } from "./move-card.js";

export const moveCardBundle = (user, initiator, oZoneId, dZoneId, index, targetIndex, action, emit = true) => {
    const oInitiator = initiator === 'self' ? 'opp' : 'self';
    if (user === 'opp' && emit && systemState.isTwoPlayer){
        processAction(user, emit, 'moveCardBundle', [oInitiator, oZoneId, dZoneId, index, targetIndex, action]);
        return;
    };

    moveCardMessage(user, initiator, oZoneId, dZoneId, index, targetIndex, action);
    moveCard(user, initiator, oZoneId, dZoneId, index, targetIndex);

    processAction(user, emit, 'moveCardBundle', [oInitiator, oZoneId, dZoneId, index, targetIndex, action]);
}