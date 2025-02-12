// Check if there's an overflow
const checkOverflow = (element) => {
  return element.scrollWidth > element.clientWidth;
};
// Change the justify-content property based on the overflow
export const adjustAlignment = (element) => {
  if (checkOverflow(element)) {
    element.style.justifyContent = 'flex-start';
  } else {
    element.style.justifyContent = 'center';
  }
};
