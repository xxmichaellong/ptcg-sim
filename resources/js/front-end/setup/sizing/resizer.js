import { addAbilityCounter } from '../../actions/counters/ability-counter.js';
import { addDamageCounter } from '../../actions/counters/damage-counter.js';
import { addSpecialCondition } from '../../actions/counters/special-condition.js';
import { closeFullView } from '../../actions/general/close-popups.js';
import { hand_html, oppContainers, oppHand_html, oppResizer, selfContainers, selfResizer, stadium_html } from '../../front-end.js';
import { stringToVariable } from '../containers/string-to-variable.js';
import { adjustAlignment } from './adjust-alignment.js';
// Create the overlay div
const overlay = document.createElement('div');
overlay.style.position = 'fixed';
overlay.style.top = 0;
overlay.style.right = 0;
overlay.style.bottom = 0;
overlay.style.left = 0;
overlay.style.zIndex = 1000; // Adjust as needed

export const selfHandleMouseDown = (e) => {
    e.preventDefault();
    window.addEventListener('mousemove', selfResize);
    document.addEventListener('mouseup', stopSelfResize);

    // Add the overlay to the body
    document.body.appendChild(overlay);
    closeFullView(e);
}
export const oppHandleMouseDown = (e) => {
    e.preventDefault();
    window.addEventListener('mousemove', oppResize);
    document.addEventListener('mouseup', stopOppResize);
    // Add the overlay to the body
    document.body.appendChild(overlay);
    closeFullView(e);
}
export const stopSelfResize = (e) => {
    window.removeEventListener('mousemove', selfResize);
    document.removeEventListener('mouseup', stopSelfResize);
    // Remove the overlay from the body
    document.body.removeChild(overlay);
}
export const stopOppResize = (e) => {
    window.removeEventListener('mousemove', oppResize);
    document.removeEventListener('mouseup', stopOppResize);
    // Remove the overlay from the body
    document.body.removeChild(overlay);
}

export const selfResize = (e) => {
    //adjust hand container
    [hand_html, oppHand_html].forEach(adjustAlignment);

    const oldSelfHeight = parseInt(selfContainers.offsetHeight);
    const oldOppHeight = parseInt(oppContainers.offsetHeight);
    const clientY = Math.max(0, Math.min(e.clientY, window.innerHeight + window.innerHeight*.01));
    const newSelfHeight = ((window.innerHeight - clientY) / window.innerHeight) * 100 + 1;
    const newOppHeight = 100 - newSelfHeight;

    // Apply the new heights
    selfContainers.style.height = Math.max(1, newSelfHeight) + '%';

    // Apply the new bottom position
    selfResizer.style.bottom = (100 - (clientY / window.innerHeight) * 100) + '%';
    const _newSelfHeight = parseInt(selfContainers.offsetHeight);
    const selfRatio = _newSelfHeight/oldSelfHeight;
     // Readjust the width of containers on the active/bench
    adjustCards('self', 'bench', 'bench_html', selfRatio);
    adjustCards('self', 'active', 'active_html', selfRatio);
    
    let selfResizerBottom = parseInt(window.getComputedStyle(selfResizer).getPropertyValue('bottom'));
    let oppResizerBottom = parseInt(window.getComputedStyle(oppResizer).getPropertyValue('bottom'));
    
    oppResizer.style.bottom = oppResizer.style.bottom ? oppResizer.style.bottom : '51%';
    if (selfResizerBottom + selfResizer.offsetHeight > oppResizerBottom){
        oppResizer.style.bottom = (100 + 2 - (clientY / window.innerHeight) * 100) + '%';
        oppContainers.style.height = Math.max(1, newOppHeight) + '%';
        oppContainers.style.bottom = (100 + 1 - (clientY / window.innerHeight) * 100) + '%';
        const _newOppHeight = parseInt(oppContainers.offsetHeight);
        const oppRatio = _newOppHeight/oldOppHeight;
        adjustCards('opp', 'bench', 'bench_html', oppRatio);
        adjustCards('opp', 'active', 'active_html', oppRatio);
    };
    stadium_html.style.bottom = (Math.min(84, ((parseFloat(oppResizer.style.bottom) + parseFloat(selfResizer.style.bottom))/2 - 8))) + '%';
    oppResizer.style.height = '2%';
    if (parseFloat(oppResizer.style.bottom) > 100){
        oppResizer.style.height = '6%';
    };
    selfResizer.style.height = '2%';
    if (parseFloat(selfResizer.style.bottom) < 0){
        selfResizer.style.height = '6%';
    };
}
export const oppResize = (e) => {
    //adjust hand container
    [hand_html, oppHand_html].forEach(adjustAlignment);

    const oldSelfHeight = parseInt(selfContainers.offsetHeight);
    const oldOppHeight = parseInt(oppContainers.offsetHeight);

    const clientY = Math.max(-window.innerHeight*.01, Math.min(e.clientY, window.innerHeight));    // Calculate the new heights
    const newSelfHeight = ((window.innerHeight - clientY) / window.innerHeight) * 100 - 1;
    const newOppHeight = 100 - newSelfHeight;
   
    oppResizer.style.bottom = (100 - (clientY / window.innerHeight) * 100) + '%';
    oppContainers.style.height = Math.max(1, newOppHeight) + '%';
    oppContainers.style.bottom = (100 - 1 - (clientY / window.innerHeight) * 100) + '%';
    const _newOppHeight = parseInt(oppContainers.offsetHeight);
    const oppRatio = _newOppHeight/oldOppHeight;
    adjustCards('opp', 'bench', 'bench_html', oppRatio);
    adjustCards('opp', 'active', 'active_html', oppRatio);
    
    let selfResizerBottom = parseInt(window.getComputedStyle(selfResizer).getPropertyValue('bottom'));
    let oppResizerBottom = parseInt(window.getComputedStyle(oppResizer).getPropertyValue('bottom'));
    
    selfResizer.style.bottom = selfResizer.style.bottom ? selfResizer.style.bottom : '49%';
    if (selfResizerBottom + selfResizer.offsetHeight > oppResizerBottom){
        selfContainers.style.height = Math.max(1, newSelfHeight) + '%';
        selfResizer.style.bottom = (100 - 2 - (clientY / window.innerHeight) * 100) + '%';
        const _newSelfHeight = parseInt(selfContainers.offsetHeight);
        const selfRatio = _newSelfHeight/oldSelfHeight;
        adjustCards('self', 'bench', 'bench_html', selfRatio);
        adjustCards('self', 'active', 'active_html', selfRatio);
    };
    stadium_html.style.bottom = (Math.min(84, ((parseFloat(oppResizer.style.bottom) + parseFloat(selfResizer.style.bottom))/2 - 8))) + '%';
    oppResizer.style.height = '2%';
    if (parseFloat(oppResizer.style.bottom) > 100){
        oppResizer.style.height = '6%';
    };
    selfResizer.style.height = '2%';
    if (parseFloat(selfResizer.style.bottom) < 0){
        selfResizer.style.height = '6%';
    };
}

