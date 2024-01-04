import { oppContainersDocument, systemState, selfContainersDocument, socket } from "../../front-end.js";

export const resetCounters = (emit = true) => {
    selfContainersDocument.querySelectorAll('.self-tab, .opp-tab').forEach(element => {
        element.handleRemove();
    });
    oppContainersDocument.querySelectorAll('.self-tab, .opp-tab').forEach(element => {
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