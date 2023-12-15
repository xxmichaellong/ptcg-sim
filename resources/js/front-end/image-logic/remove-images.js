export const removeImages = (container_html) => {
    const images = container_html.querySelectorAll('img');
    images.forEach((image) => {
        image.remove();
    });
}