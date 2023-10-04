export function moveCard(oLocation, oLocation_html, mLocation, mLocation_html, index){
        // remove card from hand.cards array and add it to bench.cards array
        mLocation.cards.push(...oLocation.cards.splice(index, 1));
    
        // remove img element from hand_html container
        if (oLocation_html.contains(oLocation.images[index])){
            oLocation_html.removeChild(oLocation.images[index]);
        };
    
        // remove img from hand.images array and add it to bench.images array
        mLocation.images.push(...oLocation.images.splice(index, 1));

        // append image to bench_html container
        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);

        //remove popup
        popup.style.display = "none";
    }