export const adjustCards = (user, location, container, ratio) => {

    const _location = location;
    const _container = container;
    location = stringToVariable(user, location);
    container = stringToVariable(user, container);

    location.cards.forEach(card => {
        if (card.image.attached){
            if (card.type === 'pokemon'){
                const oldBottom = parseFloat(card.image.style.bottom);
                const newBottom = oldBottom * ratio;
                card.image.style.bottom = `${newBottom}px`;
            } else {
                const oldLeft = parseFloat(card.image.style.left);
                const newLeft = oldLeft * ratio;
                card.image.style.left = `${newLeft}px`;
            };
        } else {
            const baseWidth = parseFloat(card.image.clientWidth);
            const adjustment = parseFloat(card.image.clientWidth/6);
            const newWidth = (baseWidth + card.image.energyLayer * adjustment) * ratio;
            card.image.parentElement.style.width = `${newWidth}px`;
        };
        if (card.image.damageCounter){
            const index = location.cards.findIndex(_card => _card === card);
            addDamageCounter(user, _location, _container, index, true);
        };
        if (card.image.specialCondition){
            const index = location.cards.findIndex(_card => _card === card);
            addSpecialCondition(user, _location, _container, index, true);
        };
        if (card.image.abilityCounter){
            const index = location.cards.findIndex(_card => _card === card);
            addAbilityCounter(user, _location, _container, index, true);
        };
    });
}

export const flippedSelfHandleMouseDown = (e) => {
    e.preventDefault();
    window.addEventListener('mousemove', flippedSelfResize);
    document.addEventListener('mouseup', flippedStopSelfResize);

    // Add the overlay to the body
    document.body.appendChild(overlay);
    closeFullView(e);
}
export const flippedOppHandleMouseDown = (e) => {
    e.preventDefault();
    window.addEventListener('mousemove', flippedOppResize);
    document.addEventListener('mouseup', flippedStopOppResize);
    // Add the overlay to the body
    document.body.appendChild(overlay);
    closeFullView(e);
}
export const flippedStopSelfResize = (e) => {
    window.removeEventListener('mousemove', flippedSelfResize);
    document.removeEventListener('mouseup', flippedStopSelfResize);
    // Remove the overlay from the body
    document.body.removeChild(overlay);
}
export const flippedStopOppResize = (e) => {
    window.removeEventListener('mousemove', flippedOppResize);
    document.removeEventListener('mouseup', flippedStopOppResize);
    // Remove the overlay from the body
    document.body.removeChild(overlay);
}

