import { addAbilityCounter } from '../../actions/counters/ability-counter.js';
import { oppContainerDocument, selfContainerDocument, systemState } from '../../front-end.js';
import { getZone } from '../../setup/zones/get-zone.js';

export const initializeBenchObserver = () => {
    const resizeObserver = new ResizeObserver(entries => {
        entries.forEach(entry => {
            if (entry.target.parentNode.id === 'bench') {
                const selectedBenchZone = getZone(systemState.user, 'bench');
                for (let i = 0; i < selectedBenchZone.getCount(); i++) {
                    const image = selectedBenchZone.array[i].image;
                    if (image.damageCounter) {
                        addDamageCounter(user, 'bench', i, false);
                    };
                    if (image.abilityCounter) {
                        addAbilityCounter(user, 'bench', i, false);
                    };
                };
            };
        });
    });
    
    const benchElement = selfContainerDocument.getElementById('bench');
    const oppBenchElement = oppContainerDocument.getElementById('bench');
    
    // Get all elements inside benchElement and oppBenchElement
    let elements = [...benchElement.children, ...oppBenchElement.children];
    
    // Start observing each element
    elements.forEach(element => {
        resizeObserver.observe(element);
    });
}