import { videoContainer } from "../../../front-end.js";

document.getElementById('tutorialButton').addEventListener('click', () => {
  videoContainer.style.display = 'flex';
  videoContainer.innerHTML = `
    <iframe
      width="560"
      height="315"
      src="https://youtu.be/t3qAhO_p3mk?si=r2_PNRskd6QeKRso"
      frameborder="0"
      allowfullscreen
    ></iframe>
  `;
  videoContainer.addEventListener('click', (event) => {
    if (event.target === videoContainer) {
      videoContainer.style.display = 'none';
      videoContainer.innerHTML = '';
    }
  });
});
