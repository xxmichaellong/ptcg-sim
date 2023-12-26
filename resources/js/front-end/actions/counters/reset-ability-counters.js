import { oppContainersDocument, p1, selfContainersDocument, socket } from "../../front-end.js";

export const resetCounters = (received = false) => {
    selfContainersDocument.querySelectorAll('.self-tab, .opp-tab').forEach(element => {
        element.handleRemove();
    });
    oppContainersDocument.querySelectorAll('.self-tab, .opp-tab').forEach(element => {
        element.handleRemove();
    });
    document.querySelectorAll('.tab').forEach(element => {
        element.handleRemove();
    });
    if (!p1[0] && !received){
        const data = {
            roomId : roomId,
            received: true
        };
        socket.emit('resetCounters', data);
    };
}