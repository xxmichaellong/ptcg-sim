// Function to remove all images inside the container
export function removeImages(container_html){
    const images = container_html.querySelectorAll('img');
    images.forEach((image) => {
        image.remove();
    });
}