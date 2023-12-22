import { p1 } from "../../front-end.js";
import { p2DeckData } from "../../socket/fetch-opp-data.js";
import { altDeckData, mainDeckData } from "../deck-constructor/import.js";

export const determineDeckData = (user) => {
    let deckData;
    if (user === 'self'){
        deckData = mainDeckData[0];
    } else {
        deckData = p1[0] ? altDeckData[0] : p2DeckData[0];
    };
    return deckData;
}
