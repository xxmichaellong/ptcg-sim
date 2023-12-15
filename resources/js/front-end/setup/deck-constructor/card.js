import { imageFunctions } from './image-function-references.js';
import { resetImage } from '../../image-logic/reset-image.js';

export class Card {
    name;
    type;
    image;

    constructor(rawCardAttributes, rawImageAttributes){
        this.rawCardAttributes = rawCardAttributes;
        this.rawImageAttributes = rawImageAttributes;
        this.buildCard(JSON.parse(rawCardAttributes)),
        this.buildImage(JSON.parse(rawImageAttributes));
    }

    buildCard(cardAttributes){
        for (const attr in cardAttributes){
            if (attr === 'name'){
                this.name = cardAttributes[attr];
            }
            if (attr === 'type'){
                this.type = cardAttributes[attr];
            }
        };
    }

    buildImage(imageAttributes){
        this.image = document.createElement('img');
        for (const attr in imageAttributes){
            if (imageFunctions.hasOwnProperty(imageAttributes[attr])){
                this.image.addEventListener(attr, imageFunctions[imageAttributes[attr]]);
            } else if (attr === 'style'){
                for (const styleAttr in imageAttributes[attr]){
                    this.image.style[styleAttr] = imageAttributes[attr][styleAttr];
                };
            } else if (attr === 'user'){
                this.image.user = imageAttributes[attr];
            }else {
                this.image.setAttribute(attr, imageAttributes[attr]);
            };
        };
        resetImage(this.image);
    }
}