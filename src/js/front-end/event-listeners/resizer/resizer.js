import { oppResizer, selfResizer } from '../../front-end.js';
import { oppHandleMouseDown, selfHandleMouseDown } from '../../setup/sizing/resizer.js';

selfResizer.addEventListener('mousedown', selfHandleMouseDown);
oppResizer.addEventListener('mousedown', oppHandleMouseDown);