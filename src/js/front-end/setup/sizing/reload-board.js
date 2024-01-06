import { rotateCard } from "../../actions/general/rotate-card.js";
import { moveCard } from "../../actions/move-card-logic/move-card.js";
import { getZone } from "../zones/get-zone.js";

const reloadContainer = (user, zoneId) => {
    const zone = getZone(user, zoneId);
    //find all playContainers
    const playContainers = zone.element.querySelectorAll('DIV')
    //loop through each box
    playContainers.forEach((playContainer) => {
        //find all images within box
        const images = (playContainer).querySelectorAll('img');
        //loop through each image and update the attached cards
        images.forEach((image) => {
            if (!image.attached){
                //re-append the card to the end of the same zone
                let currentRotation;
                if (image.PokémonBreak){
                    currentRotation = (parseInt(image.style.transform.replace(/[^0-9-]/g, '')) || 0) - 90;
                } else {
                    currentRotation = parseInt(image.style.transform.replace(/[^0-9-]/g, '')) || 0;
                };
                const numberRotations = currentRotation / 90;
                const index = zone.array.findIndex(card => card.image === image);
                moveCard(user, zoneId, zoneId, index, false, false);
                const newIndex = zone.array.findIndex(card => card.image === image);
                for (let i = 0; i < numberRotations; i ++){
                    rotateCard(user, zoneId, newIndex, false, false);
                };
            };
        });
    });
}

export const reloadBoard = () => {
    const zones = [
        ['self', 'active'],
        ['self', 'bench'],
        ['opp', 'active'],
        ['opp', 'bench'],
    ];

    zones.forEach(([user, zoneId]) => {
        reloadContainer(user, zoneId);
    });
}