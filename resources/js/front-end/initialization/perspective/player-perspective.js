import { selfContainers } from "../../front-end.js";

export const p1 = [true];
export const POV = {
    get user() {
        return selfContainers.classList.contains('self') ? 'self' : 'opp';
    },
    get oUser() {
        return selfContainers.classList.contains('self') ? 'opp' : 'self';
    }
};
export const roomId = [];
export const p1Username = (user) => {
    return user === 'self' ? 'Blue player' : 'Red player';
}
export const p2SelfUsername = [];
export const p2OppUsername = [];
export const turn = [0];
