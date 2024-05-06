import { systemState } from "../../front-end.js";

export const cleanActionData = (user) => {
    if (user === 'self'){
        systemState.selfCounter = 0;
        systemState.selfActionData = [];
        // systemState.spectatorActionData = [];
        systemState.exportActionData = [];
    } else {
        systemState.oppCounter = 0;
        systemState.oppActionData = [];
        systemState.p2OppDeckData = '';
    };
}