export const removeImages = (element) => {
  const images = element.querySelectorAll('img');
  images.forEach((image) => {
    image.remove();
  });
};
