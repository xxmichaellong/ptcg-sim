import { moveCard } from "../../actions/general/move-card.js";
import { rotateCard } from "../../actions/general/rotate-card.js";
import { stringToVariable } from "../containers/string-to-variable.js";

const reloadContainer = (user, location, location_html) => {
    const _location = location;
    const _location_html = location_html;
    location = stringToVariable(user, location);
    location_html = stringToVariable(user, location_html);  
    //find all boxes
    const boxes = location_html.querySelectorAll('DIV')
    //loop through each box
    boxes.forEach((box) => {
        //find all images within box
        const images = (box).querySelectorAll('img');
        //loop through each image and update the attached cards
        images.forEach((image) => {
            if (!image.attached){
                //re-append the card to the end of the same container
                let currentRotation;
                if (image.PokémonBreak){
                    currentRotation = (parseInt(image.style.transform.replace(/[^0-9-]/g, '')) || 0) - 90;
                } else {
                    currentRotation = parseInt(image.style.transform.replace(/[^0-9-]/g, '')) || 0;
                };
                const numberRotations = currentRotation / 90;
                const index = location.cards.findIndex(card => card.image === image);
                moveCard(user, _location, _location_html, _location, _location_html, index, false, true);
                const newIndex = location.cards.findIndex(card => card.image === image);
                for (let i = 0; i < numberRotations; i ++){
                    rotateCard(user, _location, _location_html, newIndex, false, true);
                };
            };
        });
    });
}

export const reloadBoard = () => {
    const containerArray = [
        ['self', 'active', 'active_html'],
        ['self', 'bench', 'bench_html'],
        ['opp', 'active', 'active_html'],
        ['opp', 'bench', 'bench_html'],
    ];

    containerArray.forEach(([user, location, location_html]) => {
        reloadContainer(user, location, location_html);
    });
}









