const express = require('express');
const app = express();

const http = require('http');
const server = http.createServer(app);

const port = 8000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile( + '/index.html');
});

// Start the server
server.listen(port, () => {
  console.log(`Client is running at http://localhost:${port}`);
});
