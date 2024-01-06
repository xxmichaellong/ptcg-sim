import { oppContainerDocument, selfContainerDocument, socket, systemState } from "../../front-end.js";

export const resetCounters = (emit = true) => {
    selfContainerDocument.querySelectorAll('.self-tab, .opp-tab').forEach(element => {
        element.handleRemove();
    });
    oppContainerDocument.querySelectorAll('.self-tab, .opp-tab').forEach(element => {
        element.handleRemove();
    });
    document.querySelectorAll('.tab').forEach(element => {
        element.handleRemove();
    });
    if (systemState.isTwoPlayer && emit){
        const data = {
            roomId : systemState.roomId,
            emit: false
        };
        socket.emit('resetCounters', data);
    };
}