export function resetImage(image){
    image.style.position = 'relative';
    image.style.bottom = '0%';
    image.style.zIndex = '0';
    image.energyLayer = 0;
    image.layer = 0;
    image.relative = 0;
    image.style.left = 0;
    image.attached = false;
    image.target = 'off';
}