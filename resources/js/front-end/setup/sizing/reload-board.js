import { moveCard } from "../../actions/general/move-card.js";
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
                const index = location.cards.findIndex(card => card.image === image);
                moveCard(user, _location, _location_html, _location, _location_html, index)
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









