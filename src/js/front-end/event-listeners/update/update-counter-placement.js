import { addAbilityCounter } from '../../actions/counters/ability-counter.js';
import { getZoneCount } from '../../actions/general/count.js';
import { benchElement, oppBenchElement } from '../../front-end.js';

let resizeObserver = new ResizeObserver(entries => {
  entries.forEach(entry => {
    if (entry.target.parentNode.id === 'benchElement' || entry.target.parentNode.id === 'oppBenchElement') {
      let selectedBenchArray;
      if (user === 'self'){
        selectedBenchArray = benchArray;
      } else {
        selectedBenchArray = oppBenchArray;
      };
      for (let i = 0; i < getZoneCount(selectedBenchArray); i++){
          const image = selectedBenchArray[i].image;
          if (image.damageCounter){
              addDamageCounter(user, 'benchArray', 'benchElement', i, false);
          };
          if (image.abilityCounter){
            addAbilityCounter(user, 'benchArray', 'benchElement', i, false);
        };
      };
    }
  });
});

// Get all elements inside benchElement and oppBenchElement
let elements = [...benchElement.children, ...oppBenchElement.children];

// Start observing each element
elements.forEach(element => {
  resizeObserver.observe(element);
});
