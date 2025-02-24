import { mouseClick } from '../../front-end.js';

export var areKeybindsSleeping = false;

var runningStartKeybindsSleep = 0;

export async function startKeybindsSleep() {
    if (!mouseClick.selectingCard) {
        return;
    }
    runningStartKeybindsSleep = runningStartKeybindsSleep + 1;
    areKeybindsSleeping = true;
    await new Promise(r => setTimeout(r, 350)); // wait 350 milliseconds
    runningStartKeybindsSleep = runningStartKeybindsSleep - 1;
    if (runningStartKeybindsSleep === 0){
        areKeybindsSleeping = false;
    }
    return;
}