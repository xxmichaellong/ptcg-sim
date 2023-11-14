// Function to shuffle indices
export function shuffleIndices(length){
    let indices = Array.from({length}, (_, i) => i); // Generate array of indices

    for (let i = length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    return indices;
}

// Function to rearrange array based on shuffled indices
export function rearrangeArray(array, indices){
    return indices.map(i => array[i]);
}
