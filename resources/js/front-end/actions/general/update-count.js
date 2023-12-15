import { selfContainersDocument } from '../../initialization/containers/self-containers.js';
import { oppContainersDocument } from '../../initialization/containers/opp-containers.js';
import { stringToVariable } from '../../setup/containers/string-to-variable.js';

export const updateCount = () => {
    const containerNames = ['deck', 'discard', 'lostzone'];
  
    containerNames.forEach((containerId) => {
        const selfElement = selfContainersDocument.getElementById(`${containerId}Count`);
        const oppElement = oppContainersDocument.getElementById(`${containerId}Count`);
    
        const selfLocation = stringToVariable('self', containerId);
        const oppLocation = stringToVariable('opp', containerId);

        selfElement.textContent = selfLocation.count;
        oppElement.textContent = oppLocation.count;
    });
};
  