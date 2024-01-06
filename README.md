# PTCG-sim

Welcome to the PTCG-sim codebase! We're currently in the process of documenting extensively. Stay tuned for detailed information about our open-source journey and how you can contribute. 

PTCG-sim is primarily built with vanilla JavaScript, with Node.js, Express, and Socket.io as the key frameworks. Socket.io is utilized for two-player functionality.

## Running PTCG-sim Locally

Follow these steps to run PTCG-sim on your local machine:

1. **Install Dependencies:** Execute `npm install` to install all the required dependencies.

2. **Configure WebSocket Connection:** Navigate to the `global-variables.js` file and replace the WebSocket connection with your own. For instance:
   ```javascript
   const socket = io('http://localhost:4000/');
   ```
   Ensure that the URL is consistent with the one in the server.

3. **Start Local Server:** Use Node.js to start running `server.js` locally. This will load the repository, starting with `front-end.js`. This file initializes various global variables, sets up the DOM, and registers socket event listeners.

Feel free to explore the codebase and play around with the sim! I'm always happy to answer any questions and open to suggestions.

## Contributing

If you're interested in contributing, we'll soon be releasing detailed information about the contribution process. Stay tuned!

## Open Source

PTCG-sim is an open-source project. We encourage the community to get involved and stay updated with the latest releases and changes in the codebase.

## Contact

Feel free to reach out on:

- [Twitter](https://twitter.com/xxmichaellong)
- [Discord](https://discord.com/invite/Kj8fhVns4g)
- GitHub

Happy testing!

-XXL