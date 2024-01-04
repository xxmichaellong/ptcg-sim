import { moveCard } from "../../actions/move-card-logic/move-card.js";
import { rotateCard } from "../../actions/general/rotate-card.js";
import { stringToVariable } from "../zones/zone-string-to-variable.js";

const reloadContainer = (user, zoneArrayString, zoneElementString) => {
    const zoneArray = stringToVariable(user, zoneArrayString);
    const zoneElement = stringToVariable(user, zoneElementString);  
    //find all boxes
    const boxes = zoneElement.querySelectorAll('DIV')
    //loop through each box
    boxes.forEach((box) => {
        //find all images within box
        const images = (box).querySelectorAll('img');
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
                const index = zoneArray.findIndex(card => card.image === image);
                moveCard(user, zoneArrayString, zoneElementString, zoneArrayString, zoneElementString, index, false, false);
                const newIndex = zoneArray.findIndex(card => card.image === image);
                for (let i = 0; i < numberRotations; i ++){
                    rotateCard(user, zoneArrayString, zoneElementString, newIndex, false, false);
                };
            };
        });
    });
}

export const reloadBoard = () => {
    const containerArray = [
        ['self', 'activeArray', 'activeElement'],
        ['self', 'benchArray', 'benchElement'],
        ['opp', 'activeArray', 'activeElement'],
        ['opp', 'benchArray', 'benchElement'],
    ];

    containerArray.forEach(([user, zoneArrayString, zoneElementString]) => {
        reloadContainer(user, zoneArrayString, zoneElementString);
    });
}








