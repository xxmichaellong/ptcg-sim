import { index } from "./initialization.js";
import { hand } from "./initialization.js";

// Function to display the modal when the image is clicked
export function imageClick(event){
    //identify index of the card/image
    index.poo = hand.images.indexOf(event.target);
    var popup = document.getElementById('popup');
    popup.style.display = 'block';
    console.log(hand.images.indexOf(event.target));
    
};

