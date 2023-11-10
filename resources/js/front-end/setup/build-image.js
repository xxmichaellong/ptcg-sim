export function buildImage (imageAttributes, image){
    for (const attr in imageAttributes) {
        if (typeof imageAttributes[attr] === 'function') {
            // If it's a function (an event listener), add it as an event listener
            image.addEventListener(attr, imageAttributes[attr]);
        } 
        else {
            // Otherwise, set it as an attribute
            image.setAttribute(attr, imageAttributes[attr]);
        };
    };
}