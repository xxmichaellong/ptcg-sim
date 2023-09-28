const express = require('express');
const app = express();
const port = 3000; // You can choose any available port

// Serve static files (HTML, CSS, JavaScript, etc.) from the current directory
app.use(express.static('/Users/micha/Documents/coding/pokemon/ptcg-sim')); // Change this to your respective directory

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
