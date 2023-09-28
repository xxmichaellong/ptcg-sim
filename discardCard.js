


// Function to discard a card from hand
export function discardCard(){
    // Check that there is a card in hand
    if (hand.count===0){
        const errormsg = 'No more cards in deck';
        console.error(errormsg);
        const error = document.getElementById("deck");
        error.textContent = errormsg;
    }
    else {
        const imgElement = document.createElement('img');
        imgElement.src = deck[0].image;
        imgElement.alt = deck[0].name;

        // Append the <img> element to the container
        hand.appendChild(imgElement);
        deck.splice(0, 1);
        };
}