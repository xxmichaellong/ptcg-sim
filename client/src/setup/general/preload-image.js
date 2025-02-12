export const preloadImage = (url) => {
  const image = new Image();
  image.src = url;
  image.style.width = '0';
  image.style.height = '0';
  image.style.position = 'absolute';
  image.style.top = '-9999px';
  image.style.left = '-9999px';

  document.body.appendChild(image);

  image.addEventListener('load', () => {
    document.body.removeChild(image);
  });
};
