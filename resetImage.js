export function resetImage(image){
    image.style.position = 'static';
    image.style.bottom = '0%';
    image.style.zIndex = '0';
    image.layer = 0;
    image.relative = 0;
    image.target = 'off';
}