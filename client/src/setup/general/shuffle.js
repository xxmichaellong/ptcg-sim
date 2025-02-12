export const shuffleIndices = (length) => {
  let indices = Array.from({ length }, (_, i) => i);

  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
};

export const rearrangeArray = (array, indices) => {
  const rearrangedArray = indices.map((newIndex) => array[newIndex]);
  array.length = 0; // Clear the original array
  array.push(...rearrangedArray); // Append the rearranged elements to the original array
};
