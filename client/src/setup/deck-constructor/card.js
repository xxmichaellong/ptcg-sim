import {
  doubleClick,
  imageClick,
  openCardContextMenu,
} from '../image-logic/click-events.js';
import {
  dragEnd,
  dragLeave,
  dragOver,
  dragStart,
} from '../image-logic/drag.js';
import { resetImage } from '../image-logic/reset-image.js';

export class Card {
  name;
  type;
  user;
  image;

  constructor(user, name, type, imageURL) {
    this.user = user;
    this.name = name;
    this.type = type;
    this.imageAttributes = {
      user: user,
      type: type,
      src: imageURL,
      alt: name,
      draggable: true,
      click: imageClick,
      dblclick: doubleClick,
      dragstart: dragStart,
      dragover: dragOver,
      dragleave: dragLeave,
      dragend: dragEnd,
      contextmenu: openCardContextMenu,
    };
    this.buildImage(this.imageAttributes);
  }

  buildImage(imageAttributes) {
    this.image = document.createElement('img');
    for (const attr in imageAttributes) {
      if (typeof imageAttributes[attr] === 'function') {
        this.image.addEventListener(attr, imageAttributes[attr]);
      } else if (attr === 'user') {
        this.image.user = imageAttributes[attr];
      } else if (attr === 'type') {
        this.image.type = imageAttributes[attr];
      } else {
        this.image.setAttribute(attr, imageAttributes[attr]);
      }
    }
    resetImage(this.image);
  }
}