export const flippedSelfResize = (e) => {
    //adjust hand container
    [hand_html, oppHand_html].forEach(adjustAlignment);

    const oldSelfHeight = parseInt(selfContainers.offsetHeight);
    const oldOppHeight = parseInt(oppContainers.offsetHeight);

    const clientY = Math.max(1, Math.min(e.clientY, window.innerHeight - 1));
    const newOppHeight = ((window.innerHeight - clientY) / window.innerHeight) * 100;
    const newSelfHeight = 100 - newOppHeight;

    // Apply the new heights
    oppContainers.style.height = newOppHeight + '%';

    // Apply the new bottom position
    selfResizer.style.bottom = (100 - 1 - (clientY / window.innerHeight) * 100) + '%';
    const _newOppHeight = parseInt(oppContainers.offsetHeight);
    const oppRatio = _newOppHeight/oldOppHeight;
     // Readjust the width of containers on the active/bench
    adjustCards('opp', 'bench', 'bench_html', oppRatio);
    adjustCards('opp', 'active', 'active_html', oppRatio);
    
    let selfResizerBottom = parseInt(window.getComputedStyle(selfResizer).getPropertyValue('bottom'));
    let oppResizerBottom = parseInt(window.getComputedStyle(oppResizer).getPropertyValue('bottom'));
    
    oppResizer.style.bottom = oppResizer.style.bottom ? oppResizer.style.bottom : '51%';
    if (selfResizerBottom + selfResizer.offsetHeight > oppResizerBottom){
        oppResizer.style.bottom = (100 + 1 - (clientY / window.innerHeight) * 100) + '%';
        selfContainers.style.height = newSelfHeight + '%';
        selfContainers.style.bottom = (100 - (clientY / window.innerHeight) * 100) + '%';
        const _newSelfHeight = parseInt(selfContainers.offsetHeight);
        const selfRatio = _newSelfHeight/oldSelfHeight;
        adjustCards('self', 'bench', 'bench_html', selfRatio);
        adjustCards('self', 'active', 'active_html', selfRatio);
    };
    stadium_html.style.bottom = (Math.min(84, ((parseFloat(selfResizer.style.bottom) + parseFloat(oppResizer.style.bottom))/2 - 8))) + '%';
    oppResizer.style.height = '2%';
    if (parseFloat(oppResizer.style.bottom) > 100){
        oppResizer.style.height = '5%';
    };
    selfResizer.style.height = '2%';
    if (parseFloat(selfResizer.style.bottom) < 0){
        selfResizer.style.height = '6%';
    };
}

export const flippedOppResize = (e) => {
    //adjust hand container
    [hand_html, oppHand_html].forEach(adjustAlignment);

    const oldSelfHeight = parseInt(selfContainers.offsetHeight);
    const oldOppHeight = parseInt(oppContainers.offsetHeight);

    const clientY = Math.max(1, Math.min(e.clientY, window.innerHeight - 1));    // Calculate the new heights
    const newOppHeight = ((window.innerHeight - clientY) / window.innerHeight) * 100;
    const newSelfHeight = 100 - newOppHeight;
   
    oppResizer.style.bottom = (100 + 1 - (clientY / window.innerHeight) * 100) + '%';
    selfContainers.style.height = newSelfHeight + '%';
    selfContainers.style.bottom = (100 - (clientY / window.innerHeight) * 100) + '%';
    const _newSelfHeight = parseInt(selfContainers.offsetHeight);
    const selfRatio = _newSelfHeight/oldSelfHeight;
    adjustCards('self', 'bench', 'bench_html', selfRatio);
    adjustCards('self', 'active', 'active_html', selfRatio);
    
    let selfResizerBottom = parseInt(window.getComputedStyle(selfResizer).getPropertyValue('bottom'));
    let oppResizerBottom = parseInt(window.getComputedStyle(oppResizer).getPropertyValue('bottom'));
    
    selfResizer.style.bottom = selfResizer.style.bottom ? selfResizer.style.bottom : '49%';
    if (selfResizerBottom + selfResizer.offsetHeight > oppResizerBottom){
        oppContainers.style.height = newOppHeight + '%';
        selfResizer.style.bottom = (100 - 1 - (clientY / window.innerHeight) * 100) + '%';
        const _newOppHeight = parseInt(oppContainers.offsetHeight);
        const oppRatio = _newOppHeight/oldOppHeight;
        adjustCards('opp', 'bench', 'bench_html', oppRatio);
        adjustCards('opp', 'active', 'active_html', oppRatio);
    };
    stadium_html.style.bottom = (Math.min(84, ((parseFloat(selfResizer.style.bottom) + parseFloat(oppResizer.style.bottom))/2 - 8))) + '%';
    oppResizer.style.height = '2%';
    if (parseFloat(oppResizer.style.bottom) > 100){
        oppResizer.style.height = '5%';
    };
    selfResizer.style.height = '2%';
    if (parseFloat(selfResizer.style.bottom) < 0){
        selfResizer.style.height = '6%';
    };
}