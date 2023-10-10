// Function to remove all images inside the container
export function removeImages(container) {
    const images = container.querySelectorAll('img');
    images.forEach((image) => {
        image.remove();
    });
}
