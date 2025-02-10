export const resetImage = (image, zoneId = '') => {
  image.style.opacity = 1;
  image.style.position = 'relative';
  image.style.bottom = '0%';
  image.style.zIndex = '0';
  image.energyLayer = 0;
  image.layer = 0;
  image.relative = 0;
  image.style.left = 0;
  image.attached = false;
  image.target = 'off';
  if (image.PokémonBreak && ['active', 'bench'].includes(zoneId)) {
    image.style.transform = 'rotate(90deg)';
  } else {
    image.style.transform = 'rotate(0deg)';
    image.PokémonBreak = false;
  }
  image.classList.remove(
    'default-rotation',
    'prizes-normal-size',
    'prizes-small-size'
  );
};
