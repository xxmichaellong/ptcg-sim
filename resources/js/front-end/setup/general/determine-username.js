import { p1, p1Username, p2OppUsername, p2SelfUsername } from "../../front-end.js";

export const determineUsername = (user) => {
    let username;
    if (p1[0]){
        username = p1Username(user);
    } else {
        username = user === 'self' ? p2SelfUsername[0] : p2OppUsername[0];
    };
    return username;
}